import fs from 'fs';
import path from 'path';

const tokenFile = 'FINAL_TOKEN.txt';
const envFile = '.env';

try {
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    let env = fs.readFileSync(envFile, 'utf8');

    const regex = /^GOOGLE_REFRESH_TOKEN=.*/m;
    const newLine = `GOOGLE_REFRESH_TOKEN="${token}"`;

    if (regex.test(env)) {
        env = env.replace(regex, newLine);
        console.log('Updated existing GOOGLE_REFRESH_TOKEN in .env');
    } else {
        env += `\n${newLine}\n`;
        console.log('Added GOOGLE_REFRESH_TOKEN to .env');
    }

    fs.writeFileSync(envFile, env);
    console.log('Successfully updated .env with new refresh token.');
} catch (err) {
    console.error('Error updating .env:', err.message);
    process.exit(1);
}
