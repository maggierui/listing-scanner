import dbManager from '../src/db/DatabaseListingsManager.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

// Get the directory name of the current module
const __dirname = dirname(fileURLToPath(import.meta.url));

// Configure dotenv to look for .env file in the project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });


// Add a check to see what URL we're using
console.log('Database URL:', process.env.DATABASE_URL);

async function testDatabaseOperations() {
    console.log('Testing Database Operations...');
    
    try {
        // Test database initialization
        console.log('1. Testing database initialization...');
        await dbManager.init();
        console.log('✅ Database initialized successfully');

        // Test saving a search
        console.log('\n2. Testing save search...');
        const searchId = await dbManager.saveSearch(
            'Test Search',
            ['test phrase'],
            ['typical phrase'],
            100,
            ['NEW']
        );
        console.log('✅ Search saved successfully with ID:', searchId);

        // Test retrieving saved searches
        console.log('\n3. Testing get saved searches...');
        const searches = await dbManager.getSavedSearches();
        console.log('✅ Retrieved saved searches:', searches.length, 'found');

        // Test saving a search result
        console.log('\n4. Testing save search result...');
        await dbManager.saveSearchResult(searchId, {
            itemId: 'test123',
            title: 'Test Item',
            price: 10.99,
            url: 'http://test.com',
            sellerId: 'seller123'
        });
        console.log('✅ Search result saved successfully');

        // Test retrieving search results
        console.log('\n5. Testing get search results...');
        const results = await dbManager.getSearchResults(searchId);
        console.log('✅ Retrieved search results:', results.length, 'found');

    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the tests
testDatabaseOperations(); 