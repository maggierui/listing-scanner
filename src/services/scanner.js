import { fetchAllListings,fetchListingsForPhrase} from './ebay.js';
import fetchAccessToken from './auth.js';
import logger from '../utils/logger.js';
import dbManager from '../db/DatabaseListingsManager.js';
import { autoExportScanResults } from '../../csv-handlers.js';
import fs from 'fs/promises';
import { progressState, resetProgress, updatePhraseProgress } from './progress.js';

// Scan state
export let scanInProgress = false;
export let scanResults = {
    status: 'idle',
    listings: [],
    lastUpdated: null,
    error: null,
    logMessages: [],
    get progress() {
        return progressState;  // Reference the shared progress state
    }
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

        // Reset progress using the shared module
        resetProgress();
        progressState.totalPhrases = searchPhrases.length;

        // Clear old log messages from logger
        logger.clearMessages();

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

    

        // Clean up old items (not seen in 90 days)
        dbManager.cleanupOldItems();

        // Get eBay access token
        await logger.log('Getting eBay access token...');
        const accessToken = await fetchAccessToken();
        await logger.log('Access token obtained');

        // Fetch listings for each search phrase
        const allListings = [];
        for (let i = 0; i < searchPhrases.length; i++) {
            const phrase = searchPhrases[i];

            // Update progress using the shared module
            updatePhraseProgress(phrase, i + 1, searchPhrases.length);

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

        // Auto-export results to CSV
        if (allListings.length > 0) {
            const exportPath = await autoExportScanResults(allListings, 'scan');
            if (exportPath) {
                await logger.log(`Results exported to: ${exportPath}`);
            }
        }

    } catch (error) {
        await logger.log('Scan error:', error.message);
        scanResults.error = error.message;
        scanResults.status = 'error';
        throw error;
    } finally {
        scanInProgress = false;
    }
}
        
     