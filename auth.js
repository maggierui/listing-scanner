import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const clientId = process.env.EBAY_CLIENT_ID;
const clientSecret = process.env.EBAY_CLIENT_SECRET;

const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

async function fetchAccessToken() {
    const url = 'https://api.ebay.com/identity/v1/oauth2/token';
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${credentials}`,
            },
            body: body.toString(),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        //console.log('Access Token:', data.access_token);
        return data.access_token; // Return the token
    } catch (error) {
        console.error('Error fetching access token:', error.message);
        return null; // Return null in case of error
    }
}

// Export the fetchAccessToken function
export default fetchAccessToken;
