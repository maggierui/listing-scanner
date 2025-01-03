import { fetchAllListings,fetchListingsForPhrase} from './ebay.js';
import fetchAccessToken from './auth.js';
import logger from '../utils/logger.js';
import fs from 'fs/promises';

// Scan state
export let scanInProgress = false;
export let scanResults = {
    status: 'idle',
    listings: [],
    lastUpdated: null,
    error: null,
    logMessages: []
};



export async function startScan(searchPhrases, typicalPhrases, feedbackThreshold, conditions) {
    if (scanInProgress) {
        throw new Error('A scan is already in progress');
    }
    try {
        // Reset and start scan
        scanInProgress = true;
        scanResults.status = 'scanning';
        scanResults.error = null;
        scanResults.logMessages = [];
        scanResults.listings = [];

        // Debug log the parameters
        await logger.log('\n=== Starting new scan ===');
        await logger.log('Parameters:', JSON.stringify({
            searchPhrases,
            typicalPhrases,
            feedbackThreshold,
            conditions
        }));

        // Add validation at the start of the function
        if (!searchPhrases || !Array.isArray(searchPhrases)) {
            await logger.log('Error: Invalid or missing search phrases');
            return; // Return instead of throwing error for automated rescans
        }
        if (!typicalPhrases || !Array.isArray(typicalPhrases)) {
            await logger.log('Error: Invalid or missing typical phrases');
            return; // Return instead of throwing error for automated rescans
        }
        if (!feedbackThreshold) {
            await logger.log('Error: Missing feedback threshold');
            return; // Return instead of throwing error for automated rescans
        }


        const scanStartTime = new Date().toISOString().split('T')[0];
        const logFileName = `ebay-scanner-${scanStartTime}.txt`;
        
        await fs.appendFile(logFileName, `\n\n========================================\n`);
        await fs.appendFile(logFileName, `startScan function - New Scan Started at ${new Date().toLocaleString()}\n`);
        await fs.appendFile(logFileName, `========================================\n\n`);
        await logger.log(JSON.stringify({ searchPhrases, feedbackThreshold, typicalPhrases, conditions }, null, 2));

    

        // Get eBay access token
        await logger.log('Getting eBay access token...');
        const accessToken = await fetchAccessToken();
        await logger.log('Access token obtained');

        // Fetch listings for each search phrase
        const allListings = [];
        for (const phrase of searchPhrases) {
            await logger.log(`\nProcessing search phrase: "${phrase}"`);
            try {
                const listings = await fetchListingsForPhrase(
                    accessToken,
                    phrase,
                    typicalPhrases,
                    feedbackThreshold,
                    conditions
                );
                await logger.log(`Found ${listings.length} listings for "${phrase}"`);
                allListings.push(...listings);
            } catch (error) {
                await logger.log(`Error processing phrase "${phrase}": ${error.message}`);
            }
        }
            // Update results
        await logger.log(`\nScan completed. Total listings found: ${allListings.length}`);
        scanResults.listings = allListings;
        scanResults.lastUpdated = new Date();
        scanResults.status = 'completed';

    } catch (error) {
        await logger.log('Scan error:', error.message);
        scanResults.error = error.message;
        scanResults.status = 'error';
        throw error;
    } finally {
        scanInProgress = false;
    }
}
        
     