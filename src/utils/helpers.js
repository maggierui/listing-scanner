/**
 * Creates a promise that resolves after a specified delay
 * @param {number} ms - The delay duration in milliseconds
 * @returns {Promise} A promise that resolves after the specified delay
 * 
 * Usage examples:
 * - Rate limiting: await delay(1000) // Wait 1 second between API calls
 * - Retry mechanism: await delay(2000) // Wait 2 seconds before retrying
 */
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Add other utility functions here as needed 