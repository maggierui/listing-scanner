import express from 'express';
import fetchAccessToken from './auth.js';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs/promises';
import dotenv from 'dotenv';
import { URLSearchParams } from 'url';

// Load environment variables
dotenv.config();
// Simple logging function (to replace addLog)
async function log(message) {
    console.log(message);
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds
const listingsCache = {
    data: {},
    timestamps: {}
};

// Middleware
app.use(express.json());
app.use(express.static(__dirname)); // Serve files from current directory

// Initialize variables
let apiCallsCount = 0;


async function trackApiCall() {
    apiCallsCount++;
    await addLog(`API Calls made today: ${apiCallsCount}/5000`);
    if (apiCallsCount > 4500) {
        await addLog('WARNING: Approaching daily API limit (5000)');
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

app.post('/api/scan', async (req, res) => {
    try {

          // Send immediate response to client
          res.json({ 
            status: 'started',
            message: 'Scan started successfully'
        });

        // Parse feedback threshold
        const threshold = parseInt(req.body.feedbackThreshold, 10);
        await addLog(`Parsed feedback threshold: ${threshold}`);

        // Get category IDs
        const categories = req.body.categoryIds;
        await addLog(`Request categoryIds: ${JSON.stringify(categories || [])}`);
        
      // Parse search phrases
      const rawSearchPhrases = req.body.searchPhrases;
      let parsedPhrases;
      if (typeof rawSearchPhrases === 'string') {
          // If it's a single string with commas
          parsedPhrases = rawSearchPhrases.split(',').map(phrase => phrase.trim());
      } else if (Array.isArray(rawSearchPhrases)) {
          // If it's already an array
          parsedPhrases = rawSearchPhrases;
      } else {
          throw new Error('Invalid search phrases format');
      }

      await addLog(`Parsed searchPhrases: ${JSON.stringify(parsedPhrases)}`);

         // Pass all parameters to startScan
         await startScan(parsedPhrases, threshold, categories);
         
         res.json({ 
             status: 'Scan started',
             message: `Starting scan with ${parsedPhrases.length} search phrases`
         });
     } catch (error) {
         await addLog(`Error in scan endpoint: ${error.message}`);
         res.status(500).json({ error: error.message });
     }
 });

async function addLog(message) {
// Create timestamp in EST/EDT
    const timestamp = new Date().toLocaleTimeString('en-US', { 
    timeZone: 'America/New_York',
    hour12: true 
    });    
    const logMessage = `${timestamp}: ${message}\n`;
    
    // Keep limited logs for web display
    const webLogMessage = `${timestamp}: ${message}`;
    scanResults.logMessages.push(webLogMessage);
    if (scanResults.logMessages.length > 50) {
        scanResults.logMessages.shift();
    }

    // Write to console
    console.log(message);

    // Write to file with timestamp
    try {
        const logFileName = `ebay-scanner-${new Date().toISOString().split('T')[0]}.txt`;
        await fs.appendFile(logFileName, logMessage,'utf8');
    } catch (error) {
        console.error('Error writing to log file:', error);
    }
}

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
        await log(`Seller listings response for ${sellerUsername}: ${JSON.stringify(data, null, 2)}`);

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
        let allListings = [];
        let totalCount = 0;

        // Process categories in groups of 3
        for (let i = 0; i < categoryIds.length; i += 3) {
            const currentCategories = categoryIds.slice(i, i + 3);
            
            const url = 'https://svcs.ebay.com/services/search/FindingService/v1';
            const params = {
                'OPERATION-NAME': 'findItemsAdvanced',
                'SERVICE-VERSION': '1.0.0',
                'SECURITY-APPNAME': process.env.EBAY_CLIENT_ID,
                'GLOBAL-ID': 'EBAY-US',
                'RESPONSE-DATA-FORMAT': 'JSON',
                'itemFilter(0).name': 'Seller',
                'itemFilter(0).value': sellerUsername,
                'paginationInput.entriesPerPage': '20'
            };

            // Add up to 3 category IDs
            currentCategories.forEach((catId, index) => {
                params[`categoryId[${index}]`] = catId;
            });

            const queryString = new URLSearchParams(params).toString();
            const fullUrl = `${url}?${queryString}`;

            await addLog(`Processing categories ${i + 1}-${i + currentCategories.length} of ${categoryIds.length}`);
            await addLog(`Full URL for batch ${i+1}: ${fullUrl}`);

            const response = await fetch(fullUrl);
            const data = await response.json();
            await addLog(`Response for batch ${i+1}: ${JSON.stringify(data)}`);

            if (data.findItemsAdvancedResponse[0].ack[0] === "Success") {
                const searchResult = data.findItemsAdvancedResponse[0].searchResult[0];
                if (searchResult.item) {
                    allListings = allListings.concat(searchResult.item);
                }
                const currentTotal = parseInt(data.findItemsAdvancedResponse[0].paginationOutput[0].totalEntries[0]) || 0;
                totalCount += currentTotal;
            }

            // Add delay between API calls
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return {
            error: false,
            listings: allListings,
            total: totalCount
        };

    } catch (error) {
        await addLog(`Error fetching listings for ${sellerUsername}: ${error.message}`);
        return { error: true, listings: [], total: 0 };
    }
}

// Updated analyzeSellerListings function
async function analyzeSellerListings(sellerData, username) {
    await addLog(`\n==== ANALYZING SELLER: ${username} ====`);
    await addLog(`Seller data for ${username}: ${JSON.stringify(sellerData)}`);
    if (sellerData.error || !sellerData.listings || sellerData.listings.length === 0) {
        await addLog(`ERROR: No valid listings found for seller ${username}`);
        return true;
    }

    const totalListings = sellerData.total;
    const categoryListings = sellerData.categoryTotal;
    const ratio = (categoryListings / totalListings) * 100;
    
    await addLog(`Analysis for ${username}:`);
    await addLog(`Total listings: ${totalListings}`);
    await addLog(`Category-specific listings: ${categoryListings}`);
    await addLog(`Category ratio: ${ratio.toFixed(2)}%`);

    // You can adjust this threshold as needed
    const shouldExclude = ratio < 80;  // Exclude if less than 80% in specified categories
    
    await addLog(shouldExclude ? 
        `DECISION: EXCLUDING ${username} - Only ${ratio.toFixed(2)}% in specified categories` : 
        `DECISION: INCLUDING ${username} - ${ratio.toFixed(2)}% in specified categories`
    );

    return shouldExclude;
}



async function fetchListingsForPhrase(accessToken,searchPhrases, feedbackThreshold, categoryIds) {
    await trackApiCall();
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(searchPhrases)}&limit=50`;
    
    // Cache handling
    const cacheKey = searchPhrases.join(',').toLowerCase();  // Convert array to string
    const currentTime = Date.now();
    if (listingsCache.data[cacheKey] && 
        (currentTime - listingsCache.timestamps[cacheKey]) < CACHE_DURATION) {
        await addLog(`Using cached results for phrases: ${searchPhrases}`);
        return listingsCache.data[cacheKey];
}

    await addLog(`\n=== Searching for phrase: ${searchPhrases} ===`);
    await addLog(`URL: ${url}`);

    try {
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
            },
        });

        if (response.status === 429) {
            const rateLimitMessage = await response.text();
            await addLog(`RATE LIMIT REACHED: ${rateLimitMessage}`);
            await addLog('Daily API limit reached. Operations will resume when limit resets.');
            return [];
        }

        if (!response.ok) {
            const errorText = await response.text();
            await addLog(`Error fetching listings for ${searchPhrases}: ${response.status}`);
            await addLog(`Error details: ${errorText}`);
            return [];
        }

        const data = await response.json();
        await addLog(`Found ${data.itemSummaries?.length || 0} initial listings for ${searchPhrases}`);

        if (!data.itemSummaries || data.itemSummaries.length === 0) {
            return [];
        }

        const filteredListings = [];
        const sellers = data.itemSummaries;
        
        // Process sellers in chunks of 3
        for (let i = 0; i < sellers.length; i += 3) {
            const chunk = sellers.slice(i, i + 3);
            const results = await Promise.all(chunk.map(async (item) => {
                const feedbackScore = item.seller?.feedbackScore || 0;
                // Add debug logs
                await addLog('\n=== Debug: Feedback Check ===');
                await addLog(`Global feedbackThreshold value: ${feedbackThreshold}`);
                await addLog(`Debug: Checking seller ${item.seller?.username}`);
                await addLog(`Debug: Seller feedback score: ${feedbackScore}`);
                await addLog(`Debug: Feedback threshold: ${feedbackThreshold}`);
                await addLog(`Debug: Condition check: ${feedbackScore} >= ${feedbackThreshold} equals ${feedbackScore >= feedbackThreshold}`);
                if (feedbackScore >= feedbackThreshold) {
                    await addLog(`Skipping seller ${item.seller?.username} (feedback: ${feedbackScore})`);
                    return null;
                }

                try {
                    const sellerData = await fetchSellerListings(item.seller?.username, categoryIds);
                    await addLog(`Seller data for ${item.seller?.username}: ${JSON.stringify(sellerData)}`);
                    const shouldExclude = await analyzeSellerListings(sellerData, item.seller?.username);
                    
                    if (!shouldExclude) {
                        await addLog(`Adding listing from ${item.seller?.username}: ${item.title}`);
                        return item;
                    }
                    await addLog(`Excluded listing from ${item.seller?.username}: ${item.title}`);
                    return null;
                } catch (error) {
                    await addLog(`Error processing ${item.seller?.username}: ${error.message}`);
                    return null;
                }
            }));

            const validResults = results.filter(item => item !== null);
            if (validResults && validResults.length > 0) {
                filteredListings.push(...validResults);
            }
            await delay(500);
        }

        // Store filtered results in cache before returning
        listingsCache.data[cacheKey] = filteredListings;
        listingsCache.timestamps[cacheKey] = currentTime;
        
        await addLog(`Found ${filteredListings.length} matching listings for ${phrase}\n`);
        return filteredListings;

    } catch (error) {
        await addLog(`Error processing ${searchPhrases}: ${error.message}`);
        return [];
    }
}

async function fetchAllListings(searchPhrases, feedbackThreshold, categoryIds) {
    try {
        await addLog('\n=== fetchAllListings received parameters ===');
        await addLog(JSON.stringify({ searchPhrases, feedbackThreshold, categoryIds}, null, 2));
    
        const accessToken = await fetchAccessToken();
        await addLog('Access token obtained successfully');
        await addLog(`Starting scan with searchPhrases: ${JSON.stringify(searchPhrases)}`);
        const allListings = [];
        
        for (const phrase of searchPhrases) {
            console.log('Searching for phrase:', phrase); // Debug log
            const listings = await fetchListingsForPhrase(accessToken,searchPhrases, feedbackThreshold, categoryIds);
            console.log(`Found ${listings.length} listings for phrase: ${phrase}`); // Debug log
            if (listings && listings.length > 0) {
                allListings.push(...listings);
            }
            await delay(1000);
        }

        await addLog(`\n====== Scan complete. Found ${allListings.length} total listings ======\n`);
        return allListings;
    } catch (error) {
        await addLog(`Scan error: ${error.message}`);
        throw error;
    }
}

async function startScan(searchPhrases, feedbackThreshold, categoryIds) {
    try {
        const scanStartTime = new Date().toISOString().split('T')[0];
        const logFileName = `ebay-scanner-${scanStartTime}.txt`;
        
        await fs.appendFile(logFileName, `\n\n========================================\n`);
        await fs.appendFile(logFileName, `startScan function - New Scan Started at ${new Date().toLocaleString()}\n`);
        await fs.appendFile(logFileName, `========================================\n\n`);
        await addLog(JSON.stringify({ searchPhrases, feedbackThreshold, categoryIds }, null, 2));

        scanResults.status = 'processing';
        scanResults.error = null;
        scanResults.logMessages = [];
        const listings = await fetchAllListings(searchPhrases, feedbackThreshold, categoryIds,);
        
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
        await addLog(`Error during scan: ${error.message}`);
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

app.get('/status', (req, res) => {
    res.json({ status: 'Server is running' });
});




app.get('/api/results', (req, res) => {
    console.log('Debug - sending results:', scanResults);
    if (scanResults.status === 'complete') {
        res.json({
            status: 'complete',
            lastUpdated: scanResults.lastUpdated,
            totalListings: scanResults.listings.length,
            listings: scanResults.listings.map(item => ({
                title: item.title,
                price: item.price?.value || 'N/A',
                currency: item.price?.currency || 'N/A',
                seller: item.seller?.username || 'N/A',
                feedbackScore: item.seller?.feedbackScore || 'N/A',
                itemWebUrl: item.itemWebUrl
            })),
            logMessages: scanResults.logMessages
        });
    } else {
        res.json({
            status: scanResults.status,
            error: scanResults.error,
            logMessages: scanResults.logMessages
        });
    }
});

// Start the background scanning process
//startScan();

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});