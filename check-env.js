import 'dotenv/config';

console.log('--- Environment Variable Check ---');
const keys = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'GEMINI_API_KEY'
];

keys.forEach(key => {
    const val = process.env[key];
    if (val) {
        console.log(`${key}: [SET] (Length: ${val.length}, Starts with: ${val.substring(0, 5)}...)`);
    } else {
        console.log(`${key}: [MISSING]`);
    }
});

const isOAuth2Possible = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN;
console.log('\nOAuth2 Possible:', isOAuth2Possible ? 'YES' : 'NO');
