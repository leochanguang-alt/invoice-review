import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { supabase } from './api/_supabase.js';

const BUCKET = process.env.R2_BUCKET_NAME;
const ENDPOINT = process.env.R2_ENDPOINT;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || `https://${BUCKET}.r2.cloudflarestorage.com`).replace(/\/$/, '');
const PREFIX = 'bui_invoice/original_files/fr_google_drive/';
const LIMIT = 2;

const r2 = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function listLatest(prefix, limit) {
  let token = null;
  const objects = [];
  do {
    const res = await r2.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    (res.Contents || []).forEach(o => {
      if (o.Key.endsWith('/')) return; // skip pseudo folders
      objects.push(o);
    });
    token = res.IsTruncated ? res.NextContinuationToken : null;
  } while (token);

  objects.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
  return objects.slice(0, limit);
}

async function loadExisting(etags, links) {
  const existingHashes = new Set();
  const existingLinks = new Set();
  if (!supabase) return { existingHashes, existingLinks };

  const { data, error } = await supabase
    .from('invoices')
    .select('file_ID_HASH_R2,file_link_r2')
    .in('file_ID_HASH_R2', etags);

  if (!error && data) {
    data.forEach(r => {
      if (r.file_ID_HASH_R2) existingHashes.add(r.file_ID_HASH_R2);
      if (r.file_link_r2) existingLinks.add(r.file_link_r2);
    });
  }

  // also check links to be safe
  const { data: data2, error: error2 } = await supabase
    .from('invoices')
    .select('file_link_r2')
    .in('file_link_r2', links);
  if (!error2 && data2) {
    data2.forEach(r => {
      if (r.file_link_r2) existingLinks.add(r.file_link_r2);
    });
  }

  return { existingHashes, existingLinks };
}

async function upsertRecords(objs) {
  if (!supabase) {
    console.error('Supabase not initialized. Check env.');
    return;
  }
  if (objs.length === 0) {
    console.log('No new objects to upsert.');
    return;
  }

  const rows = objs.map(o => {
    const etag = (o.ETag || '').replace(/"/g, '');
    const link = `${R2_PUBLIC_URL}/${o.Key}`;
    return {
      file_ID_HASH_R2: etag || null,
      file_link_r2: link,
      file_link: link,
      status: 'Waiting for Confirm',
    };
  });

  const { error } = await supabase
    .from('invoices')
    .upsert(rows, { onConflict: 'file_ID_HASH_R2' });

  if (error) {
    console.error('Upsert failed:', error.message);
  } else {
    console.log(`Upserted ${rows.length} record(s) into Supabase.`);
  }
}

async function main() {
  console.log(`Listing latest ${LIMIT} objects from R2 prefix: ${PREFIX}`);
  const latest = await listLatest(PREFIX, LIMIT);
  latest.forEach(o => {
    console.log(`- ${o.Key} (${o.Size} bytes, ${o.LastModified}, etag=${o.ETag})`);
  });

  const etags = latest.map(o => (o.ETag || '').replace(/"/g, '')).filter(Boolean);
  const links = latest.map(o => `${R2_PUBLIC_URL}/${o.Key}`);
  const { existingHashes, existingLinks } = await loadExisting(etags, links);

  const toInsert = latest.filter(o => {
    const etag = (o.ETag || '').replace(/"/g, '');
    const link = `${R2_PUBLIC_URL}/${o.Key}`;
    return !existingHashes.has(etag) && !existingLinks.has(link);
  });

  if (toInsert.length === 0) {
    console.log('No new records to insert (already present in Supabase).');
    return;
  }

  await upsertRecords(toInsert);
}

main().catch(err => {
  console.error('backfill failed:', err);
});
