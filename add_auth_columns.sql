-- Add email and password columns to owners table
ALTER TABLE owners ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS password TEXT DEFAULT '123456';

-- Update existing users' email
UPDATE owners SET email = 'leochanguang@gmail.com', password = '123456' WHERE owner_id = '1';
UPDATE owners SET email = 'admin@buiservice', password = '123456' WHERE owner_id = '2';

-- Create unique index for email
CREATE UNIQUE INDEX IF NOT EXISTS idx_owners_email ON owners(email);
