import express from 'express';
import dotenv from 'dotenv';
import dbManager from './src/db/DatabaseListingsManager.js';
import apiRoutes from './src/routes/api.js';

// Load environment variables
dotenv.config();

export function createServer() {
    const app = express();

    // Add logging middleware to see all requests
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.path}`);
        next();
    });

    // Initialize database (now synchronous with SQLite)
    dbManager.init();

    // Middleware
    app.use(express.json());

    // API Routes must come BEFORE static file serving
    app.use('/api', apiRoutes);

    // Static file serving comes after API routes
    app.use(express.static('public'));

    // HTML routes come last
    app.get('/', (req, res) => {
        res.sendFile('index.html', { root: './views' });
    });

    // Start server on port 3000 (local only, no Heroku)
    const server = app.listen(3000, () => {
        console.log('Server is running on http://localhost:3000');
    });

    // Graceful shutdown - close database connection on exit
    process.on('SIGINT', () => {
        console.log('\nShutting down gracefully...');
        dbManager.close();
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });

    return server;
}
// Only start the server if this file is run directly
// Note: Using a simpler check that works reliably on Windows
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
    createServer();
}