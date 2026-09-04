import assert from "node:assert/strict";
import test from "node:test";
import {
    CopyObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
} from "@aws-sdk/client-s3";

import {
    buildDryRunManifest,
    calculateManifestDigest,
    cleanupManifest,
    createManifestEnvelope,
    finalizeManifest,
    generateGuardedSql,
    HELP_TEXT,
    parseCliArgs,
    stageManifest,
    validateManifest,
    verifyFinalObjects,
} from "../scripts/renumber-project-invoices.js";

const PROJECT_CODE = "Neoss-MoEx-2608";
const RUN_ID = "20260904";
const CREATED_AT = "2026-09-04T20:00:00.000Z";

function makeInvoices() {
    return Array.from({ length: 35 }, (_, index) => {
        const id = 1000 + (34 - index);
        return {
            id,
            invoice_date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
            amount: index + 0.6,
            currency: index % 2 ? "EUR" : "SEK",
            achieved_file_id: `bui_invoice/projects/${PROJECT_CODE}/legacy/${id}.pdf`,
        };
    });
}

function makeManifest() {
    const rows = makeInvoices()
        .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.id - b.id)
        .map((invoice, index) => {
            const sequence = index + 1;
            const generatedInvoiceId = `${PROJECT_CODE}-${String(sequence).padStart(4, "0")}-${Math.round(invoice.amount)}${invoice.currency}`;
            return {
                invoiceId: invoice.id,
                invoiceDate: invoice.invoice_date,
                sequence,
                amount: invoice.amount,
                currency: invoice.currency,
                oldKey: invoice.achieved_file_id,
                generatedInvoiceId,
                newKey: `bui_invoice/projects/${PROJECT_CODE}/${generatedInvoiceId}.pdf`,
                stagingKey: `bui_invoice/projects/${PROJECT_CODE}/.renumber-${RUN_ID}/${generatedInvoiceId}.pdf`,
                sourceSize: 100 + sequence,
                sourceETag: `${String(sequence).padStart(32, "0")}`,
                sourceChecksumSHA256: null,
            };
        });
    return createManifestEnvelope({
        projectCode: PROJECT_CODE,
        runId: RUN_ID,
        createdAt: CREATED_AT,
        rows,
    });
}

function rowsOf(manifest) {
    return manifest.rows;
}

function resign(manifest) {
    manifest.contentDigest = calculateManifestDigest(manifest);
    return manifest;
}

test("manifest envelope verifies metadata integrity and rejects stale or tampered content", () => {
    const manifest = makeManifest();
    assert.equal(manifest.version, 1);
    assert.equal(manifest.projectCode, PROJECT_CODE);
    assert.equal(manifest.runId, RUN_ID);
    assert.equal(manifest.createdAt, CREATED_AT);
    assert.match(manifest.contentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(validateManifest(manifest, { now: "2026-09-05T00:00:00.000Z" }), manifest);

    const tampered = structuredClone(manifest);
    tampered.rows[0].oldKey = "other/file.pdf";
    assert.throws(
        () => validateManifest(tampered, { now: "2026-09-05T00:00:00.000Z" }),
        /digest mismatch/,
    );
    assert.throws(
        () => validateManifest(manifest, { now: "2026-09-20T00:00:00.000Z" }),
        /expired/,
    );
});

test("default dry-run builds exactly 35 ordered complete rows without R2 mutation", async () => {
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            return {
                ContentLength: 1000 + commands.length,
                ETag: `"${String(commands.length).padStart(32, "0")}"`,
            };
        },
    };

    const manifest = await buildDryRunManifest({
        invoices: makeInvoices(),
        projectCode: PROJECT_CODE,
        runId: RUN_ID,
        r2Client,
        bucketName: "bucket",
        createdAt: CREATED_AT,
    });

    const rows = rowsOf(manifest);
    assert.equal(rows.length, 35);
    assert.deepEqual(rows.map(row => row.sequence), Array.from({ length: 35 }, (_, i) => i + 1));
    assert.deepEqual(
        rows.map(row => [row.invoiceDate, row.invoiceId]),
        [...rows]
            .map(row => [row.invoiceDate, row.invoiceId])
            .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]),
    );
    for (const row of rows) {
        assert.ok(row.oldKey);
        assert.ok(row.newKey);
        assert.ok(row.stagingKey);
        assert.ok(row.sourceSize > 0);
    }
    assert.equal(commands.length, 35);
    assert.ok(commands.every(command => command instanceof HeadObjectCommand));
});

test("dry-run rejects any row count other than 35 before touching R2", async () => {
    let calls = 0;
    await assert.rejects(
        buildDryRunManifest({
            invoices: makeInvoices().slice(0, 34),
            projectCode: PROJECT_CODE,
            runId: RUN_ID,
            r2Client: { async send() { calls += 1; } },
            bucketName: "bucket",
            createdAt: CREATED_AT,
        }),
        /exactly 35 active invoices/,
    );
    assert.equal(calls, 0);
});

test("dry-run orders missing invoice dates last and preserves them in the manifest", async () => {
    const invoices = makeInvoices();
    invoices[0].invoice_date = null;
    const manifest = await buildDryRunManifest({
        invoices,
        projectCode: PROJECT_CODE,
        runId: RUN_ID,
        r2Client: {
            async send() {
                return { ContentLength: 123, ETag: "00000000000000000000000000000001" };
            },
        },
        bucketName: "bucket",
        createdAt: CREATED_AT,
    });
    assert.equal(manifest.rows.at(-1).invoiceDate, null);
    assert.equal(manifest.rows.at(-1).invoiceId, invoices[0].id);
});

test("manifest validation rejects duplicate final keys", () => {
    const manifest = makeManifest();
    manifest.rows[1].newKey = manifest.rows[0].newKey;
    resign(manifest);
    assert.throws(() => validateManifest(manifest), /newKey mismatch|duplicate newKey/);
});

test("manifest rejects unsafe IDs, duplicate old keys, and paths outside its project run", () => {
    const unsafeId = makeManifest();
    unsafeId.rows[0].invoiceId = Number.MAX_SAFE_INTEGER + 1;
    resign(unsafeId);
    assert.throws(() => validateManifest(unsafeId), /invalid invoiceId/);

    const duplicateOld = makeManifest();
    duplicateOld.rows[1].oldKey = duplicateOld.rows[0].oldKey;
    duplicateOld.rows[1].generatedInvoiceId = `${PROJECT_CODE}-0002-${Math.round(duplicateOld.rows[1].amount)}${duplicateOld.rows[1].currency}`;
    duplicateOld.rows[1].newKey = `bui_invoice/projects/${PROJECT_CODE}/${duplicateOld.rows[1].generatedInvoiceId}.pdf`;
    duplicateOld.rows[1].stagingKey = `bui_invoice/projects/${PROJECT_CODE}/.renumber-${RUN_ID}/${duplicateOld.rows[1].generatedInvoiceId}.pdf`;
    resign(duplicateOld);
    assert.throws(() => validateManifest(duplicateOld), /duplicate oldKey/);

    const foreignStaging = makeManifest();
    foreignStaging.rows[0].stagingKey = `bui_invoice/projects/Other/.renumber-${RUN_ID}/x.pdf`;
    resign(foreignStaging);
    assert.throws(() => validateManifest(foreignStaging), /stagingKey mismatch/);

    const foreignOld = makeManifest();
    foreignOld.rows[0].oldKey = "bui_invoice/projects/Other/legacy.pdf";
    resign(foreignOld);
    assert.throws(() => validateManifest(foreignOld), /oldKey prefix/);
});

test("manifest ties generated IDs and extensions to sequence, amount, currency, and old key", () => {
    for (const [property, value, pattern] of [
        ["amount", 999, /generatedInvoiceId mismatch/],
        ["currency", "GBP", /generatedInvoiceId mismatch/],
        ["generatedInvoiceId", "forged", /generatedInvoiceId mismatch/],
        ["newKey", `bui_invoice/projects/${PROJECT_CODE}/forged.exe`, /newKey mismatch/],
    ]) {
        const manifest = makeManifest();
        manifest.rows[0][property] = value;
        resign(manifest);
        assert.throws(() => validateManifest(manifest), pattern);
    }
});

test("manifest schema rejects unknown fields and noncanonical dates or sizes", () => {
    const extraField = makeManifest();
    extraField.unreviewed = true;
    resign(extraField);
    assert.throws(() => validateManifest(extraField), /unknown manifest field/);

    const stringSize = makeManifest();
    stringSize.rows[0].sourceSize = "101";
    resign(stringSize);
    assert.throws(() => validateManifest(stringSize), /invalid sourceSize/);

    const invalidDate = makeManifest();
    invalidDate.rows[0].invoiceDate = "not-a-date";
    resign(invalidDate);
    assert.throws(() => validateManifest(invalidDate), /invalid invoiceDate/);
});

test("stage heads every source before copying and verifies staged lengths", async () => {
    const manifest = makeManifest();
    const rows = rowsOf(manifest);
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            if (command instanceof HeadObjectCommand) {
                const row = rows.find(item =>
                    item.oldKey === command.input.Key || item.stagingKey === command.input.Key);
                return { ContentLength: row.sourceSize, ETag: row.sourceETag };
            }
            return {};
        },
    };

    await stageManifest({ manifest, r2Client, bucketName: "bucket" });

    const firstCopy = commands.findIndex(command => command instanceof CopyObjectCommand);
    assert.ok(firstCopy >= 35);
    assert.deepEqual(
        commands.slice(0, 35).map(command => command.input.Key),
        rows.map(row => row.oldKey),
    );
    assert.equal(commands.filter(command => command instanceof CopyObjectCommand).length, 35);
    assert.equal(commands.filter(command =>
        command instanceof HeadObjectCommand
        && rows.some(row => row.stagingKey === command.input.Key)).length, 70);
});

test("stage percent-encodes every CopySource segment including Unicode, spaces, plus, and percent", async () => {
    const manifest = makeManifest();
    const row = manifest.rows[0];
    row.oldKey = `bui_invoice/projects/${PROJECT_CODE}/旧 发票/+plus/%percent.pdf`;
    resign(manifest);
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            const matched = manifest.rows.find(item =>
                item.oldKey === command.input.Key || item.stagingKey === command.input.Key);
            return command instanceof HeadObjectCommand
                ? { ContentLength: matched.sourceSize, ETag: matched.sourceETag }
                : {};
        },
    };
    await stageManifest({ manifest, r2Client, bucketName: "bucket" });
    const copy = commands.find(command =>
        command instanceof CopyObjectCommand && command.input.Key === row.stagingKey);
    assert.equal(
        copy.input.CopySource,
        `bucket/bui_invoice/projects/${PROJECT_CODE}/%E6%97%A7%20%E5%8F%91%E7%A5%A8/%2Bplus/%25percent.pdf`,
    );
});

test("stage performs no writes when any source preflight fails", async () => {
    const manifest = makeManifest();
    const rows = rowsOf(manifest);
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            if (command.input.Key === rows[17].oldKey) {
                throw new Error("not found");
            }
            const row = rows.find(item => item.oldKey === command.input.Key);
            return { ContentLength: row?.sourceSize, ETag: row?.sourceETag };
        },
    };

    await assert.rejects(
        stageManifest({ manifest, r2Client, bucketName: "bucket" }),
        /source preflight failed/,
    );
    assert.equal(commands.filter(command => command instanceof HeadObjectCommand).length, 35);
    assert.equal(commands.filter(command => command instanceof CopyObjectCommand).length, 0);
});

test("stage refuses a source whose size changed since dry-run before any copy", async () => {
    const manifest = makeManifest();
    const rows = rowsOf(manifest);
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            const row = rows.find(item => item.oldKey === command.input.Key);
            return {
                ContentLength: row.sourceSize + (row === rows[4] ? 1 : 0),
                ETag: row.sourceETag,
            };
        },
    };
    await assert.rejects(
        stageManifest({ manifest, r2Client, bucketName: "bucket" }),
        /size changed/,
    );
    assert.equal(commands.filter(command => command instanceof CopyObjectCommand).length, 0);
});

test("finalize copies only staging objects to final keys and returns guarded SQL", async () => {
    const manifest = makeManifest();
    const rows = rowsOf(manifest);
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            if (command instanceof HeadObjectCommand) {
                const row = rows.find(item =>
                    item.stagingKey === command.input.Key || item.newKey === command.input.Key);
                return { ContentLength: row.sourceSize, ETag: row.sourceETag };
            }
            return {};
        },
    };

    const sql = await finalizeManifest({
        manifest,
        r2Client,
        bucketName: "bucket",
        publicUrl: "https://assets.example",
        projectCode: PROJECT_CODE,
    });

    const copies = commands.filter(command => command instanceof CopyObjectCommand);
    assert.equal(copies.length, 35);
    assert.ok(copies.every((command, index) =>
        decodeURIComponent(command.input.CopySource) === `bucket/${rows[index].stagingKey}`
        && command.input.Key === rows[index].newKey));
    assert.ok(commands.every(command =>
        !(command instanceof HeadObjectCommand)
        || !rows.some(row => row.oldKey === command.input.Key)));
    assert.equal(sql, generateGuardedSql(manifest, {
        projectCode: PROJECT_CODE,
        publicUrl: "https://assets.example",
    }));
});

test("finalize preflights every staging object and writes no finals when one is missing", async () => {
    const manifest = makeManifest();
    const rows = rowsOf(manifest);
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            if (command.input.Key === rows[9].stagingKey) {
                throw new Error("not found");
            }
            const row = rows.find(item => item.stagingKey === command.input.Key);
            return { ContentLength: row?.sourceSize, ETag: row?.sourceETag };
        },
    };
    await assert.rejects(
        finalizeManifest({
            manifest,
            r2Client,
            bucketName: "bucket",
            publicUrl: "https://assets.example",
            projectCode: PROJECT_CODE,
        }),
        /source preflight failed/,
    );
    assert.equal(commands.filter(command => command instanceof HeadObjectCommand).length, 35);
    assert.equal(commands.filter(command => command instanceof CopyObjectCommand).length, 0);
});

test("verify heads all 35 final objects without mutation and enforces usable integrity metadata", async () => {
    const manifest = makeManifest();
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            const row = manifest.rows.find(item => item.newKey === command.input.Key);
            return { ContentLength: row.sourceSize, ETag: row.sourceETag };
        },
    };
    const result = await verifyFinalObjects({ manifest, r2Client, bucketName: "bucket" });
    assert.equal(result.length, 35);
    assert.equal(commands.length, 35);
    assert.ok(commands.every(command => command instanceof HeadObjectCommand));

    const multipart = makeManifest();
    multipart.rows[0].sourceETag = "multipart-source-7";
    resign(multipart);
    await verifyFinalObjects({
        manifest: multipart,
        bucketName: "bucket",
        r2Client: {
            async send(command) {
                const row = multipart.rows.find(item => item.newKey === command.input.Key);
                return {
                    ContentLength: row.sourceSize,
                    ETag: row === multipart.rows[0] ? "copy-changed-7" : row.sourceETag,
                };
            },
        },
    });
});

test("cleanup verifies every final first and deletes nothing on size, ETag, or checksum mismatch", async () => {
    for (const mismatch of ["size", "etag", "checksum"]) {
        const manifest = makeManifest();
        if (mismatch === "checksum") {
            manifest.rows[0].sourceETag = "multipart-source-7";
            manifest.rows[0].sourceChecksumSHA256 = "expected-checksum";
            resign(manifest);
        }
        const commands = [];
        const r2Client = {
            async send(command) {
                commands.push(command);
                const row = manifest.rows.find(item => item.newKey === command.input.Key);
                const response = {
                    ContentLength: row.sourceSize,
                    ETag: row.sourceETag,
                    ChecksumSHA256: row.sourceChecksumSHA256,
                };
                if (row === manifest.rows[0]) {
                    if (mismatch === "size") response.ContentLength += 1;
                    if (mismatch === "etag") response.ETag = "ffffffffffffffffffffffffffffffff";
                    if (mismatch === "checksum") response.ChecksumSHA256 = "wrong";
                }
                return response;
            },
        };
        await assert.rejects(
            cleanupManifest({ manifest, r2Client, bucketName: "bucket", dbVerified: true }),
            /mismatch/,
        );
        assert.equal(commands.filter(command => command instanceof HeadObjectCommand).length, 35);
        assert.equal(commands.filter(command => command instanceof DeleteObjectCommand).length, 0);
    }
});

test("cleanup requires explicit DB verification and never deletes old keys that are final keys", async () => {
    const manifest = makeManifest();
    const rows = rowsOf(manifest);
    rows[0].oldKey = rows[1].newKey;
    rows[0].generatedInvoiceId = `${PROJECT_CODE}-0001-${Math.round(rows[0].amount)}${rows[0].currency}`;
    rows[0].newKey = `bui_invoice/projects/${PROJECT_CODE}/${rows[0].generatedInvoiceId}.pdf`;
    rows[0].stagingKey = `bui_invoice/projects/${PROJECT_CODE}/.renumber-${RUN_ID}/${rows[0].generatedInvoiceId}.pdf`;
    resign(manifest);
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            if (command instanceof HeadObjectCommand) {
                const row = rows.find(item => item.newKey === command.input.Key);
                return { ContentLength: row.sourceSize, ETag: row.sourceETag };
            }
            return {};
        },
    };

    await assert.rejects(
        cleanupManifest({ manifest, r2Client, bucketName: "bucket", dbVerified: false }),
        /DB verification confirmation is required/,
    );
    assert.equal(commands.length, 0);

    const deleted = await cleanupManifest({
        manifest,
        r2Client,
        bucketName: "bucket",
        dbVerified: true,
    });
    assert.ok(!deleted.includes(rows[0].oldKey));
    assert.ok(rows.every(row => deleted.includes(row.stagingKey)));
    assert.equal(commands.filter(command => command instanceof DeleteObjectCommand).length, deleted.length);
});

test("guarded SQL asserts all rows and old keys, updates archive fields, and sets counter to 35", () => {
    const manifest = makeManifest();
    const sql = generateGuardedSql(manifest, {
        projectCode: PROJECT_CODE,
        publicUrl: "https://assets.example/",
    });
    assert.doesNotMatch(sql, /\bbegin\s*;|\bcommit\s*;/i);
    assert.match(sql, /lock table public\.invoices in share row exclusive mode/i);
    assert.match(
        sql,
        /select count\(\*\)[\s\S]*charge_to_project[\s\S]*deleted_at is null[\s\S]*<>\s*35/is,
    );
    assert.match(sql, /project_invoice_counters[\s\S]*for update/is);
    assert.match(sql, /if\s+\w+\s*>\s*35[\s\S]*raise exception/is);
    assert.match(sql, /last_sequence\s*=\s*greatest\([^)]*last_sequence[^)]*35/is);
    assert.match(sql, /count\(distinct project_sequence\).*35/is);
    assert.match(sql, /min\(project_sequence\).*1/is);
    assert.match(sql, /max\(project_sequence\).*35/is);
    assert.match(sql, /achieved_file_id/is);
    assert.match(sql, /achieved_file_link/is);
    assert.match(sql, /project_invoice_counters/is);
    assert.match(sql, /get diagnostics\s+\w+\s*=\s*row_count/is);
    assert.match(sql, /if\s+\w+\s*<>\s*35/is);
    const clearPosition = sql.search(/set project_sequence = null/i);
    const assignPosition = sql.search(/set project_sequence = m\.project_sequence/i);
    assert.ok(clearPosition >= 0 && assignPosition > clearPosition);
    assert.match(sql, /amount numeric not null/i);
    assert.match(sql, /currency text not null/i);
    assert.match(sql, /i\.amount is distinct from m\.amount/i);
    assert.match(sql, /upper\(btrim\(coalesce\(i\.currency,\s*''\)\)\) is distinct from m\.currency/i);
    for (const row of manifest.rows) {
        assert.match(sql, new RegExp(`\\(${row.invoiceId},\\s*${row.sequence},`));
        assert.ok(sql.includes(row.oldKey));
        assert.ok(sql.includes(row.newKey));
    }
    assert.match(sql, /on commit drop/i);
});

test("finalize and SQL generation reject an empty or unsafe public URL", async () => {
    const manifest = makeManifest();
    assert.throws(
        () => generateGuardedSql(manifest, { projectCode: PROJECT_CODE, publicUrl: "" }),
        /R2_PUBLIC_URL/,
    );
    assert.throws(
        () => generateGuardedSql(manifest, {
            projectCode: PROJECT_CODE,
            publicUrl: "javascript:alert(1)",
        }),
        /valid HTTP\(S\) URL/,
    );
    assert.throws(
        () => generateGuardedSql(manifest, {
            projectCode: PROJECT_CODE,
            publicUrl: " https://assets.example ",
        }),
        /valid HTTP\(S\) URL/,
    );
    await assert.rejects(
        finalizeManifest({
            manifest,
            r2Client: { async send() { throw new Error("must not reach R2"); } },
            bucketName: "bucket",
            publicUrl: "",
        }),
        /R2_PUBLIC_URL/,
    );
});

test("SQL keeps dollar-tag-like URL text outside procedural dollar quotes", () => {
    const marker = "$renumber_update$";
    const sql = generateGuardedSql(makeManifest(), {
        projectCode: PROJECT_CODE,
        publicUrl: `https://assets.example/${marker}`,
    });
    const opening = "do $renumber_update$\n";
    const bodyStart = sql.indexOf(opening) + opening.length;
    const bodyEnd = sql.indexOf("\n$renumber_update$;", bodyStart);
    assert.ok(bodyStart >= 0 && bodyEnd > bodyStart);
    assert.ok(!sql.slice(bodyStart, bodyEnd).includes(`assets.example/${marker}`));
    assert.ok(sql.slice(0, bodyStart).includes(`assets.example/${marker}`));
});

test("CLI arguments fail closed", () => {
    assert.deepEqual(parseCliArgs(["--project", PROJECT_CODE]), {
        action: "dry-run",
        projectCode: PROJECT_CODE,
    });
    assert.throws(() => parseCliArgs([]), /--project is required/);
    assert.throws(() => parseCliArgs(["--project", PROJECT_CODE, "--stage"]), /--manifest is required/);
    assert.throws(() => parseCliArgs(["--manifest", "x.json", "--cleanup"]), /--db-verified is required/);
    assert.deepEqual(parseCliArgs(["--manifest", "x.json", "--verify"]), {
        action: "verify",
        manifestPath: "x.json",
        dbVerified: false,
    });
    assert.match(HELP_TEXT, /--cleanup --db-verified/);
    assert.deepEqual(parseCliArgs(["--help"]), { action: "help" });
    assert.throws(() => parseCliArgs(["--manifest", "x.json", "--stage", "--finalize"]), /exactly one action/);
    assert.throws(
        () => parseCliArgs(["--manifest", "x.json", "--manifest", "y.json", "--verify"]),
        /duplicate --manifest/,
    );
    assert.throws(
        () => parseCliArgs(["--project", PROJECT_CODE, "--project", PROJECT_CODE]),
        /duplicate --project/,
    );
    assert.throws(() => parseCliArgs(["--project", PROJECT_CODE, "--wat"]), /unknown argument/);
});
