import express from 'express';
import fetchAccessToken from './auth.js';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs/promises';


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
let searchPhrases = [];
let feedbackThreshold = 0;



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
        await addLog('Received data:', JSON.stringify(req.body));
        await addLog('\n=== Got scan request from the user ===');
        await addLog(`Raw feedback threshold from request: ${req.body.feedbackThreshold}`);
        await addLog(`Type of feedback threshold: ${typeof req.body.feedbackThreshold}`);
        await addLog(`received search phrases: ${req.body.searchPhrases}`);

        const categoryIds = req.body.categoryIds; // Local variable
        await addLog(`Request categoryIds: ${JSON.stringify(categoryIds || [])}`);
        
      // Parse search phrases
      let rawSearchPhrases = req.body.searchPhrases;
      if (typeof rawSearchPhrases === 'string') {
          // If it's a single string with commas
          searchPhrases = rawSearchPhrases.split(',').map(phrase => phrase.trim());
      } else if (Array.isArray(rawSearchPhrases)) {
          // If it's already an array
          searchPhrases = rawSearchPhrases;
      } else {
          throw new Error('Invalid search phrases format');
      }

      await addLog(`Parsed searchPhrases: ${JSON.stringify(searchPhrases)}`);


        if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
            throw new Error('Category IDs must be a non-empty array');
        }

        // Pass categoryIds to startScan
        await startScan(categoryIds);


         // Fix feedback threshold parsing
         feedbackThreshold = parseInt(req.body.feedbackThreshold, 10);
         await addLog(`Parsed feedback threshold: ${feedbackThreshold}`);
         await addLog(`Type after parsing: ${typeof feedbackThreshold}`);         
         if (isNaN(feedbackThreshold)) {
             throw new Error('Invalid feedback threshold value');
         }

        console.log('Processed values:', {
            searchPhrases,
            categoryIds,
            feedbackThreshold
        });

    // Start the scanning process
    await startScan();
  
    res.json({ 
        status: 'Scan started',
        message: `Starting scan with ${searchPhrases.length} search phrases`
    });
} catch (error) {
    console.error('Error in /scan endpoint:', error);
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

async function getSellerTotalListings(sellerUsername, accessToken) {
    try {
        const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
            `q=seller:${encodeURIComponent(sellerUsername)}&` +
            `limit=1`;

        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
            }
        }, 8000);

        const data = await response.json();
        
        if (data.total !== undefined) {
            await addLog(`Seller ${sellerUsername} has ${data.total} total active listings`);
            return data.total;
        }
        return 0;
    } catch (error) {
        await addLog(`Error getting total listings for ${sellerUsername}: ${error.message}`);
        return 0;
    }
}


async function fetchSellerListings(sellerUsername, accessToken, categoryIds, retryCount = 2) {
    try {
        // Add debug logs
        await addLog(`Debug: Starting fetchSellerListings for ${sellerUsername}`);
        await addLog(`Debug: Current categoryIds: ${JSON.stringify(categoryIds)}`);

        // First get total listings
        const totalListings = await getSellerTotalListings(sellerUsername, accessToken);

        if (totalListings === 0) {
            await addLog(`Seller ${sellerUsername} has no active listings`);
            return { error: true, listings: [], total: 0, categoryTotal: 0 };
        }
        
        // Add more debug logs
        await addLog(`Debug: About to create category query`);
        await addLog(`Debug: categoryIds type: ${typeof categoryIds}`);
        await addLog(`Debug: categoryIds value: ${categoryIds}`);

        // Check if categoryIds exists and is an array
        if (!Array.isArray(categoryIds)) {
            await addLog(`Error: categoryIds is not an array: ${typeof categoryIds}`);
            return { error: true, listings: [], total: totalListings, categoryTotal: 0 };
        }

        // Then get category-specific listings
        const categoryQuery = categoryIds.join('|');
        const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
            `q=category:{${categoryQuery}} seller:${encodeURIComponent(sellerUsername)}&` +
            `limit=50`;
        await addLog(`Debug: Using URL: ${url}`);

        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
            }
        }, 8000);

        if (!response.ok) {
            const errorData = await response.text();
            await addLog(`Error fetching listings for ${sellerUsername}: ${response.status}`);
            await addLog(`Error details: ${errorData}`);
            return { 
                error: true, 
                listings: [], 
                total: totalListings,
                categoryTotal: 0 
            };
        }

        const data = await response.json();
        return {
            error: false,
            listings: data.itemSummaries || [],
            total: totalListings,
            categoryTotal: data.total || 0
        };

    } catch (error) {
        await addLog(`Error processing ${sellerUsername}: ${error.message}`);
        return { error: true, listings: [], total: 0, categoryTotal: 0 };
    }
}

// Updated analyzeSellerListings function
async function analyzeSellerListings(sellerData, username) {
    await addLog(`\n==== ANALYZING SELLER: ${username} ====`);

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



async function fetchListingsForPhrase(phrase, accessToken, categoryIds,retryCount = 3) {
    await trackApiCall();
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(phrase)}&limit=150`;
    
    // Check cache first
    const cacheKey = phrase.toLowerCase();
    const currentTime = Date.now();
    if (listingsCache.data[cacheKey] && 
        (currentTime - listingsCache.timestamps[cacheKey]) < CACHE_DURATION) {
        await addLog(`Using cached results for phrase: ${phrase}`);
        return listingsCache.data[cacheKey];
    }

    await addLog(`\n=== Searching for phrase: ${phrase} ===`);
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
            await addLog(`Error fetching listings for ${phrase}: ${response.status}`);
            await addLog(`Error details: ${errorText}`);
            return [];
        }

        const data = await response.json();
        await addLog(`Found ${data.itemSummaries?.length || 0} initial listings for ${phrase}`);

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
                    const sellerData = await fetchSellerListings(item.seller?.username, accessToken,categoryIds);
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
        await addLog(`Error processing ${phrase}: ${error.message}`);
        return [];
    }
}

async function fetchAllListings(categoryIds,searchPhrases, feedbackThreshold) {
    try {
        await addLog('\n====== Starting new scan ======');
        const accessToken = await fetchAccessToken();
        await addLog('Access token obtained successfully');
        console.log('Starting scan with searchPhrases:', searchPhrases); // Debug log
        const allListings = [];
        
        for (const phrase of searchPhrases) {
            console.log('Searching for phrase:', phrase); // Debug log
            const listings = await fetchListingsForPhrase(phrase, accessToken, categoryIds,feedbackThreshold);
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

async function startScan(categoryIds,searchPhrases, feedbackThreshold) {
    try {
        const scanStartTime = new Date().toISOString().split('T')[0];
        const logFileName = `ebay-scanner-${scanStartTime}.txt`;
        
        await fs.appendFile(logFileName, `\n\n========================================\n`);
        await fs.appendFile(logFileName, `New Scan Started at ${new Date().toLocaleString()}\n`);
        await fs.appendFile(logFileName, `========================================\n\n`);
        
        scanResults.status = 'processing';
        scanResults.error = null;
        scanResults.logMessages = [];
        const listings = await fetchAllListings(categoryIds,searchPhrases, feedbackThreshold);
        
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




app.get('/results', (req, res) => {
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
startScan();

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});