import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
    DeleteObjectCommand,
    HeadObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

import { copyAndVerifyArchive } from "../lib/invoice-archive.js";
import {
    buildRenumberManifest,
    extensionFromOldKey,
    formatInvoiceId,
} from "../lib/invoice-numbering.js";

export const PROJECT_CODE = "Neoss-MoEx-2608";
export const RUN_ID = "20260904";
export const EXPECTED_INVOICE_COUNT = 35;
export const MANIFEST_VERSION = 1;
const MAX_MANIFEST_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const OUTPUT_DIRECTORY = "tmp/renumber-project-invoices";
export const HELP_TEXT = `Usage:
  node scripts/renumber-project-invoices.js --project ${PROJECT_CODE}
  node scripts/renumber-project-invoices.js --manifest <path> --stage
  node scripts/renumber-project-invoices.js --manifest <path> --finalize
  node scripts/renumber-project-invoices.js --manifest <path> --verify
  node scripts/renumber-project-invoices.js --manifest <path> --cleanup --db-verified

Default project mode is dry-run. Cleanup requires both --cleanup and the
explicit --db-verified confirmation after independent database verification.`;

function requireNonEmpty(value, label) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${label} is required`);
    }
}

function uniqueValues(rows, property) {
    return new Set(rows.map(row => row[property]));
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, canonicalize(value[key])]),
        );
    }
    return value;
}

export function calculateManifestDigest(manifest) {
    const { contentDigest: _contentDigest, ...unsigned } = manifest;
    return `sha256:${createHash("sha256")
        .update(JSON.stringify(canonicalize(unsigned)))
        .digest("hex")}`;
}

export function createManifestEnvelope({ projectCode, runId, createdAt, rows }) {
    const manifest = {
        version: MANIFEST_VERSION,
        projectCode,
        runId,
        createdAt,
        rows,
    };
    return {
        ...manifest,
        contentDigest: calculateManifestDigest(manifest),
    };
}

function compareManifestRows(a, b) {
    if (a.invoiceDate == null && b.invoiceDate == null) {
        return a.invoiceId - b.invoiceId;
    }
    if (a.invoiceDate == null) return 1;
    if (b.invoiceDate == null) return -1;
    return a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceId - b.invoiceId;
}

export function validateManifest(manifest, {
    now = new Date(),
    maxAgeMs = MAX_MANIFEST_AGE_MS,
} = {}) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error("manifest must be an integrity envelope");
    }
    const manifestFields = [
        "contentDigest",
        "createdAt",
        "projectCode",
        "rows",
        "runId",
        "version",
    ];
    const unknownManifestField = Object.keys(manifest)
        .find(key => !manifestFields.includes(key));
    if (unknownManifestField) {
        throw new Error(`unknown manifest field: ${unknownManifestField}`);
    }
    if (manifest.version !== MANIFEST_VERSION) {
        throw new Error(`manifest version must be ${MANIFEST_VERSION}`);
    }
    if (manifest.projectCode !== PROJECT_CODE) {
        throw new Error(`manifest projectCode must be ${PROJECT_CODE}`);
    }
    if (manifest.runId !== RUN_ID || !/^\d{8}$/.test(manifest.runId)) {
        throw new Error(`manifest runId must be ${RUN_ID}`);
    }
    const createdAtMs = Date.parse(manifest.createdAt);
    const nowMs = new Date(now).getTime();
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) {
        throw new Error("manifest createdAt is invalid");
    }
    if (new Date(createdAtMs).toISOString() !== manifest.createdAt) {
        throw new Error("manifest createdAt must be a canonical ISO timestamp");
    }
    if (manifest.createdAt.slice(0, 10).replaceAll("-", "") !== manifest.runId) {
        throw new Error("manifest createdAt does not belong to runId");
    }
    if (createdAtMs > nowMs + MAX_FUTURE_SKEW_MS) {
        throw new Error("manifest createdAt is in the future");
    }
    if (nowMs - createdAtMs > maxAgeMs) {
        throw new Error("manifest has expired");
    }
    if (manifest.contentDigest !== calculateManifestDigest(manifest)) {
        throw new Error("manifest content digest mismatch");
    }

    const rows = manifest.rows;
    if (!Array.isArray(rows) || rows.length !== EXPECTED_INVOICE_COUNT) {
        throw new Error(`manifest must contain exactly ${EXPECTED_INVOICE_COUNT} rows`);
    }

    const requiredStrings = [
        "oldKey",
        "generatedInvoiceId",
        "newKey",
        "stagingKey",
    ];
    const rowFields = [
        "amount",
        "currency",
        "generatedInvoiceId",
        "invoiceDate",
        "invoiceId",
        "newKey",
        "oldKey",
        "sequence",
        "sourceChecksumSHA256",
        "sourceETag",
        "sourceSize",
        "stagingKey",
    ];
    for (const [index, row] of rows.entries()) {
        if (!row || typeof row !== "object") {
            throw new Error(`manifest row ${index + 1} must be an object`);
        }
        const unknownRowField = Object.keys(row).find(key => !rowFields.includes(key));
        if (unknownRowField) {
            throw new Error(`manifest row ${index + 1} has unknown field ${unknownRowField}`);
        }
        if (!Number.isSafeInteger(row.invoiceId) || row.invoiceId <= 0) {
            throw new Error(`manifest row ${index + 1} has invalid invoiceId`);
        }
        if (!Object.hasOwn(row, "invoiceDate")
            || (row.invoiceDate !== null
                && (typeof row.invoiceDate !== "string"
                    || !/^\d{4}-\d{2}-\d{2}$/.test(row.invoiceDate)
                    || Number.isNaN(Date.parse(`${row.invoiceDate}T00:00:00.000Z`))
                    || new Date(`${row.invoiceDate}T00:00:00.000Z`)
                        .toISOString()
                        .slice(0, 10) !== row.invoiceDate))) {
            throw new Error(`manifest row ${index + 1} has invalid invoiceDate`);
        }
        if (row.sequence !== index + 1) {
            throw new Error("manifest sequences must be contiguous from 1 through 35");
        }
        if (typeof row.amount !== "number" || !Number.isFinite(row.amount)) {
            throw new Error(`manifest row ${index + 1} has invalid amount`);
        }
        if (typeof row.currency !== "string"
            || !/^[A-Z]{3}$/.test(row.currency)) {
            throw new Error(`manifest row ${index + 1} has invalid currency`);
        }
        for (const property of requiredStrings) {
            requireNonEmpty(row[property], `manifest row ${index + 1} ${property}`);
        }
        const oldPrefix = `bui_invoice/projects/${manifest.projectCode}/`;
        const oldRelativeKey = row.oldKey.slice(oldPrefix.length);
        if (!row.oldKey.startsWith(oldPrefix)
            || !oldRelativeKey
            || oldRelativeKey.startsWith(".renumber-")) {
            throw new Error(`manifest row ${index + 1} oldKey prefix is invalid`);
        }
        if (row.oldKey.includes("\\")
            || row.oldKey.split("/").some(part => part === "." || part === "..")
            || /[\u0000-\u001f\u007f]/.test(row.oldKey)) {
            throw new Error(`manifest row ${index + 1} oldKey is unsafe`);
        }
        if (!Number.isSafeInteger(row.sourceSize) || row.sourceSize <= 0) {
            throw new Error(`manifest row ${index + 1} has invalid sourceSize`);
        }
        requireNonEmpty(row.sourceETag, `manifest row ${index + 1} sourceETag`);
        if (row.sourceChecksumSHA256 !== null
            && (typeof row.sourceChecksumSHA256 !== "string"
                || row.sourceChecksumSHA256.length === 0)) {
            throw new Error(`manifest row ${index + 1} has invalid sourceChecksumSHA256`);
        }

        const expectedGeneratedInvoiceId = formatInvoiceId({
            projectCode: manifest.projectCode,
            sequence: row.sequence,
            amount: row.amount,
            currency: row.currency,
        });
        const extension = extensionFromOldKey(row.oldKey);
        const expectedNewKey = `bui_invoice/projects/${manifest.projectCode}/${expectedGeneratedInvoiceId}${extension}`;
        const expectedStagingKey = `bui_invoice/projects/${manifest.projectCode}/.renumber-${manifest.runId}/${expectedGeneratedInvoiceId}${extension}`;
        if (row.generatedInvoiceId !== expectedGeneratedInvoiceId) {
            throw new Error(`manifest row ${index + 1} generatedInvoiceId mismatch`);
        }
        if (row.newKey !== expectedNewKey) {
            throw new Error(`manifest row ${index + 1} newKey mismatch`);
        }
        if (row.stagingKey !== expectedStagingKey) {
            throw new Error(`manifest row ${index + 1} stagingKey mismatch`);
        }
    }

    for (const property of ["invoiceId", "sequence", "oldKey", "newKey", "stagingKey"]) {
        if (uniqueValues(rows, property).size !== EXPECTED_INVOICE_COUNT) {
            throw new Error(`manifest contains duplicate ${property}`);
        }
    }
    const stagingKeys = uniqueValues(rows, "stagingKey");
    if (rows.some(row => stagingKeys.has(row.oldKey) || stagingKeys.has(row.newKey))) {
        throw new Error("manifest staging keys must be disjoint from old and final keys");
    }

    const ordered = [...rows].sort(compareManifestRows);
    if (ordered.some((row, index) => row !== rows[index])) {
        throw new Error("manifest rows must be ordered by invoiceDate then invoiceId");
    }

    return manifest;
}

async function inspectAllSources({ rows, keyProperty, r2Client, bucketName }) {
    const inspections = await Promise.allSettled(rows.map(row =>
        r2Client.send(new HeadObjectCommand({
            Bucket: bucketName,
            Key: row[keyProperty],
            ChecksumMode: "ENABLED",
        }))));

    const errors = [];
    const metadata = inspections.map((inspection, index) => {
        if (inspection.status === "rejected") {
            errors.push(`${rows[index][keyProperty]}: ${inspection.reason?.message || "HeadObject failed"}`);
            return null;
        }
        const size = Number(inspection.value?.ContentLength);
        if (!(size > 0)) {
            errors.push(`${rows[index][keyProperty]}: missing or empty`);
            return null;
        }
        const etag = String(inspection.value?.ETag || "").replace(/^"|"$/g, "");
        if (!etag) {
            errors.push(`${rows[index][keyProperty]}: ETag is unavailable`);
            return null;
        }
        return {
            size,
            etag,
            checksumSHA256: inspection.value?.ChecksumSHA256 || null,
        };
    });
    if (errors.length > 0) {
        throw new Error(`source preflight failed:\n${errors.join("\n")}`);
    }
    return metadata;
}

export async function buildDryRunManifest({
    invoices,
    projectCode,
    runId,
    r2Client,
    bucketName,
    createdAt = new Date().toISOString(),
}) {
    if (!Array.isArray(invoices) || invoices.length !== EXPECTED_INVOICE_COUNT) {
        throw new Error(`expected exactly ${EXPECTED_INVOICE_COUNT} active invoices`);
    }

    const invoicesById = new Map(invoices.map(invoice => [invoice.id, invoice]));
    const rows = buildRenumberManifest(invoices, projectCode).map(row => {
        const source = invoicesById.get(row.invoiceId);
        requireNonEmpty(row.oldKey, `invoice ${row.invoiceId} achieved_file_id`);
        const filename = row.newKey.slice(row.newKey.lastIndexOf("/") + 1);
        return {
            invoiceId: row.invoiceId,
            invoiceDate: source.invoice_date || null,
            sequence: row.sequence,
            amount: Number(String(source.amount).replaceAll(",", "")),
            currency: String(source.currency || "").trim().toUpperCase(),
            oldKey: row.oldKey,
            generatedInvoiceId: row.generatedInvoiceId,
            newKey: row.newKey,
            stagingKey: `bui_invoice/projects/${projectCode}/.renumber-${runId}/${filename}`,
        };
    });

    const sourceMetadata = await inspectAllSources({
        rows,
        keyProperty: "oldKey",
        r2Client,
        bucketName,
    });
    const manifestRows = rows.map((row, index) => ({
        ...row,
        sourceSize: sourceMetadata[index].size,
        sourceETag: sourceMetadata[index].etag,
        sourceChecksumSHA256: sourceMetadata[index].checksumSHA256,
    }));
    const manifest = createManifestEnvelope({
        projectCode,
        runId,
        createdAt,
        rows: manifestRows,
    });
    return validateManifest(manifest);
}

export async function stageManifest({ manifest, r2Client, bucketName }) {
    validateManifest(manifest);
    const rows = manifest.rows;
    const sourceMetadata = await inspectAllSources({
        rows,
        keyProperty: "oldKey",
        r2Client,
        bucketName,
    });
    const changedSources = rows.filter((row, index) => {
        const actual = sourceMetadata[index];
        return actual.size !== row.sourceSize
            || actual.etag !== row.sourceETag
            || (row.sourceChecksumSHA256
                && actual.checksumSHA256 !== row.sourceChecksumSHA256);
    });
    if (changedSources.length > 0) {
        throw new Error(`source preflight failed: size changed for ${changedSources.map(row => row.oldKey).join(", ")}`);
    }

    for (const row of rows) {
        await copyAndVerifyArchive(r2Client, {
            bucketName,
            publicUrl: "",
            originalKey: row.oldKey,
            targetKey: row.stagingKey,
        });
        const [staged] = await inspectAllSources({
            rows: [row],
            keyProperty: "stagingKey",
            r2Client,
            bucketName,
        });
        verifyCopiedMetadata(row, staged, "staged");
    }
}

function isSinglePartContentETag(etag) {
    return /^[a-f0-9]{32}$/i.test(etag);
}

function verifyCopiedMetadata(row, actual, label) {
    if (actual.size !== row.sourceSize) {
        throw new Error(`${label} size mismatch for ${row.newKey}`);
    }
    if (row.sourceChecksumSHA256) {
        if (actual.checksumSHA256 !== row.sourceChecksumSHA256) {
            throw new Error(`${label} checksum mismatch for ${row.newKey}`);
        }
    } else if (isSinglePartContentETag(row.sourceETag)
        && actual.etag !== row.sourceETag) {
        throw new Error(`${label} ETag mismatch for ${row.newKey}`);
    }
    // Multipart ETags are not portable content hashes. With no checksum,
    // require a non-empty target ETag (enforced by inspectAllSources) plus size.
}

function normalizePublicUrl(publicUrl) {
    requireNonEmpty(publicUrl, "R2_PUBLIC_URL");
    if (publicUrl !== publicUrl.trim()) {
        throw new Error("R2_PUBLIC_URL must be a valid HTTP(S) URL");
    }
    let parsed;
    try {
        parsed = new URL(publicUrl);
    } catch {
        throw new Error("R2_PUBLIC_URL must be a valid HTTP(S) URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol)
        || parsed.username
        || parsed.password
        || parsed.search
        || parsed.hash) {
        throw new Error("R2_PUBLIC_URL must be a valid HTTP(S) URL");
    }
    return publicUrl.replace(/\/+$/, "");
}

export async function finalizeManifest({
    manifest,
    r2Client,
    bucketName,
    publicUrl,
    projectCode = PROJECT_CODE,
}) {
    validateManifest(manifest);
    const normalizedPublicUrl = normalizePublicUrl(publicUrl);
    const rows = manifest.rows;
    const stagingSizes = await inspectAllSources({
        rows,
        keyProperty: "stagingKey",
        r2Client,
        bucketName,
    });
    const changedStaging = rows.filter((row, index) => {
        try {
            verifyCopiedMetadata(row, stagingSizes[index], "staged");
            return false;
        } catch {
            return true;
        }
    });
    if (changedStaging.length > 0) {
        throw new Error(`source preflight failed: staged size changed for ${changedStaging.map(row => row.stagingKey).join(", ")}`);
    }

    for (const row of rows) {
        await copyAndVerifyArchive(r2Client, {
            bucketName,
            publicUrl: normalizedPublicUrl,
            originalKey: row.stagingKey,
            targetKey: row.newKey,
        });
        const [finalObject] = await inspectAllSources({
            rows: [row],
            keyProperty: "newKey",
            r2Client,
            bucketName,
        });
        verifyCopiedMetadata(row, finalObject, "final");
    }
    return generateGuardedSql(manifest, {
        projectCode,
        publicUrl: normalizedPublicUrl,
    });
}

export async function verifyFinalObjects({ manifest, r2Client, bucketName }) {
    validateManifest(manifest);
    const metadata = await inspectAllSources({
        rows: manifest.rows,
        keyProperty: "newKey",
        r2Client,
        bucketName,
    });
    manifest.rows.forEach((row, index) =>
        verifyCopiedMetadata(row, metadata[index], "final"));
    return metadata;
}

export async function cleanupManifest({
    manifest,
    r2Client,
    bucketName,
    dbVerified,
}) {
    if (dbVerified !== true) {
        throw new Error("explicit DB verification confirmation is required");
    }
    validateManifest(manifest);
    await verifyFinalObjects({ manifest, r2Client, bucketName });

    const rows = manifest.rows;
    const finalKeys = uniqueValues(rows, "newKey");
    const keysToDelete = [
        ...rows.map(row => row.oldKey).filter(key => !finalKeys.has(key)),
        ...rows.map(row => row.stagingKey),
    ].filter((key, index, keys) => keys.indexOf(key) === index);

    for (const key of keysToDelete) {
        await r2Client.send(new DeleteObjectCommand({
            Bucket: bucketName,
            Key: key,
        }));
    }
    return keysToDelete;
}

function sqlLiteral(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

function manifestValuesSql(manifest) {
    return manifest.rows.map(row => `    (${row.invoiceId}, ${row.sequence}, ${row.amount}, ${sqlLiteral(row.currency)}, ${sqlLiteral(row.generatedInvoiceId)}, ${sqlLiteral(row.oldKey)}, ${sqlLiteral(row.newKey)})`)
        .join(",\n");
}

export function generateGuardedSql(manifest, { projectCode, publicUrl }) {
    validateManifest(manifest);
    if (projectCode !== manifest.projectCode) {
        throw new Error("SQL projectCode does not match manifest");
    }
    const normalizedPublicUrl = normalizePublicUrl(publicUrl);
    const values = manifestValuesSql(manifest);

    return `-- Submit this entire script in one Supabase execute_sql call.
-- PostgreSQL executes the multi-statement request as one implicit transaction.
create temporary table renumber_manifest (
  invoice_id bigint primary key,
  project_sequence integer not null,
  amount numeric not null,
  currency text not null,
  generated_invoice_id text not null,
  old_key text not null,
  new_key text not null
) on commit drop;

insert into renumber_manifest values
${values};

create temporary table renumber_config (
  project_code text not null,
  public_url text not null
) on commit drop;

insert into renumber_config values
  (${sqlLiteral(projectCode)}, ${sqlLiteral(normalizedPublicUrl)});

lock table public.invoices in share row exclusive mode;

do $renumber_update$
declare
  active_rows integer;
  changed_rows integer;
  current_counter integer;
begin
  perform 1
  from public.invoices
  where charge_to_project = (select project_code from renumber_config)
    and deleted_at is null
  order by id
  for update;

  select count(*) into active_rows
  from public.invoices
  where charge_to_project = (select project_code from renumber_config)
    and deleted_at is null;
  if active_rows <> 35 then
    raise exception 'project must have exactly 35 active invoices, found %', active_rows;
  end if;

  if exists (
    select 1
    from renumber_manifest as m
    left join public.invoices as i
      on i.id = m.invoice_id
      and i.charge_to_project = (select project_code from renumber_config)
      and i.deleted_at is null
    where i.id is null
      or i.achieved_file_id is distinct from m.old_key
      or i.amount is distinct from m.amount
      or upper(btrim(coalesce(i.currency, ''))) is distinct from m.currency
  ) then
    raise exception 'invoice old key, amount, or currency guard failed';
  end if;

  if (
    select count(distinct project_sequence) = 35
      and min(project_sequence) = 1
      and max(project_sequence) = 35
    from renumber_manifest
  ) is not true then
    raise exception 'manifest sequences are not exactly 1 through 35';
  end if;

  insert into private.project_invoice_counters (
    project_code,
    last_sequence,
    updated_at
  )
  values (
    (select project_code from renumber_config),
    35,
    now()
  )
  on conflict (project_code) do nothing;

  select last_sequence into current_counter
  from private.project_invoice_counters
  where project_code = (select project_code from renumber_config)
  for update;

  if current_counter > 35 then
    raise exception 'project counter % is already greater than 35', current_counter;
  end if;

  update public.invoices as i
  set project_sequence = null,
      updated_at = now()
  from renumber_manifest as m
  where i.id = m.invoice_id
    and i.charge_to_project = (select project_code from renumber_config)
    and i.deleted_at is null
    and i.achieved_file_id = m.old_key
    and i.amount is not distinct from m.amount
    and upper(btrim(coalesce(i.currency, ''))) is not distinct from m.currency;

  get diagnostics changed_rows = row_count;
  if changed_rows <> 35 then
    raise exception 'expected to clear 35 invoice sequences, cleared %', changed_rows;
  end if;

  update public.invoices as i
  set project_sequence = m.project_sequence,
      generated_invoice_id = m.generated_invoice_id,
      achieved_file_id = m.new_key,
      achieved_file_link = (select public_url from renumber_config) || '/' || m.new_key,
      updated_at = now()
  from renumber_manifest as m
  where i.id = m.invoice_id
    and i.charge_to_project = (select project_code from renumber_config)
    and i.deleted_at is null
    and i.achieved_file_id = m.old_key
    and i.amount is not distinct from m.amount
    and upper(btrim(coalesce(i.currency, ''))) is not distinct from m.currency;

  get diagnostics changed_rows = row_count;
  if changed_rows <> 35 then
    raise exception 'expected to update 35 invoices, updated %', changed_rows;
  end if;

  update private.project_invoice_counters
  set last_sequence = greatest(
        private.project_invoice_counters.last_sequence,
        35
      ),
      updated_at = now()
  where project_code = (select project_code from renumber_config);
end
$renumber_update$;
`;
}

function takeValue(argv, index, option) {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

export function parseCliArgs(argv) {
    let projectCode;
    let manifestPath;
    let dbVerified = false;
    const actions = [];

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--help") {
            if (argv.length !== 1) throw new Error("--help cannot be combined with other arguments");
            return { action: "help" };
        } else if (argument === "--project") {
            if (projectCode !== undefined) throw new Error("duplicate --project");
            projectCode = takeValue(argv, index, argument);
            index += 1;
        } else if (argument === "--manifest") {
            if (manifestPath !== undefined) throw new Error("duplicate --manifest");
            manifestPath = takeValue(argv, index, argument);
            index += 1;
        } else if (["--stage", "--finalize", "--verify", "--cleanup"].includes(argument)) {
            actions.push(argument.slice(2));
        } else if (argument === "--db-verified") {
            if (dbVerified) throw new Error("duplicate --db-verified");
            dbVerified = true;
        } else {
            throw new Error(`unknown argument: ${argument}`);
        }
    }

    if (actions.length > 1) {
        throw new Error("specify exactly one action");
    }
    const action = actions[0] || "dry-run";
    if (action === "dry-run") {
        if (!projectCode) throw new Error("--project is required for dry-run");
        if (projectCode !== PROJECT_CODE) throw new Error(`--project must be ${PROJECT_CODE}`);
        if (manifestPath || dbVerified) throw new Error("--manifest and --db-verified are invalid for dry-run");
        return { action, projectCode };
    }
    if (!manifestPath) throw new Error("--manifest is required for R2 actions");
    if (projectCode) throw new Error("--project is invalid when --manifest is supplied");
    if (action === "cleanup" && !dbVerified) {
        throw new Error("--db-verified is required for cleanup");
    }
    if (action !== "cleanup" && dbVerified) {
        throw new Error("--db-verified is valid only with --cleanup");
    }
    return { action, manifestPath, dbVerified };
}

function loadEnvironment() {
    dotenv.config({ path: ".env.local" });
    dotenv.config({ path: ".env" });
}

function createR2Client() {
    for (const name of [
        "R2_ENDPOINT",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_NAME",
    ]) {
        requireNonEmpty(process.env[name], name);
    }
    return new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
}

async function loadManifest(manifestPath) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    return validateManifest(manifest);
}

async function queryInvoices(projectCode) {
    requireNonEmpty(process.env.SUPABASE_URL, "SUPABASE_URL");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    requireNonEmpty(key, "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY");
    const supabase = createClient(process.env.SUPABASE_URL, key);
    const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_date, amount, currency, achieved_file_id")
        .eq("charge_to_project", projectCode)
        .is("deleted_at", null)
        .order("invoice_date", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true });
    if (error) throw new Error(`invoice query failed: ${error.message}`);
    return data;
}

export async function main(argv = process.argv.slice(2)) {
    loadEnvironment();
    const options = parseCliArgs(argv);
    if (options.action === "help") {
        console.log(HELP_TEXT);
        return;
    }
    const r2Client = createR2Client();
    const bucketName = process.env.R2_BUCKET_NAME;

    if (options.action === "dry-run") {
        const invoices = await queryInvoices(options.projectCode);
        const manifest = await buildDryRunManifest({
            invoices,
            projectCode: options.projectCode,
            runId: RUN_ID,
            r2Client,
            bucketName,
        });
        await mkdir(OUTPUT_DIRECTORY, { recursive: true });
        const outputPath = path.join(
            OUTPUT_DIRECTORY,
            `${options.projectCode}-${RUN_ID}.json`,
        );
        await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
            flag: "wx",
        });
        console.log(outputPath);
        return;
    }

    const manifest = await loadManifest(options.manifestPath);
    if (options.action === "stage") {
        await stageManifest({ manifest, r2Client, bucketName });
        console.log(`staged and verified ${manifest.rows.length} objects`);
    } else if (options.action === "finalize") {
        const sql = await finalizeManifest({
            manifest,
            r2Client,
            bucketName,
            publicUrl: process.env.R2_PUBLIC_URL,
        });
        console.log(sql);
    } else if (options.action === "verify") {
        await verifyFinalObjects({ manifest, r2Client, bucketName });
        console.log(`verified ${manifest.rows.length} final objects`);
    } else {
        const deleted = await cleanupManifest({
            manifest,
            r2Client,
            bucketName,
            dbVerified: options.dbVerified,
        });
        console.log(`deleted ${deleted.length} obsolete/staging objects`);
    }
}

const isDirectExecution = process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
