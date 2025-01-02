
const BASE_URL = 'http://localhost:3000';

async function testApiEndpoints() {
    console.log('Testing API Endpoints...');

    try {
        // Test results endpoint first (simpler test)
        console.log('\n1. Testing /api/results endpoint...');
        const resultsResponse = await fetch(`${BASE_URL}/api/results`);
        console.log('Results status:', resultsResponse.status);
        
        if (!resultsResponse.ok) {
            const text = await resultsResponse.text();
            console.log('Error response body:', text);
            throw new Error(`HTTP error! status: ${resultsResponse.status}`);
        }
        
        const results = await resultsResponse.json();
        console.log('Results:', results);
        console.log('✅ Results endpoint working');

        // Then test scan endpoint
        console.log('\n2. Testing /api/scan endpoint...');
        const scanResponse = await fetch(`${BASE_URL}/api/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                searchPhrases: ['test'],
                typicalPhrases: ['test'],
                feedbackThreshold: 100,
                conditions: ['NEW']
            })
        });
        
        if (!scanResponse.ok) {
            const text = await scanResponse.text();
            console.log('Error response body:', text);
            throw new Error(`HTTP error! status: ${scanResponse.status}`);
        }
        
        console.log('✅ Scan endpoint working');

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the tests
testApiEndpoints(); 