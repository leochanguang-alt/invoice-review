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

1. Locks the requested invoice row.
2. Returns its existing project sequence and generated ID when already reserved.
3. Initializes the project's counter from the maximum parsed legacy sequence
   when the counter does not yet exist.
4. Atomically increments the counter.
5. Writes `project_sequence` and `generated_invoice_id` to the locked invoice.
6. Returns the reserved values.

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

R2 migration is staged:

1. Produce and save a manifest containing invoice ID, old key, new key, size,
   and new generated ID.
2. Copy every old object to a run-specific staging prefix.
3. Verify each staged object's size against its source.
4. Copy all staged objects to their final keys and verify them.
5. In one database transaction, update all 35 invoice IDs, project sequences,
   archive keys/links, and set the project counter to 35.
6. Verify database uniqueness and all final R2 objects.
7. Delete obsolete old keys that are not also final keys, then delete staging
   objects.

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
- The expenses CSV contains the same 35 R2 paths as the ZIP.

## Rollback

The migration manifest is retained locally until verification completes. If the
database update fails, old database paths remain valid and staged objects remain
available. If post-update verification fails, the manifest can restore the old
database values in one transaction because old objects are not deleted until
the final cleanup step.
