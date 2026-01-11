import 'dotenv/config';

const url = "https://buiservice.com/api/file?link=https%3A%2F%2Fbuiservice-assets.r2.cloudflarestorage.com%2Fbui_invoice%2Foriginal_files%2Ffr_google_drive%2FScanned%208%20Jan%202026%20at%2021_31_13.pdf&_t=" + Date.now();

async function check() {
    console.log(`Fetching ${url}...`);
    try {
        const res = await fetch(url);
        console.log(`Status: ${res.status}`);
        const text = await res.text();
        console.log("Body:");
        console.log(text);

        try {
            const json = JSON.parse(text);
            console.log("Parsed Error Info:");
            console.log(JSON.stringify(json, null, 2));
        } catch (e) {
            // Not JSON
        }
    } catch (err) {
        console.error("Fetch failed:", err);
    }
}

check();
