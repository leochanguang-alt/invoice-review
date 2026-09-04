import { fileURLToPath } from "node:url";
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
import { buildRenumberManifest } from "../lib/invoice-numbering.js";

export const PROJECT_CODE = "Neoss-MoEx-2608";
export const RUN_ID = "20260904";
export const EXPECTED_INVOICE_COUNT = 35;
const OUTPUT_DIRECTORY = "tmp/renumber-project-invoices";

function requireNonEmpty(value, label) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${label} is required`);
    }
}

function uniqueValues(rows, property) {
    return new Set(rows.map(row => row[property]));
}

export function validateManifest(manifest) {
    if (!Array.isArray(manifest) || manifest.length !== EXPECTED_INVOICE_COUNT) {
        throw new Error(`manifest must contain exactly ${EXPECTED_INVOICE_COUNT} rows`);
    }

    const requiredStrings = [
        "oldKey",
        "generatedInvoiceId",
        "newKey",
        "stagingKey",
    ];
    for (const [index, row] of manifest.entries()) {
        if (!row || typeof row !== "object") {
            throw new Error(`manifest row ${index + 1} must be an object`);
        }
        if (!Number.isInteger(Number(row.invoiceId))) {
            throw new Error(`manifest row ${index + 1} has invalid invoiceId`);
        }
        if (!Object.hasOwn(row, "invoiceDate")
            || (row.invoiceDate !== null && typeof row.invoiceDate !== "string")) {
            throw new Error(`manifest row ${index + 1} has invalid invoiceDate`);
        }
        if (row.sequence !== index + 1) {
            throw new Error("manifest sequences must be contiguous from 1 through 35");
        }
        for (const property of requiredStrings) {
            requireNonEmpty(row[property], `manifest row ${index + 1} ${property}`);
        }
        if (!(Number(row.sourceSize) > 0)) {
            throw new Error(`manifest row ${index + 1} has invalid sourceSize`);
        }
    }

    for (const property of ["invoiceId", "sequence", "newKey", "stagingKey"]) {
        if (uniqueValues(manifest, property).size !== EXPECTED_INVOICE_COUNT) {
            throw new Error(`manifest contains duplicate ${property}`);
        }
    }

    const ordered = [...manifest].sort((a, b) => {
        if (a.invoiceDate == null && b.invoiceDate == null) {
            return Number(a.invoiceId) - Number(b.invoiceId);
        }
        if (a.invoiceDate == null) return 1;
        if (b.invoiceDate == null) return -1;
        return a.invoiceDate.localeCompare(b.invoiceDate)
            || Number(a.invoiceId) - Number(b.invoiceId);
    });
    if (ordered.some((row, index) => row !== manifest[index])) {
        throw new Error("manifest rows must be ordered by invoiceDate then invoiceId");
    }

    return manifest;
}

async function inspectAllSources({ rows, keyProperty, r2Client, bucketName }) {
    const inspections = await Promise.allSettled(rows.map(row =>
        r2Client.send(new HeadObjectCommand({
            Bucket: bucketName,
            Key: row[keyProperty],
        }))));

    const errors = [];
    const sizes = inspections.map((inspection, index) => {
        if (inspection.status === "rejected") {
            errors.push(`${rows[index][keyProperty]}: ${inspection.reason?.message || "HeadObject failed"}`);
            return null;
        }
        const size = Number(inspection.value?.ContentLength);
        if (!(size > 0)) {
            errors.push(`${rows[index][keyProperty]}: missing or empty`);
            return null;
        }
        return size;
    });
    if (errors.length > 0) {
        throw new Error(`source preflight failed:\n${errors.join("\n")}`);
    }
    return sizes;
}

export async function buildDryRunManifest({
    invoices,
    projectCode,
    runId,
    r2Client,
    bucketName,
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
            invoiceDate: source.invoice_date,
            sequence: row.sequence,
            oldKey: row.oldKey,
            generatedInvoiceId: row.generatedInvoiceId,
            newKey: row.newKey,
            stagingKey: `bui_invoice/projects/${projectCode}/.renumber-${runId}/${filename}`,
        };
    });

    const sourceSizes = await inspectAllSources({
        rows,
        keyProperty: "oldKey",
        r2Client,
        bucketName,
    });
    const manifest = rows.map((row, index) => ({
        ...row,
        sourceSize: sourceSizes[index],
    }));
    return validateManifest(manifest);
}

export async function stageManifest({ manifest, r2Client, bucketName }) {
    validateManifest(manifest);
    const sourceSizes = await inspectAllSources({
        rows: manifest,
        keyProperty: "oldKey",
        r2Client,
        bucketName,
    });
    const changedSources = manifest.filter((row, index) =>
        sourceSizes[index] !== Number(row.sourceSize));
    if (changedSources.length > 0) {
        throw new Error(`source preflight failed: size changed for ${changedSources.map(row => row.oldKey).join(", ")}`);
    }

    for (const row of manifest) {
        await copyAndVerifyArchive(r2Client, {
            bucketName,
            publicUrl: "",
            originalKey: row.oldKey,
            targetKey: row.stagingKey,
        });
    }
}

export async function finalizeManifest({
    manifest,
    r2Client,
    bucketName,
    publicUrl,
    projectCode = PROJECT_CODE,
}) {
    validateManifest(manifest);
    const stagingSizes = await inspectAllSources({
        rows: manifest,
        keyProperty: "stagingKey",
        r2Client,
        bucketName,
    });
    const changedStaging = manifest.filter((row, index) =>
        stagingSizes[index] !== Number(row.sourceSize));
    if (changedStaging.length > 0) {
        throw new Error(`source preflight failed: staged size changed for ${changedStaging.map(row => row.stagingKey).join(", ")}`);
    }

    for (const row of manifest) {
        await copyAndVerifyArchive(r2Client, {
            bucketName,
            publicUrl,
            originalKey: row.stagingKey,
            targetKey: row.newKey,
        });
    }
    return generateGuardedSql(manifest, { projectCode, publicUrl });
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

    const finalKeys = uniqueValues(manifest, "newKey");
    const keysToDelete = [
        ...manifest.map(row => row.oldKey).filter(key => !finalKeys.has(key)),
        ...manifest.map(row => row.stagingKey),
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
    return manifest.map(row => `    (${Number(row.invoiceId)}, ${row.sequence}, ${sqlLiteral(row.generatedInvoiceId)}, ${sqlLiteral(row.oldKey)}, ${sqlLiteral(row.newKey)})`)
        .join(",\n");
}

export function generateGuardedSql(manifest, { projectCode, publicUrl }) {
    validateManifest(manifest);
    const values = manifestValuesSql(manifest);
    const ids = manifest.map(row => Number(row.invoiceId)).join(", ");
    const normalizedPublicUrl = String(publicUrl || "").replace(/\/+$/, "");

    return `begin;

create temporary table renumber_manifest (
  invoice_id bigint primary key,
  project_sequence integer not null,
  generated_invoice_id text not null,
  old_key text not null,
  new_key text not null
) on commit drop;

insert into renumber_manifest values
${values};

do $guard$
begin
  if not exists (
    select 1 from public.invoices
    where charge_to_project = ${sqlLiteral(projectCode)} and deleted_at is null
  ) then
    raise exception 'source project has no active invoices';
  end if;
  if (
    select count(*) from public.invoices
    where charge_to_project = ${sqlLiteral(projectCode)}
      and deleted_at is null
      and id in (${ids})
  ) <> 35 then
    raise exception 'expected exactly 35 active manifest invoices';
  end if;
  if exists (
    select 1
    from renumber_manifest as m
    left join public.invoices as i
      on i.id = m.invoice_id
      and i.charge_to_project = ${sqlLiteral(projectCode)}
      and i.deleted_at is null
    where i.id is null or i.achieved_file_id is distinct from m.old_key
  ) then
    raise exception 'invoice old key guard failed';
  end if;
  if (
    select count(distinct project_sequence) = 35
      and min(project_sequence) = 1
      and max(project_sequence) = 35
    from renumber_manifest
  ) is not true then
    raise exception 'manifest sequences are not exactly 1 through 35';
  end if;
end
$guard$;

do $update$
declare
  updated_rows integer;
begin
  update public.invoices as i
  set project_sequence = m.project_sequence,
      generated_invoice_id = m.generated_invoice_id,
      achieved_file_id = m.new_key,
      achieved_file_link = ${sqlLiteral(`${normalizedPublicUrl}/`)} || m.new_key,
      updated_at = now()
  from renumber_manifest as m
  where i.id = m.invoice_id
    and i.charge_to_project = ${sqlLiteral(projectCode)}
    and i.deleted_at is null
    and i.achieved_file_id = m.old_key;

  get diagnostics updated_rows = row_count;
  if updated_rows <> 35 then
    raise exception 'expected to update 35 invoices, updated %', updated_rows;
  end if;
end
$update$;

insert into private.project_invoice_counters (project_code, last_sequence, updated_at)
values (${sqlLiteral(projectCode)}, 35, now())
on conflict (project_code) do update
set last_sequence = 35,
    updated_at = now();

commit;
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
        if (argument === "--project") {
            projectCode = takeValue(argv, index, argument);
            index += 1;
        } else if (argument === "--manifest") {
            manifestPath = takeValue(argv, index, argument);
            index += 1;
        } else if (["--stage", "--finalize", "--cleanup"].includes(argument)) {
            actions.push(argument.slice(2));
        } else if (argument === "--db-verified") {
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
        console.log(`staged and verified ${manifest.length} objects`);
    } else if (options.action === "finalize") {
        const sql = await finalizeManifest({
            manifest,
            r2Client,
            bucketName,
            publicUrl: process.env.R2_PUBLIC_URL,
        });
        console.log(sql);
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
