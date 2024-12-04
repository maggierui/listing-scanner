import express from 'express';
import fetchAccessToken from './auth.js'; // Import the function

import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

const phrases = ['"jewelry lot"', '"jewelry collection"', '"jewelry bundle"'];
const accessToken = await fetchAccessToken(); // Fetch the access token
const feedbackThreshold = 5000; // Define the maximum seller feedback score

async function fetchListingsForPhrase(phrase) {
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

async function fetchSellerListings(sellerUsername) {
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?seller=${encodeURIComponent(sellerUsername)}&limit=50`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            console.error(`Error fetching listings for seller ${sellerUsername}: ${response.status}`);
            return [];
        }

        const data = await response.json();
        return data.itemSummaries || [];
    } catch (error) {
        console.error(`Error fetching seller's listings: ${error.message}`);
        return [];
    }
}

function analyzeSellerListings(listings) {
    const totalListings = listings.length;

    if (totalListings <= 15) {
        return false; // Do not exclude if the total listings are 15 or fewer
    }

    // Count listings in the "jewelry" category
    const jewelryListings = listings.filter(item => item.category?.categoryName?.toLowerCase() === 'jewelry');
    const jewelryPercentage = (jewelryListings.length / totalListings) * 100;

    // Exclude if 80% or more listings are in the "jewelry" category
    return jewelryPercentage >= 80;
}


async function fetchAllListings() {
    const allListings = [];

    for (const phrase of phrases) {
        const listings = await fetchListingsForPhrase(phrase);
        allListings.push(...listings); // Combine filtered listings
    }

    console.log('Filtered Combined Listings:', allListings);
    // Save listings to a CSV file
    return allListings;
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
                </style>
            </head>
            <body>
                <h1>eBay Listings</h1>
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

        // Disable caching by setting appropriate headers
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');

        res.send(html); // Send the generated HTML as the response
    } catch (error) {
        res.status(500).send(`<h1>Error</h1><p>${error.message}</p>`);
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});