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
        
        // First, get the seller's total listings across ALL categories using Browse API
        totalListings = await getSellerTotalListingsBrowseAPI(sellerUsername);

        // If we can't get total listings, we should still continue but log a warning
        if (totalListings === 0) {
            await logger.log(`Warning: Could not get total listings for ${sellerUsername}`);
        }

        if (totalListings > 100) 
            totalListings = 100;

        await logger.log(`Total listings for seller ${sellerUsername}: ${totalListings}`);

        // Get sample inventory using Browse API
        const maxItems = Math.min(totalListings, 100);
        sampleListings = await getSellerInventoryBrowseAPI(sellerUsername, maxItems);
        
        if (sampleListings.length > 0) {
            for (const item of sampleListings) {
                // Check if item title contains any of the search phrases
                const itemTitle = item.title.toLowerCase();
                const matchesPhrase = typicalPhrases.some(phrase => 
                    itemTitle.includes(phrase.toLowerCase())
                );

                if (matchesPhrase) {
                    matchingListingsCount++;
                    await logger.log(`Matching title found: ${item.title}`);
                }
            }
            
            await logger.log(`Analyzed ${sampleListings.length} sample listings for ${sellerUsername}`);
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
        await logger.log('\n=== Starting fetchListingsForPhrase ===');
        await logger.log('Parameters:', {
            phrase,
            typicalPhrases,
            feedbackThreshold,
            conditions
        });
        const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
            `q=${encodeURIComponent(phrase)}` +
            `&limit=200`;   
        await logger.log('Making eBay API request to:', url);

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
        await logger.log('eBay API response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('eBay API error:', errorText);
            throw new Error(`eBay API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        await logger.log(`Initial API response: Found ${data.itemSummaries?.length || 0} items`);

        
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
        await logger.log('\n=== Processing Conditions ===');

        // Process items one by one
        for (const item of data.itemSummaries) {            
            const matchingCondition = Object.values(EBAY_CONDITIONS).find(conditionObject => {
                return conditionObject.variants.includes(item.condition);
            });

            console.log(`Checking condition for item: "${item.title}"`);
            console.log(`Item condition: "${item.condition}"`);

            if (matchingCondition) {
                console.log(`Item's condition: "${item.condition}" is called ${matchingCondition.name} (ID: ${matchingCondition.id}) in the eBay API`);
            } else {
                console.log(`Item's condition: "${item.condition}" is not in any ebay conditionvariants`);
                continue;  // Skip to next item
            }

            const itemConditionId = matchingCondition.id;
            console.log(`Mapped condition ID: ${itemConditionId}`);
            console.log(`Allowed conditions: ${conditions}`);
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
            await logger.log(`\nProcessing seller: ${sellerUsername}`);

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
            await logger.log(`Seller analysis ratio: ${sellerAnalysis.ratio}%`);

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

// Modern eBay Browse API implementation to replace old Finding API
async function getSellerTotalListingsBrowseAPI(sellerUsername) {
    try {
        const accessToken = await fetchAccessToken();
        const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
            `seller=${encodeURIComponent(sellerUsername)}` +
            `&limit=1`; // Just get 1 item to check if seller exists
        
        await logger.log(`Seller listings request for ${sellerUsername}: ${url}`);

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
            await logger.log(`HTTP error! status: ${response.status}, error: ${errorText}`);
            return 0;
        }

        const data = await response.json();
        
        // Check if we have any results
        if (!data.itemSummaries || data.itemSummaries.length === 0) {
            await logger.log(`No listings found for seller ${sellerUsername}`);
            return 0;
        }

        // For a more accurate count, we'd need to make additional calls with pagination
        // For now, we'll estimate based on the first page results
        // In a production environment, you might want to implement proper pagination counting
        const estimatedTotal = Math.min(data.total || 0, 1000); // Cap at reasonable number
        
        await logger.log(`Estimated total listings for ${sellerUsername}: ${estimatedTotal}`);
        return estimatedTotal;
        
    } catch (error) {
        await logger.log(`Error getting total listings for ${sellerUsername}: ${error.message}`);
        return 0;
    }
}

// Modern eBay Browse API implementation to get seller inventory
async function getSellerInventoryBrowseAPI(sellerUsername, maxItems) {
    try {
        const accessToken = await fetchAccessToken();
        const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?` +
            `seller=${encodeURIComponent(sellerUsername)}` +
            `&limit=${Math.min(maxItems, 200)}`; // eBay Browse API max is 200
        
        await logger.log(`Fetching inventory for ${sellerUsername}, max items: ${maxItems}`);

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
            await logger.log(`HTTP error! status: ${response.status}, error: ${errorText}`);
            return [];
        }

        const data = await response.json();
        
        if (!data.itemSummaries || data.itemSummaries.length === 0) {
            await logger.log(`No inventory found for seller ${sellerUsername}`);
            return [];
        }

        const listings = data.itemSummaries.map(item => ({
            title: item.title,
            itemId: item.itemId,
            price: item.price,
            condition: item.condition,
            seller: {
                username: item.seller?.username || sellerUsername,
                feedbackScore: item.seller?.feedbackScore || 0
            }
        }));

        await logger.log(`Retrieved ${listings.length} listings for seller ${sellerUsername}`);
        return listings;
        
    } catch (error) {
        await logger.log(`Error getting inventory for ${sellerUsername}: ${error.message}`);
        return [];
    }
}

// Legacy function - keeping for backward compatibility but marking as deprecated
async function getSellerTotalListings(sellerUsername) {
    await logger.log(`WARNING: Using deprecated Finding API for ${sellerUsername}. Please use getSellerTotalListingsBrowseAPI instead.`);
    return await getSellerTotalListingsBrowseAPI(sellerUsername);
}