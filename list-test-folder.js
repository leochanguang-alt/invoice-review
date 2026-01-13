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

async function listTestFolder() {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const folderId = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3";
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, modifiedTime)"
    });
    console.log(`Folder ${folderId} contains ${res.data.files.length} files:`);
    res.data.files.forEach(f => {
      console.log(` - ${f.name} (${f.id}) [${f.modifiedTime}]`);
    });
  } catch (err) {
    console.error(err.message);
  }
}

listTestFolder();
