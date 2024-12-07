import express from 'express';
import fetchAccessToken from './auth.js';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

const searchPhrases = ['"jewelry lot"', '"jewelry collection"', '"jewelry bundle"'];
const jewelryPhrases = [
    '"jewelry"', '"necklace"', '"necklaces"', '"brooch"', '"brooches"', 
    '"ring"', '"rings"', '"bracelet"', '"bracelets"', '"earring"', 
    '"earrings"', '"bangle"', '"bangles"', '"pendant"', '"pendants"'
];
const feedbackThreshold = 5000;

// Store results and logs in memory
let scanResults = {
    status: 'processing',
    listings: [],
    lastUpdated: null,
    error: null,
    logMessages: []
};

function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `${timestamp}: ${message}`;
    scanResults.logMessages.push(logMessage);
    if (scanResults.logMessages.length > 50) {
        scanResults.logMessages.shift();
    }
    console.log(logMessage);
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

    addLog(`Fetching listings for seller: ${sellerUsername}`);

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
                addLog(`Rate limit reached for seller ${sellerUsername}, waiting 10 seconds...`);
                await delay(10000); // Reduced from 30s to 10s
                continue;
            }

            if (!response.ok) {
                const errorData = await response.text();
                addLog(`Error fetching listings for ${sellerUsername}: ${response.status}`);
                
                if (i === retryCount) {
                    return { error: true, listings: [], total: 0 };
                }
                await delay(1000 * (i + 1));
                continue;
            }

            const data = await response.json();
            addLog(`Retrieved ${data.itemSummaries?.length || 0} listings for seller ${sellerUsername}`);
            
            return {
                error: false,
                listings: data.itemSummaries || [],
                total: data.total || 0
            };
        } catch (error) {
            addLog(`Error processing seller ${sellerUsername}: ${error.message}`);
            if (i === retryCount) {
                return { error: true, listings: [], total: 0 };
            }
            await delay(1000 * (i + 1));
        }
    }
    return { error: true, listings: [], total: 0 };
}

async function analyzeSellerListings(sellerData, username) {
    if (sellerData.error || !sellerData.listings || sellerData.listings.length === 0) {
        addLog(`No valid listings found for seller ${username}, excluding`);
        return true;
    }

    const fetchedListings = sellerData.listings;
    const totalAvailable = sellerData.total;
    
    addLog(`Analyzing ${fetchedListings.length} listings for seller ${username} (${totalAvailable} total available)`);

    // Debug: Print first few titles
    addLog(`Sample listings for ${username}:`);
    fetchedListings.slice(0, 3).forEach(item => {
        addLog(`- ${item.title}`);
    });

    if (totalAvailable <= 15) {
        addLog(`Small seller ${username} (${totalAvailable} listings), including`);
        return false;
    }

    let jewelryListings = 0;
    const jewelryMatches = [];

    for (const item of fetchedListings) {
        const matchedPhrases = jewelryPhrases.filter(phrase => {
            const cleanPhrase = phrase.replace(/"/g, '').trim().toLowerCase();
            return item.title.toLowerCase().includes(cleanPhrase);
        });

        if (matchedPhrases.length > 0) {
            jewelryListings++;
            jewelryMatches.push({
                title: item.title,
                matches: matchedPhrases
            });
        }
    }

    const jewelryPercentage = (jewelryListings / fetchedListings.length) * 100;

    // Detailed analysis logging
    addLog(`Analysis for ${username}:`);
    addLog(`- Total listings analyzed: ${fetchedListings.length}`);
    addLog(`- Jewelry listings found: ${jewelryListings}`);
    addLog(`- Jewelry percentage: ${jewelryPercentage.toFixed(2)}%`);
    if (jewelryMatches.length > 0) {
        addLog('Sample matches:');
        jewelryMatches.slice(0, 3).forEach(match => {
            addLog(`- ${match.title} (matched: ${match.matches.join(', ')})`);
        });
    }

    const shouldExclude = jewelryPercentage >= 80;
    addLog(shouldExclude ? 
        `EXCLUDING ${username} - ${jewelryPercentage.toFixed(2)}% jewelry` : 
        `INCLUDING ${username} - ${jewelryPercentage.toFixed(2)}% jewelry`);
    
    return shouldExclude;
}

async function fetchListingsForPhrase(phrase, accessToken) {
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(phrase)}&limit=150`;
    addLog(`Searching for phrase: ${phrase}`);

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
            addLog('Rate limit reached, waiting 10 seconds...');
            await delay(10000);
            return fetchListingsForPhrase(phrase, accessToken);
        }

        if (!response.ok) {
            const errorText = await response.text();
            addLog(`Error fetching listings for ${phrase}: ${response.status}`);
            return [];
        }

        const data = await response.json();
        addLog(`Found ${data.itemSummaries?.length || 0} initial listings for ${phrase}`);

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
                    addLog(`Skipping seller ${item.seller?.username} (feedback: ${feedbackScore})`);
                    return null;
                }

                try {
                    const sellerData = await fetchSellerListings(item.seller?.username, accessToken);
                    const shouldExclude = await analyzeSellerListings(sellerData, item.seller?.username);
                    
                    if (!shouldExclude) {
                        addLog(`Adding listing from ${item.seller?.username}: ${item.title}`);
                        return item;
                    }
                    return null;
                } catch (error) {
                    addLog(`Error processing ${item.seller?.username}: ${error.message}`);
                    return null;
                }
            }));

            filteredListings.push(...results.filter(item => item !== null));
            await delay(500);
        }

        addLog(`Found ${filteredListings.length} matching listings for ${phrase}`);
        return filteredListings;
    } catch (error) {
        addLog(`Error processing ${phrase}: ${error.message}`);
        return [];
    }
}

async function fetchAllListings() {
    try {
        addLog('Starting new scan...');
        const accessToken = await fetchAccessToken();
        addLog('Access token obtained successfully');

        const allListings = [];
        
        for (const phrase of searchPhrases) {
            const listings = await fetchListingsForPhrase(phrase, accessToken);
            allListings.push(...listings);
            await delay(1000);
        }

        addLog(`Scan complete. Found ${allListings.length} total listings`);
        return allListings;
    } catch (error) {
        addLog(`Scan error: ${error.message}`);
        throw error;
    }
}

async function startScan() {
    try {
        scanResults.status = 'processing';
        scanResults.error = null;
        scanResults.logMessages = [];
        const listings = await fetchAllListings();
        
        scanResults = {
            status: 'complete',
            listings: listings,
            lastUpdated: new Date(),
            error: null,
            logMessages: scanResults.logMessages
        };
        
        setTimeout(startScan, 300000);
    } catch (error) {
        addLog(`Error during scan: ${error.message}`);
        scanResults = {
            ...scanResults,
            status: 'error',
            error: error.message
        };
        setTimeout(startScan, 60000);
    }
}

// Express routes and UI components

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
                .log-timestamp {
                    color: #666;
                    margin-right: 10px;
                }
                #results {
                    margin-top: 20px;
                }
            </style>
        </head>
        <body>
            <h1>eBay Listings Scanner</h1>
            <div id="loading">
                <div class="spinner"></div>
                <p>Scanning listings... This may take a few minutes.</p>
                <p>Live scanning activity:</p>
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

// Start the background scanning process when server starts
startScan();

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
