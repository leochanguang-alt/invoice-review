import assert from "node:assert/strict";
import test from "node:test";
import { CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

import { copyAndVerifyArchive } from "../lib/invoice-archive.js";

test("copies an archive and verifies the target before returning its metadata", async () => {
    const commands = [];
    const r2 = {
        async send(command) {
            commands.push(command);
            return command instanceof HeadObjectCommand
                ? { ContentLength: 123 }
                : {};
        },
    };

    const result = await copyAndVerifyArchive(r2, {
        bucketName: "bucket",
        publicUrl: "https://files.example",
        originalKey: "original files/a b.pdf",
        targetKey: "projects/P/P-0001-1EUR.pdf",
    });

    assert.equal(commands.length, 2);
    assert.ok(commands[0] instanceof CopyObjectCommand);
    assert.ok(commands[1] instanceof HeadObjectCommand);
    assert.equal(commands[0].input.CopySource, "bucket/original%20files/a%20b.pdf");
    assert.equal(commands[1].input.Key, "projects/P/P-0001-1EUR.pdf");
    assert.deepEqual(result, {
        archivedFileId: "projects/P/P-0001-1EUR.pdf",
        archivedLink: "https://files.example/projects/P/P-0001-1EUR.pdf",
    });
});

test("rejects an archive target that is missing or empty", async () => {
    const r2 = {
        async send(command) {
            if (command instanceof HeadObjectCommand) {
                return { ContentLength: 0 };
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
        /missing or empty/,
    );
});
