import { Pool } from 'pg';
import { stringify } from 'csv-stringify/sync';

// CSV download handlers for server
async function generatePreviousListingsCSV() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        const result = await pool.query(
            'SELECT item_id, created_at FROM previous_listings ORDER BY created_at DESC'
        );
        
        // Convert to CSV format
        const csvData = stringify(result.rows, {
            header: true,
            columns: ['item_id', 'created_at']
        });
        
        return csvData;
    } catch (error) {
        console.error('Error generating previous listings CSV:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Convert search results to CSV
function generateSearchResultsCSV(results) {
    const csvData = stringify(results.map(item => ({
        title: item.title,
        price: item.price,
        currency: item.currency,
        seller: item.seller,
        feedbackScore: item.feedbackScore,
        link: item.link
    })), {
        header: true,
        columns: ['title', 'price', 'currency', 'seller', 'feedbackScore', 'link']
    });
    
    return csvData;
}

export { generatePreviousListingsCSV, generateSearchResultsCSV };