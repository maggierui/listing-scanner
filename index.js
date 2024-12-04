import express from 'express';
import fetchAccessToken from './auth-off.js';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

console.log('Starting application...');

// Add error logging middleware
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).send(`Server Error: ${err.message}`);
});

async function safeStart() {
    try {
        console.log('Attempting to fetch access token...');
        const accessToken = await fetchAccessToken();
        console.log('Access token obtained successfully');

        const phrases = ['"jewelry lot"', '"jewelry collection"', '"jewelry bundle"'];
        const feedbackThreshold = 5000; // Define the maximum seller feedback score


        async function fetchListingsForPhrase(phrase) {
            console.log(`Fetching listings for phrase: ${phrase}`);
            const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(phrase)}&limit=150`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            console.error(`Error fetching listings for ${phrase}: ${response.status}`);
            return [];
        }

        const data = await response.json();

        const filteredListings = [];

        for (const item of data.itemSummaries || []) {
            const feedbackScore = item.seller?.feedbackScore || 0;
            const availableQuantity = item.availableQuantity || 1;

            // Check initial criteria
            if (feedbackScore >= feedbackThreshold || availableQuantity > 1) {
                continue;
            }

            // Fetch seller's other listings
            const sellerListings = await fetchSellerListings(item.seller?.username);

            // Analyze seller's listings
            if (analyzeSellerListings(sellerListings)) {
                console.log(`Excluded Listing: ${item.title}, Seller: ${item.seller?.username}`);
                continue;
            }

            // Include listing if it passes all filters
            filteredListings.push(item);
        }

        return filteredListings;
    } catch (error) {
        console.error('Error fetching or processing the API response:', error.message);
        return [];
    }
        }

        app.get('/', async (req, res) => {
            try {
                console.log('Root route accessed');
                const allListings = [];

                for (const phrase of phrases) {
                    try {
                        const listings = await fetchListingsForPhrase(phrase);
                        allListings.push(...listings);
                    } catch (phraseError) {
                        console.error(`Error fetching listings for phrase ${phrase}:`, phraseError);
                    }
                }

                console.log(`Total listings found: ${allListings.length}`);

                // Generate HTML dynamically
                const html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>eBay Listings</title>
                    </head>
                    <body>
                        <h1>eBay Listings</h1>
                        <p>Total Listings: ${allListings.length}</p>
                        <pre>${JSON.stringify(allListings, null, 2)}</pre>
                    </body>
                    </html>
                `;

                res.send(html);
            } catch (error) {
                console.error('Error in root route:', error);
                res.status(500).send(`Server Error: ${error.message}`);
            }
        });

        // Start the server
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });

    } catch (startupError) {
        console.error('Startup Error:', startupError);
    }
}

safeStart();