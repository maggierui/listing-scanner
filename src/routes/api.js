import express from 'express';
import { readFile } from 'fs/promises';
import dbManager from '../db/DatabaseListingsManager.js';
import logger from '../utils/logger.js';
import { scanResults, startScan, scanInProgress } from '../services/scanner.js';
import { EBAY_CONDITIONS } from '../constants/conditions.js';
const router = express.Router();


router.get('/results', (req, res) => {
    try {
        console.log('Sending scan results:', {
            status: scanResults.status,
            listingCount: scanResults.listings?.length,
            hasError: !!scanResults.error
        });

        const transformedListings = scanResults.listings?.map(item => {
            return {
                title: item.title || 'N/A',
                price: item.price?.value
                    ? parseFloat(item.price.value).toFixed(2)
                    : 'N/A',
                currency: item.price?.currency || 'USD',
                seller: item.seller?.username || 'N/A',
                feedbackScore: item.seller?.feedbackScore?.toString() || 'N/A',
                link: item.itemWebUrl || '#'
            };
        }) || [];

        // Get live logs from logger
        const liveLogMessages = logger.getLogMessages();

        res.json({
            status: scanResults.status,
            lastUpdated: scanResults.lastUpdated,
            totalListings: scanResults.listings?.length || 0,
            listings: transformedListings,
            error: scanResults.error,
            logMessages: liveLogMessages,  // Use live logs from logger
            progress: scanResults.progress  // Include progress information
        });
    } catch (error) {
        console.error('Error in /api/results:', error);
        res.status(500).json({
            status: 'error',
            error: 'Internal server error'
        });
    }
});


router.post('/scan', async (req, res) => {
    try {
        // Debug logging
        console.log('\n=== Starting new scan ===');
        console.log('Current scan status:', scanResults.status);
        console.log('Scan in progress:', scanInProgress);
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        
        if (scanInProgress) {
            return res.status(409).json({ 
                error: 'A scan is already in progress'
            });
        }
    
        // Log the incoming request
        await logger.log('Scan request body:', JSON.stringify(req.body));
        const { searchPhrases, typicalPhrases, feedbackThreshold, conditions } = req.body;
        // Validate input with detailed logging
        if (!searchPhrases || !typicalPhrases || !feedbackThreshold || !conditions) {
            await logger.log('Missing required parameters');
            return res.status(400).json({ 
                error: 'Missing required parameters',
                details: {
                    searchPhrases: !searchPhrases ? 'missing' : 'present',
                    typicalPhrases: !typicalPhrases ? 'missing' : 'present',
                    feedbackThreshold: !feedbackThreshold ? 'missing' : 'present',
                    conditions: !conditions ? 'missing' : 'present'
                }
            });
        }

        // Start scan with try-catch
        try {
            await logger.log('Starting scan with validated parameters...');
            await startScan(searchPhrases, typicalPhrases, feedbackThreshold, conditions);
            await logger.log('Scan started successfully');
            res.json({ message: 'Scan started successfully' });
        } catch (scanError) {
            await logger.log('Error in startScan:', scanError.message);
            await logger.log('Full error details:', scanError.stack);
            res.status(500).json({ 
                error: 'Failed to start scan',
                details: scanError.message,
                stack: scanError.stack
            });
        }
    } catch (error) {
        await logger.log('Error in /scan route:', error);
        await logger.log('Full error details:', error.stack);
        res.status(500).json({ 
            error: 'Failed to start scan',
            details: error.message,
            stack: error.stack
        });
    }
});



// Get all saved searches
router.get('/saves/searches', (req, res) => {
    try {
        const searches = dbManager.getSavedSearches();
        res.json(searches);
    } catch (error) {
        console.error('Error fetching saved searches:', error);
        res.status(500).json({ error: 'Failed to fetch searches' });
    }
});

// Get results for a specific saved search
router.get('/saves/search/:id/results', (req, res) => {
    try {
        const results = dbManager.getSearchResults(req.params.id);
        res.json(results);
    } catch (error) {
        console.error('Error fetching search results:', error);
        res.status(500).json({ error: 'Failed to fetch search results' });
    }
});

// Get a specific saved search
router.get('/saves/search/:id', (req, res) => {
    try {
        // Get the ID from the URL parameters
        const searchId = parseInt(req.params.id);

        // Validate the ID
        if (isNaN(searchId)) {
            return res.status(400).json({ error: 'Invalid search ID' });
        }

        // Use the database manager to get the specific search
        const search = dbManager.getSavedSearchById(searchId);

        // Handle case where search isn't found
        if (!search) {
            return res.status(404).json({ error: 'Search not found' });
        }

        // Return the search data
        res.json(search);
    } catch (error) {
        console.error('Error fetching search:', error);
        res.status(500).json({ error: 'Failed to fetch search' });
    }
});

// Save a new search
router.post('/saves/search', (req, res) => {
    try {
        const {
            name,
            searchPhrases,
            typicalPhrases,
            feedbackThreshold,
            conditions
        } = req.body;

        const searchId = dbManager.saveSearch(
            name,
            searchPhrases,
            typicalPhrases,
            feedbackThreshold,
            conditions
        );

        res.status(201).json({
            message: 'Search saved successfully',
            id: searchId
        });
    } catch (error) {
        console.error('Error saving search:', error);
        res.status(500).json({ error: 'Failed to save search' });
    }
});





// Download logs
router.get('/logs', async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const logFileName = `ebay-scanner-${today}.txt`;

    try {
        const logContent = await readFile(logFileName, 'utf8');
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename=${logFileName}`);
        res.send(logContent);
    } catch (error) {
        res.status(500).send('Error downloading log file: ' + error.message);
    }
});

// Get conditions
router.get('/conditions', (req, res) => {
    // Convert EBAY_CONDITIONS object to array for frontend
    const conditionsArray = Object.values(EBAY_CONDITIONS);
    res.json(conditionsArray);
});



export default router; 