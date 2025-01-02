// logger.js
import fs from 'fs/promises';

class Logger {
    constructor() {
        this.logMessages = [];
    }

    async log(message) {
        // Create timestamp in EST/EDT
        const timestamp = new Date().toLocaleTimeString('en-US', { 
            timeZone: 'America/New_York',
            hour12: true 
        });    
        const logMessage = `${timestamp}: ${message}\n`;
        
        // Keep limited logs for web display
        const webLogMessage = `${timestamp}: ${message}`;
        this.logMessages.push(webLogMessage);
        if (this.logMessages.length > 50) {
            this.logMessages.shift();
        }

        // Write to console (this will show up in Heroku logs)
        console.log(message);

        // Write to file with timestamp
        try {
            const logFileName = `ebay-scanner-${new Date().toISOString().split('T')[0]}.txt`;
            await fs.appendFile(logFileName, logMessage, 'utf8');
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }

    getLogMessages() {
        return this.logMessages;
    }

    clearMessages() {
        this.logMessages = [];
    }
}

// Create and export a single instance
export default new Logger();