-- Add archived column to projects table
-- Execute this SQL in Supabase Dashboard

ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;

-- Create an index for faster filtering
CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived);
