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
    // Keep only the last 50 messages
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
            addLog(`Attempt ${i + 1} for seller ${sellerUsername}`);
            
            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
                },
            }, 8000);

            if (response.status === 429) {
                addLog(`Rate limit reached for seller ${sellerUsername}, waiting 30 seconds...`);
                await delay(30000);
                continue;
            }

            if (!response.ok) {
                const errorData = await response.text();
                addLog(`Error fetching listings for seller ${sellerUsername}: ${response.status}`);
                
                if (i === retryCount) {
                    return { error: true, listings: [], total: 0 };
                }
                await delay(2000 * (i + 1));
                continue;
            }

            const data = await response.json();
            addLog(`Found ${data.itemSummaries?.length || 0} listings for seller ${sellerUsername}`);
            
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
            await delay(2000 * (i + 1));
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
    
    addLog(`Analyzing ${fetchedListings.length} listings for seller ${username}`);

    if (totalAvailable <= 15) {
        addLog(`Small seller ${username} (${totalAvailable} listings), including`);
        return false;
    }

    let jewelryListings = 0;
    for (const item of fetchedListings) {
        const isJewelryListing = jewelryPhrases.some(phrase => 
            item.title.toLowerCase().includes(phrase.replace(/"/g, '').toLowerCase())
        );
        if (isJewelryListing) {
            jewelryListings++;
        }
    }

    const jewelryPercentage = (jewelryListings / fetchedListings.length) * 100;
    addLog(`Seller ${username}: ${jewelryPercentage.toFixed(2)}% jewelry listings`);

    const shouldExclude = jewelryPercentage >= 80;
    addLog(shouldExclude ? 
        `Excluding seller ${username} (${jewelryPercentage.toFixed(2)}% jewelry)` : 
        `Including seller ${username} (${jewelryPercentage.toFixed(2)}% jewelry)`);
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
            addLog('Rate limit reached, waiting 30 seconds...');
            await delay(30000);
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
        
        for (const item of data.itemSummaries || []) {
            const feedbackScore = item.seller?.feedbackScore || 0;

            if (feedbackScore >= feedbackThreshold) {
                addLog(`Skipping seller ${item.seller?.username} (feedback: ${feedbackScore})`);
                continue;
            }

            try {
                const sellerData = await fetchSellerListings(item.seller?.username, accessToken);
                const shouldExclude = await analyzeSellerListings(sellerData, item.seller?.username);
                
                if (!shouldExclude) {
                    addLog(`Adding listing from ${item.seller?.username}: ${item.title}`);
                    filteredListings.push(item);
                }

                await delay(1000);
                
            } catch (error) {
                addLog(`Error processing ${item.seller?.username}: ${error.message}`);
            }
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
        addLog('Fetching access token...');
        const accessToken = await fetchAccessToken();
        addLog('Access token obtained successfully');

        const allListings = [];
        
        for (const phrase of searchPhrases) {
            const listings = await fetchListingsForPhrase(phrase, accessToken);
            allListings.push(...listings);
            await delay(2000);
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
        
        setTimeout(startScan, 300000); // Start new scan after 5 minutes
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
                body { font-family: Arial, sans-serif; margin: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
                th { background-color: #f4f4f4; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                .auto-refresh { color: #666; margin-bottom: 20px; }
                #loading { text-align: center; padding: 20px; }
                .spinner { width: 50px; height: 50px; border: 5px solid #f3f3f3; 
                          border-top: 5px solid #3498db; border-radius: 50%;
                          animation: spin 1s linear infinite; margin: 20px auto; }
                @keyframes spin { 0% { transform: rotate(0deg); }
                                100% { transform: rotate(360deg); } }
                .error { color: red; padding: 20px; text-align: center; }
                #logArea {
                    max-height: 400px;
                    overflow-y: auto;
                    padding: 10px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    margin: 10px auto;
                    background-color: #f9f9f9;
                    font-family: monospace;
                    width: 90%;
                    text-align: left;
                }
                .log-message {
                    margin: 2px 0;
                    padding: 2px 0;
                    border-bottom: 1px solid #eee;
                }
            </style>
        </head>
        <body>
            <h1>eBay Listings Scanner</h1>
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

startScan();

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});