import 'dotenv/config';
import { google } from 'googleapis';
import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';

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

const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    'http://localhost:3333/oauth2callback'
);

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
});

console.log('\n=== Google OAuth2 Refresh Token Generator ===\n');
console.log('1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Authorize the application');
console.log('3. You will be redirected back here automatically\n');

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/oauth2callback') {
        const code = parsedUrl.query.code;

        if (code) {
            try {
                const { tokens } = await oauth2Client.getToken(code);
                const refreshToken = tokens.refresh_token;

                if (!refreshToken) {
                    throw new Error('No refresh token received. Did you click "Allow" and is this the first time you are authorizing? (Try using prompt: consent in script if needed)');
                }

                fs.writeFileSync('FINAL_TOKEN.txt', refreshToken);

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`
                    <html>
                        <head><title>Success!</title></head>
                        <body style="font-family: Arial; padding: 40px; text-align: center;">
                            <h1 style="color: green;">✓ Authorization Successful!</h1>
                            <p>Refresh Token has been saved to <b>FINAL_TOKEN.txt</b>.</p>
                            <p>You can close this window and return to the terminal.</p>
                        </body>
                    </html>
                `);

                console.log('\n=== SUCCESS! ===\n');
                console.log('Refresh Token grabbed and saved to FINAL_TOKEN.txt');
                console.log('Token starts with: ' + refreshToken.substring(0, 5) + '...');
                console.log('Token ends with:   ' + refreshToken.substring(refreshToken.length - 5));
                console.log('Total length:      ' + refreshToken.length);

                console.log('\nNow I will display it in chunks for you to copy easily if needed.');

                server.close();
                process.exit(0);
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error: ' + err.message);
                console.error('Error:', err);
                process.exit(1);
            }
        }
    }
});

server.listen(3333, () => {
    console.log('Waiting for authorization... (listening on port 3333)\n');
});
