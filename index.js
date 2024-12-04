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

async function fetchListingsForPhrase(phrase, accessToken) {
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(phrase)}&limit=150`;
    console.log(`Fetching URL: ${url}`);
    console.log(`Using access token (first 10 chars): ${accessToken.substring(0, 10)}...`);

    try {
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error fetching listings for ${phrase}: ${response.status}`);
            console.error('Error details:', errorText);
            return [];
        }

        const data = await response.json();
        console.log(`Raw API response for ${phrase}:`, JSON.stringify(data, null, 2));
        console.log(`Number of items found for ${phrase}: ${data.itemSummaries?.length || 0}`);

        if (!data.itemSummaries || data.itemSummaries.length === 0) {
            console.log(`No items found for phrase: ${phrase}`);
            return [];
        }

        const filteredListings = [];
        
        // Process sellers in parallel using Promise.all
        await Promise.all((data.itemSummaries || []).map(async (item) => {
            const feedbackScore = item.seller?.feedbackScore || 0;
            const availableQuantity = item.availableQuantity || 1;

            if (feedbackScore >= feedbackThreshold || availableQuantity > 1) {
                console.log(`Skipping item due to criteria - Feedback: ${feedbackScore}, Quantity: ${availableQuantity}`);
                return;
            }

            try {
                const sellerListings = await fetchSellerListings(item.seller?.username, accessToken);
                const shouldExclude = await analyzeSellerListings(sellerListings);
                
                if (!shouldExclude) {
                    console.log(`Including listing from seller ${item.seller?.username}`);
                    filteredListings.push(item);
                } else {
                    console.log(`Excluded Listing: ${item.title}, Seller: ${item.seller?.username}`);
                }
            } catch (error) {
                console.error(`Error processing seller ${item.seller?.username}:`, error);
            }
        }));

        console.log(`Filtered listings count for ${phrase}: ${filteredListings.length}`);
        return filteredListings;
    } catch (error) {
        console.error(`Complete error for phrase ${phrase}:`, error);
        return [];
    }
}

async function fetchSellerListings(sellerUsername, accessToken) {
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=seller:${encodeURIComponent(sellerUsername)}&limit=50`;
    console.log(`Fetching seller listings URL: ${url}`);

    try {
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
            },
        }, 8000);

        if (!response.ok) {
            const errorData = await response.text();
            console.error(`Error fetching listings for seller ${sellerUsername}: ${response.status}`);
            console.error('Error details:', errorData);
            return [];
        }

        const data = await response.json();
        console.log(`Successfully fetched ${data.itemSummaries?.length || 0} listings for seller ${sellerUsername}`);
        return data.itemSummaries || [];
    } catch (error) {
        console.error(`Error fetching seller's listings for ${sellerUsername}:`, error.message);
        return [];
    }
}

async function analyzeSellerListings(listings) {
    const totalListings = listings.length;
    console.log(`Analyzing ${totalListings} listings`);

    if (totalListings <= 15) {
        console.log('Not enough listings to analyze (<=15)');
        return false;
    }

    let jewelryListings = 0;

    for (const item of listings) {
        const isJewelryListing = jewelryPhrases.some(phrase => 
            item.title.toLowerCase().includes(phrase.replace(/"/g, ''))
        );

        if (isJewelryListing) {
            jewelryListings++;
        }
    }

    const jewelryPercentage = (jewelryListings / totalListings) * 100;
    console.log(`Jewelry listings: ${jewelryListings}, Total: ${totalListings}, Percentage: ${jewelryPercentage}%`);

    return jewelryPercentage >= 80;
}

async function fetchAllListings() {
    try {
        console.log('Fetching access token...');
        const accessToken = await fetchAccessToken();
        console.log('Access token obtained. First 10 characters:', accessToken.substring(0, 10) + '...');

        const listingsArrays = await Promise.all(
            searchPhrases.map(phrase => fetchListingsForPhrase(phrase, accessToken))
        );

        const allListings = listingsArrays.flat();
        console.log(`Total combined listings: ${allListings.length}`);
        return allListings;
    } catch (error) {
        console.error('Error in fetchAllListings:', error);
        throw error;
    }
}

app.get('/', async (req, res) => {
    res.setTimeout(25000, () => {
        res.status(503).send(`
            <html>
                <body>
                    <h1>Request Timeout</h1>
                    <p>The request took too long to process. Please try again.</p>
                    <script>
                        setTimeout(() => window.location.reload(), 5000);
                    </script>
                </body>
            </html>
        `);
    });

    try {
        const listings = await fetchAllListings();

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>eBay Listings</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
                    th { background-color: #f4f4f4; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    .auto-refresh { color: #666; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <h1>eBay Listings</h1>
                <p class="auto-refresh">Page auto-refreshes every 5 minutes</p>
                <p>Total Listings Found: ${listings.length}</p>
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
                        ${listings.map(item => `
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
                <script>
                    setTimeout(() => window.location.reload(), 300000);
                </script>
            </body>
            </html>
        `;

        res.send(html);
    } catch (error) {
        console.error('Error in root route:', error);
        res.status(500).send(`<h1>Error</h1><p>${error.message}</p>`);
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});