import 'dotenv/config';
import { google } from 'googleapis';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getDriveAuth } from './api/_sheets.js';

const drive = google.drive({ version: 'v3', auth: getDriveAuth() });

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PREFIX = 'bui_invoice/original_files/fr_google_drive/';

function sanitize(name) {
  return (name || '').replace(/[\\\/:*?"<>|]/g, '_').trim();
}

async function uploadOne(fileId) {
  if (!fileId) throw new Error('fileId required');

  const meta = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType',
    supportsAllDrives: true,
  });
  const name = sanitize(meta.data.name || fileId);
  const mimeType = meta.data.mimeType || 'application/octet-stream';
  const r2Key = `${PREFIX}${name}`;

  // skip if exists
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: r2Key }));
    console.log(`Skip (already exists): ${r2Key}`);
    return;
  } catch (e) {
    // continue if not found
  }

  console.log(`Downloading from Drive: ${fileId} (${name})`);
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  console.log(`Uploading to R2: ${r2Key}`);
  const upload = new Upload({
    client: r2,
    params: {
      Bucket: BUCKET,
      Key: r2Key,
      Body: res.data,
      ContentType: mimeType,
    },
  });
  const out = await upload.done();
  console.log('Uploaded. ETag:', out.ETag);
}

const args = process.argv.slice(2);
const fileId = args[0];
uploadOne(fileId).catch(err => {
  console.error('Upload failed:', err);
  process.exit(1);
});
