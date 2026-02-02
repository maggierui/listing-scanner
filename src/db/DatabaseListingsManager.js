import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Database Schema Documentation
 *
 * 1. all_search_results
 * Stores unique eBay items found during searches
 * @table all_search_results
 * @column {INTEGER} id - Primary key (auto-increment)
 * @column {TEXT} item_id - Unique eBay item identifier
 * @column {TEXT} title - Item listing title
 * @column {REAL} price - Item price
 * @column {TEXT} url - eBay listing URL
 * @column {TEXT} seller_id - eBay seller's identifier
 * @column {TEXT} first_found_at - When item was first discovered (ISO datetime)
 * @column {TEXT} last_seen_at - When item was last seen in search results (ISO datetime)
 * @column {INTEGER} is_active - Whether item is still available (1=true, 0=false)
 * @index idx_results_item_id - Index on item_id for faster lookups
 * @index idx_results_last_seen - Index on last_seen_at for date filtering
 *
 * 2. saved_searches
 * Stores user's search configurations
 * @table saved_searches
 * @column {INTEGER} id - Primary key (auto-increment)
 * @column {TEXT} name - User-given name for the search
 * @column {TEXT} search_phrases - JSON array of search terms
 * @column {TEXT} typical_phrases - JSON array of category-specific phrases
 * @column {INTEGER} feedback_threshold - Minimum seller rating
 * @column {TEXT} conditions - JSON array of acceptable item conditions
 * @column {TEXT} created_at - When search was created (ISO datetime)
 *
 * 3. search_result_mappings
 * Maps items to the searches that found them (many-to-many relationship)
 * @table search_result_mappings
 * @column {INTEGER} search_id - References saved_searches(id)
 * @column {INTEGER} result_id - References all_search_results(id)
 * @column {TEXT} found_at - When this search found this item (ISO datetime)
 * @constraint PRIMARY KEY (search_id, result_id) - Prevents duplicate mappings
 * @constraint FOREIGN KEY search_id REFERENCES saved_searches(id)
 * @constraint FOREIGN KEY result_id REFERENCES all_search_results(id)
 *
 * Relationships:
 * - One saved search can find many items (through mappings)
 * - One item can be found by many searches (through mappings)
 * - Mappings table creates many-to-many relationship
 */

/**
 * Class to manage database operations for eBay listings and saved searches
 * Now using SQLite instead of PostgreSQL for local-only deployment
 * Handles two main functions:
 * 1. Search Results Management: Tracks and maps eBay items to saved searches
 * 2. Saved Searches Management: Stores user's search configurations
 */
class DatabaseListingsManager {
    /**
     * Constructor initializes the SQLite database connection
     * Database file is stored in the project root directory
     */
    constructor() {
        // Database file path - stored in project root
        const dbPath = join(__dirname, '..', '..', 'scanner.db');

        console.log('Connecting to SQLite database at:', dbPath);

        // Open database (creates file if it doesn't exist)
        this.db = new Database(dbPath);

        // Enable foreign keys (disabled by default in SQLite)
        this.db.pragma('foreign_keys = ON');

        // Enable WAL mode for better concurrency
        this.db.pragma('journal_mode = WAL');
    }

    /**
     * Initializes database by creating necessary tables if they don't exist
     * Creates tables: all_search_results, search_result_mappings, saved_searches
     */
    init() {
        try {
            // 1. First create saved_searches table (because other tables reference it)
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS saved_searches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    search_phrases TEXT NOT NULL,
                    typical_phrases TEXT NOT NULL,
                    feedback_threshold INTEGER NOT NULL,
                    conditions TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            `);

            // 2. Then create all_search_results table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS all_search_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    item_id TEXT UNIQUE NOT NULL,
                    title TEXT NOT NULL,
                    price REAL,
                    url TEXT,
                    seller_id TEXT,
                    first_found_at TEXT DEFAULT (datetime('now')),
                    last_seen_at TEXT DEFAULT (datetime('now')),
                    is_active INTEGER DEFAULT 1
                )
            `);

            // 3. Finally create search_result_mappings table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS search_result_mappings (
                    search_id INTEGER REFERENCES saved_searches(id),
                    result_id INTEGER REFERENCES all_search_results(id),
                    found_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (search_id, result_id)
                )
            `);

            // Create indexes for better performance
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_results_item_id ON all_search_results(item_id);
                CREATE INDEX IF NOT EXISTS idx_results_last_seen ON all_search_results(last_seen_at);
            `);

            console.log('Database initialized successfully');
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
     *                  3. Seen within the last 7 days (for deduplication)
     */
    checkExistingResults(searchId) {
        const query = `
            SELECT r.*
            FROM all_search_results r
            JOIN search_result_mappings m ON r.id = m.result_id
            WHERE m.search_id = ?
            AND r.is_active = 1
            AND r.last_seen_at > datetime('now', '-7 days')
            ORDER BY r.first_found_at DESC
        `;

        return this.db.prepare(query).all(searchId);
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
    saveSearchResult(searchId, item) {
        const saveTransaction = this.db.transaction(() => {
            // Insert or update the item
            const itemQuery = `
                INSERT INTO all_search_results
                    (item_id, title, price, url, seller_id)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (item_id) DO UPDATE
                SET last_seen_at = datetime('now'),
                    is_active = 1
            `;

            const itemStmt = this.db.prepare(itemQuery);
            itemStmt.run(
                item.itemId,
                item.title,
                item.price,
                item.url,
                item.sellerId
            );

            // Get the item ID (either just inserted or existing)
            const getItemId = this.db.prepare(
                'SELECT id FROM all_search_results WHERE item_id = ?'
            );
            const itemResult = getItemId.get(item.itemId);

            // Create the mapping
            const mappingQuery = `
                INSERT INTO search_result_mappings (search_id, result_id)
                VALUES (?, ?)
                ON CONFLICT DO NOTHING
            `;

            const mappingStmt = this.db.prepare(mappingQuery);
            mappingStmt.run(searchId, itemResult.id);
        });

        saveTransaction();
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
    saveSearch(name, searchPhrases, typicalPhrases, feedbackThreshold, conditions) {
        const stmt = this.db.prepare(`
            INSERT INTO saved_searches
            (name, search_phrases, typical_phrases, feedback_threshold, conditions)
            VALUES (?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            name,
            JSON.stringify(searchPhrases),
            JSON.stringify(typicalPhrases),
            feedbackThreshold,
            JSON.stringify(conditions)
        );

        return result.lastInsertRowid;
    }

    /**
     * Retrieves all saved searches from the database
     * Parses JSON arrays back into JavaScript arrays
     * @returns {Array} Array of all saved searches, ordered by creation date
     */
    getSavedSearches() {
        const stmt = this.db.prepare(
            'SELECT * FROM saved_searches ORDER BY created_at DESC'
        );

        const searches = stmt.all();

        // Parse JSON strings back to arrays
        return searches.map(search => ({
            ...search,
            search_phrases: JSON.parse(search.search_phrases),
            typical_phrases: JSON.parse(search.typical_phrases),
            conditions: JSON.parse(search.conditions)
        }));
    }

    /**
     * Retrieves a specific saved search by its ID
     * @param {number} id - The ID of the saved search to retrieve
     * @returns {Object|undefined} The saved search configuration or undefined if not found
     */
    getSavedSearchById(id) {
        const stmt = this.db.prepare('SELECT * FROM saved_searches WHERE id = ?');
        const search = stmt.get(id);

        if (!search) return undefined;

        // Parse JSON strings back to arrays
        return {
            ...search,
            search_phrases: JSON.parse(search.search_phrases),
            typical_phrases: JSON.parse(search.typical_phrases),
            conditions: JSON.parse(search.conditions)
        };
    }

    /**
     * Retrieves all results associated with a specific saved search
     * @param {number} searchId - The ID of the saved search
     * @returns {Array} Array of search results, ordered by when they were first found
     */
    getSearchResults(searchId) {
        const query = `
            SELECT r.*
            FROM all_search_results r
            JOIN search_result_mappings m ON r.id = m.result_id
            WHERE m.search_id = ?
            AND r.is_active = 1
            ORDER BY r.first_found_at DESC
        `;

        const stmt = this.db.prepare(query);
        return stmt.all(searchId);
    }

    /**
     * Marks old items as inactive if they haven't been seen in 90 days
     * This helps keep the database clean and improves query performance
     * @returns {number} Number of items marked as inactive
     */
    cleanupOldItems() {
        const stmt = this.db.prepare(`
            UPDATE all_search_results
            SET is_active = 0
            WHERE last_seen_at < datetime('now', '-90 days')
            AND is_active = 1
        `);

        const result = stmt.run();

        if (result.changes > 0) {
            logger.log(`Cleaned up ${result.changes} old items (not seen in 90 days)`);
        }

        return result.changes;
    }

    /**
     * Gets all items seen recently (for deduplication during scans)
     * @param {number} days - Number of days to look back (default: 7)
     * @returns {Set} Set of item IDs seen in the last N days
     */
    getRecentItemIds(days = 7) {
        const stmt = this.db.prepare(`
            SELECT item_id
            FROM all_search_results
            WHERE last_seen_at > datetime('now', '-' || ? || ' days')
        `);

        const items = stmt.all(days);
        return new Set(items.map(item => item.item_id));
    }

    /**
     * Closes the database connection
     * Should be called when shutting down the application
     */
    close() {
        this.db.close();
        console.log('Database connection closed');
    }
}

// Create a singleton instance
const dbManager = new DatabaseListingsManager();

// Export both the class and the singleton instance
export { DatabaseListingsManager };
export default dbManager;
