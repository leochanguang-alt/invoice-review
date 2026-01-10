import 'dotenv/config';
import { google } from 'googleapis';
import readline from 'readline';
import fs from 'fs';

const SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
];

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
    process.exit(1);
}

// Use a special redirect URI for manual copy-paste: 'postman' or just 'http://localhost'
// 'urn:ietf:wg:oauth:2.0:oob' is deprecated, so we use http://localhost
const REDIRECT_URI = 'http://localhost';

const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

console.log('\n=== Google OAuth2 Refresh Token Generator (Manual Mode) ===\n');
console.log('1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Authorize the application.');
console.log('3. After authorizing, you will be redirected to an error page (since no server is running).');
console.log('   Look at the URL in your browser\'s address bar.');
console.log('   Copy the "code" parameter value (the string after "code=" and before any "&").\n');

rl.question('Enter the code from the URL here: ', async (code) => {
    rl.close();
    if (code) {
        try {
            console.log('\nExchanging code for tokens...');
            const { tokens } = await oauth2Client.getToken(code);
            const refreshToken = tokens.refresh_token;

            if (!refreshToken) {
                console.error('\nError: No refresh token received.');
                console.log('Check if you already have a valid refresh token. Google only sends it the first time you authorize unless you use prompt: "consent".');
                console.log('Full token response:', tokens);
            } else {
                fs.writeFileSync('FINAL_TOKEN.txt', refreshToken);
                console.log('\n=== SUCCESS! ===\n');
                console.log('Refresh Token saved to FINAL_TOKEN.txt');
                console.log('Token starts with: ' + refreshToken.substring(0, 5) + '...');
                console.log('\nPlease update your .env file with this GOOGLE_REFRESH_TOKEN.');
            }
        } catch (err) {
            console.error('\nError getting token:', err.message);
        }
    } else {
        console.log('No code entered. Exiting.');
    }
    process.exit(0);
});
