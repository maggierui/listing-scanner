import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

// Setup environment
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { fetchListingsForPhrase } from '../src/services/ebay.js';
import fetchAccessToken from '../src/services/auth.js';

async function testEbayService() {
    console.log('Testing eBay Service...');

    try {
        // First get the access token
        console.log('\n1. Getting eBay access token...');
        const accessToken = await fetchAccessToken();
        console.log('✅ Access token obtained');

        // Then test fetching listings
        console.log('\n2. Testing fetchListingsForPhrase...');
        const listings = await fetchListingsForPhrase(
            accessToken,  // Use the token we just got
            'test item',
            ['typical phrase'],
            100,
            ['NEW']
        );
        console.log('✅ Fetched listings:', listings.length, 'found');

    } catch (error) {
        console.error('❌ Test failed:', error);
        // Log more details about the error
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', await error.response.text());
        }
        process.exit(1);
    }
}

// Run the tests
testEbayService(); 