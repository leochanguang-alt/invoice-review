import assert from "node:assert/strict";
import test from "node:test";
import { CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

import { copyAndVerifyArchive } from "../lib/invoice-archive.js";

test("copies an archive and verifies the target before returning its metadata", async () => {
    const commands = [];
    const r2 = {
        async send(command) {
            commands.push(command);
            if (command instanceof HeadObjectCommand) {
                if (commands.length === 2) {
                    const error = new Error("not found");
                    error.name = "NotFound";
                    error.$metadata = { httpStatusCode: 404 };
                    throw error;
                }
                return {
                    ContentLength: 123,
                    ETag: '"same-etag"',
                    ChecksumSHA256: "same-checksum",
                };
            }
            return {};
        },
    };

    const result = await copyAndVerifyArchive(r2, {
        bucketName: "bucket",
        publicUrl: "https://files.example",
        originalKey: "original files/a b.pdf",
        targetKey: "projects/P/P-0001-1EUR.pdf",
    });

    assert.equal(commands.length, 4);
    assert.ok(commands[0] instanceof HeadObjectCommand);
    assert.ok(commands[1] instanceof HeadObjectCommand);
    assert.ok(commands[2] instanceof CopyObjectCommand);
    assert.ok(commands[3] instanceof HeadObjectCommand);
    assert.equal(commands[0].input.Key, "original files/a b.pdf");
    assert.equal(commands[1].input.Key, "projects/P/P-0001-1EUR.pdf");
    assert.equal(commands[2].input.CopySource, "bucket/original%20files/a%20b.pdf");
    assert.equal(commands[3].input.Key, "projects/P/P-0001-1EUR.pdf");
    assert.deepEqual(result, {
        archivedFileId: "projects/P/P-0001-1EUR.pdf",
        archivedLink: "https://files.example/projects/P/P-0001-1EUR.pdf",
    });
});

test("rejects an archive target whose length differs from the source", async () => {
    let headCount = 0;
    const r2 = {
        async send(command) {
            if (command instanceof HeadObjectCommand) {
                headCount += 1;
                if (headCount === 2) {
                    const error = new Error("not found");
                    error.name = "NotFound";
                    error.$metadata = { httpStatusCode: 404 };
                    throw error;
                }
                return { ContentLength: headCount === 1 ? 123 : 122 };
            }
            return {};
        },
    };

    await assert.rejects(
        copyAndVerifyArchive(r2, {
            bucketName: "bucket",
            publicUrl: "https://files.example",
            originalKey: "original/a.pdf",
            targetKey: "projects/P/a.pdf",
        }),
        /length mismatch/,
    );
});

test("treats an existing byte-identical target as idempotent without copying", async () => {
    const commands = [];
    const r2 = {
        async send(command) {
            commands.push(command);
            return {
                ContentLength: 123,
                ETag: '"same-etag"',
                ChecksumSHA256: "same-checksum",
            };
        },
    };

    const result = await copyAndVerifyArchive(r2, {
        bucketName: "bucket",
        publicUrl: "https://files.example",
        originalKey: "original/a.pdf",
        targetKey: "projects/P/a.pdf",
    });

    assert.equal(commands.length, 2);
    assert.ok(commands.every(command => command instanceof HeadObjectCommand));
    assert.equal(result.archivedFileId, "projects/P/a.pdf");
});

test("refuses to overwrite an existing target with different metadata", async () => {
    const commands = [];
    const r2 = {
        async send(command) {
            commands.push(command);
            return commands.length === 1
                ? { ContentLength: 123, ETag: '"source"', ChecksumSHA256: "source-sum" }
                : { ContentLength: 123, ETag: '"target"', ChecksumSHA256: "target-sum" };
        },
    };

    await assert.rejects(
        copyAndVerifyArchive(r2, {
            bucketName: "bucket",
            publicUrl: "https://files.example",
            originalKey: "original/a.pdf",
            targetKey: "projects/P/a.pdf",
        }),
        /refusing to overwrite.*metadata mismatch/i,
    );
    assert.equal(commands.filter(command => command instanceof CopyObjectCommand).length, 0);
});

test("rejects a missing or empty source before copying", async () => {
    const commands = [];
    const r2 = {
        async send(command) {
            commands.push(command);
            return { ContentLength: 0 };
        },
    };

    await assert.rejects(
        copyAndVerifyArchive(r2, {
            bucketName: "bucket",
            publicUrl: "https://files.example",
            originalKey: "original/a.pdf",
            targetKey: "projects/P/a.pdf",
        }),
        /source is missing or empty/,
    );
    assert.equal(commands.length, 1);
    assert.ok(commands[0] instanceof HeadObjectCommand);
});

test("provides a concrete reason when source Head fails without a message", async () => {
    const r2 = {
        async send() {
            throw new Error("");
        },
    };

    await assert.rejects(
        copyAndVerifyArchive(r2, {
            bucketName: "bucket",
            publicUrl: "https://files.example",
            originalKey: "original/a.pdf",
            targetKey: "projects/P/a.pdf",
        }),
        /Failed to inspect archive source original\/a\.pdf: unknown R2 HeadObject error/,
    );
});
