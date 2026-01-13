import 'dotenv/config';
import { google } from "googleapis";

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

const GOOGLE_CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
const GOOGLE_REFRESH_TOKEN = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);

async function testDrive() {
  console.log("Testing Google Drive Auth...");
  console.log("GOOGLE_CLIENT_ID:", GOOGLE_CLIENT_ID ? "PRESENT" : "MISSING");
  console.log("GOOGLE_CLIENT_SECRET:", GOOGLE_CLIENT_SECRET ? "PRESENT" : "MISSING");
  console.log("GOOGLE_REFRESH_TOKEN:", GOOGLE_REFRESH_TOKEN ? "PRESENT" : "MISSING");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    console.error("Missing OAuth2 credentials. Cannot test Drive.");
    return;
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  try {
    console.log("Attempting to list files in Drive...");
    const driveRes = await drive.files.list({ pageSize: 1 });
    console.log("Drive connectivity: SUCCESS. Found", driveRes.data.files.length, "files.");

    const sheetId = cleanEnv(process.env.SHEET_ID);
    if (sheetId) {
        console.log("Attempting to read Google Sheet:", sheetId);
        const sheetRes = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
        console.log("Sheet connectivity: SUCCESS. Title:", sheetRes.data.properties.title);
    } else {
        console.log("SHEET_ID missing, skipping Sheets test.");
    }
    
    console.log("ALL GOOGLE AUTH TESTS PASSED.");
  } catch (err) {
    console.error("GOOGLE AUTH TEST FAILED:");
    console.error(err.message);
    if (err.response) {
      console.error(JSON.stringify(err.response.data));
    }
  }
}

testDrive();
