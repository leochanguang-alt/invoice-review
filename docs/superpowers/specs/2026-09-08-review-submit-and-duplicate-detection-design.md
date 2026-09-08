# Direct Review Submit and Duplicate Detection

## Scope

1. Collapse Invoice Review into a single page: mark invoices as reviewed, then submit them in one step. Remove the Modify and Submit tabs.
2. Detect likely duplicate invoices during review and remind the user to delete extras. Do not block submit.

## Review Submit

The current three-tab flow is Review (`Waiting for Confirm` → `Confirmed`) → Modify (`Confirmed`) → Submit (`Confirmed` → `Submitted` with numbering and archive).

The new flow:

- One Review Invoice page. No Modify or Submit tabs.
- The list shows invoices whose status is `Waiting for Confirm` (any "waiting" variant) or `Confirmed`, so in-flight Confirmed invoices are not stranded.
- Users still click Review to mark rows, edit details in the right panel, and Delete as today.
- **Submit Reviewed** submits only marked rows through the existing `/api/submit` path (reserve number, archive file, set `Submitted`). Required-field validation that currently runs before Confirm still runs before submit.
- Status does not need to pass through `Confirmed`. `/api/confirm` remains in the codebase but is unused by this page.
- Because Confirm is skipped, `/api/submit` must fill `amount_hkd` when it is missing or zero, using the same month-rate lookup Confirm used.
- Navigating away with unsubmitted Review marks warns that the marks will be lost.
- Select All / Deselect All continue to operate on Review marks.

## Duplicate Detection

A pair of invoices is a likely duplicate when all of the following match after normalization:

- vendor (trim, lowercase, collapse internal whitespace)
- amount (numeric, 2 decimal places)
- currency (uppercase)
- invoice date (`YYYY-MM-DD`)
- invoice number, **only if both records have a non-empty invoice number**

Do not match when vendor, amount, currency, or date is missing. A record is never a duplicate of itself. Compare against all non-deleted invoices, including already Submitted ones.

Normalization includes currency because the same numeric amount in USD and HKD is not the same invoice.

## Duplicate UX

- Compute matches on the server when mapping `/api/expenses` rows.
- In the Review list, flag rows that have at least one match. Show a visible "Possible duplicate" badge and a short explanation (other invoice id, status, and invoice ID if present).
- Repeat the warning in the detail panel when that row is selected.
- Submit is not blocked. The existing Delete action is how the user removes extras.

## Error Handling

- Submit keeps per-record progress and existing failure messages.
- Duplicate matching failures must not break the expenses list: if annotation throws, return unannotated rows rather than a 500.
- Missing exchange rates leave `amount_hkd` unset; submit still proceeds, matching current Confirm behavior when no rate exists.

## Verification

- Unit tests cover duplicate matching (including invoice-number gating, missing fields, and submitted counterparts).
- Unit tests cover reviewable status filtering.
- Unit tests cover `amount_hkd` computation helpers.
- Browser: Review Invoice has one page, Submit Reviewed is visible, duplicate badge appears on a synthetic match, Modify/Submit tabs are gone.
