import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
    "../supabase/migrations/20260904195000_add_atomic_invoice_sequences.sql",
    import.meta.url,
);

test("migration defines private atomic counters and idempotent reservation", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(sql, /create schema if not exists private/i);
    assert.match(sql, /create table if not exists private\.project_invoice_counters/is);
    assert.match(sql, /select[\s\S]*from public\.invoices[\s\S]*for update/is);
    assert.match(sql, /insert into private\.project_invoice_counters[\s\S]*on conflict\s*\(\s*project_code\s*\)\s*do nothing/is);
    assert.match(sql, /update private\.project_invoice_counters[\s\S]*returning last_sequence/is);
    assert.match(sql, /security invoker\s+set search_path\s*=\s*''/i);
    assert.match(sql, /create unique index if not exists invoices_project_sequence_unique[\s\S]*charge_to_project\s*,\s*project_sequence/is);
});

test("migration parses the first sequence after the current project prefix even if amount changed", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(
        sql,
        /when\s+left\s*\(\s*i\.generated_invoice_id\s*,\s*length\s*\(\s*v_project_code\s*\)\s*\+\s*1\s*\)\s*=\s*v_project_code\s*\|\|\s*'-'[\s\S]*substring\s*\(\s*substring\s*\(\s*i\.generated_invoice_id\s+from\s+length\s*\(\s*v_project_code\s*\)\s*\+\s*2\s*\)\s+from\s+'\^\(\[0-9\]\{1,7\}\)-'\s*\)::integer/is,
    );
    assert.doesNotMatch(sql, /generated_invoice_id\s+like\s+/i);
});

test("migration parses renamed projects only after matching the row amount and currency suffix", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(
        sql,
        /floor\s*\(\s*coalesce\s*\(\s*i\.amount\s*,\s*0\s*\)\s*\+\s*0\.5\s*\)\s+as\s+rounded_amount/i,
    );
    assert.match(
        sql,
        /upper\s*\(\s*btrim\s*\(\s*coalesce\s*\(\s*i\.currency\s*,\s*''\s*\)\s*\)\s*\)\s+as\s+normalized_currency/i,
    );
    assert.match(
        sql,
        /right\s*\(\s*i\.generated_invoice_id\s*,\s*length\s*\(\s*history_suffix\.current_suffix\s*\)\s*\)\s*=\s*history_suffix\.current_suffix/i,
    );
    assert.match(
        sql,
        /left\s*\(\s*i\.generated_invoice_id\s*,\s*length\s*\(\s*i\.generated_invoice_id\s*\)\s*-\s*length\s*\(\s*history_suffix\.current_suffix\s*\)\s*\)[\s\S]*from\s+'-\(\[0-9\]\{1,7\}\)\$'/is,
    );
    assert.match(
        sql,
        /grant select\s*\([^)]*\bamount\b[^)]*\bcurrency\b[^)]*\)\s+on table public\.invoices/is,
    );
});

test("migration does not mistake a four-part legacy ID amount for its sequence", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.doesNotMatch(
        sql,
        /generated_invoice_id\s+from\s+'-\(\[0-9\]\{1,7\}\)-\[\^-\]\+\$'/i,
    );
    assert.match(sql, /history_suffix\.current_suffix/i);
    assert.doesNotMatch(sql, /unique[\s\S]{0,100}generated_invoice_id/i);
});

test("migration supports current and legacy negative amount suffixes", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(
        sql,
        /then\s+'m'\s*\|\|\s*abs\s*\(\s*history_amount\.rounded_amount\s*\)::text[\s\S]*as\s+current_suffix/is,
    );
    assert.match(
        sql,
        /'-'\s*\|\|\s*history_amount\.rounded_amount::text[\s\S]*as\s+legacy_suffix/is,
    );
    assert.match(
        sql,
        /history_amount\.rounded_amount\s*<\s*0[\s\S]*right\s*\([^)]*generated_invoice_id[\s\S]*history_suffix\.legacy_suffix/is,
    );
});

test("migration keeps private counters outside the Data API and narrows privileges", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(sql, /revoke all on function public\.reserve_invoice_number\(bigint,\s*text,\s*numeric,\s*text\) from public/i);
    assert.match(sql, /grant execute on function public\.reserve_invoice_number\(bigint,\s*text,\s*numeric,\s*text\)\s+to anon,\s*authenticated/i);
    assert.match(sql, /revoke all on schema private from public/i);
    assert.match(sql, /grant usage on schema private to anon,\s*authenticated,\s*service_role/i);
    assert.match(sql, /grant select,\s*insert,\s*update on table private\.project_invoice_counters\s+to anon,\s*authenticated,\s*service_role/i);
    assert.match(sql, /grant execute on function public\.reserve_invoice_number\(bigint,\s*text,\s*numeric,\s*text\)\s+to service_role/i);
    assert.match(sql, /security:[^\n]*private[^\n]*never[^\n]*postgrest[^\n]*exposed schemas/i);
    assert.doesNotMatch(sql, /pgrst\.db_schemas|exposed_schemas/i);
});

test("migration normalizes project codes and preserves one reservation per invoice", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(sql, /v_project_code\s*:=\s*btrim\s*\(\s*p_project_code\s*\)/i);
    assert.match(sql, /v_project_code\s+is\s+null[\s\S]*v_project_code\s*=\s*''/i);
    assert.match(sql, /charge_to_project\s*=\s*v_project_code/i);
    assert.match(sql, /where project_code\s*=\s*v_project_code/i);
    assert.doesNotMatch(sql, /charge_to_project\s*=\s*p_project_code/i);
    assert.match(sql, /if\s+v_project_sequence\s+is\s+not\s+null[\s\S]*return query/is);
    assert.match(sql, /greatest\s*\([\s\S]*max\s*\(\s*i\.project_sequence\s*\)[\s\S]*max\s*\([\s\S]*generated_invoice_id/is);
});

test("migration matches JavaScript rounding for negative halves", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(
        sql,
        /v_rounded_amount\s*:=\s*floor\s*\(\s*coalesce\s*\(\s*p_amount\s*,\s*0\s*\)\s*\+\s*0\.5\s*\)/i,
    );
    assert.doesNotMatch(sql, /\bround\s*\(/i);
});

test("migration rejects deleted invoices and updates the invoice timestamp", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(
        sql,
        /from public\.invoices as i[\s\S]*i\.deleted_at\s+is\s+null[\s\S]*for update/is,
    );
    assert.match(
        sql,
        /update public\.invoices as i[\s\S]*set project_sequence\s*=\s*v_project_sequence[\s\S]*updated_at\s*=\s*now\s*\(\s*\)/is,
    );
    assert.match(
        sql,
        /grant select\s*\(\s*id\s*,\s*charge_to_project\s*,\s*project_sequence\s*,\s*generated_invoice_id\s*,\s*deleted_at\b/i,
    );
});
