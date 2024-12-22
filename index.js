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
import {getAllConditionOptions, formatConditionsForQuery } from './conditions.js';


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
const previousListings = new DatabaseListingsManager();
await previousListings.init();

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

app.get('/api/categories', async (req, res) => {
    try {
        // Using the already imported fs promises
        const files = await fs.readdir('.');
        const categoryFiles = files.filter(f => f.startsWith('ebay_categories_') && f.endsWith('.json'));
        const mostRecentFile = categoryFiles.sort().reverse()[0];
        
        const categoriesData = await fs.readFile(mostRecentFile, 'utf8');
        const categories = JSON.parse(categoriesData);
        
        res.json(categories);
    } catch (error) {
        console.error('Error serving categories:', error);
        res.status(500).json({ error: 'Failed to load categories' });
    }
});

app.get('/api/conditions', async (req, res) => {
    res.json(getAllConditionOptions());
    await logger.log('Conditions requested');
});

app.post('/api/scan', async (req, res) => {
    // Cconsole.log('Received request body:', req.body);
        console.log('Type of req.body:', typeof req.body);
        console.log('Keys in req.body:', Object.keys(req.body));
        //check if a scan is already in progress
        if (scanInProgress) {
            return res.status(409).json({ 
                error: 'A scan is already in progress'
            });
        }

        // Check if req.body.searchPhrases exists first
        if (!req.body.searchPhrases) {
            return res.status(400).json({ error: 'Search phrases are required' });
        }

        // Then parse the search phrases
        const searchPhrases = req.body.searchPhrases.split(',').map(phrase => phrase.trim());
        const feedbackThreshold = parseInt(req.body.feedbackThreshold, 10);
        const categoryIds = req.body.categoryIds;
        const conditions = req.body.selectedConditions;

        await logger.log(`Received request with:`);
        await logger.log(`- Search phrases: ${JSON.stringify(searchPhrases)}`);
        await logger.log(`- Feedback threshold: ${feedbackThreshold}`);
        await logger.log(`- Category IDs: ${JSON.stringify(categoryIds)}`);
        await logger.log('Selected conditions received:', req.body.selectedConditions);


        // Validate after parsing
        if (searchPhrases.length === 0) {
            return res.status(400).json({ error: 'At least one search phrase is required' });
        }

        if (isNaN(feedbackThreshold)) {
            return res.status(400).json({ error: 'Valid feedback threshold is required' });
        }

        if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
            return res.status(400).json({ error: 'Category IDs are required' });
        }
        
        scanInProgress = true;
        scanResults.status = 'processing';
        scanResults.error = null;

        // Send immediate response to client
        try {
            res.json({ 
                status: 'started',
                message: 'Scan started successfully'
            });

        // Start the scan in the background without awaiting
        startScan(searchPhrases, feedbackThreshold, categoryIds,conditions)
            .catch(error => {
                console.error('Scan error:', error);
                scanResults.status = 'error';
                scanResults.error = error.message;
            })
            .finally(() => {
                scanInProgress = false;
            });
            
    } catch (error) {
        // Only send error response if we haven't sent a response yet
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


async function fetchSellerListings(sellerUsername, categoryIds) {
    try {
        // Initialize data structures to track listings and counts
        let totalListings = 0;        // Total listings across all categories
        let categoryListingsCount = 0; // Listings in target categories
        let sampleListings = [];  // Define the array here
        
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

        // Create a Set of category IDs for faster lookup
        const categorySet = new Set(categoryIds);
        
        const queryString = new URLSearchParams(params).toString();
        const response = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${queryString}`);
        const data = await response.json();

        if (data.findItemsAdvancedResponse[0].ack[0] === "Success" && 
            data.findItemsAdvancedResponse[0].searchResult[0].item) {
            
            const items = data.findItemsAdvancedResponse[0].searchResult[0].item;
            
            // Process items and count category matches
            items.forEach(item => {
                sampleListings.push(item);
                
                // Check if item's category matches any of our target categories
                const itemCategory = item.primaryCategory[0].categoryId[0];
                if (categorySet.has(itemCategory)) {
                    categoryListingsCount++;
                }
            });
            
            await logger.log(`Analyzed ${items.length} sample listings for ${sellerUsername}`);
            await logger.log(`Found ${categoryListingsCount} listings in target categories`);
        }
        
        // Calculate the ratio based on the sample
        const sampleSize = sampleListings.length;
        const categoryRatio = sampleSize > 0 ? (categoryListingsCount / sampleSize) : 0;
        const ratio = categoryRatio * 100; // Convert to percentage
        
        // Analysis criteria
        const MINIMUM_RATIO = 20;
        const shouldExclude = ratio > MINIMUM_RATIO || !(ratio === 0);
        
        await logger.log(`Sample ratio: ${ratio.toFixed(2)}%`);
        await logger.log(shouldExclude
            ? `DECISION: EXCLUDING ${sellerUsername} - ${ratio.toFixed(2)}% in target categories`
            : `DECISION: INCLUDING ${sellerUsername} - ${ratio.toFixed(2)}% in target categories`);
        
        return {
            shouldExclude,
            error: false,
            listings: sampleListings,
            ratio: ratio,
            total: totalListings,
            sampleData: {
                sampleSize,
                categoryCount: categoryListingsCount
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



async function fetchListingsForPhrase(accessToken, phrase, feedbackThreshold, categoryIds, conditions) {
    await trackApiCall();
    
    try {
        await logger.log(`Condition IDs received: ${conditions}`);
        await logger.log(`Formatted condition filter: ${formatConditionsForQuery(conditions)}`);        // Add condition filter to URL if conditions are specified
        const conditionFilter = conditions && conditions.length > 0 
            ? `&filter=condition:{${formatConditionsForQuery(conditions)}}` 
            : '';
        await logger.log(`\n=== Fetching listings for search phrase: "${phrase}" ===`);
        await logger.log(`Condition filter: ${conditionFilter}`);

        const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
            `q=${encodeURIComponent(phrase)}` +
            `&limit=200${conditionFilter}`;   
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

        // Filter out previously seen listings
        const newListings = [];
        for (const item of data.itemSummaries) {
            if (!(await previousListings.has(item.itemId))) {
                newListings.push(item);
            }
        }
        
        await logger.log(`Found ${newListings.length} new listings (not previously processed)`);

        // Store new listing IDs
        if (newListings.length > 0) {
            await previousListings.addMany(newListings.map(item => item.itemId));
            await logger.log(`Stored ${newListings.length} new listing IDs in database`);
        }

        // Group by seller with validation
        const sellerListings = new Map();
        let skippedListings = 0;
        
        newListings.forEach(item => {
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
            
            const sellerAnalysis = await fetchSellerListings(sellerUsername, categoryIds);
            
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



async function fetchAllListings(searchPhrases, feedbackThreshold, categoryIds, conditions) {
    try {
        await logger.log('\n=== fetchAllListings received parameters ===');
        await logger.log(JSON.stringify({ searchPhrases, feedbackThreshold, categoryIds}, null, 2));
    
        await previousListings.cleanup(30); // Cleans up listings older than 30 days
        const accessToken = await fetchAccessToken();
        await logger.log('Access token obtained successfully');
        await logger.log(`Starting scan with searchPhrases: ${JSON.stringify(searchPhrases)}`);
        const allListings = [];
        
        for (const phrase of searchPhrases) {
            console.log('Searching for phrase:', phrase); // Debug log
            const listings = await fetchListingsForPhrase(accessToken,phrase, feedbackThreshold, categoryIds,conditions);
            console.log(`Found ${listings.length} listings for phrase: ${phrase}`); // Debug log
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

async function startScan(searchPhrases, feedbackThreshold, categoryIds,conditions) {
    try {
        // Add validation at the start of the function
        if (!searchPhrases || !Array.isArray(searchPhrases)) {
            await logger.log('Error: Invalid or missing search phrases');
            throw new Error('Invalid search phrases provided');
        }
        if (!feedbackThreshold) {
            await logger.log('Error: Missing feedback threshold');
            throw new Error('Missing feedback threshold');
        }

        if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
            await logger.log('Error: Invalid or missing category IDs');
            throw new Error('Invalid category IDs provided');
        }

        if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
            await logger.log('Error: Invalid or missing category IDs');
            throw new Error('Invalid category IDs provided');
        }

        const scanStartTime = new Date().toISOString().split('T')[0];
        const logFileName = `ebay-scanner-${scanStartTime}.txt`;
        
        await fs.appendFile(logFileName, `\n\n========================================\n`);
        await fs.appendFile(logFileName, `startScan function - New Scan Started at ${new Date().toLocaleString()}\n`);
        await fs.appendFile(logFileName, `========================================\n\n`);
        await logger.log(JSON.stringify({ searchPhrases, feedbackThreshold, categoryIds }, null, 2));

        // Add logging for database cleanup
        try {
            await logger.log('Starting database cleanup...');
            await previousListings.cleanup();
            await logger.log('Database cleanup completed');
        } catch (cleanupError) {
            await logger.log(`Database cleanup error: ${cleanupError.message}`);
            // Continue with scan even if cleanup fails
        }

        // Add debug logging
        await logger.log('Scan parameters:');
        await logger.log(`- Search Phrases: ${JSON.stringify(searchPhrases)}`);
        await logger.log(`- Feedback Threshold: ${feedbackThreshold}`);
        await logger.log(`- Category IDs: ${JSON.stringify(categoryIds)}`);

        scanResults.status = 'processing';
        scanResults.error = null;
        scanResults.logMessages = [];

        await logger.log('Calling fetchAllListings...');
        const listings = await fetchAllListings(searchPhrases, feedbackThreshold, categoryIds,conditions);
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
        
        setTimeout(startScan, 300000);
    } catch (error) {
        await logger.log(`Error during scan: ${error.message}`);
        scanResults = {
            ...scanResults,
            status: 'error',
            error: error.message
        };
        setTimeout(startScan, 60000);
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

// Start the background scanning process
//startScan();

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});