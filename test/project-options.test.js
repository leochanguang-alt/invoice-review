import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadProjectOptions() {
    const source = await readFile(
        new URL("../public/project-options.js", import.meta.url),
        "utf8",
    );
    const context = {};
    vm.runInNewContext(source, context);
    return context.buildProjectOptions;
}

test("appends an inactive current project and keeps it selected", async () => {
    const buildProjectOptions = await loadProjectOptions();
    const options = buildProjectOptions([
        { "Project Code": "ACTIVE", Company_ID: "C1", archived: false },
        { "Project Code": "OTHER", Company_ID: "C2", archived: false },
        { "Project Code": "LEGACY", Company_ID: "C1", archived: true },
    ], "C1", "LEGACY");

    assert.deepEqual(
        JSON.parse(JSON.stringify(options)),
        [
            { value: "ACTIVE", selected: false, inactiveCurrent: false },
            { value: "LEGACY", selected: true, inactiveCurrent: true },
        ],
    );
});

test("preserves the current project even when no company is selected", async () => {
    const buildProjectOptions = await loadProjectOptions();

    assert.deepEqual(
        JSON.parse(JSON.stringify(buildProjectOptions([], "", "LEGACY"))),
        [{ value: "LEGACY", selected: true, inactiveCurrent: true }],
    );
});

test("review form uses the tested project option builder", async () => {
    const [appSource, htmlSource] = await Promise.all([
        readFile(new URL("../public/app.js", import.meta.url), "utf8"),
        readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    ]);

    assert.match(
        appSource,
        /buildProjectOptions\(\s*projectsList,\s*selectedCompanyId,\s*selectedValue,?\s*\)/,
    );
    assert.match(
        htmlSource,
        /<script src="project-options\.js"><\/script>\s*<script src="app\.js"><\/script>/,
    );
});
