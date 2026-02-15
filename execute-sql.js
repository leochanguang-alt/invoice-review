#!/usr/bin/env node
/**
 * Execute SQL via Supabase REST API
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addArchivedColumn() {
    console.log('Adding archived column to projects table...');
    
    // Use rpc to execute raw SQL (requires a database function)
    // Since we can't execute raw DDL via the client, let's check if the column exists first
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .limit(1);
    
    if (error) {
        console.error('Error checking projects table:', error.message);
        return;
    }
    
    // Check if archived column exists
    if (data && data.length > 0) {
        const hasArchived = 'archived' in data[0];
        if (hasArchived) {
            console.log('✓ archived column already exists');
            return;
        }
    }
    
    console.log('archived column does not exist.');
    console.log('\nPlease execute this SQL in Supabase Dashboard SQL Editor:');
    console.log('------------------------------------------------------------');
    console.log('ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;');
    console.log('CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived);');
    console.log('------------------------------------------------------------');
}

addArchivedColumn();
