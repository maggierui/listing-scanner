import pkg from 'pg';
const { Pool } = pkg;
import logger from './logger.js';

/**
 * Class to manage database operations for eBay listings and saved searches
 * Handles two main functions:
 * 1. Previous Listings Management: Tracks processed eBay items
 * 2. Saved Searches Management: Stores user's search configurations
 */
class DatabaseListingsManager {
    /**
     * Constructor initializes the PostgreSQL database connection using Heroku's DATABASE_URL
     */
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,  // Gets database URL from environment variables
            ssl: {
                rejectUnauthorized: false  // Required for Heroku PostgreSQL
            }
        });
    }

    /**
     * Initializes database by creating necessary tables if they don't exist
     * Called when the application starts
     */
    async init() {
        try {
            // Creates 'previous_listings' table if it doesn't exist
            // This table stores IDs of listings we've already processed
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS previous_listings (
                    item_id TEXT PRIMARY KEY,        -- Unique eBay item ID
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- When we first saw this item
                )
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
     * Checks if a specific eBay item has already been processed
     * @param {string} itemId - The eBay item ID to check
     * @returns {boolean} True if item exists in database, false otherwise
     */
    async has(itemId) {
        const result = await this.pool.query(
            'SELECT EXISTS(SELECT 1 FROM previous_listings WHERE item_id = $1)',
            [itemId]  // Prevents SQL injection by using parameterized query
        );
        return result.rows[0].exists;  // Returns true/false
    }

    /**
     * Adds multiple eBay item IDs to previous_listings table
     * @param {string[]} itemIds - Array of eBay item IDs to add
     */
    async addMany(itemIds) {
        if (!itemIds.length) return;  // Skip if no items to add
        
        // Creates a string like ($1),($2),($3) for the SQL query
        const values = itemIds.map((_, index) => `($${index + 1})`).join(',');
        
        // Inserts all items, ignoring duplicates using ON CONFLICT
        await this.pool.query(
            `INSERT INTO previous_listings (item_id) VALUES ${values} 
             ON CONFLICT (item_id) DO NOTHING`,
            itemIds
        );
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
            RETURNING id`,  // Returns the ID of the newly created search
            [name, searchPhrases, typicalPhrases, feedbackThreshold, conditions]
        );
        return result.rows[0].id;  // Returns the new search ID
    }

    /**
     * Retrieves all saved searches from the database
     * @returns {Array} Array of all saved searches, ordered by creation date
     */
    async getSavedSearches() {
        const result = await this.pool.query(
            'SELECT * FROM saved_searches ORDER BY created_at DESC'
        );
        return result.rows;  // Returns array of all saved searches
    }

    /**
     * Retrieves a specific saved search by its ID
     * @param {number} id - The ID of the saved search to retrieve
     * @returns {Object} The saved search configuration or undefined if not found
     */
    async getSavedSearchById(id) {
        const result = await this.pool.query(
            'SELECT * FROM saved_searches WHERE id = $1',
            [id]  // Prevents SQL injection by using parameterized query
        );
        return result.rows[0];  // Returns the search configuration or undefined if not found
    }
}

// Export the class for use in other files
export default DatabaseListingsManager;