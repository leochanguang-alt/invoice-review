-- ============================================================
-- Migration: Soft delete + attachment cleanup tracking for invoices
-- ============================================================
-- Goal: make user-initiated invoice deletion resilient. We mark
-- the row as soft-deleted immediately, then drive the actual
-- attachment (Google Drive + R2) cleanup asynchronously with
-- retries. The row itself stays as a tombstone so that the
-- R2-based ingestion job does not re-create the record from
-- the original file.
--
-- Columns added to `invoices`:
--   deleted_at                          TIMESTAMPTZ  (NULL = active row)
--   attachment_cleanup_status           TEXT         pending | success | failed
--   attachment_cleanup_errors           JSONB        list of last error messages
--   attachment_cleanup_attempts         INTEGER      retry counter
--   attachment_cleanup_last_attempt_at  TIMESTAMPTZ  last retry timestamp
--
-- Re-running this migration is safe (IF NOT EXISTS / DO blocks).
-- ============================================================

BEGIN;

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attachment_cleanup_status TEXT,
    ADD COLUMN IF NOT EXISTS attachment_cleanup_errors JSONB,
    ADD COLUMN IF NOT EXISTS attachment_cleanup_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS attachment_cleanup_last_attempt_at TIMESTAMPTZ;

-- Constrain status to a known set when present.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'invoices_attachment_cleanup_status_check'
    ) THEN
        ALTER TABLE invoices
            ADD CONSTRAINT invoices_attachment_cleanup_status_check
            CHECK (
                attachment_cleanup_status IS NULL
                OR attachment_cleanup_status IN ('pending', 'success', 'failed')
            );
    END IF;
END $$;

-- Speed up the "scan rows that still need attachment cleanup" query
-- used by the retry worker / API endpoint.
CREATE INDEX IF NOT EXISTS idx_invoices_cleanup_pending
    ON invoices (attachment_cleanup_attempts, attachment_cleanup_last_attempt_at)
    WHERE deleted_at IS NOT NULL
      AND attachment_cleanup_status IN ('pending', 'failed');

-- Speed up the typical "active records" listing used by the UI.
CREATE INDEX IF NOT EXISTS idx_invoices_active_created_at
    ON invoices (created_at DESC)
    WHERE deleted_at IS NULL;

COMMIT;

-- Verification queries (run separately to confirm):
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'invoices'
--     AND column_name IN (
--         'deleted_at', 'attachment_cleanup_status',
--         'attachment_cleanup_errors', 'attachment_cleanup_attempts',
--         'attachment_cleanup_last_attempt_at'
--     );
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'invoices'
--     AND indexname LIKE 'idx_invoices_%';
