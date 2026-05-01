BEGIN;

-- Merge company NEOSS into canonical Neoss and remove NEOSS option.
-- Handles:
-- 1) companies.company_name casing variants
-- 2) companies.company_id variants (NEOSS/neoss/Neoss)
-- 3) projects.company_id references
-- 4) invoices.charge_to_company references

DO $$
DECLARE
    canonical_id TEXT;
BEGIN
    -- Prefer exact Neoss name row, then exact Neoss id, then any neoss-like row.
    SELECT company_id INTO canonical_id
    FROM companies
    WHERE company_name = 'Neoss'
    ORDER BY company_id
    LIMIT 1;

    IF canonical_id IS NULL THEN
        SELECT company_id INTO canonical_id
        FROM companies
        WHERE company_id = 'Neoss'
        ORDER BY company_id
        LIMIT 1;
    END IF;

    IF canonical_id IS NULL THEN
        SELECT company_id INTO canonical_id
        FROM companies
        WHERE company_name ILIKE 'neoss' OR company_id ILIKE 'neoss'
        ORDER BY (company_name = 'Neoss') DESC, (company_id = 'Neoss') DESC, company_id
        LIMIT 1;
    END IF;

    -- If still not found, create canonical company row.
    IF canonical_id IS NULL THEN
        canonical_id := 'Neoss';
        INSERT INTO companies(company_id, company_name)
        VALUES (canonical_id, 'Neoss');
    END IF;

    -- Normalize canonical row display name.
    UPDATE companies
    SET company_name = 'Neoss'
    WHERE company_id = canonical_id;

    -- Move all project references to canonical id.
    UPDATE projects
    SET company_id = canonical_id
    WHERE company_id ILIKE 'neoss'
      AND company_id <> canonical_id;

    -- Normalize invoice company field to visible canonical name.
    UPDATE invoices
    SET charge_to_company = 'Neoss'
    WHERE charge_to_company ILIKE 'neoss';

    -- Remove duplicate rows (including NEOSS option).
    DELETE FROM companies
    WHERE (company_name ILIKE 'neoss' OR company_id ILIKE 'neoss')
      AND company_id <> canonical_id;
END $$;

COMMIT;
