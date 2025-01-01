import express from 'express';
import fetchAccessToken from './auth.js';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs/promises';
import dotenv from 'dotenv';
import { URLSearchParams } from 'url';
import { generatePreviousListingsCSV, generateSearchResultsCSV } from './csv-handlers.js';
import DatabaseListingsManager from './DatabaseListingsManager.js';
import logger from './logger.js';
import {getAllConditionOptions, EBAY_CONDITIONS } from './conditions.js';


// Load environment variables
dotenv.config();
// Simple logging function (to replace logger.log)
async function log(message) {
    console.log(message);
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// Wrap the initialization in an async function
const initializeServer = async () => {
    try {
        await dbManager.init();
        
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to initialize server:', error);
    }
};

// Middleware
app.use(express.json());
app.use(express.static(__dirname)); // Serve files from current directory

// Initialize variables
let apiCallsCount = 0;
// Near the top of index.js
let scanInProgress = false;


async function trackApiCall() {
    apiCallsCount++;
    await logger.log(`API Calls made today: ${apiCallsCount}/5000`);
    if (apiCallsCount > 4500) {
        await logger.log('WARNING: Approaching daily API limit (5000)');
    }
}


// Store results and logs in memory
let scanResults = {
    status: 'processing',
    listings: [],
    lastUpdated: null,
    error: null,
    logMessages: []
};
app.get('/', async (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/conditions', async (req, res) => {
    res.json(getAllConditionOptions());
    await logger.log('Conditions requested');
});

app.post('/api/scan', async (req, res) => {
    if (scanInProgress) {
        return res.status(409).json({ 
            error: 'A scan is already in progress'
        });
    }

    const searchPhrases = req.body.searchPhrases.split(',').map(phrase => phrase.trim());
    const typicalPhrases = req.body.typicalPhrases.split(',').map(phrase => phrase.trim());
    const feedbackThreshold = parseInt(req.body.feedbackThreshold, 10);
    const conditions = req.body.selectedConditions;
    
    // Validate after parsing
    if (searchPhrases.length === 0) {
        return res.status(400).json({ error: 'At least one search phrase is required' });
    }

    if (isNaN(feedbackThreshold)) {
        return res.status(400).json({ error: 'Valid feedback threshold is required' });
    }

    await logger.log(`Received request with:`);
    await logger.log(`- Search phrases: ${JSON.stringify(searchPhrases)}`);
    await logger.log(`- Typical phrases: ${JSON.stringify(typicalPhrases)}`);
    await logger.log(`- Feedback threshold: ${feedbackThreshold}`);
    await logger.log(`- Conditions: ${JSON.stringify(conditions)}`);
    scanInProgress = true;
    scanResults.status = 'processing';
    scanResults.error = null;

    try {
        res.json({ 
            status: 'started',
            message: 'Scan started successfully'
        });

        startScan(searchPhrases, typicalPhrases, feedbackThreshold,conditions)
            .catch(error => {
                console.error('Scan error:', error);
                scanResults.status = 'error';
                scanResults.error = error.message;
            })
            .finally(() => {
                scanInProgress = false;
            });
            
    } catch (error) {
        if (!res.headersSent) {
            scanInProgress = false;
            scanResults.status = 'error';
            scanResults.error = error.message;
            await logger.log(`Error in scan endpoint: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    }
});


const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options, timeout = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

async function getSellerTotalListings(sellerUsername) {
    try {
        const url = 'https://svcs.ebay.com/services/search/FindingService/v1';
        const params = {
            'OPERATION-NAME': 'findItemsAdvanced',
            'SERVICE-VERSION': '1.0.0',
            'SECURITY-APPNAME': process.env.EBAY_CLIENT_ID,
            'RESPONSE-DATA-FORMAT': 'JSON',
            'itemFilter(0).name': 'Seller',
            'itemFilter(0).value': sellerUsername,
            'paginationInput.entriesPerPage': '1'
        };

        const queryString = new URLSearchParams(params).toString();
        await log(`Seller listings request for ${sellerUsername}: ${queryString}`);
        const fullUrl = `${url}?${queryString}`;
        await log(`Full URL: ${fullUrl}`);

        const response = await fetch(fullUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        // Debug each step
        const advancedResponse = data.findItemsAdvancedResponse[0];
        console.log('Advanced response:', advancedResponse);

        const paginationOutput = advancedResponse.paginationOutput[0];
        console.log('Pagination output:', paginationOutput);

        const totalEntries = paginationOutput.totalEntries[0];
        console.log('Total entries:', totalEntries);


        if (data.findItemsAdvancedResponse[0].ack[0] === "Failure") {
            throw new Error(data.findItemsAdvancedResponse[0].errorMessage[0].error[0].message[0]);
        }
        
        // Now try to get the total
        const total = parseInt(totalEntries);
        await log(`Total listings for ${sellerUsername}: ${total}`);
        
        return parseInt(total);
    } catch (error) {
        await log(`Error getting total listings for ${sellerUsername}: ${error.message}`);
        return 0;
    }
}


async function fetchSellerListings(sellerUsername, typicalPhrases) {
    try {
        let totalListings = 0;
        let matchingListingsCount = 0;
        let sampleListings = [];
        
        // First, get the seller's total listings across ALL categories
        totalListings = await getSellerTotalListings(sellerUsername);

        // If we can't get total listings, we should still continue but log a warning
        if (totalListings === 0) {
            await logger.log(`Warning: Could not get total listings for ${sellerUsername}`);
        }

        if (totalListings > 100) 
            totalListings = 100;

        await logger.log(`Total listings for seller ${sellerUsername}: ${totalListings}`);

        // Set up base parameters for Finding API
        const params = {
            'OPERATION-NAME': 'findItemsAdvanced',
            'SERVICE-VERSION': '1.0.0',
            'SECURITY-APPNAME': process.env.EBAY_CLIENT_ID,
            'RESPONSE-DATA-FORMAT': 'JSON',
            'itemFilter(0).name': 'Seller',
            'itemFilter(0).value': sellerUsername,
            'paginationInput.entriesPerPage': 100,
            'outputSelector': 'SellerInfo'
        };
        
        const queryString = new URLSearchParams(params).toString();
        const response = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${queryString}`);
        const data = await response.json();

        if (data.findItemsAdvancedResponse[0].ack[0] === "Success" && 
            data.findItemsAdvancedResponse[0].searchResult[0].item) {
            
            const items = data.findItemsAdvancedResponse[0].searchResult[0].item;
            
            for (const item of items) {
                sampleListings.push(item);
                
                // Check if item title contains any of the search phrases
                const itemTitle = item.title[0].toLowerCase();
                const matchesPhrase = typicalPhrases.some(phrase => 
                    itemTitle.includes(phrase.toLowerCase())
                );

                if (matchesPhrase) {
                    matchingListingsCount++;
                    await logger.log(`Matching title found: ${item.title[0]}`);
                }
            }
            
            await logger.log(`Analyzed ${items.length} sample listings for ${sellerUsername}`);
            await logger.log(`Found ${matchingListingsCount} listings matching typical phrases`);
        }
        
        // Calculate the ratio based on the sample
        const sampleSize = sampleListings.length;
        const categoryRatio = sampleSize > 0 ? (matchingListingsCount / sampleSize) : 0;
        const ratio = categoryRatio * 100; // Convert to percentage
        
        // Analysis criteria
        const MINIMUM_RATIO = 20;
        const shouldExclude = ratio > MINIMUM_RATIO || (ratio === 0);
        
        await logger.log(`Sample ratio: ${ratio.toFixed(2)}%`);
        await logger.log(shouldExclude
            ? `DECISION: EXCLUDING ${sellerUsername} - ${ratio.toFixed(2)}% matching phrases`
            : `DECISION: INCLUDING ${sellerUsername} - ${ratio.toFixed(2)}% matching phrases`);
        
        return {
            shouldExclude,
            error: false,
            listings: sampleListings,
            ratio: ratio,
            total: totalListings,
            sampleData: {
                sampleSize,
                matchCount: matchingListingsCount
            }
        };
        
    } catch (error) {
        await logger.log(`Error fetching listings for ${sellerUsername}: ${error.message}`);
        return {
            shouldExclude: true, // Exclude on error to be safe
            error: true,
            listings: [],
            ratio: 0,
            total: 0,
            errorMessage: error.message
        };
    }
}



async function fetchListingsForPhrase(accessToken, phrase, typicalPhrases,feedbackThreshold, conditions) {
    await trackApiCall();
    
    try {
        await logger.log(`\n=== Fetching listings for search phrase: "${phrase}" ===`);

        // Remove condition filter from URL - we'll filter results after
        const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
            `q=${encodeURIComponent(phrase)}` +
            `&limit=200`;   
        await logger.log(`API URL: ${url}`);

        const processedSellers = new Set();
        const filteredListings = [];

        // Fetch listings from eBay API
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
            },
        });

        if (!response.ok) {
            throw new Error(`eBay API error! Status: ${response.status}`);
        }

        const data = await response.json();
        
        // Check for empty results
        if (!data.itemSummaries || data.itemSummaries.length === 0) {
            await logger.log(`No listings found for phrase "${phrase}"`);
            return [];
        }

        await logger.log(`Found ${data.itemSummaries.length} total listings for phrase "${phrase}"`);
        // Print out all search results
        for (const item of data.itemSummaries) {
            await logger.log(`Initial search results for this run: Title: ${item.title}, Seller: ${item.seller.username}, Condition: ${item.condition}`);
        }
        // Create array to store valid items
        let validListings = [];

        // Process items one by one
        for (const item of data.itemSummaries) {
            await logger.log(`\nTrying to match item condition: "${item.condition}"`);
            
            const matchingCondition = Object.values(EBAY_CONDITIONS).find(conditionObject => {
                return conditionObject.variants.includes(item.condition);
            });

            if (matchingCondition) {
                await logger.log(`Item's condition: "${item.condition}" is called ${matchingCondition.name} (ID: ${matchingCondition.id}) in the eBay API`);
            } else {
                await logger.log(`No match found for condition: "${item.condition}" in any variants`);
                continue;  // Skip to next item
            }
            
            const itemConditionId = matchingCondition.id;
            const isValidCondition = conditions.includes(itemConditionId);

            if (!isValidCondition) {
                await logger.log(`Filtered out - Title: "${item.title}", Condition: ${item.condition}, ID: ${itemConditionId}`);
            } else {
                await logger.log(`Included - Title: "${item.title}", Condition: ${item.condition}, ID: ${itemConditionId}`);
                validListings.push(item);  // Add to valid listings if condition matches
            }
        }

        
        await logger.log(`Found ${validListings.length} listings with matching conditions out of ${data.itemSummaries.length} total`);

        // Filter out previously seen listings
        //const newListings = [];
       // for (const item of validListings) {
        //    if (!(await previousListings.has(item.itemId))) {
        //        newListings.push(item);
        //    }
        //}
        
        //await logger.log(`Found ${newListings.length} new listings (not previously processed)`);

        // Store new listing IDs
        // if (newListings.length > 0) {
        //    await previousListings.addMany(newListings.map(item => item.itemId));
        //    await logger.log(`Stored ${newListings.length} new listing IDs in database`);
        //}

        // Group by seller with validation
        const sellerListings = new Map();
        let skippedListings = 0;
        
        validListings.forEach(item => { //Since I commented out the newListings, I'm using validListings instead
            if (!item.seller?.username) {
                skippedListings++;
                return;
            }
            
            const sellerUsername = item.seller.username;
            if (!sellerListings.has(sellerUsername)) {
                sellerListings.set(sellerUsername, []);
            }
            sellerListings.get(sellerUsername).push(item);
        });

        if (skippedListings > 0) {
            await logger.log(`Skipped ${skippedListings} listings with missing seller information`);
        }

        const totalSellers = sellerListings.size;
        await logger.log(`\n=== Processing ${totalSellers} unique sellers ===`);
        await logger.log(`Sellers found: ${[...sellerListings.keys()].join(', ')}`);

        let sellerCounter = 0;
        let qualifiedSellerCounter = 0;

        // Process each seller
        for (const [sellerUsername, listings] of sellerListings) {
            if (processedSellers.has(sellerUsername)) {
                await logger.log(`Skipping already processed seller: ${sellerUsername}`);
                continue;
            }

            sellerCounter++;
            await logger.log(`\n--- Processing Seller ${sellerCounter}/${totalSellers}: ${sellerUsername} ---`);
            
            const feedbackScore = listings[0].seller?.feedbackScore || 0;
            await logger.log(`Feedback score: ${feedbackScore}`);
            
            if (feedbackScore >= feedbackThreshold) {
                await logger.log(`Skipping due to high feedback score (${feedbackScore} >= ${feedbackThreshold})`);
                continue;
            }

            processedSellers.add(sellerUsername);
            
            const sellerAnalysis = await fetchSellerListings(sellerUsername, typicalPhrases);
            
            if (!sellerAnalysis.error && !sellerAnalysis.shouldExclude) {
                qualifiedSellerCounter++;
                await logger.log(`Seller qualified: ${sellerUsername}`);
                
                if (listings.length > 0) {
                    const addedListing = listings[0];
                    filteredListings.push(addedListing);
                    await logger.log(`Added listing: "${addedListing.title}" (${addedListing.itemId})`);
                }
            } else {
                await logger.log(`Seller excluded: ${sellerUsername}${sellerAnalysis.error ? ` (Error: ${sellerAnalysis.errorMessage})` : ''}`);
            }
        }

        await logger.log(`\n=== Phrase "${phrase}" Processing Complete ===`);
        await logger.log(`- Total sellers processed: ${sellerCounter}`);
        await logger.log(`- Qualified sellers: ${qualifiedSellerCounter}`);
        await logger.log(`- Qualified listings found: ${filteredListings.length}`);

        return filteredListings;

    } catch (error) {
        await logger.log(`Error processing phrase "${phrase}": ${error.message}`);
        await logger.log(error.stack); // Log stack trace for debugging
        return [];
    }
}



async function fetchAllListings(searchPhrases, typicalPhrases, feedbackThreshold,  conditions) {
    try {
        await logger.log('\n=== fetchAllListings received parameters ===');
        await logger.log(JSON.stringify({ searchPhrases,typicalPhrases, feedbackThreshold,  conditions}, null, 2));
    
        //await previousListings.cleanup(30); // Cleans up listings older than 30 days
        const accessToken = await fetchAccessToken();
        await logger.log('Access token obtained successfully');
        await logger.log(`Starting scan with searchPhrases: ${JSON.stringify(searchPhrases)}`);
        const allListings = [];
        
        for (const phrase of searchPhrases) {
            console.log('Searching for phrase:', phrase);
            const listings = await fetchListingsForPhrase(accessToken, phrase, typicalPhrases,feedbackThreshold, conditions);
            console.log(`Found ${listings.length} listings for phrase: ${phrase}`);
            if (listings && listings.length > 0) {
                allListings.push(...listings);
            }
            await delay(1000);
        }

        await logger.log(`\n====== Scan complete. Found ${allListings.length} total listings ======\n`);
        return allListings;
    } catch (error) {
        await logger.log(`Scan error: ${error.message}`);
        throw error;
    }
}

async function startScan(searchPhrases, typicalPhrases, feedbackThreshold, conditions) {
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
        scanResults.status = 'processing';
        scanResults.error = null;
        scanResults.logMessages = [];

        await logger.log('Calling fetchAllListings...');
        const listings = await fetchAllListings(searchPhrases, typicalPhrases, feedbackThreshold, conditions);
        await logger.log(`fetchAllListings completed. Found ${listings.length} listings`);

        
        await fs.appendFile(logFileName, `\n========================================\n`);
        await fs.appendFile(logFileName, `Scan Completed at ${new Date().toLocaleString()}\n`);
        await fs.appendFile(logFileName, `Total listings found: ${listings.length}\n`);
        await fs.appendFile(logFileName, `========================================\n\n`);
        
        scanResults = {
            status: 'complete',
            listings: listings,
            lastUpdated: new Date(),
            error: null,
            logMessages: scanResults.logMessages
        };
        
    } catch (error) {
        await logger.log(`Error during scan: ${error.message}`);
        scanResults = {
            ...scanResults,
            status: 'error',
            error: error.message
        };
    }
}

// New endpoint to download logs
app.get('/api/logs', async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const logFileName = `ebay-scanner-${today}.txt`;
    
    try {
        const logContent = await fs.readFile(logFileName, 'utf8');
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename=${logFileName}`);
        res.send(logContent);
    } catch (error) {
        res.status(500).send('Error downloading log file: ' + error.message);
    }
});

app.get('/api/download/previous-listings', async (req, res) => {
    try {
        const csvData = await generatePreviousListingsCSV();
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=previous-listings.csv');
        res.send(csvData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate CSV' });
    }
});

app.get('/api/download/search-results', async (req, res) => {
    try {
        const csvData = generateSearchResultsCSV(scanResults.listings);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=search-results.csv');
        res.send(csvData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate CSV' });
    }
});

app.get('/status', (req, res) => {
    res.json({ status: 'Server is running' });
});

app.get('/api/results', (req, res) => {
    try {
        // Log the initial state for debugging
        console.log('Sending scan results:', {
            status: scanResults.status,
            listingCount: scanResults.listings?.length,
            hasError: !!scanResults.error
        });
        
        // Transform the listings data if we have completed listings
        const transformedListings = scanResults.listings?.map(item => {
            // Extract the specific values we need from the nested objects
            return {
                title: item.title || 'N/A',
                // Extract numeric price value from the price object
                price: item.price?.value 
                    ? parseFloat(item.price.value).toFixed(2) 
                    : 'N/A',
                // Extract currency from the price object
                currency: item.price?.currency || 'USD',
                // Extract username from the seller object
                seller: item.seller?.username || 'N/A',
                // Extract and format feedback score from the seller object
                feedbackScore: item.seller?.feedbackScore?.toString() || 'N/A',
                // Use the direct link to the item
                link: item.itemWebUrl || '#'
            };
        }) || [];  // If no listings, default to empty array
        
        // Send the transformed data in the response
        res.json({
            status: scanResults.status,
            lastUpdated: scanResults.lastUpdated,
            totalListings: scanResults.listings?.length || 0,
            listings: transformedListings,
            error: scanResults.error,
            logMessages: scanResults.logMessages
        });
    } catch (error) {
        console.error('Error in /api/results:', error);
        res.status(500).json({
            status: 'error',
            error: 'Internal server error'
        });
    }
});


// 2. Create an instance of the manager
const dbManager = new DatabaseListingsManager();

// 3. Initialize the database when your server starts
// This should be called when your server starts up
await dbManager.init();

// 4. Create the endpoint for saving searches
app.post('/api/saves/search', async (req, res) => {
    try {
        // 5. Extract the data from the request body
        const { 
            name,           // Name of the search
            searchPhrases,  // Array of search terms
            typicalPhrases, // Array of category phrases
            feedbackThreshold, // Number
            conditions     // Array of conditions
        } = req.body;

        // 6. Validate the input data
        if (!name || !searchPhrases || !typicalPhrases || !feedbackThreshold || !conditions) {
            return res.status(400).json({ 
                error: 'Missing required fields' 
            });
        }

        // 7. Save the search using the database manager
        const searchId = await dbManager.saveSearch(
            name,
            searchPhrases,
            typicalPhrases,
            feedbackThreshold,
            conditions
        );

        // 8. Send success response
        res.status(201).json({
            message: 'Search saved successfully',
            id: searchId
        });

    } catch (error) {
        // 9. Handle any errors
        console.error('Error saving search:', error);
        res.status(500).json({ 
            error: 'Failed to save search',
            details: error.message 
        });
    }
});

// 10. Create endpoint to get all saved searches
app.get('/api/saves/searches', async (req, res) => {
    try {
        // 11. Use the database manager to get all searches
        const searches = await dbManager.getSavedSearches();
        res.json(searches);
    } catch (error) {
        console.error('Error fetching searches:', error);
        res.status(500).json({ error: 'Failed to fetch searches' });
    }
});

// 12. Create endpoint to get a specific saved search
app.get('/api/saves/search/:id', async (req, res) => {
    try {
        // 13. Get the ID from the URL parameters
        const searchId = parseInt(req.params.id);
        
        // 14. Validate the ID
        if (isNaN(searchId)) {
            return res.status(400).json({ error: 'Invalid search ID' });
        }

        // 15. Use the database manager to get the specific search
        const search = await dbManager.getSavedSearchById(searchId);
        
        // 16. Handle case where search isn't found
        if (!search) {
            return res.status(404).json({ error: 'Search not found' });
        }

        // 17. Return the search data
        res.json(search);
    } catch (error) {
        console.error('Error fetching search:', error);
        res.status(500).json({ error: 'Failed to fetch search' });
    }
});

// Start the background scanning process
//startScan();

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});