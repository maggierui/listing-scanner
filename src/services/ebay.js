import logger from '../utils/logger.js';
import fetchAccessToken from '../services/auth.js';
import { EBAY_CONDITIONS } from '../constants/conditions.js';
import { URLSearchParams } from 'url';
import { delay } from '../utils/helpers.js';



export async function fetchSellerListings(sellerUsername, typicalPhrases) {
    try {
        let totalListings = 0;
        let matchingListingsCount = 0;
        let sampleListings = [];
        
        // First, get the seller's total listings across ALL categories
        totalListings = await getSellerTotalListings(sellerUsername);

        // If we can't get total listings, we should still continue but log a warning
        if (totalListings === 0) {
            await logger.log(`Warning: Could not get total listings for ${sellerUsername}`);
        }

        if (totalListings > 100) 
            totalListings = 100;

        await logger.log(`Total listings for seller ${sellerUsername}: ${totalListings}`);

        // Set up base parameters for Finding API
        const params = {
            'OPERATION-NAME': 'findItemsAdvanced',
            'SERVICE-VERSION': '1.0.0',
            'SECURITY-APPNAME': process.env.EBAY_CLIENT_ID,
            'RESPONSE-DATA-FORMAT': 'JSON',
            'itemFilter(0).name': 'Seller',
            'itemFilter(0).value': sellerUsername,
            'paginationInput.entriesPerPage': 100,
            'outputSelector': 'SellerInfo'
        };
        
        const queryString = new URLSearchParams(params).toString();
        const response = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${queryString}`);
        const data = await response.json();

        if (data.findItemsAdvancedResponse[0].ack[0] === "Success" && 
            data.findItemsAdvancedResponse[0].searchResult[0].item) {
            
            const items = data.findItemsAdvancedResponse[0].searchResult[0].item;
            
            for (const item of items) {
                sampleListings.push(item);
                
                // Check if item title contains any of the search phrases
                const itemTitle = item.title[0].toLowerCase();
                const matchesPhrase = typicalPhrases.some(phrase => 
                    itemTitle.includes(phrase.toLowerCase())
                );

                if (matchesPhrase) {
                    matchingListingsCount++;
                    await logger.log(`Matching title found: ${item.title[0]}`);
                }
            }
            
            await logger.log(`Analyzed ${items.length} sample listings for ${sellerUsername}`);
            await logger.log(`Found ${matchingListingsCount} listings matching typical phrases`);
        }
        
        // Calculate the ratio based on the sample
        const sampleSize = sampleListings.length;
        const categoryRatio = sampleSize > 0 ? (matchingListingsCount / sampleSize) : 0;
        const ratio = categoryRatio * 100; // Convert to percentage
        
        // Analysis criteria
        const MINIMUM_RATIO = 20;
        const shouldExclude = ratio > MINIMUM_RATIO || (ratio === 0);
        
        await logger.log(`Sample ratio: ${ratio.toFixed(2)}%`);
        await logger.log(shouldExclude
            ? `DECISION: EXCLUDING ${sellerUsername} - ${ratio.toFixed(2)}% matching phrases`
            : `DECISION: INCLUDING ${sellerUsername} - ${ratio.toFixed(2)}% matching phrases`);
        
        return {
            shouldExclude,
            error: false,
            listings: sampleListings,
            ratio: ratio,
            total: totalListings,
            sampleData: {
                sampleSize,
                matchCount: matchingListingsCount
            }
        };
        
    } catch (error) {
        await logger.log(`Error fetching listings for ${sellerUsername}: ${error.message}`);
        return {
            shouldExclude: true, // Exclude on error to be safe
            error: true,
            listings: [],
            ratio: 0,
            total: 0,
            errorMessage: error.message
        };
    }
}

export async function fetchListingsForPhrase(accessToken, phrase, typicalPhrases,feedbackThreshold, conditions) {
    await trackApiCall();
    await delay(1000); // 1 second delay

    try {
        // Add debug logging
        console.log('Fetching listings with parameters:', {
            searchPhrase,
            typicalPhrases,
            feedbackThreshold,
            conditions
        });
        const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
            `q=${encodeURIComponent(phrase)}` +
            `&limit=200`;   
            console.log('Making eBay API request to:', url);

        const processedSellers = new Set();
        const filteredListings = [];

        // Fetch listings from eBay API
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
            },
        });

        // Log the response status
        console.log('eBay API response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('eBay API error:', errorText);
            throw new Error(`eBay API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('eBay API response data:', JSON.stringify(data, null, 2));

        
        // Check for empty results
        if (!data.itemSummaries || data.itemSummaries.length === 0) {
            await logger.log(`No listings found for phrase "${phrase}"`);
            return [];
        }

        await logger.log(`Found ${data.itemSummaries.length} total listings for phrase "${phrase}"`);
        // Print out all search results
        for (const item of data.itemSummaries) {
            await logger.log(`Initial search results for this run: Title: ${item.title}, Seller: ${item.seller.username}, Condition: ${item.condition}`);
        }
        // Create array to store valid items
        let validListings = [];

        // Process items one by one
        for (const item of data.itemSummaries) {
            await logger.log(`\nTrying to match item condition: "${item.condition}"`);
            
            const matchingCondition = Object.values(EBAY_CONDITIONS).find(conditionObject => {
                return conditionObject.variants.includes(item.condition);
            });

            if (matchingCondition) {
                await logger.log(`Item's condition: "${item.condition}" is called ${matchingCondition.name} (ID: ${matchingCondition.id}) in the eBay API`);
            } else {
                await logger.log(`No match found for condition: "${item.condition}" in any variants`);
                continue;  // Skip to next item
            }
            
            const itemConditionId = matchingCondition.id;
            const isValidCondition = conditions.includes(itemConditionId);

            if (!isValidCondition) {
                await logger.log(`Filtered out - Title: "${item.title}", Condition: ${item.condition}, ID: ${itemConditionId}`);
            } else {
                await logger.log(`Included - Title: "${item.title}", Condition: ${item.condition}, ID: ${itemConditionId}`);
                validListings.push(item);  // Add to valid listings if condition matches
            }
        }

        
        await logger.log(`Found ${validListings.length} listings with matching conditions out of ${data.itemSummaries.length} total`);

        

        // Group by seller with validation
        const sellerListings = new Map();
        let skippedListings = 0;
        
        validListings.forEach(item => { //Since I commented out the newListings, I'm using validListings instead
            if (!item.seller?.username) {
                skippedListings++;
                return;
            }
            
            const sellerUsername = item.seller.username;
            if (!sellerListings.has(sellerUsername)) {
                sellerListings.set(sellerUsername, []);
            }
            sellerListings.get(sellerUsername).push(item);
        });

        if (skippedListings > 0) {
            await logger.log(`Skipped ${skippedListings} listings with missing seller information`);
        }

        const totalSellers = sellerListings.size;
        await logger.log(`\n=== Processing ${totalSellers} unique sellers ===`);
        await logger.log(`Sellers found: ${[...sellerListings.keys()].join(', ')}`);

        let sellerCounter = 0;
        let qualifiedSellerCounter = 0;

        // Process each seller
        for (const [sellerUsername, listings] of sellerListings) {
            if (processedSellers.has(sellerUsername)) {
                await logger.log(`Skipping already processed seller: ${sellerUsername}`);
                continue;
            }

            sellerCounter++;
            await logger.log(`\n--- Processing Seller ${sellerCounter}/${totalSellers}: ${sellerUsername} ---`);
            
            const feedbackScore = listings[0].seller?.feedbackScore || 0;
            await logger.log(`Feedback score: ${feedbackScore}`);
            
            if (feedbackScore >= feedbackThreshold) {
                await logger.log(`Skipping due to high feedback score (${feedbackScore} >= ${feedbackThreshold})`);
                continue;
            }

            processedSellers.add(sellerUsername);
            
            const sellerAnalysis = await fetchSellerListings(sellerUsername, typicalPhrases);
            
            if (!sellerAnalysis.error && !sellerAnalysis.shouldExclude) {
                qualifiedSellerCounter++;
                await logger.log(`Seller qualified: ${sellerUsername}`);
                
                if (listings.length > 0) {
                    const addedListing = listings[0];
                    filteredListings.push(addedListing);
                    await logger.log(`Added listing: "${addedListing.title}" (${addedListing.itemId})`);
                }
            } else {
                await logger.log(`Seller excluded: ${sellerUsername}${sellerAnalysis.error ? ` (Error: ${sellerAnalysis.errorMessage})` : ''}`);
            }
        }

        await logger.log(`\n=== Phrase "${phrase}" Processing Complete ===`);
        await logger.log(`- Total sellers processed: ${sellerCounter}`);
        await logger.log(`- Qualified sellers: ${qualifiedSellerCounter}`);
        await logger.log(`- Qualified listings found: ${filteredListings.length}`);

        return filteredListings;

    } catch (error) {
        await logger.log(`Error processing phrase "${phrase}": ${error.message}`);
        await logger.log(error.stack); // Log stack trace for debugging
        return [];
    }
}

export async function fetchAllListings(searchPhrases, typicalPhrases, feedbackThreshold,  conditions) {
    try {
        await logger.log('\n=== fetchAllListings received parameters ===');
        await logger.log(JSON.stringify({ searchPhrases,typicalPhrases, feedbackThreshold,  conditions}, null, 2));
    
        //await previousListings.cleanup(30); // Cleans up listings older than 30 days
        const accessToken = await fetchAccessToken();
        await logger.log('Access token obtained successfully');
        await logger.log(`Starting scan with searchPhrases: ${JSON.stringify(searchPhrases)}`);
        const allListings = [];
        
        for (const phrase of searchPhrases) {
            console.log('Searching for phrase:', phrase);
            const listings = await fetchListingsForPhrase(accessToken, phrase, typicalPhrases,feedbackThreshold, conditions);
            console.log(`Found ${listings.length} listings for phrase: ${phrase}`);
            if (listings && listings.length > 0) {
                allListings.push(...listings);
            }
            await delay(1000);
        }

        await logger.log(`\n====== Scan complete. Found ${allListings.length} total listings ======\n`);
        return allListings;
    } catch (error) {
        await logger.log(`Scan error: ${error.message}`);
        throw error;
    }
}

async function trackApiCall() {
    // Initialize variables
    let apiCallsCount = 0;
    apiCallsCount++;
    await logger.log(`API Calls made today: ${apiCallsCount}/5000`);
    if (apiCallsCount > 4500) {
        await logger.log('WARNING: Approaching daily API limit (5000)');
    }
}
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