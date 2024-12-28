import pkg from 'pg';
const { Pool } = pkg;
import logger from './logger.js';

class DatabaseListingsManager {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
    }

    async init() {
        try {
            // Create table for previous listings (existing listings)
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS previous_listings (
                    item_id TEXT PRIMARY KEY,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Database initialized');
        } catch (error) {
            console.error('Database initialization error:', error);
            throw error;
        }
    }

    async has(itemId) {
        const result = await this.pool.query(
            'SELECT EXISTS(SELECT 1 FROM previous_listings WHERE item_id = $1)',
            [itemId]
        );
        return result.rows[0].exists;
    }

    async addMany(itemIds) {
        if (!itemIds.length) return;
        const values = itemIds.map((_, index) => `($${index + 1})`).join(',');
        await this.pool.query(
            `INSERT INTO previous_listings (item_id) VALUES ${values} 
             ON CONFLICT (item_id) DO NOTHING`,
            itemIds
        );
    }
}

export default DatabaseListingsManager;