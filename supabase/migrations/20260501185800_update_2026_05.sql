-- ============================================================
-- Migration: 2026-05 Updates
-- 1) Rename project spain-2506 -> Spain-2505
-- 2) Merge company NEOSS -> Neoss
-- 3) Add remarks column (VARCHAR(30)) to invoices
-- ============================================================
-- Run this in Supabase Dashboard > SQL Editor.
-- Each section is wrapped in DO blocks / safe statements so
-- repeated execution will not error out.

BEGIN;

-- ============================================================
-- 1) Rename Spain-2506 -> Spain-2505 (project_code AND project_name)
-- ============================================================
-- Sanity-check first (uncomment to inspect before applying):
-- SELECT project_id, project_code, project_name FROM projects WHERE project_code ILIKE 'spain-2506' OR project_name ILIKE 'spain-2506';

UPDATE projects
SET project_code = 'Spain-2505',
    project_name = 'Spain-2505'
WHERE project_code ILIKE 'spain-2506'
   OR project_name ILIKE 'spain-2506';

-- Keep invoice references in sync
UPDATE invoices
SET charge_to_project = 'Spain-2505'
WHERE charge_to_project ILIKE 'spain-2506';

-- ============================================================
-- 2) Merge NEOSS company into Neoss (case-insensitive merge)
-- ============================================================
-- Strategy:
--   * Find a canonical Neoss row (prefer the one whose name == 'Neoss')
--   * Re-point all projects.company_id and invoices.charge_to_company
--     that reference the duplicate(s) to the canonical id and name
--   * Delete duplicate company rows
--
-- This handles both the case where company_id values differ (e.g. 'NEOSS' vs 'Neoss')
-- and the case where the rows differ only in casing of company_name.

DO $$
DECLARE
    canonical_id TEXT;
BEGIN
    -- Pick the row whose name is exactly 'Neoss' as canonical;
    -- if none, pick the row with company_id = 'Neoss'; otherwise the first match.
    SELECT company_id INTO canonical_id
    FROM companies
    WHERE company_name = 'Neoss'
    ORDER BY (company_id = 'Neoss') DESC, company_id
    LIMIT 1;

    IF canonical_id IS NULL THEN
        SELECT company_id INTO canonical_id
        FROM companies
        WHERE company_name ILIKE 'neoss'
        ORDER BY (company_id ILIKE 'Neoss') DESC, (company_name = 'Neoss') DESC, company_id
        LIMIT 1;
    END IF;

    IF canonical_id IS NULL THEN
        RAISE NOTICE 'No Neoss/NEOSS company row found, skipping merge.';
        RETURN;
    END IF;

    -- Normalize the canonical row name to 'Neoss'
    UPDATE companies
    SET company_name = 'Neoss'
    WHERE company_id = canonical_id
      AND company_name <> 'Neoss';

    -- Re-point projects from all other neoss-named rows to the canonical id
    UPDATE projects
    SET company_id = canonical_id
    WHERE company_id IN (
        SELECT company_id
        FROM companies
        WHERE company_name ILIKE 'neoss'
          AND company_id <> canonical_id
    );

    -- Delete the duplicate company rows
    DELETE FROM companies
    WHERE company_name ILIKE 'neoss'
      AND company_id <> canonical_id;

    -- Normalize invoice references regardless of which value they used
    UPDATE invoices
    SET charge_to_company = canonical_id
    WHERE charge_to_company ILIKE 'neoss'
       OR charge_to_company ILIKE 'NEOSS';
END $$;

-- ============================================================
-- 3) Add remarks column to invoices (max 30 chars)
-- ============================================================
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS remarks VARCHAR(30);

COMMIT;

-- Verification queries (run separately to confirm):
-- SELECT project_id, project_code, project_name FROM projects WHERE project_code ILIKE 'spain%';
-- SELECT company_id, company_name FROM companies WHERE company_name ILIKE 'neoss';
-- SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'remarks';
