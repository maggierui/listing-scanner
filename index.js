import express from 'express';
import fetchAccessToken from './auth.js';
import fetch from 'node-fetch';
import { appendFile } from 'fs/promises';

const app = express();
const PORT = process.env.PORT || 3000;

const searchPhrases = ['"jewelry lot"', '"jewelry collection"', '"jewelry bundle"'];
const jewelryPhrases = [
    '"jewelry"', '"necklace"', '"necklaces"', '"brooch"', '"brooches"', 
    '"ring"', '"rings"', '"bracelet"', '"bracelets"', '"earring"', 
    '"earrings"', '"bangle"', '"bangles"', '"pendant"', '"pendants"'
];
const feedbackThreshold = 5000;

// Store results in memory
let scanResults = {
    status: 'processing',
    listings: [],
    lastUpdated: null,
    error: null,
    logMessages: []
};

async function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
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
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
        `q=seller:${encodeURIComponent(sellerUsername)}` +
        `&limit=100` +
        `&offset=0`;

    await addLog(`\n=== Fetching listings for seller: ${sellerUsername} ===`);

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

    // Log all titles
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
            await addLog('Rate limit reached, waiting 10 seconds...');
            await delay(10000);
            return fetchListingsForPhrase(phrase, accessToken);
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
                if (feedbackScore >= feedbackThreshold) {
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

            filteredListings.push(...results.filter(item => item !== null));
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
        
        for (const phrase of searchPhrases) {
            const listings = await fetchListingsForPhrase(phrase, accessToken);
            allListings.push(...listings);
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
        
        // Add a header to the log file
        await appendFile(logFileName, `\n\n========================================\n`);
        await appendFile(logFileName, `New Scan Started at ${new Date().toLocaleString()}\n`);
        await appendFile(logFileName, `========================================\n\n`);
        
        scanResults.status = 'processing';
        scanResults.error = null;
        scanResults.logMessages = [];
        const listings = await fetchAllListings();
        
        // Log completion to file
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
        
        setTimeout(startScan, 300000); // 5 minutes
    } catch (error) {
        await addLog(`Error during scan: ${error.message}`);
        scanResults = {
            ...scanResults,
            status: 'error',
            error: error.message
        };
        setTimeout(startScan, 60000); // 1 minute on error
    }
}
app.get('/status', (req, res) => {
    res.json({ status: 'Server is running' });
});

app.get('/', async (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>eBay Listings Scanner</title>
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    margin: 20px;
                    line-height: 1.6;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin-top: 20px;
                    font-size: 14px;
                }
                th, td { 
                    border: 1px solid #ccc; 
                    padding: 10px; 
                    text-align: left;
                }
                th { 
                    background-color: #f4f4f4;
                    position: sticky;
                    top: 0;
                }
                tr:nth-child(even) { 
                    background-color: #f9f9f9;
                }
                .auto-refresh { 
                    color: #666; 
                    margin-bottom: 20px;
                }
                #loading { 
                    text-align: center; 
                    padding: 20px;
                }
                .spinner { 
                    width: 50px; 
                    height: 50px; 
                    border: 5px solid #f3f3f3;
                    border-top: 5px solid #3498db; 
                    border-radius: 50%;
                    animation: spin 1s linear infinite; 
                    margin: 20px auto;
                }
                @keyframes spin { 
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .error { 
                    color: red; 
                    padding: 20px; 
                    text-align: center;
                }
                #logArea {
                    max-height: 400px;
                    overflow-y: auto;
                    padding: 10px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    margin: 10px auto;
                    background-color: #f9f9f9;
                    font-family: monospace;
                    width: 95%;
                    text-align: left;
                    font-size: 13px;
                }
                .log-message {
                    margin: 2px 0;
                    padding: 2px 0;
                    border-bottom: 1px solid #eee;
                }
                .note {
                    background-color: #fff3cd;
                    border: 1px solid #ffeeba;
                    padding: 10px;
                    margin: 10px 0;
                    border-radius: 4px;
                }
            </style>
        </head>
        <body>
            <h1>eBay Listings Scanner</h1>
            <div class="note">
                Full scanning logs are being written to a file for debugging purposes.
            </div>
            <div id="loading">
                <div class="spinner"></div>
                <p>Scanning listings... This may take a few minutes.</p>
                <p>Recent activity:</p>
                <div id="logArea"></div>
            </div>
            <div id="error" style="display: none;" class="error"></div>
            <div id="results" style="display: none;"></div>

            <script>
                function checkResults() {
                    fetch('/results')
                        .then(response => response.json())
                        .then(data => {
                            // Update logs
                            const logArea = document.getElementById('logArea');
                            if (data.logMessages) {
                                logArea.innerHTML = data.logMessages
                                    .map(msg => '<div class="log-message">' + msg + '</div>')
                                    .join('');
                                logArea.scrollTop = logArea.scrollHeight;
                            }

                            if (data.status === 'complete') {
                                document.getElementById('loading').style.display = 'none';
                                document.getElementById('error').style.display = 'none';
                                document.getElementById('results').style.display = 'block';
                                document.getElementById('results').innerHTML = data.html;
                            } else if (data.status === 'error') {
                                document.getElementById('loading').style.display = 'none';
                                document.getElementById('results').style.display = 'none';
                                document.getElementById('error').style.display = 'block';
                                document.getElementById('error').innerHTML = 'Error: ' + data.error;
                            }
                            setTimeout(checkResults, 2000);
                        })
                        .catch(error => {
                            console.error('Error:', error);
                            setTimeout(checkResults, 2000);
                        });
                }

                checkResults();
            </script>
        </body>
        </html>
    `;

    res.send(html);
});

app.get('/results', (req, res) => {
    if (scanResults.status === 'complete') {
        const html = `
            <p class="auto-refresh">Last updated: ${scanResults.lastUpdated.toLocaleString()}</p>
            <p>Total Listings Found: ${scanResults.listings.length}</p>
            <table>
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>Price</th>
                        <th>Currency</th>
                        <th>Seller</th>
                        <th>Feedback Score</th>
                        <th>Link</th>
                    </tr>
                </thead>
                <tbody>
                    ${scanResults.listings.map(item => `
                        <tr>
                            <td>${item.title}</td>
                            <td>${item.price?.value || 'N/A'}</td>
                            <td>${item.price?.currency || 'N/A'}</td>
                            <td>${item.seller?.username || 'N/A'}</td>
                            <td>${item.seller?.feedbackScore || 'N/A'}</td>
                            <td><a href="${item.itemWebUrl}" target="_blank">View Listing</a></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        res.json({
            status: 'complete',
            html: html,
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