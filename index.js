import express from 'express';
import fetchAccessToken from './auth.js';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// Search phrases for initial listing search
const searchPhrases = ['"jewelry lot"', '"jewelry collection"', '"jewelry bundle"'];

// Phrases to identify jewelry listings when analyzing seller inventory
const jewelryPhrases = [
    '"jewelry"', '"necklace"', '"necklaces"', '"brooch"', '"brooches"', 
    '"ring"', '"rings"', '"bracelet"', '"bracelets"', '"earring"', 
    '"earrings"', '"bangle"', '"bangles"', '"pendant"', '"pendants"'
];

const feedbackThreshold = 5000; // Maximum seller feedback score

async function fetchListingsForPhrase(phrase, accessToken) {
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
            const sellerListings = await fetchSellerListings(item.seller?.username, accessToken);

            // Analyze seller's listings
            const shouldExclude = await analyzeSellerListings(sellerListings);
            if (shouldExclude) {
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

async function fetchSellerListings(sellerUsername, accessToken) {
    // Use the seller's username as the search query with the proper prefix
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` + 
        `q=seller:${encodeURIComponent(sellerUsername)}` + 
        `&limit=50`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error(`Error fetching listings for seller ${sellerUsername}: ${response.status}`);
            console.error('Error details:', errorData);
            return [];
        }

        const data = await response.json();
        return data.itemSummaries || [];
    } catch (error) {
        console.error(`Error fetching seller's listings: ${error.message}`);
        return [];
    }
}

async function analyzeSellerListings(listings) {
    const totalListings = listings.length;

    if (totalListings <= 15) {
        return false; // Do not exclude if the total listings are 15 or fewer
    }

    // Count jewelry-related listings
    let jewelryListings = 0;

    for (const item of listings) {
        // Check if any jewelry phrase is in the item's title
        const isJewelryListing = jewelryPhrases.some(phrase => 
            item.title.toLowerCase().includes(phrase.replace(/"/g, ''))
        );

        if (isJewelryListing) {
            jewelryListings++;
        }
    }

    // Calculate percentage of jewelry listings
    const jewelryPercentage = (jewelryListings / totalListings) * 100;

    // Log for debugging
    console.log(`Total Listings: ${totalListings}, Jewelry Listings: ${jewelryListings}, Percentage: ${jewelryPercentage}%`);

    // Exclude if 80% or more listings are jewelry-related
    return jewelryPercentage >= 80;
}

async function fetchAllListings() {
    try {
        console.log('Fetching access token...');
        const accessToken = await fetchAccessToken();
        console.log('Access token obtained successfully');

        const allListings = [];

        for (const phrase of searchPhrases) {
            console.log(`Searching for phrase: ${phrase}`);
            const listings = await fetchListingsForPhrase(phrase, accessToken);
            allListings.push(...listings);
            console.log(`Found ${listings.length} listings for phrase ${phrase}`);
        }

        console.log(`Total combined listings: ${allListings.length}`);
        return allListings;
    } catch (error) {
        console.error('Error in fetchAllListings:', error);
        throw error;
    }
}

app.get('/', async (req, res) => {
    try {
        const listings = await fetchAllListings();

        // Generate HTML dynamically
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
                </style>
            </head>
            <body>
                <h1>eBay Listings</h1>
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
            </body>
            </html>
        `;

        // Set cache control headers
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');

        res.send(html);
    } catch (error) {
        console.error('Error in root route:', error);
        res.status(500).send(`<h1>Error</h1><p>${error.message}</p>`);
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});