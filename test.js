import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { URLSearchParams } from 'url';

// Load environment variables
dotenv.config();

// Simple logging function (to replace addLog)
async function log(message) {
    console.log(message);
}

async function getSellerTotalListings(sellerUsername) {
    try {
        const url = 'https://svcs.ebay.com/services/search/FindingService/v1';
        const params = {
            'OPERATION-NAME': 'findItemsAdvanced',
            'SERVICE-VERSION': '1.0.0',
            'SECURITY-APPNAME': process.env.EBAY_CLIENT_ID,
            'RESPONSE-DATA-FORMAT': 'JSON',
            'itemFilter(0).name': 'Seller',
            'itemFilter(0).value': sellerUsername,
            'paginationInput.entriesPerPage': '1'
        };

        const queryString = new URLSearchParams(params).toString();
        await log(`Seller listings request for ${sellerUsername}: ${queryString}`);
        const fullUrl = `${url}?${queryString}`;
        await log(`Full URL: ${fullUrl}`);

        const response = await fetch(fullUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        await log(`Seller listings response for ${sellerUsername}: ${JSON.stringify(data, null, 2)}`);

        // Debug each step
        const advancedResponse = data.findItemsAdvancedResponse[0];
        console.log('Advanced response:', advancedResponse);

        const paginationOutput = advancedResponse.paginationOutput[0];
        console.log('Pagination output:', paginationOutput);

        const totalEntries = paginationOutput.totalEntries[0];
        console.log('Total entries:', totalEntries);


        if (data.findItemsAdvancedResponse[0].ack[0] === "Failure") {
            throw new Error(data.findItemsAdvancedResponse[0].errorMessage[0].error[0].message[0]);
        }
        
        // Now try to get the total
        const total = parseInt(totalEntries);
        await log(`Total listings for ${sellerUsername}: ${total}`);
        
        return parseInt(total);
    } catch (error) {
        await log(`Error getting total listings for ${sellerUsername}: ${error.message}`);
        return 0;
    }
}

// Test function
async function test() {
    try {
        const sellerUsername = 'maggiehucat'; // Replace with actual seller username
        const result = await getSellerTotalListings(null, sellerUsername);
        console.log(`Test result: ${result} total listings`);
    } catch (error) {
        console.error('Test failed:', error);
    }
}

// Run the test
test();