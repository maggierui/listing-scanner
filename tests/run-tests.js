import './test-db.js';
import './test-api.js';
import './test-ebay.js';

console.log('Running all tests...\n');

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled promise rejection:', error);
    process.exit(1);
}); 