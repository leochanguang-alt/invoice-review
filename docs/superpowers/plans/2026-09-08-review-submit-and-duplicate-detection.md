# Direct Review Submit and Duplicate Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users review invoices and submit them on one page, and warn about likely duplicate invoices without blocking submit.

**Architecture:** Add a pure duplicate matcher used by `/api/expenses`. Collapse the Review Invoice UI onto one queue (`Waiting` + `Confirmed`) with a Submit Reviewed button that calls existing `/api/submit`. Move `amount_hkd` backfill into submit so skipping Confirm does not drop HKD amounts.

**Tech Stack:** Node.js ESM, `node:test`, Express `/api/*` handlers, vanilla `public/app.js`.

## Global Constraints

- Do not require `Confirmed` before submit.
- Duplicate warnings never block submit or delete.
- Do not auto-delete duplicates.
- Do not commit unless the user asks.

---

### Task 1: Duplicate matcher

**Files:**
- Create: `lib/invoice-duplicates.js`
- Create: `test/invoice-duplicates.test.js`
- Modify: `api/expenses.js`

**Interfaces:**
- Produces: `annotateDuplicates(records)`, `invoicesAreDuplicates(a, b)`, `isReviewableStatus(status)`

- [ ] Write failing tests for matcher and reviewable status
- [ ] Implement matcher and annotate `/api/expenses` rows with `duplicate_matches`
- [ ] Run `node --test test/invoice-duplicates.test.js`

### Task 2: amount_hkd on submit

**Files:**
- Create: `lib/currency-hkd.js`
- Create: `test/currency-hkd.test.js`
- Modify: `api/submit.js`
- Modify: `api/confirm.js` (import shared lookup)

- [ ] Write failing tests for `needsAmountHkd` / `computeAmountHkd`
- [ ] Implement helpers and call them from submit (and confirm)

### Task 3: Single-page Review Invoice UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

- [ ] Remove Modify/Submit tabs
- [ ] Show Submit Reviewed on the review list; submit `reviewedRows`
- [ ] Filter queue to waiting + confirmed
- [ ] Warn on navigation if marks are unsubmitted
- [ ] Render duplicate badge and detail warning
