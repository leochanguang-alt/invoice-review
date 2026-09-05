# Atomic Invoice Numbering and Renumbering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee unique per-project invoice sequences and safely renumber all 35 `Neoss-MoEx-2608` archived invoices from `0001` through `0035`.

**Architecture:** PostgreSQL owns atomic sequence allocation through a private counter table and a public security-invoker RPC. The submit API reserves an idempotent number before copying to R2. A manifest-driven migration stages all existing objects before atomically updating database paths and removing obsolete keys.

**Tech Stack:** Node.js ESM, Node test runner, Supabase/PostgreSQL, Cloudflare R2 via AWS SDK v3, Vercel Functions.

## Global Constraints

- Order `Neoss-MoEx-2608` by `invoice_date ASC NULLS LAST, id ASC`.
- Assign exactly `0001` through `0035`, once each.
- Keep filename format `{projectCode}-{fourDigitSequence}-{roundedAmount}{currency}.{extension}`.
- Keep old R2 objects until all sources are staged and the database transaction succeeds.
- Do not expose `private.project_invoice_counters` through the Supabase Data API.
- Reuse a previously reserved number when a submission is retried.
- Do not modify unrelated `.DS_Store` or `tmp/` files.

---

### Task 1: Numbering and Manifest Helpers

**Files:**
- Create: `lib/invoice-numbering.js`
- Create: `test/invoice-numbering.test.js`

**Interfaces:**
- Produces: `formatInvoiceId({ projectCode, sequence, amount, currency }) -> string`
- Produces: `parseProjectSequence(invoiceId, projectCode) -> number | null`
- Produces: `buildRenumberManifest(invoices, projectCode) -> ManifestEntry[]`

- [ ] **Step 1: Write failing helper tests**

```javascript
import assert from "node:assert/strict";
import test from "node:test";
import {
    buildRenumberManifest,
    formatInvoiceId,
    parseProjectSequence,
} from "../lib/invoice-numbering.js";

test("formats positive and negative invoice IDs", () => {
    assert.equal(formatInvoiceId({
        projectCode: "Neoss-MoEx-2608",
        sequence: 9,
        amount: "780.4",
        currency: "sek",
    }), "Neoss-MoEx-2608-0009-780SEK");
    assert.equal(formatInvoiceId({
        projectCode: "P",
        sequence: 2,
        amount: "-12.6",
        currency: "gbp",
    }), "P-0002-m13GBP");
});

test("parses sequence after a project code containing hyphens", () => {
    assert.equal(
        parseProjectSequence("Neoss-MoEx-2608-0018-31EUR", "Neoss-MoEx-2608"),
        18,
    );
});

test("builds a date then id ordered contiguous manifest", () => {
    const manifest = buildRenumberManifest([
        { id: 3, invoice_date: "2026-08-02", amount: 20, currency: "GBP", achieved_file_id: "old/c.pdf" },
        { id: 2, invoice_date: "2026-08-01", amount: 10, currency: "EUR", achieved_file_id: "old/b.pdf" },
        { id: 1, invoice_date: "2026-08-01", amount: 5, currency: "SEK", achieved_file_id: "old/a.pdf" },
    ], "Neoss-MoEx-2608");
    assert.deepEqual(manifest.map(item => [item.invoiceId, item.sequence]), [
        [1, 1],
        [2, 2],
        [3, 3],
    ]);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/invoice-numbering.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement minimal pure helpers**

```javascript
export function formatInvoiceId({ projectCode, sequence, amount, currency }) {
    const rounded = Math.round(Number(String(amount).replaceAll(",", "")) || 0);
    const amountPart = rounded < 0 ? `m${Math.abs(rounded)}` : String(rounded);
    return `${projectCode}-${String(sequence).padStart(4, "0")}-${amountPart}${String(currency || "").trim().toUpperCase()}`;
}

export function parseProjectSequence(invoiceId, projectCode) {
    const prefix = `${projectCode}-`;
    if (!String(invoiceId || "").startsWith(prefix)) return null;
    const value = Number.parseInt(String(invoiceId).slice(prefix.length).split("-")[0], 10);
    return Number.isInteger(value) && value > 0 ? value : null;
}

export function buildRenumberManifest(invoices, projectCode) {
    return [...invoices]
        .sort((a, b) => {
            const left = a.invoice_date || "9999-12-31";
            const right = b.invoice_date || "9999-12-31";
            return left.localeCompare(right) || Number(a.id) - Number(b.id);
        })
        .map((invoice, index) => {
            const sequence = index + 1;
            const generatedInvoiceId = formatInvoiceId({
                projectCode,
                sequence,
                amount: invoice.amount,
                currency: invoice.currency,
            });
            const extension = String(invoice.achieved_file_id).match(/\.[^.]+$/)?.[0] || ".pdf";
            return {
                invoiceId: invoice.id,
                sequence,
                oldKey: invoice.achieved_file_id,
                generatedInvoiceId,
                newKey: `bui_invoice/projects/${projectCode}/${generatedInvoiceId}${extension}`,
            };
        });
}
```

- [ ] **Step 4: Run full tests and verify GREEN**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/invoice-numbering.js test/invoice-numbering.test.js
git commit -m "add invoice numbering helpers"
```

---

### Task 2: Atomic Project Counter Migration

**Files:**
- Create: `supabase/migrations/20260904195000_add_atomic_invoice_sequences.sql`
- Create: `test/invoice-sequence-migration.test.js`

**Interfaces:**
- Produces: `public.invoices.project_sequence integer`
- Produces: `private.project_invoice_counters(project_code, last_sequence)`
- Produces: `public.reserve_invoice_number(bigint, text, numeric, text)`

- [ ] **Step 1: Write a failing migration contract test**

```javascript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration defines private atomic counters and idempotent reservation", async () => {
    const sql = await readFile(
        new URL("../supabase/migrations/20260904195000_add_atomic_invoice_sequences.sql", import.meta.url),
        "utf8",
    );
    assert.match(sql, /create schema if not exists private/i);
    assert.match(sql, /create table.*project_invoice_counters/is);
    assert.match(sql, /for update/i);
    assert.match(sql, /on conflict.*do nothing/is);
    assert.match(sql, /security invoker/i);
    assert.match(sql, /unique.*charge_to_project.*project_sequence/is);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test/invoice-sequence-migration.test.js`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Write the migration**

The migration must:

```sql
create schema if not exists private;

alter table public.invoices
  add column if not exists project_sequence integer;

alter table public.invoices
  add constraint invoices_project_sequence_positive
  check (project_sequence is null or project_sequence > 0) not valid;

create unique index if not exists invoices_project_sequence_unique
  on public.invoices (charge_to_project, project_sequence)
  where project_sequence is not null;

create table if not exists private.project_invoice_counters (
  project_code text primary key,
  last_sequence integer not null check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);
```

Create `public.reserve_invoice_number` as `SECURITY INVOKER SET search_path = ''`.
It must lock the invoice with `SELECT ... FOR UPDATE`, return an existing
`project_sequence/generated_invoice_id`, initialize the counter from the maximum
legacy parsed sequence for that project, increment with `UPDATE ... RETURNING`,
format the generated ID, update the invoice row, and return
`project_sequence/generated_invoice_id`.

Grant only schema usage and required table/function privileges to `anon` and
`authenticated`; do not add `private` to exposed schemas.

- [ ] **Step 4: Run local tests and apply migration**

Run: `npm test`

Expected: all tests PASS.

Apply through Supabase MCP `apply_migration` using the exact migration SQL.

Verify:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='invoices'
and column_name='project_sequence';

select routine_name, security_type
from information_schema.routines
where routine_schema='public' and routine_name='reserve_invoice_number';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904195000_add_atomic_invoice_sequences.sql test/invoice-sequence-migration.test.js
git commit -m "add atomic project invoice counters"
```

---

### Task 3: Submit API Reservation Flow

**Files:**
- Modify: `api/submit.js`
- Create: `lib/invoice-number-reservation.js`
- Create: `test/invoice-number-reservation.test.js`

**Interfaces:**
- Consumes: RPC `reserve_invoice_number`
- Produces: `reserveInvoiceNumber(supabase, input) -> { projectSequence, generatedInvoiceId }`

- [ ] **Step 1: Write failing reservation adapter tests**

Test that the adapter maps RPC snake_case values, throws RPC errors, and returns
the same reserved ID on repeated calls. Use a small in-memory fake implementing
only `.rpc()`; do not mock R2.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test/invoice-number-reservation.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the adapter**

```javascript
export async function reserveInvoiceNumber(supabase, {
    invoiceId,
    projectCode,
    amount,
    currency,
}) {
    const { data, error } = await supabase.rpc("reserve_invoice_number", {
        p_invoice_id: invoiceId,
        p_project_code: projectCode,
        p_amount: Number(String(amount).replaceAll(",", "")) || 0,
        p_currency: String(currency || "").trim().toUpperCase(),
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
        projectSequence: row.project_sequence,
        generatedInvoiceId: row.generated_invoice_id,
    };
}
```

- [ ] **Step 4: Replace global ID loading in `api/submit.js`**

Delete `existingInvoices`, `existingInvoiceIds`, and `projectSequences`.
For each non-deleted record, call `reserveInvoiceNumber` before constructing the
R2 target key. Use `generatedInvoiceId` returned by the RPC. After `CopyObject`,
send `HeadObjectCommand` and reject a missing or zero-length target. Only then
update `status`, `achieved_file_id`, and `achieved_file_link`.

- [ ] **Step 5: Verify**

Run:

```bash
npm test
node --check api/submit.js
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 6: Commit**

```bash
git add api/submit.js lib/invoice-number-reservation.js test/invoice-number-reservation.test.js
git commit -m "reserve invoice numbers atomically"
```

---

### Task 4: Manifest-Driven R2 Renumber Tool

**Files:**
- Create: `scripts/renumber-project-invoices.js`
- Create: `test/renumber-project-invoices.test.js`

**Interfaces:**
- Consumes: `buildRenumberManifest`
- Produces: dry-run JSON manifest under `tmp/renumber-project-invoices/`
- Supports: `--stage`, `--finalize`, `--cleanup`, each requiring `--manifest`

- [ ] **Step 1: Write failing CLI argument and manifest tests**

Tests must prove that dry-run performs no R2 mutation, duplicate new keys are
rejected, all 35 sequences are contiguous, and cleanup excludes keys also
present in the final-key set.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test/renumber-project-invoices.test.js`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement dry-run and stage**

Load `.env.local` then `.env`, query active project invoices, require exactly 35
rows, create the ordered manifest, and fetch source `ContentLength` using
`HeadObjectCommand`. `--stage` copies each source to:

`bui_invoice/projects/Neoss-MoEx-2608/.renumber-20260904/{generatedInvoiceId}.{ext}`

Verify every staged object's length.

- [ ] **Step 4: Implement finalize and cleanup**

`--finalize` copies staged objects to final keys and verifies lengths. It prints
the exact guarded SQL transaction for all 35 updates and counter value 35.

After that SQL is applied separately and verified, `--cleanup` deletes only:

- old keys not present in the final-key set;
- all run-specific staging keys.

- [ ] **Step 5: Run tests and commit**

```bash
npm test
node --check scripts/renumber-project-invoices.js
git diff --check
git add scripts/renumber-project-invoices.js test/renumber-project-invoices.test.js
git commit -m "add safe project invoice renumber tool"
```

---

### Task 5: Production Migration and Deployment

**Files:**
- Runtime artifact: `tmp/renumber-project-invoices/Neoss-MoEx-2608-20260904.json`

**Interfaces:**
- Consumes all previous tasks.
- Produces migrated database rows and R2 objects.

- [ ] **Step 1: Run complete pre-deployment verification**

```bash
npm test
node --check api/submit.js
node --check scripts/renumber-project-invoices.js
git status --short
```

Expected: tests pass; only unrelated `.DS_Store` and `tmp/` remain uncommitted.

- [ ] **Step 2: Push implementation and verify deployment**

Push the feature branch, merge to `main`, push `main`, and verify the Vercel
deployment is ready before allowing new submissions.

- [ ] **Step 3: Build and stage the manifest**

```bash
node scripts/renumber-project-invoices.js --project Neoss-MoEx-2608
node scripts/renumber-project-invoices.js --manifest <manifest-path> --stage
node scripts/renumber-project-invoices.js --manifest <manifest-path> --finalize
```

Expected: 35 sources, 35 staged objects, and 35 final objects all pass size
verification.

- [ ] **Step 4: Apply the guarded database transaction**

Use Supabase MCP `execute_sql`. The transaction must first assert:

- source project exists;
- exactly 35 active invoices match the manifest IDs;
- every expected old key still matches;
- sequences are exactly 1 through 35.

Then update each invoice's `project_sequence`, `generated_invoice_id`,
`achieved_file_id`, `achieved_file_link`, and `updated_at`, and upsert the
project counter to `35`.

- [ ] **Step 5: Verify and clean R2**

Query the database for count, distinct sequence count, minimum, maximum, and
duplicate groups. Run the tool's R2 verification, then:

```bash
node scripts/renumber-project-invoices.js --manifest <manifest-path> --cleanup
```

Expected: no missing final objects and no obsolete/staging objects.

---

### Task 6: Export Acceptance Test

**Files:**
- Output: fresh `Neoss-MoEx-2608_files.zip`
- Output: fresh `Neoss-MoEx-2608_expenses.csv`

**Interfaces:**
- Consumes production export endpoints.
- Produces final user-verifiable exports.

- [ ] **Step 1: Export fresh artifacts**

Download a new ZIP and expenses CSV after database and R2 verification.

- [ ] **Step 2: Verify ZIP sequences**

List ZIP entries and assert:

- total files: 35;
- distinct filenames: 35;
- extracted sequences: exactly `0001` through `0035`;
- no duplicate sequence.

- [ ] **Step 3: Verify CSV consistency**

Assert:

- data rows: 35;
- distinct R2 paths: 35;
- CSV basenames equal ZIP basenames as sets.

- [ ] **Step 4: Final repository and production check**

Run `npm test`, confirm `origin/main...main` is `0 0`, and report the migration
manifest path, deployment commit, database counts, and export results.

---

## Final Safety Runbook (Supersedes Task 5/6 Ordering)

No command in this section is run automatically by the migration tool. Review
every generated SQL block and execute it manually in the approved environment.

### 1. Freeze numbering first

```bash
node scripts/renumber-project-invoices.js \
  --project Neoss-MoEx-2608 --freeze-sql
```

Execute the printed SQL and verify `projects.numbering_frozen = true`.
`projects.archived` must remain unchanged so the active project stays
exportable. Smoke-check that `reserve_invoice_number` now rejects this project.

### 2. Dry-run and stage

```bash
node scripts/renumber-project-invoices.js --project Neoss-MoEx-2608
node scripts/renumber-project-invoices.js --manifest <manifest> --stage
```

Review the versioned digest, fixed project/run, 35 rows, old database values,
old object size/ETag/checksum, `publicUrl`, and all old/staging/final keys.
Stage performs complete source preflight before any copy.

### 3. Finalize R2

```bash
node scripts/renumber-project-invoices.js --manifest <manifest> --finalize \
  > guarded-renumber.sql
```

Finalize verifies all staging objects before writing final keys. Every copy
Heads its target first: an absent target may be copied; an existing target is
accepted only when size, available checksum, and a 32-hex single-part content
ETag match. Multipart ETags are not treated as content hashes.

### 4. Apply guarded database SQL manually

Review `guarded-renumber.sql`, then execute it as one transaction. It must
assert `numbering_frozen = true`, exactly 35 active manifest rows, all old
database values, contiguous sequences, counter bounds, and affected row counts.
Do not unfreeze.

### 5. Verify and smoke-test

```bash
node scripts/renumber-project-invoices.js --manifest <manifest> --verify
```

Independently query all 35 rows and verify sequence, generated ID,
`achieved_file_id`, and `achieved_file_link`; verify no duplicate project
sequences or generated IDs. Export a fresh ZIP and CSV. CSV may contain only
submitted invoices with persisted achieved paths and must report the count of
in-transit/missing-path rows skipped.

Run reservation smoke tests in a separate non-production project: first
reservation, retry idempotence, and collision skip-to-next behavior. Confirm the
frozen Neoss project still rejects reservation.

### 6. Roll back if needed (only before cleanup)

```bash
node scripts/renumber-project-invoices.js --manifest <manifest> --rollback-sql \
  > guarded-rollback.sql
```

The command Heads all 35 old keys and verifies manifest metadata before it
prints SQL. Missing or changed old objects fail closed. Review and execute the
SQL manually; it guards current new values, clears all sequences first,
restores old nullable fields, and never lowers the counter. Re-run step 5 after
rollback. Cleanup permanently closes this rollback window.

### 7. Cleanup only after accepting loss of rollback

```bash
node scripts/renumber-project-invoices.js \
  --manifest <manifest> --cleanup --db-verified
```

Cleanup independently re-queries all 35 database rows and Heads all final
objects before any Delete. Do not run it while rollback may still be needed.

### 8. Unfreeze last

```bash
node scripts/renumber-project-invoices.js \
  --manifest <manifest> --unfreeze-sql
# or: --project Neoss-MoEx-2608 --unfreeze-sql
```

Execute the printed SQL, verify `numbering_frozen = false`, then perform one
final normal reservation smoke test. The project remains active throughout.
