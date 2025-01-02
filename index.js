import express from 'express';
import dotenv from 'dotenv';
import dbManager from './src/db/DatabaseListingsManager.js';
import apiRoutes from './src/routes/api.js';

// Load environment variables
dotenv.config();

export async function createServer() {
    const app = express();
    // Add logging middleware to see all requests
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.path}`);
        next();
    });
    
    // Initialize database
    await dbManager.init();
    
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
    
    app.get('/dashboard', (req, res) => {
        res.sendFile('dashboard.html', { root: './views' });
    });
    
    // Start server
    const server = app.listen(3000, () => {
        console.log('Server is running on http://localhost:3000');
    });
    
    return server;
}
// Only start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    createServer();
}