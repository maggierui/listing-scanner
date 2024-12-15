import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

async function testDatabaseOperations() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        console.log('🚀 Starting database operations test...\n');

        // Test 1: Create the listings table
        console.log('1️⃣ Creating listings table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS previous_listings (
                item_id TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Table created successfully\n');

        // Test 2: Insert single listing
        console.log('2️⃣ Testing single listing insertion...');
        const testItemId = 'TEST123456789';
        await pool.query(
            'INSERT INTO previous_listings (item_id) VALUES ($1) ON CONFLICT (item_id) DO NOTHING',
            [testItemId]
        );
        console.log('✅ Single listing inserted successfully\n');

        // Test 3: Insert multiple listings
        console.log('3️⃣ Testing multiple listings insertion...');
        const testItemIds = ['TEST987654321', 'TEST555555555', 'TEST777777777'];
        const values = testItemIds.map((_, index) => `($${index + 1})`).join(',');
        await pool.query(
            `INSERT INTO previous_listings (item_id) VALUES ${values} ON CONFLICT (item_id) DO NOTHING`,
            testItemIds
        );
        console.log('✅ Multiple listings inserted successfully\n');

        // Test 4: Check if listing exists
        console.log('4️⃣ Testing listing existence check...');
        const existsResult = await pool.query(
            'SELECT EXISTS(SELECT 1 FROM previous_listings WHERE item_id = $1)',
            [testItemId]
        );
        console.log(`✅ Listing existence check successful: ${existsResult.rows[0].exists}\n`);

        // Test 5: Count total listings
        console.log('5️⃣ Testing listings count...');
        const countResult = await pool.query('SELECT COUNT(*) FROM previous_listings');
        console.log(`✅ Count successful: ${countResult.rows[0].count} listings\n`);

        // Test 6: Select all test listings
        console.log('6️⃣ Testing listings retrieval...');
        const selectResult = await pool.query(
            'SELECT * FROM previous_listings WHERE item_id LIKE \'TEST%\' ORDER BY created_at DESC'
        );
        console.log('✅ Retrieved listings:', selectResult.rows, '\n');

        // Test 7: Delete test listings
        console.log('7️⃣ Testing deletion of test listings...');
        const deleteResult = await pool.query(
            'DELETE FROM previous_listings WHERE item_id LIKE \'TEST%\' RETURNING *'
        );
        console.log(`✅ Deleted ${deleteResult.rowCount} test listings\n`);

        // Test 8: Test cleanup of old listings
        console.log('8️⃣ Testing cleanup of old listings...');
        await pool.query(
            'DELETE FROM previous_listings WHERE created_at < NOW() - INTERVAL \'30 days\''
        );
        console.log('✅ Cleanup successful\n');

        console.log('🎉 All database operations completed successfully!');

    } catch (error) {
        console.error('❌ Error during testing:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run the tests
testDatabaseOperations().catch(console.error);