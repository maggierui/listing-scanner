import { fetchAllListings,fetchListingsForPhrase} from './ebay.js';
import fetchAccessToken from './auth.js';
import logger from '../utils/logger.js';
import fs from 'fs/promises';

// Scan state
export let scanResults = {
    status: 'idle',
    listings: [],
    lastUpdated: null,
    error: null,
    logMessages: []
};

export let scanInProgress = false;

export async function startScan(searchPhrases, typicalPhrases, feedbackThreshold, conditions) {
    if (scanInProgress) {
        throw new Error('A scan is already in progress');
    }
    try {
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

        

        // Add debug logging
        await logger.log('Scan parameters:');
        await logger.log(`- Search Phrases: ${JSON.stringify(searchPhrases)}`);
        await logger.log(`- Feedback Threshold: ${feedbackThreshold}`);
        await logger.log(`- Typical Phrases: ${JSON.stringify(typicalPhrases)}`);
        await logger.log(`- Conditions: ${JSON.stringify(conditions)}`);
        // Reset and start scan
        scanInProgress = true;
        scanResults.status = 'scanning';
        scanResults.error = null;
        scanResults.logMessages = [];
        scanResults.listings = [];  // Clear previous listings

        console.log('Starting scan with parameters:', {
            searchPhrases,
            typicalPhrases,
            feedbackThreshold,
            conditions
        });

        // Get eBay access token
        console.log('Getting eBay access token...');
        const accessToken = await fetchAccessToken();
        console.log('Access token obtained');

        // Fetch listings for each search phrase
        const allListings = [];
        for (const phrase of searchPhrases) {
            console.log(`Searching for phrase: "${phrase}"`);
            const phraseListings = await fetchListingsForPhrase(  // Changed variable name to phraseListings
                accessToken,
                phrase,
                typicalPhrases,
                feedbackThreshold,
                conditions
            );
            console.log(`Found ${phraseListings.length} listings for "${phrase}"`);
            allListings.push(...phraseListings);
            
            // Add to log messages
            scanResults.logMessages.push(`Found ${phraseListings.length} listings for "${phrase}"`);
        }
        
            // Update results
        console.log(`Total listings found: ${allListings.length}`);
        scanResults.listings = allListings;
        scanResults.lastUpdated = new Date();
        scanResults.status = 'complete';
        scanResults.logMessages.push(`Scan completed. Total listings: ${allListings.length}`);

    } catch (error) {
        console.error('Scan error:', error);
        scanResults.error = error.message;
        scanResults.status = 'error';
        scanResults.logMessages.push(`Error: ${error.message}`);
        throw error;
    } finally {
        scanInProgress = false;
    }
}
        
     