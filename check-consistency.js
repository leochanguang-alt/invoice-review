import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { supabase } from './api/_supabase.js';

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const FR_PREFIX = 'bui_invoice/original_files/fr_google_drive/';
const PROJECTS_PREFIX = 'bui_invoice/projects/';

async function listCount(prefix) {
  let token = null;
  let count = 0;
  do {
    const res = await r2.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    count += (res.Contents || []).length;
    token = res.IsTruncated ? res.NextContinuationToken : null;
  } while (token);
  return count;
}

async function main() {
  if (!supabase) {
    console.error('Supabase not initialized. Check env.');
    return;
  }

  const [frCount, projectsCount] = await Promise.all([
    listCount(FR_PREFIX),
    listCount(PROJECTS_PREFIX),
  ]);

  const { count: invoicesCount, error } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Supabase count error:', error.message);
  }

  console.log('--- Consistency Snapshot ---');
  console.log(`R2 fr_google_drive objects : ${frCount}`);
  console.log(`R2 projects objects        : ${projectsCount}`);
  console.log(`Supabase invoices records   : ${invoicesCount ?? 'n/a'}`);
  console.log('Note: this is a raw count; refine filters as needed (e.g., exclude placeholders).');
}

main().catch(err => {
  console.error('Consistency check failed:', err);
});
