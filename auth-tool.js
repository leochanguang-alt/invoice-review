import 'dotenv/config';
import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';

/**
 * auth-tool.js
 * Automated version: Starts a temporary server to capture the token.
 */

const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
];

const PORT = 3088;
const REDIRECT_URI = `http://localhost:${PORT}`;

async function run() {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        REDIRECT_URI
    );

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });

    console.log('\n=== OAUTH2 AUTHORIZATION TOOL (AUTOMATED) ===\n');
    console.log('1. A browser window should open. If not, open this URL manually:\n');
    console.log(authUrl);
    console.log('\n2. Log in and allow permissions.');
    console.log('3. The script will automatically capture the code and finish.\n');

    const server = http.createServer(async (req, res) => {
        try {
            if (req.url.indexOf('/?code=') > -1) {
                const url = new URL(req.url, REDIRECT_URI);
                const code = url.searchParams.get('code');

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>Authorization Successful!</h1><p>You can close this window now. Return to the terminal.</p>');

                console.log(`\n[DEBUG] Captured Code: ${code.substring(0, 10)}...`);

                const { tokens } = await oauth2Client.getToken(code);
                console.log('\n=== SUCCESS ===\n');
                console.log('Add the following to your .env file:\n');
                console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
                console.log('\n(Note: Keep this token safe.)');

                process.exit(0);
            }
        } catch (e) {
            console.error('\n[ERROR] Failed to get tokens:', e.response?.data || e.message);
            res.writeHead(500);
            res.end('Error occurred. Check terminal.');
            process.exit(1);
        }
    }).listen(PORT, () => {
        console.log(`Waiting for authorization on ${REDIRECT_URI} ...`);
    });
}

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('\n[ERROR] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
    process.exit(1);
}

run();
