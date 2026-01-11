-- Run this in Supabase SQL Editor

ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS file_link_r2 text,
ADD COLUMN IF NOT EXISTS file_id_hash_r2 text;
