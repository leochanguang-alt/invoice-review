# Exchange Rate and Project Date Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore September HKD conversions, backfill the 12 affected invoices, and require confirmation before saving an invoice dated outside its project's active period.

**Architecture:** Keep exchange-rate generation in the existing `update-rates` endpoint and perform a guarded one-time SQL backfill. Add a pure date-range validator under `lib/`, call it from the existing `api/manage.js` update path, and let `public/app.js` retry the save only after the user accepts the warning.

**Tech Stack:** Node.js ES modules, Node test runner, Vercel Functions, Supabase/PostgreSQL, browser `fetch` and `confirm`.

## Global Constraints

- Do not add another Vercel Function.
- Project boundaries are inclusive.
- Validation runs when Save is clicked.
- Missing project boundary dates do not block saving.
- The four invoices parsed as years 2020-2023 are excluded from automatic HKD backfill.

---

### Task 1: Add September Rates and Backfill HKD

**Files:**
- Modify: Supabase tables `currency_rates` and `invoices` through existing APIs/SQL

**Interfaces:**
- Consumes: `GET /api/update-rates?force=true`
- Produces: `currency_rates` rows dated `2026-09-01` and 12 non-zero `amount_hkd` values

- [ ] **Step 1: Generate September rates**

Run:

```bash
curl -fsS "https://ems.buiservice.com/api/update-rates?force=true"
```

Expected: JSON with `success: true`, `date: "2026-09-01"`, and successful GBP, CNY, USD, and EUR entries.

- [ ] **Step 2: Verify exactly 12 candidates**

Run this read-only SQL:

```sql
select count(*) as candidate_count
from public.invoices i
join public.currency_rates r
  on r.currency_code = upper(trim(i.currency))
 and r.rate_date = date '2026-09-01'
where i.deleted_at is null
  and i.invoice_date >= date '2026-09-01'
  and i.invoice_date < date '2026-10-01'
  and (i.amount_hkd is null or i.amount_hkd = 0)
  and i.amount is not null;
```

Expected: `candidate_count = 12`.

- [ ] **Step 3: Perform guarded backfill**

Run:

```sql
do $$
declare
  candidate_count integer;
begin
  select count(*)
  into candidate_count
  from public.invoices i
  join public.currency_rates r
    on r.currency_code = upper(trim(i.currency))
   and r.rate_date = date '2026-09-01'
  where i.deleted_at is null
    and i.invoice_date >= date '2026-09-01'
    and i.invoice_date < date '2026-10-01'
    and (i.amount_hkd is null or i.amount_hkd = 0)
    and i.amount is not null;

  if candidate_count <> 12 then
    raise exception 'Expected 12 HKD backfill candidates, found %', candidate_count;
  end if;

  update public.invoices i
  set amount_hkd = round(i.amount * r.rate_to_hkd, 2),
      updated_at = now()
  from public.currency_rates r
  where r.currency_code = upper(trim(i.currency))
    and r.rate_date = date '2026-09-01'
    and i.deleted_at is null
    and i.invoice_date >= date '2026-09-01'
    and i.invoice_date < date '2026-10-01'
    and (i.amount_hkd is null or i.amount_hkd = 0)
    and i.amount is not null;
end $$;
```

- [ ] **Step 4: Verify the backfill**

Run:

```sql
select count(*) as remaining
from public.invoices
where deleted_at is null
  and invoice_date >= date '2026-09-01'
  and invoice_date < date '2026-10-01'
  and amount is not null
  and currency is not null
  and (amount_hkd is null or amount_hkd = 0);
```

Expected: `remaining = 0`.

---

### Task 2: Build the Project Date Validator with TDD

**Files:**
- Create: `lib/project-date-validation.js`
- Create: `test/project-date-validation.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateInvoiceProjectDate({ invoiceDate, projectStartDate, projectEndDate })`
- Returns: `{ outOfRange: boolean, invoiceDate?: string, projectStartDate?: string, projectEndDate?: string }`

- [ ] **Step 1: Write failing validator tests**

Create tests covering inclusive boundaries, dates before/after the project, and missing inputs:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { validateInvoiceProjectDate } from "../lib/project-date-validation.js";

const range = { projectStartDate: "2026-08-01", projectEndDate: "2026-08-31" };

test("allows project boundary dates", () => {
  assert.equal(validateInvoiceProjectDate({ invoiceDate: "2026-08-01", ...range }).outOfRange, false);
  assert.equal(validateInvoiceProjectDate({ invoiceDate: "2026-08-31", ...range }).outOfRange, false);
});

test("flags invoice dates outside the project range", () => {
  assert.equal(validateInvoiceProjectDate({ invoiceDate: "2026-07-31", ...range }).outOfRange, true);
  assert.equal(validateInvoiceProjectDate({ invoiceDate: "2026-09-01", ...range }).outOfRange, true);
});

test("does not block when a boundary is missing", () => {
  assert.equal(validateInvoiceProjectDate({
    invoiceDate: "2026-09-01",
    projectStartDate: "2026-08-01",
    projectEndDate: null,
  }).outOfRange, false);
});
```

- [ ] **Step 2: Run tests and observe the expected failure**

Run:

```bash
node --test test/project-date-validation.test.js
```

Expected: FAIL because `lib/project-date-validation.js` does not exist.

- [ ] **Step 3: Implement the pure validator**

Create:

```js
function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function validateInvoiceProjectDate({
  invoiceDate,
  projectStartDate,
  projectEndDate,
}) {
  const invoice = normalizeDate(invoiceDate);
  const start = normalizeDate(projectStartDate);
  const end = normalizeDate(projectEndDate);

  if (!invoice || !start || !end) return { outOfRange: false };

  return {
    outOfRange: invoice < start || invoice > end,
    invoiceDate: invoice,
    projectStartDate: start,
    projectEndDate: end,
  };
}
```

- [ ] **Step 4: Enable the repository test command**

Change `package.json`:

```json
"scripts": {
  "test": "node --test test/*.test.js",
  "start": "node server.js"
}
```

- [ ] **Step 5: Run all tests**

Run:

```bash
npm test
```

Expected: the existing export ZIP test and all project-date tests pass.

- [ ] **Step 6: Commit validator**

```bash
git add lib/project-date-validation.js test/project-date-validation.test.js package.json
git commit -m "add project date range validator"
```

---

### Task 3: Enforce Validation in the Existing Manage API

**Files:**
- Modify: `api/manage.js`
- Test: `test/project-date-validation.test.js`

**Interfaces:**
- Consumes: `allow_out_of_range` in the existing POST body
- Produces: HTTP 409 with `code: "INVOICE_DATE_OUTSIDE_PROJECT_RANGE"` and a `warning` object

- [ ] **Step 1: Add an override behavior test**

Extend the validator tests with:

```js
test("returns normalized dates for an out-of-range warning", () => {
  assert.deepEqual(
    validateInvoiceProjectDate({ invoiceDate: "2026-09-01", ...range }),
    {
      outOfRange: true,
      invoiceDate: "2026-09-01",
      projectStartDate: "2026-08-01",
      projectEndDate: "2026-08-31",
    },
  );
});
```

- [ ] **Step 2: Run the test**

Run:

```bash
npm test
```

Expected: PASS, confirming the API warning payload can use normalized values.

- [ ] **Step 3: Add validation to `api/manage.js`**

Import the validator and destructure the override flag:

```js
import { validateInvoiceProjectDate } from "../lib/project-date-validation.js";

const {
  action,
  sheet: tableKey,
  rowNumber,
  data,
  allow_out_of_range: allowOutOfRange,
} = body;
```

Before updating an invoice:

```js
if (tableKey === "main" && !allowOutOfRange) {
  const projectCode = updateData.charge_to_project;
  const invoiceDate = updateData.invoice_date;

  if (projectCode && invoiceDate) {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("project_code, project_name, create_date, end_date")
      .eq("project_code", projectCode)
      .maybeSingle();

    if (projectError) {
      return json(res, 500, { success: false, message: projectError.message });
    }

    if (project) {
      const warning = validateInvoiceProjectDate({
        invoiceDate,
        projectStartDate: project.create_date,
        projectEndDate: project.end_date,
      });

      if (warning.outOfRange) {
        return json(res, 409, {
          success: false,
          code: "INVOICE_DATE_OUTSIDE_PROJECT_RANGE",
          warning: {
            ...warning,
            projectCode: project.project_code,
            projectName: project.project_name,
          },
        });
      }
    }
  }
}
```

- [ ] **Step 4: Run syntax and unit checks**

Run:

```bash
node --check api/manage.js
npm test
```

Expected: both commands succeed.

---

### Task 4: Add Save-Time Confirmation in the Frontend

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: API 409 warning response
- Produces: a retry with `allow_out_of_range: true` only after user confirmation

- [ ] **Step 1: Extract the existing save request into a retryable function**

Inside `saveRecordChanges`, use:

```js
const postUpdate = async (allowOutOfRange = false) => {
  const response = await fetch("/api/manage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "update",
      sheet: "main",
      rowNumber,
      data,
      allow_out_of_range: allowOutOfRange,
    }),
  });
  return { response, json: await response.json() };
};
```

- [ ] **Step 2: Handle the warning and explicit retry**

Replace the one-shot response handling with:

```js
let result = await postUpdate();

if (
  result.response.status === 409 &&
  result.json.code === "INVOICE_DATE_OUTSIDE_PROJECT_RANGE"
) {
  const warning = result.json.warning;
  const proceed = confirm(
    `Invoice date ${warning.invoiceDate} is outside project ` +
    `${warning.projectCode} (${warning.projectStartDate} to ${warning.projectEndDate}).\n\n` +
    "Save anyway?"
  );

  if (!proceed) return;
  result = await postUpdate(true);
}

if (result.json.success) {
  await loadReviewRecords();
} else {
  alert("Failed to save: " + result.json.message);
}
```

- [ ] **Step 3: Run static checks**

Run:

```bash
node --check public/app.js
npm test
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 4: Commit API and frontend integration**

```bash
git add api/manage.js public/app.js
git commit -m "warn when invoice date is outside project range"
```

---

### Task 5: Deploy and Verify

**Files:**
- No additional source changes

**Interfaces:**
- Produces: updated `main` branch and Vercel production deployment

- [ ] **Step 1: Push commits**

```bash
git push origin main
```

- [ ] **Step 2: Verify deployment**

Confirm production serves the new `INVOICE_DATE_OUTSIDE_PROJECT_RANGE` code in `app.js` and that the latest commit is deployed.

- [ ] **Step 3: Verify production behavior**

Use an existing invoice/project pair or a non-mutating API-level test fixture:

- invoice date equal to project start: save succeeds without warning;
- invoice date equal to project end: save succeeds without warning;
- invoice date before/after range: first request returns 409;
- retry with `allow_out_of_range: true`: save succeeds.

- [ ] **Step 4: Verify data**

Run:

```sql
select id, invoice_date, amount, currency, amount_hkd
from public.invoices
where deleted_at is null
  and invoice_date >= date '2026-09-01'
  and invoice_date < date '2026-10-01'
order by id;
```

Expected: all 12 formerly missing values are non-zero.
