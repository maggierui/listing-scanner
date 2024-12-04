import fetch from 'node-fetch';

async function fetchAccessToken() {
    console.log('Fetching access token...');
    
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;

    console.log('Client ID:', clientId ? 'Present' : 'MISSING');
    console.log('Client Secret:', clientSecret ? 'Present' : 'MISSING');

    if (!clientId || !clientSecret) {
        throw new Error('Missing eBay API credentials');
    }

    const tokenUrl = 'https://api.ebay.com/identity/v1/oauth2/token';
    try {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
            },
            body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
        });

        console.log('Token request status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Token fetch error:', errorText);
            throw new Error(`Token fetch failed: ${errorText}`);
        }

        const data = await response.json();
        console.log('Access token obtained successfully');
        return data.access_token;

    } catch (error) {
        console.error('Complete access token error:', error);
        throw error;
    }
}

export default fetchAccessToken;