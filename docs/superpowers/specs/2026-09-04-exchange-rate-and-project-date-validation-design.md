# Exchange Rate Backfill and Project Date Validation

## Scope

1. Add exchange rates dated `2026-09-01`.
2. Backfill `amount_hkd` for the 12 September 2026 invoices that currently lack it.
3. Warn during Review Invoice save when an invoice date is outside the selected project's date range.

The four invoices whose years were parsed as 2020-2023 are not part of the automatic HKD backfill. Their dates require user review.

## Exchange Rate Update

Call the existing `/api/update-rates?force=true` endpoint. It reads all configured currencies from `currency_list`, fetches current rates to HKD, and upserts them into `currency_rates` with `rate_date = 2026-09-01`.

Verify that GBP, CNY, USD, and EUR rates exist before backfilling invoices.

## HKD Backfill

Update only active invoices that:

- have an invoice date in September 2026;
- have a non-null amount and currency;
- currently have a null or zero `amount_hkd`; and
- have a matching `2026-09-01` currency rate.

Calculate `amount_hkd = round(amount * rate_to_hkd, 2)`. The expected update count is exactly 12; abort and investigate if the candidate count differs.

## Project Date Validation

Validation occurs when the user clicks Save in Review Invoice.

The existing `/api/manage` update action will:

1. Resolve the selected project by `project_code`.
2. Compare the submitted invoice date against `projects.create_date` and `projects.end_date`.
3. Treat both boundaries as inclusive.
4. Return HTTP 409 with structured project and date information when the invoice is outside the range.
5. Accept an explicit `allow_out_of_range: true` flag to save after user confirmation.

The frontend will display a confirmation dialog containing the invoice date and project range. Cancel leaves the record unchanged. Continue retries the same save with the override flag.

If the project does not have both boundary dates, validation does not block the save.

## Error Handling

- Normal validation warnings use HTTP 409 and do not mutate the invoice.
- Database or lookup errors remain operational errors and do not offer an override.
- Existing saves within range retain their current behavior.

## Verification

- Unit tests cover inclusive boundaries, before-range, after-range, missing dates, and explicit override.
- Confirm the 12 target records contain non-zero `amount_hkd`.
- Verify production saves inside range without a warning.
- Verify production saves outside range only after user confirmation.
