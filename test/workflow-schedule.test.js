import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("invoice workflow runs hourly away from top-of-hour peaks", async () => {
    const workflow = await readFile(
        new URL("../.github/workflows/process-invoices.yml", import.meta.url),
        "utf8",
    );

    assert.match(workflow, /cron:\s*['"]22 \* \* \* \*['"]/);
});
