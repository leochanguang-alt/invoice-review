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

test("migration safely parses legacy IDs for hyphenated project codes", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(sql, /length\s*\(\s*p_project_code\s*\)\s*\+\s*2/i);
    assert.match(sql, /left\s*\(\s*i\.generated_invoice_id\s*,\s*length\s*\(\s*p_project_code\s*\)\s*\+\s*1\s*\)\s*=\s*p_project_code\s*\|\|\s*'-'/i);
    assert.doesNotMatch(sql, /split_part\s*\(\s*[^,]+,\s*'-'\s*,/i);
});

test("migration keeps private counters outside the Data API and narrows privileges", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(sql, /revoke all on function public\.reserve_invoice_number\(bigint,\s*text,\s*numeric,\s*text\) from public/i);
    assert.match(sql, /grant execute on function public\.reserve_invoice_number\(bigint,\s*text,\s*numeric,\s*text\)\s+to anon,\s*authenticated/i);
    assert.match(sql, /revoke all on schema private from public/i);
    assert.match(sql, /grant usage on schema private to anon,\s*authenticated/i);
    assert.match(sql, /grant select,\s*insert,\s*update on table private\.project_invoice_counters to anon,\s*authenticated/i);
    assert.doesNotMatch(sql, /pgrst\.db_schemas|exposed_schemas/i);
});

test("migration validates inputs and preserves one reservation per invoice", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    assert.match(sql, /p_project_code\s+is\s+null[\s\S]*btrim\s*\(\s*p_project_code\s*\)\s*=\s*''/i);
    assert.match(sql, /charge_to_project\s*=\s*p_project_code/i);
    assert.match(sql, /if\s+v_project_sequence\s+is\s+not\s+null[\s\S]*return query/is);
    assert.match(sql, /greatest\s*\([\s\S]*max\s*\(\s*i\.project_sequence\s*\)[\s\S]*max\s*\([\s\S]*generated_invoice_id/is);
});
