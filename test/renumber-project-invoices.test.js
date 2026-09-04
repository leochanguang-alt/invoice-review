import assert from "node:assert/strict";
import test from "node:test";
import {
    CopyObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
} from "@aws-sdk/client-s3";

import {
    buildDryRunManifest,
    cleanupManifest,
    finalizeManifest,
    generateGuardedSql,
    parseCliArgs,
    stageManifest,
    validateManifest,
} from "../scripts/renumber-project-invoices.js";

const PROJECT_CODE = "Neoss-MoEx-2608";
const RUN_ID = "20260904";

function makeInvoices() {
    return Array.from({ length: 35 }, (_, index) => {
        const id = 1000 + (34 - index);
        return {
            id,
            invoice_date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
            amount: index + 0.6,
            currency: index % 2 ? "EUR" : "SEK",
            achieved_file_id: `old/${id}.pdf`,
        };
    });
}

function makeManifest() {
    return makeInvoices()
        .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.id - b.id)
        .map((invoice, index) => {
            const sequence = index + 1;
            const generatedInvoiceId = `${PROJECT_CODE}-${String(sequence).padStart(4, "0")}-${Math.round(invoice.amount)}${invoice.currency}`;
            return {
                invoiceId: invoice.id,
                invoiceDate: invoice.invoice_date,
                sequence,
                oldKey: invoice.achieved_file_id,
                generatedInvoiceId,
                newKey: `bui_invoice/projects/${PROJECT_CODE}/${generatedInvoiceId}.pdf`,
                stagingKey: `bui_invoice/projects/${PROJECT_CODE}/.renumber-${RUN_ID}/${generatedInvoiceId}.pdf`,
                sourceSize: 100 + sequence,
            };
        });
}

test("default dry-run builds exactly 35 ordered complete rows without R2 mutation", async () => {
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            return { ContentLength: 1000 + commands.length };
        },
    };

    const manifest = await buildDryRunManifest({
        invoices: makeInvoices(),
        projectCode: PROJECT_CODE,
        runId: RUN_ID,
        r2Client,
        bucketName: "bucket",
    });

    assert.equal(manifest.length, 35);
    assert.deepEqual(manifest.map(row => row.sequence), Array.from({ length: 35 }, (_, i) => i + 1));
    assert.deepEqual(
        manifest.map(row => [row.invoiceDate, row.invoiceId]),
        [...manifest]
            .map(row => [row.invoiceDate, row.invoiceId])
            .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]),
    );
    for (const row of manifest) {
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
        r2Client: { async send() { return { ContentLength: 123 }; } },
        bucketName: "bucket",
    });
    assert.equal(manifest.at(-1).invoiceDate, null);
    assert.equal(manifest.at(-1).invoiceId, invoices[0].id);
});

test("manifest validation rejects duplicate final keys", () => {
    const manifest = makeManifest();
    manifest[1].newKey = manifest[0].newKey;
    assert.throws(() => validateManifest(manifest), /duplicate newKey/);
});

test("stage heads every source before copying and verifies staged lengths", async () => {
    const manifest = makeManifest();
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            if (command instanceof HeadObjectCommand) {
                const row = manifest.find(item =>
                    item.oldKey === command.input.Key || item.stagingKey === command.input.Key);
                return { ContentLength: row.sourceSize };
            }
            return {};
        },
    };

    await stageManifest({ manifest, r2Client, bucketName: "bucket" });

    const firstCopy = commands.findIndex(command => command instanceof CopyObjectCommand);
    assert.ok(firstCopy >= 35);
    assert.deepEqual(
        commands.slice(0, 35).map(command => command.input.Key),
        manifest.map(row => row.oldKey),
    );
    assert.equal(commands.filter(command => command instanceof CopyObjectCommand).length, 35);
    assert.equal(commands.filter(command =>
        command instanceof HeadObjectCommand
        && manifest.some(row => row.stagingKey === command.input.Key)).length, 35);
});

test("stage performs no writes when any source preflight fails", async () => {
    const manifest = makeManifest();
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            if (command.input.Key === manifest[17].oldKey) {
                throw new Error("not found");
            }
            return { ContentLength: manifest.find(row => row.oldKey === command.input.Key)?.sourceSize };
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
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            const row = manifest.find(item => item.oldKey === command.input.Key);
            return { ContentLength: row.sourceSize + (row === manifest[4] ? 1 : 0) };
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
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            if (command instanceof HeadObjectCommand) {
                const row = manifest.find(item =>
                    item.stagingKey === command.input.Key || item.newKey === command.input.Key);
                return { ContentLength: row.sourceSize };
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
        decodeURIComponent(command.input.CopySource) === `bucket/${manifest[index].stagingKey}`
        && command.input.Key === manifest[index].newKey));
    assert.ok(commands.every(command =>
        !(command instanceof HeadObjectCommand)
        || !manifest.some(row => row.oldKey === command.input.Key)));
    assert.equal(sql, generateGuardedSql(manifest, {
        projectCode: PROJECT_CODE,
        publicUrl: "https://assets.example",
    }));
});

test("finalize preflights every staging object and writes no finals when one is missing", async () => {
    const manifest = makeManifest();
    const commands = [];
    const r2Client = {
        async send(command) {
            commands.push(command);
            if (command.input.Key === manifest[9].stagingKey) {
                throw new Error("not found");
            }
            const row = manifest.find(item => item.stagingKey === command.input.Key);
            return { ContentLength: row?.sourceSize };
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

test("cleanup requires explicit DB verification and never deletes old keys that are final keys", async () => {
    const manifest = makeManifest();
    manifest[0].oldKey = manifest[1].newKey;
    const commands = [];
    const r2Client = { async send(command) { commands.push(command); return {}; } };

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
    assert.ok(!deleted.includes(manifest[0].oldKey));
    assert.ok(manifest.every(row => deleted.includes(row.stagingKey)));
    assert.equal(commands.length, deleted.length);
    assert.ok(commands.every(command => command instanceof DeleteObjectCommand));
});

test("guarded SQL asserts all rows and old keys, updates archive fields, and sets counter to 35", () => {
    const sql = generateGuardedSql(makeManifest(), {
        projectCode: PROJECT_CODE,
        publicUrl: "https://assets.example/",
    });
    assert.match(sql, /^begin;/i);
    assert.match(sql, /count\(\*\).*35/is);
    assert.match(sql, /count\(distinct project_sequence\).*35/is);
    assert.match(sql, /min\(project_sequence\).*1/is);
    assert.match(sql, /max\(project_sequence\).*35/is);
    assert.match(sql, /achieved_file_id/is);
    assert.match(sql, /achieved_file_link/is);
    assert.match(sql, /project_invoice_counters/is);
    assert.match(sql, /last_sequence\s*=\s*35/i);
    assert.match(sql, /get diagnostics\s+\w+\s*=\s*row_count/is);
    assert.match(sql, /if\s+\w+\s*<>\s*35/is);
    for (const row of makeManifest()) {
        assert.match(sql, new RegExp(`\\(${row.invoiceId},\\s*${row.sequence},`));
        assert.ok(sql.includes(row.oldKey));
        assert.ok(sql.includes(row.newKey));
    }
    assert.match(sql, /commit;\s*$/i);
});

test("CLI arguments fail closed", () => {
    assert.deepEqual(parseCliArgs(["--project", PROJECT_CODE]), {
        action: "dry-run",
        projectCode: PROJECT_CODE,
    });
    assert.throws(() => parseCliArgs([]), /--project is required/);
    assert.throws(() => parseCliArgs(["--project", PROJECT_CODE, "--stage"]), /--manifest is required/);
    assert.throws(() => parseCliArgs(["--manifest", "x.json", "--cleanup"]), /--db-verified is required/);
    assert.throws(() => parseCliArgs(["--manifest", "x.json", "--stage", "--finalize"]), /exactly one action/);
    assert.throws(() => parseCliArgs(["--project", PROJECT_CODE, "--wat"]), /unknown argument/);
});
