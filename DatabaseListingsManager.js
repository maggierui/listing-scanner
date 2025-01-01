import pkg from 'pg';
const { Pool } = pkg;
import logger from './logger.js';

/**
 * Database Schema Documentation
 * 
 * 1. all_search_results
 * Stores unique eBay items found during searches
 * @table all_search_results
 * @column {SERIAL} id - Primary key
 * @column {TEXT} item_id - Unique eBay item identifier
 * @column {TEXT} title - Item listing title
 * @column {DECIMAL(10,2)} price - Item price
 * @column {TEXT} url - eBay listing URL
 * @column {TEXT} seller_id - eBay seller's identifier
 * @column {TIMESTAMP} first_found_at - When item was first discovered
 * @column {TIMESTAMP} last_seen_at - When item was last seen in search results
 * @column {BOOLEAN} is_active - Whether item is still available
 * @index idx_results_item_id - Index on item_id for faster lookups
 * @index idx_results_last_seen - Index on last_seen_at for date filtering
 * 
 * 2. saved_searches
 * Stores user's search configurations
 * @table saved_searches
 * @column {SERIAL} id - Primary key
 * @column {VARCHAR(255)} name - User-given name for the search
 * @column {TEXT[]} search_phrases - Array of search terms
 * @column {TEXT[]} typical_phrases - Array of category-specific phrases
 * @column {INTEGER} feedback_threshold - Minimum seller rating
 * @column {TEXT[]} conditions - Array of acceptable item conditions
 * @column {TIMESTAMP} created_at - When search was created
 * 
 * 3. search_result_mappings
 * Maps items to the searches that found them (many-to-many relationship)
 * @table search_result_mappings
 * @column {INTEGER} search_id - References saved_searches(id)
 * @column {INTEGER} result_id - References all_search_results(id)
 * @column {TIMESTAMP} found_at - When this search found this item
 * @constraint PRIMARY KEY (search_id, result_id) - Prevents duplicate mappings
 * @constraint FOREIGN KEY search_id REFERENCES saved_searches(id)
 * @constraint FOREIGN KEY result_id REFERENCES all_search_results(id)
 * 
 * Relationships:
 * - One saved search can find many items (through mappings)
 * - One item can be found by many searches (through mappings)
 * - Mappings table creates many-to-many relationship
 * 
 * Example Query Flow:
 * 1. User creates search → Insert into saved_searches
 * 2. Search finds items → Insert into all_search_results
 * 3. Link items to search → Insert into search_result_mappings
 * 4. Get search results → Join mappings with all_search_results
 */

/**
 * Class to manage database operations for eBay listings and saved searches
 * Handles two main functions:
 * 1. Search Results Management: Tracks and maps eBay items to saved searches
 * 2. Saved Searches Management: Stores user's search configurations
 */
class DatabaseListingsManager {
    /**
     * Constructor initializes the PostgreSQL database connection using Heroku's DATABASE_URL
     */
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
    }

    /**
     * Initializes database by creating necessary tables if they don't exist
     * Creates tables: all_search_results, search_result_mappings, saved_searches
     */
    async init() {
        try {
            // Create the main results table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS all_search_results (
                id SERIAL PRIMARY KEY,
                item_id TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                price DECIMAL(10,2),
                url TEXT,
                seller_id TEXT,
                first_found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true
            )
            `);
        // Create the mapping table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS search_result_mappings (
                search_id INTEGER REFERENCES saved_searches(id),
                result_id INTEGER REFERENCES all_search_results(id),
                found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (search_id, result_id)
            )
        `);

        // Create indexes for better performance
        await this.pool.query(`
            CREATE INDEX IF NOT EXISTS idx_results_item_id ON all_search_results(item_id);
            CREATE INDEX IF NOT EXISTS idx_results_last_seen ON all_search_results(last_seen_at);
        `);

         // Creates 'saved_searches' table if it doesn't exist
        // This table stores user's search configurations
        await this.pool.query(`
                CREATE TABLE IF NOT EXISTS saved_searches (
                    id SERIAL PRIMARY KEY,           -- Auto-incrementing unique ID
                    name VARCHAR(255) NOT NULL,      -- User-given name for the search
                    search_phrases TEXT[] NOT NULL,  -- Array of search terms
                    typical_phrases TEXT[] NOT NULL, -- Array of category-specific phrases
                    feedback_threshold INTEGER NOT NULL,  -- Seller rating threshold
                    conditions TEXT[] NOT NULL,      -- Array of acceptable item conditions
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- When search was created
                )
            `);
        
            
            console.log('Database initialized');
        } catch (error) {
            console.error('Database initialization error:', error);
            throw error;
        }
    }

    /**
     * Retrieves existing search results for a specific saved search
     * @param {number} searchId - The ID of the saved search
     * @returns {Array} Array of search results that are:
     *                  1. Associated with this search
     *                  2. Still active
     *                  3. Seen within the last 24 hours
     */
    async checkExistingResults(searchId) {
        const query = `
            SELECT r.* 
            FROM all_search_results r
            JOIN search_result_mappings m ON r.id = m.result_id
            WHERE m.search_id = $1
            AND r.is_active = true
            AND r.last_seen_at > NOW() - INTERVAL '24 hours'
            ORDER BY r.first_found_at DESC
        `;
        
        const results = await this.pool.query(query, [searchId]);
        return results.rows;
    }

    /**
     * Saves a new search result and creates mapping to saved search
     * Uses transaction to ensure data consistency
     * @param {number} searchId - The ID of the saved search
     * @param {Object} item - The eBay item to save
     * @param {string} item.itemId - eBay's unique item identifier
     * @param {string} item.title - Item title
     * @param {number} item.price - Item price
     * @param {string} item.url - Item listing URL
     * @param {string} item.sellerId - eBay seller's ID
     * @throws {Error} If database operations fail
     */
    async saveSearchResult(searchId, item) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Insert or update the item
            const itemQuery = `
                INSERT INTO all_search_results 
                    (item_id, title, price, url, seller_id)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (item_id) DO UPDATE
                SET last_seen_at = CURRENT_TIMESTAMP,
                    is_active = true
                RETURNING id
            `;

            const itemResult = await client.query(itemQuery, [
                item.itemId,
                item.title,
                item.price,
                item.url,
                item.sellerId
            ]);

            // Create the mapping
            const mappingQuery = `
                INSERT INTO search_result_mappings (search_id, result_id)
                VALUES ($1, $2)
                ON CONFLICT DO NOTHING
            `;

            await client.query(mappingQuery, [
                searchId,
                itemResult.rows[0].id
            ]);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Saves a new search configuration to the database
     * @param {string} name - User-given name for the search
     * @param {string[]} searchPhrases - Array of search terms
     * @param {string[]} typicalPhrases - Array of category-specific phrases
     * @param {number} feedbackThreshold - Minimum seller rating
     * @param {string[]} conditions - Array of acceptable item conditions
     * @returns {number} The ID of the newly created search
     */
    async saveSearch(name, searchPhrases, typicalPhrases, feedbackThreshold, conditions) {
        const result = await this.pool.query(
            `INSERT INTO saved_searches 
            (name, search_phrases, typical_phrases, feedback_threshold, conditions)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id`,
            [name, searchPhrases, typicalPhrases, feedbackThreshold, conditions]
        );
        return result.rows[0].id;
    }

    /**
     * Retrieves all saved searches from the database
     * @returns {Array} Array of all saved searches, ordered by creation date
     */
    async getSavedSearches() {
        const result = await this.pool.query(
            'SELECT * FROM saved_searches ORDER BY created_at DESC'
        );
        return result.rows;
    }

    /**
     * Retrieves a specific saved search by its ID
     * @param {number} id - The ID of the saved search to retrieve
     * @returns {Object|undefined} The saved search configuration or undefined if not found
     */
    async getSavedSearchById(id) {
        const result = await this.pool.query(
            'SELECT * FROM saved_searches WHERE id = $1',
            [id]
        );
        return result.rows[0];
    }

    /**
     * Retrieves all results associated with a specific saved search
     * @param {number} searchId - The ID of the saved search
     * @returns {Array} Array of search results, ordered by when they were first found
     */
    async getSearchResults(searchId) {
        const query = `
            SELECT r.* 
            FROM all_search_results r
            JOIN search_result_mappings m ON r.id = m.result_id
            WHERE m.search_id = $1
            AND r.is_active = true
            ORDER BY r.first_found_at DESC
        `;
        
        const results = await this.pool.query(query, [searchId]);
        return results.rows;
    }
}

export default DatabaseListingsManager;