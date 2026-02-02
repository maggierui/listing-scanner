import { stringify } from 'csv-stringify/sync';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import dbManager from './src/db/DatabaseListingsManager.js';

// Ensure exports directory exists
async function ensureExportsDir() {
    try {
        await mkdir('exports', { recursive: true });
    } catch (error) {
        // Directory might already exist, that's fine
    }
}

// Get all items from database and export to CSV
async function generatePreviousListingsCSV() {
    try {
        // Get all active items from database
        const query = `
            SELECT item_id, title, price, seller_id, first_found_at, last_seen_at
            FROM all_search_results
            WHERE is_active = 1
            ORDER BY last_seen_at DESC
        `;

        const results = dbManager.db.prepare(query).all();

        // Convert to CSV format
        const csvData = stringify(results, {
            header: true,
            columns: ['item_id', 'title', 'price', 'seller_id', 'first_found_at', 'last_seen_at']
        });

        return csvData;
    } catch (error) {
        console.error('Error generating previous listings CSV:', error);
        throw error;
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

// Auto-export scan results to file
async function autoExportScanResults(results, searchName = 'scan') {
    try {
        await ensureExportsDir();

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `${searchName.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.csv`;
        const filepath = join('exports', filename);

        // Transform results to simple format
        const simplifiedResults = results.map(item => ({
            title: item.title || 'N/A',
            price: item.price?.value || 'N/A',
            currency: item.price?.currency || 'USD',
            seller: item.seller?.username || 'N/A',
            feedbackScore: item.seller?.feedbackScore || 'N/A',
            link: item.itemWebUrl || '#',
            itemId: item.itemId || 'N/A'
        }));

        const csvData = stringify(simplifiedResults, {
            header: true,
            columns: ['title', 'price', 'currency', 'seller', 'feedbackScore', 'itemId', 'link']
        });

        await writeFile(filepath, csvData, 'utf8');

        console.log(`Auto-exported scan results to: ${filepath}`);
        return filepath;
    } catch (error) {
        console.error('Error auto-exporting scan results:', error);
        // Don't throw - export failure shouldn't break the scan
        return null;
    }
}

export { generatePreviousListingsCSV, generateSearchResultsCSV, autoExportScanResults };
