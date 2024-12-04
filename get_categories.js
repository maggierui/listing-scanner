import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import dotenv from 'dotenv';
import fetchAccessToken from './auth.js'; // Import the function


dotenv.config();

const appId = process.env.CLIENT_ID; // Your eBay App ID
const devId = process.env.dev_id; // Your eBay Dev ID
const certId = process.env.CLIENT_SECRET; // Your eBay Cert ID
const token = await fetchAccessToken(); // Fetch the access token
const parser = new XMLParser();


const ENDPOINT = 'https://api.ebay.com/ws/api.dll';

function escapeXml(value) {
    return value
        .replace(/&/g, '&amp;') // Escape &
        .replace(/</g, '&lt;') // Escape <
        .replace(/>/g, '&gt;') // Escape >
        .replace(/"/g, '&quot;') // Escape "
        .replace(/'/g, '&apos;'); // Escape '
}

const escapedToken = escapeXml(token);

async function getCategories() {
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetCategoriesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <RequesterCredentials>
        <eBayAuthToken>${escapedToken}</eBayAuthToken>
    </RequesterCredentials>
    <CategorySiteID>0</CategorySiteID> 
    <LevelLimit> 1 </LevelLimit>
    <ViewAllNodes>false</ViewAllNodes>
    <DetailLevel>ReturnAll</DetailLevel>
</GetCategoriesRequest>`;


    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml',
                'X-EBAY-API-COMPATIBILITY-LEVEL': '1367',
                'X-EBAY-API-DEV-NAME': devId,
                'X-EBAY-API-APP-NAME': appId,
                'X-EBAY-API-CERT-NAME': certId,
                'X-EBAY-API-CALL-NAME': 'GetCategories',
                'X-EBAY-API-SITEID': '0',
            },
            body: xmlRequest,
        });

        console.log('Request XML:', xmlRequest);
        console.log('Headers:', {
            'Content-Type': 'text/xml',
            'X-EBAY-API-COMPATIBILITY-LEVEL': '1367',
            'X-EBAY-API-DEV-NAME': devId,
            'X-EBAY-API-APP-NAME': appId,
            'X-EBAY-API-CERT-NAME': certId,
            'X-EBAY-API-CALL-NAME': 'GetCategories',
            'X-EBAY-API-SITEID': '0',
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch categories: ${response.status}`);
        }

        const xmlData = await response.text();
        console.log('Raw XML Response:', xmlData);
        const jsonData = parser.parse(xmlData, { ignoreAttributes: false });

        return jsonData.GetCategoriesResponse.CategoryArray.Category;
    } catch (error) {
        console.error('Error fetching categories:', error.message);
        return [];
    }
}

function filterCategories(categories, keyword) {
    return categories.filter(category => {
        const categoryName = category.CategoryName.toLowerCase();
        const parentName = category.CategoryParentName
            ? category.CategoryParentName.toLowerCase()
            : '';
        return categoryName.includes(keyword) || parentName.includes(keyword);
    });
}

async function main() {
    const categories = await getCategories();

    if (categories.length === 0) {
        console.error('No categories fetched.');
        return;
    }

    console.log(`Total Categories Fetched: ${categories.length}`);

    // Filter categories with "jewelry" in name or parent name
    const keyword = 'jewelry';
    const jewelryCategories = filterCategories(categories, keyword);

    console.log(`Filtered Categories: ${jewelryCategories.length}`);

    // Save to a file for future use
    const outputFile = './jewelry_categories.json';
    fs.writeFileSync(outputFile, JSON.stringify(jewelryCategories, null, 2));
    console.log(`Saved jewelry categories to ${outputFile}`);
}

main();
