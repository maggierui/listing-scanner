import express from 'express';
import fetchAccessToken from './auth.js';
import fetch from 'node-fetch';
import { appendFile, readFile } from 'fs/promises';

let apiCallsCount = 0;

async function trackApiCall() {
    apiCallsCount++;
    await addLog(`API Calls made today: ${apiCallsCount}/5000`);
    if (apiCallsCount > 4500) {
        await addLog('WARNING: Approaching daily API limit (5000)');
    }
}

const app = express();
const PORT = process.env.PORT || 3000;
const path = require('path');



const jewelryPhrases = [
    '"jewelry"', '"necklace"', '"necklaces"', '"brooch"', '"brooches"', 
    '"ring"', '"rings"', '"bracelet"', '"bracelets"', '"earring"', 
    '"earrings"', '"bangle"', '"bangles"', '"pendant"', '"pendants"'
];

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

app.post('/scan', async (req, res) => {
    try {
      // Receive user input from the request body
      const { searchPhrases, feedbackThreshold } = req.body;
  
      // Update the global variables
      this.searchPhrases = searchPhrases;
      this.feedbackThreshold = feedbackThreshold;
  
      // Start the scanning process
      await startScan();
  
      // Return a response to the client
      res.json({ status: 'Scan started' });
    } catch (error) {
      // Handle any errors that occur during the scanning process
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
        await appendFile(logFileName, logMessage);
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
async function fetchSellerListings(sellerUsername, accessToken, retryCount = 2) {
    await trackApiCall(); 
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
        `filter=seller:{${encodeURIComponent(sellerUsername)}}` + // Changed this line
        `&limit=100`;

    await addLog(`\n=== Fetching listings for seller: ${sellerUsername} ===`);
    await addLog(`Using URL: ${url}`);  // Added for debugging

    for (let i = 0; i <= retryCount; i++) {
        try {
            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
                },
            }, 8000);

            if (response.status === 429) {
                await addLog(`Rate limit reached for seller ${sellerUsername}, waiting 10 seconds...`);
                await delay(10000);
                continue;
            }

            if (!response.ok) {
                const errorData = await response.text();
                await addLog(`Error fetching listings for ${sellerUsername}: ${response.status}`);
                await addLog(`Error details: ${errorData}`);
                
                if (i === retryCount) {
                    return { error: true, listings: [], total: 0 };
                }
                await delay(1000 * (i + 1));
                continue;
            }

            const data = await response.json();
            await addLog(`Successfully fetched ${data.itemSummaries?.length || 0} listings for seller ${sellerUsername}`);
            await addLog(`Total available listings: ${data.total || 0}`);
            await addLog(`API Response: ${JSON.stringify(data, null, 2)}`); // Add this line for debugging

            
            return {
                error: false,
                listings: data.itemSummaries || [],
                total: data.total || 0
            };
        } catch (error) {
            await addLog(`Error processing seller ${sellerUsername}: ${error.message}`);
            if (i === retryCount) {
                return { error: true, listings: [], total: 0 };
            }
            await delay(1000 * (i + 1));
        }
    }
    return { error: true, listings: [], total: 0 };
}

async function analyzeSellerListings(sellerData, username) {
    await addLog(`\n==== ANALYZING SELLER: ${username} ====`);

    if (sellerData.error || !sellerData.listings || sellerData.listings.length === 0) {
        await addLog(`ERROR: No valid listings found for seller ${username}`);
        return true;
    }

    const fetchedListings = sellerData.listings;
    const totalAvailable = sellerData.total;
    
    await addLog(`Total available listings: ${totalAvailable}`);
    await addLog(`Fetched listings for analysis: ${fetchedListings.length}`);

    await addLog(`\nAll listings for ${username}:`);
    for (const item of fetchedListings) {
        await addLog(`- ${item.title}`);
    }

    let jewelryListings = 0;
    const jewelryMatches = [];

    for (const item of fetchedListings) {
        const matchedPhrases = jewelryPhrases.filter(phrase => {
            const cleanPhrase = phrase.replace(/"/g, '').trim().toLowerCase();
            const itemTitle = item.title.toLowerCase();
            const isMatch = itemTitle.includes(cleanPhrase);
            return isMatch;
        });

        if (matchedPhrases.length > 0) {
            jewelryListings++;
            jewelryMatches.push({
                title: item.title,
                matches: matchedPhrases
            });
            await addLog(`Jewelry match found: "${item.title}" - matched phrases: ${matchedPhrases.join(', ')}`);
        }
    }

    const jewelryPercentage = (jewelryListings / fetchedListings.length) * 100;

    await addLog(`\nFinal Analysis for ${username}:`);
    await addLog(`- Total listings analyzed: ${fetchedListings.length}`);
    await addLog(`- Jewelry listings found: ${jewelryListings}`);
    await addLog(`- Jewelry percentage: ${jewelryPercentage.toFixed(2)}%`);

    const shouldExclude = jewelryPercentage >= 80;
    await addLog(shouldExclude ? 
        `DECISION: EXCLUDING ${username} - ${jewelryPercentage.toFixed(2)}% jewelry` : 
        `DECISION: INCLUDING ${username} - ${jewelryPercentage.toFixed(2)}% jewelry`);
    await addLog(`==== END ANALYSIS FOR ${username} ====\n`);
    
    return shouldExclude;
}

async function fetchListingsForPhrase(phrase, accessToken) {
    await trackApiCall();
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(phrase)}&limit=150`;
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
        // Don't retry - it won't help with daily limits
        return { error: true, listings: [], total: 0 };
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
                if (feedbackScore >= this.feedbackThreshold) {
                    await addLog(`Skipping seller ${item.seller?.username} (feedback: ${feedbackScore})`);
                    return null;
                }

                try {
                    const sellerData = await fetchSellerListings(item.seller?.username, accessToken);
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

        await addLog(`Found ${filteredListings.length} matching listings for ${phrase}\n`);
        return filteredListings;
    } catch (error) {
        await addLog(`Error processing ${phrase}: ${error.message}`);
        return [];
    }
}

async function fetchAllListings() {
    try {
        await addLog('\n====== Starting new scan ======');
        const accessToken = await fetchAccessToken();
        await addLog('Access token obtained successfully');

        const allListings = [];
        
        for (const phrase of this.searchPhrases) {
            const listings = await fetchListingsForPhrase(phrase, accessToken);
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

async function startScan() {
    try {
        const scanStartTime = new Date().toISOString().split('T')[0];
        const logFileName = `ebay-scanner-${scanStartTime}.txt`;
        
        await appendFile(logFileName, `\n\n========================================\n`);
        await appendFile(logFileName, `New Scan Started at ${new Date().toLocaleString()}\n`);
        await appendFile(logFileName, `========================================\n\n`);
        
        scanResults.status = 'processing';
        scanResults.error = null;
        scanResults.logMessages = [];
        const listings = await fetchAllListings();
        
        await appendFile(logFileName, `\n========================================\n`);
        await appendFile(logFileName, `Scan Completed at ${new Date().toLocaleString()}\n`);
        await appendFile(logFileName, `Total listings found: ${listings.length}\n`);
        await appendFile(logFileName, `========================================\n\n`);
        
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
app.get('/download-logs', async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const logFileName = `ebay-scanner-${today}.txt`;
    
    try {
        const logContent = await readFile(logFileName, 'utf8');
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