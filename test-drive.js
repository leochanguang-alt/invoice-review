import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config();

function cleanEnv(v) {
    if (!v) return "";
    v = v.trim();
    if (v.startsWith('"') && v.endsWith('"')) {
        v = v.substring(1, v.length - 1);
    } else if (v.startsWith("'") && v.endsWith("'")) {
        v = v.substring(1, v.length - 1);
    }
    v = v.replace(/\\n$/, '');
    return v;
}

async function test() {
    const rawEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY;
    const email = cleanEnv(rawEmail);
    let key = cleanEnv(rawKey).replace(/\\n/g, "\n");
    const parentId = '1FreZ79xZvK3S1_Zlg4oyaep0-1tkXwF8';

    console.log("Email:", email);
    console.log("Parent ID:", parentId);

    const auth = new google.auth.JWT({
        email,
        key,
        scopes: ["https://www.googleapis.com/auth/drive"],
    });

    const drive = google.drive({ version: 'v3', auth });

    try {
        console.log("Attempting to get folder metadata...");
        const res = await drive.files.get({ fileId: parentId, fields: 'id, name, permissions' });
        console.log("Success! Folder name:", res.data.name);

        console.log("Attempting to create a test folder...");
        const createRes = await drive.files.create({
            requestBody: {
                name: "Test_Folder_by_AI",
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentId],
            },
            fields: 'id, webViewLink'
        });
        console.log("Folder created successfully! ID:", createRes.data.id);
        console.log("Link:", createRes.data.webViewLink);
    } catch (err) {
        console.error("DRIVE TEST FAILED:");
        console.error("Message:", err.message);
        if (err.response) {
            console.error("Status:", err.response.status);
            console.error("Data:", JSON.stringify(err.response.data));
        }
    }
}

test();
