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

// Store results in memory
let scanResults = {
    status: 'processing',
    listings: [],
    lastUpdated: null,
    error: null
};

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

    for (let i = 0; i <= retryCount; i++) {
        try {
            console.log(`Attempt ${i + 1}: Fetching listings for seller ${sellerUsername}`);
            
            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
                },
            }, 8000);

            if (response.status === 429) {
                console.log('Rate limit reached, waiting 30 seconds before retry...');
                await delay(30000);
                continue;
            }

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`Attempt ${i + 1}: Error fetching listings for seller ${sellerUsername}: ${response.status}`);
                console.error('Error details:', errorData);
                
                if (i === retryCount) {
                    return { error: true, listings: [], total: 0 };
                }
                await delay(2000 * (i + 1));
                continue;
            }

            const data = await response.json();
            console.log(`Successfully fetched ${data.itemSummaries?.length || 0} listings for seller ${sellerUsername}`);
            console.log(`Total listings available: ${data.total || 0}`);
            
            return {
                error: false,
                listings: data.itemSummaries || [],
                total: data.total || 0
            };
        } catch (error) {
            console.error(`Attempt ${i + 1}: Error fetching seller's listings for ${sellerUsername}:`, error.message);
            if (i === retryCount) {
                return { error: true, listings: [], total: 0 };
            }
            await delay(2000 * (i + 1));
        }
    }
    return { error: true, listings: [], total: 0 };
}

async function analyzeSellerListings(sellerData) {
    if (sellerData.error || !sellerData.listings || sellerData.listings.length === 0) {
        console.log('Error or no listings fetched for seller analysis, excluding seller');
        return true;
    }

    const fetchedListings = sellerData.listings;
    const totalAvailable = sellerData.total;
    
    console.log(`Analyzing seller - Total available listings: ${totalAvailable}, Fetched for analysis: ${fetchedListings.length}`);

    if (totalAvailable <= 15) {
        console.log('Small seller (<=15 listings), including');
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
    console.log(`Seller analysis results:` +
                `\nTotal available listings: ${totalAvailable}` +
                `\nFetched listings: ${fetchedListings.length}` +
                `\nJewelry listings in sample: ${jewelryListings}` +
                `\nJewelry percentage: ${jewelryPercentage.toFixed(2)}%`);

    const shouldExclude = jewelryPercentage >= 80;
    console.log(shouldExclude ? 
        `EXCLUDING seller - ${jewelryPercentage.toFixed(2)}% of listings are jewelry` : 
        `INCLUDING seller - ${jewelryPercentage.toFixed(2)}% of listings are jewelry`);
    return shouldExclude;
}

async function fetchListingsForPhrase(phrase, accessToken) {
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(phrase)}&limit=150`;
    console.log(`\nFetching listings for phrase: ${phrase}`);

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
            console.log('Rate limit reached, waiting 30 seconds before retry...');
            await delay(30000);
            return fetchListingsForPhrase(phrase, accessToken);
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error fetching listings for ${phrase}: ${response.status}`);
            console.error('Error details:', errorText);
            return [];
        }

        const data = await response.json();
        console.log(`Number of items found for ${phrase}: ${data.itemSummaries?.length || 0}`);

        if (!data.itemSummaries || data.itemSummaries.length === 0) {
            return [];
        }

        const filteredListings = [];
        
        for (const item of data.itemSummaries || []) {
            const feedbackScore = item.seller?.feedbackScore || 0;

            if (feedbackScore >= feedbackThreshold) {
                console.log(`Skipping item due to feedback score: ${feedbackScore}`);
                continue;
            }

            try {
                console.log(`\nAnalyzing seller: ${item.seller?.username}`);
                console.log(`Item title: ${item.title}`);
                
                const sellerData = await fetchSellerListings(item.seller?.username, accessToken);
                const shouldExclude = await analyzeSellerListings(sellerData);
                
                if (!shouldExclude) {
                    console.log(`Including listing from seller ${item.seller?.username}`);
                    filteredListings.push(item);
                } else {
                    console.log(`Excluded Listing: ${item.title}, Seller: ${item.seller?.username}`);
                }

                await delay(1000);
                
            } catch (error) {
                console.error(`Error processing seller ${item.seller?.username}:`, error);
            }
        }

        return filteredListings;
    } catch (error) {
        console.error(`Complete error for phrase ${phrase}:`, error);
        return [];
    }
}

async function fetchAllListings() {
    try {
        console.log('Fetching access token...');
        const accessToken = await fetchAccessToken();
        console.log('Access token obtained. First 10 characters:', accessToken.substring(0, 10) + '...');

        const allListings = [];
        
        for (const phrase of searchPhrases) {
            const listings = await fetchListingsForPhrase(phrase, accessToken);
            allListings.push(...listings);
            await delay(2000);
        }

        return allListings;
    } catch (error) {
        console.error('Error in fetchAllListings:', error);
        throw error;
    }
}

// Background scanning process
async function startScan() {
    try {
        scanResults.status = 'processing';
        scanResults.error = null;
        const listings = await fetchAllListings();
        
        scanResults = {
            status: 'complete',
            listings: listings,
            lastUpdated: new Date(),
            error: null
        };
        
        console.log(`Scan complete. Found ${listings.length} listings`);
        setTimeout(startScan, 300000); // Start new scan after 5 minutes
    } catch (error) {
        console.error('Scan error:', error);
        scanResults = {
            ...scanResults,
            status: 'error',
            error: error.message
        };
        setTimeout(startScan, 60000); // Retry after 1 minute on error
    }
}

// Routes
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
            </style>
        </head>
        <body>
            <h1>eBay Listings Scanner</h1>
            <div id="loading">
                <div class="spinner"></div>
                <p>Scanning listings... This may take a few minutes.</p>
                <p>The page will automatically update when complete.</p>
            </div>
            <div id="error" style="display: none;" class="error"></div>
            <div id="results" style="display: none;"></div>

            <script>
                function checkResults() {
                    fetch('/results')
                        .then(response => response.json())
                        .then(data => {
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
                            setTimeout(checkResults, 5000);
                        })
                        .catch(error => {
                            console.error('Error:', error);
                            setTimeout(checkResults, 5000);
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
            html: html
        });
    } else {
        res.json({
            status: scanResults.status,
            error: scanResults.error
        });
    }
});

// Start background scanning when server starts
startScan();

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});