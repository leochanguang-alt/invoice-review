# Atomic Invoice Numbering and Project Renumbering Design

## Scope

Fix duplicate per-project invoice sequence numbers, renumber the 35 active
`Neoss-MoEx-2608` invoices, migrate their archived R2 objects, and verify the
result through a fresh ZIP and expenses CSV export.

## Root Cause

`api/submit.js` loads all non-null `generated_invoice_id` values without
pagination. Supabase limits a response to 1,000 rows, while the database
currently contains more than 1,100 generated IDs. The API therefore calculates
the next sequence from an incomplete set. Each selected invoice is submitted in
a separate request, so stale maximum values can be reused. The database has no
constraint that prevents duplicate project sequence numbers.

## Atomic Number Allocation

Add nullable `invoices.project_sequence integer` and a partial unique index on
`(charge_to_project, project_sequence)` when `project_sequence` is non-null.
Legacy invoices in other projects remain nullable and are not forced through a
global renumbering.

Create `private.project_invoice_counters` with one row per project and a
non-negative `last_sequence`. The private schema is not exposed through the
Supabase Data API.

Create a public `SECURITY INVOKER` PostgreSQL function that:

1. Takes a `FOR SHARE` lock on the project row and rejects
   `projects.numbering_frozen = true` without changing `projects.archived`.
2. Locks the requested invoice row.
3. Returns its existing project sequence and generated ID when already reserved.
4. Initializes the project's counter from the maximum parsed legacy sequence
   when the counter does not yet exist.
5. Atomically increments the counter and formats a candidate generated ID.
6. If another row in the project already uses that generated ID, increments
   again in the same transaction, up to a fixed maximum of 1,000 attempts.
7. Writes `project_sequence` and `generated_invoice_id` to the locked invoice.
8. Returns the reserved values.

The function uses a fixed empty `search_path` and schema-qualified object names.
The API invokes it with the existing server-side Supabase client. Direct access
to the private counter table is not exposed through PostgREST.

## Submit API Flow

For each invoice, `api/submit.js` reserves or reuses its number before copying
the attachment. The generated filename retains the current format:

`{projectCode}-{fourDigitSequence}-{roundedAmount}{currency}.{extension}`

After reservation, the API copies the original object to the project archive
path and verifies that the target exists. Only then does it mark the invoice
`Submitted` and store the archived path. If copying fails, the invoice keeps its
reserved number but is not marked submitted; retrying reuses that number.

## Neoss-MoEx-2608 Migration

The 35 active invoices are ordered by:

1. `invoice_date` ascending, nulls last.
2. Database `id` ascending for equal dates.

They receive sequences `0001` through `0035`. Amounts continue to use rounded
whole-number filename components and negative values use the existing `m`
prefix.

R2 migration follows this exact runbook:

1. Generate and manually execute `--project Neoss-MoEx-2608 --freeze-sql`.
   This sets only `numbering_frozen`; the project remains active/exportable.
2. Run dry-run and save the integrity manifest containing invoice IDs, old
   values, old object size/ETag/checksum, final public URL, new keys, and IDs.
3. Stage every old object under the run-specific prefix and verify metadata.
4. Finalize from staging to final keys. Existing targets are accepted only when
   metadata proves idempotence; otherwise overwrite is refused.
5. Manually execute the emitted guarded database SQL, which requires
   `numbering_frozen = true`, then update all 35 invoice IDs, project sequences,
   archive keys/links, and set the project counter to 35.
6. Run database verification and final R2 verification.
7. Run smoke tests: reserve/submit a disposable invoice in a non-frozen test
   project, verify retry idempotence, and verify frozen Neoss numbering rejects.
8. Only after the rollback window is explicitly closed, run cleanup to delete
   obsolete old keys and staging keys.
9. Generate and manually execute unfreeze SQL.

No old object is removed before all sources are safely staged and the database
transaction succeeds.

## Testing and Verification

Automated tests cover:

- Legacy maximum sequence parsing beyond a 1,000-row global dataset.
- Reuse of an already reserved number.
- Filename formatting.
- Submit behavior when archive copy succeeds or fails.
- Migration ordering and one-to-one sequence assignment.

Production verification requires:

- Exactly 35 active project invoices.
- Exactly 35 distinct sequences covering `0001` through `0035`.
- No duplicate `(charge_to_project, project_sequence)` values.
- Every database archive key exists in R2 with the expected size.
- A newly exported ZIP contains 35 unique sequential filenames.
- The expenses CSV contains only submitted rows with persisted achieved paths;
  in-transit/missing-path rows are skipped with an explicit count.

## Rollback

The rollback window starts after the guarded database update and ends
irreversibly at cleanup. Before printing rollback SQL, `--rollback-sql` Heads
all 35 old keys and verifies manifest size, single-part content ETag, and
available checksum. Missing old objects (including after cleanup) fail closed.
The rollback restores old database values in two sequence phases and never
decreases the project counter. It does not delete R2 objects. Keep
`numbering_frozen = true` throughout rollback, re-run database/R2 verification,
then unfreeze. Never run cleanup until rollback is no longer required.
