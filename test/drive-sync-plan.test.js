import test from "node:test";
import assert from "node:assert/strict";
import {
    buildR2Key,
    canReparse,
    planDriveFileSync,
    sanitizeDriveName,
} from "../lib/drive-sync-plan.js";

const PREFIX = "bui_invoice/original_files/fr_google_drive";

function driveFile(overrides = {}) {
    return {
        id: "1SEOHRRkyRye0vN_aJWgKsWIVZDrP8Um4",
        name: "Your booking confirmation XAGY89.pdf",
        size: "1267645",
        modifiedTime: "2026-09-30T17:45:24.841Z",
        ...overrides,
    };
}

test("sanitizes characters that are illegal in R2 keys", () => {
    assert.equal(
        sanitizeDriveName("Scanned 30 Sep 2026 at 20:45:21.pdf"),
        "Scanned 30 Sep 2026 at 20_45_21.pdf",
    );
    assert.equal(sanitizeDriveName("a/b\\c*d?e\"f<g>h|i.pdf"), "a_b_c_d_e_f_g_h_i.pdf");
});

test("disambiguated keys keep the extension and are stable per drive id", () => {
    const key = buildR2Key(PREFIX, "invoice.pdf", { disambiguateWith: "1SEOHRRkyRye0vN" });
    assert.equal(key, `${PREFIX}/invoice (1SEOHRRk).pdf`);
    assert.equal(key, buildR2Key(PREFIX, "invoice.pdf", { disambiguateWith: "1SEOHRRkyRye0vN" }));
});

test("disambiguates names that have no extension", () => {
    assert.equal(
        buildR2Key(PREFIX, "260929-coffee", { disambiguateWith: "1xpOWEqYOdmfPSq" }),
        `${PREFIX}/260929-coffee (1xpOWEqY)`,
    );
});

test("a brand new drive file is uploaded under its plain name", () => {
    const plan = planDriveFileSync({ driveFile: driveFile(), prefix: PREFIX });
    assert.equal(plan.action, "upload");
    assert.equal(plan.key, `${PREFIX}/Your booking confirmation XAGY89.pdf`);
    assert.equal(plan.reparse, true);
});

test("an unchanged file that we already own is skipped", () => {
    const plan = planDriveFileSync({
        driveFile: driveFile(),
        ownedKey: {
            key: `${PREFIX}/Your booking confirmation XAGY89.pdf`,
            size: 1267645,
            lastModified: new Date("2026-09-30T18:00:00Z"),
        },
        prefix: PREFIX,
    });
    assert.equal(plan.action, "skip");
    assert.equal(plan.reason, "unchanged");
});

// The bug this module exists for: Gmail "save to Drive" over an existing name
// bumped modifiedTime and changed the bytes, but the old sync only checked that
// the key existed and skipped it forever.
test("a file replaced in place is re-uploaded to the same key", () => {
    const plan = planDriveFileSync({
        driveFile: driveFile({ size: "1267645" }),
        namedKey: {
            key: `${PREFIX}/Your booking confirmation XAGY89.pdf`,
            size: 1267726,
            lastModified: new Date("2026-09-22T15:02:14Z"),
        },
        record: {
            id: 10595,
            status: "Waiting for Confirm",
            file_link_r2: `https://pub.example.com/${PREFIX}/Your booking confirmation XAGY89.pdf`,
        },
        prefix: PREFIX,
    });
    assert.equal(plan.action, "replace");
    assert.equal(plan.key, `${PREFIX}/Your booking confirmation XAGY89.pdf`);
    assert.equal(plan.reparse, true);
});

test("metadata-only Drive edits do not trigger a reparse", () => {
    const plan = planDriveFileSync({
        driveFile: driveFile({ modifiedTime: "2026-09-30T17:45:24.841Z" }),
        ownedKey: {
            key: `${PREFIX}/Your booking confirmation XAGY89.pdf`,
            size: 1267645,
            lastModified: new Date("2026-09-22T15:02:14Z"),
        },
        prefix: PREFIX,
    });
    assert.equal(plan.action, "skip");
    assert.equal(plan.reparse, false);
});

test("a different drive file with a taken name gets its own key", () => {
    const plan = planDriveFileSync({
        driveFile: driveFile({ id: "1ctF8kcSZqjmWHtbOTTf41yFHm1sQ8zDk", name: "Receipt_14Sep2026_193207.pdf", size: "224026" }),
        namedKey: {
            key: `${PREFIX}/Receipt_14Sep2026_193207.pdf`,
            size: 224032,
            lastModified: new Date("2026-09-14T23:13:15Z"),
        },
        record: null,
        prefix: PREFIX,
    });
    assert.equal(plan.action, "upload");
    assert.equal(plan.key, `${PREFIX}/Receipt_14Sep2026_193207 (1ctF8kcS).pdf`);
});

test("identical bytes already in R2 are adopted rather than duplicated", () => {
    const plan = planDriveFileSync({
        driveFile: driveFile({ id: "1RpFh3YIKD0-gIm5gLhFNcCoXfFNSqWto", name: "shasx_folio.pdf", size: "188276" }),
        namedKey: {
            key: `${PREFIX}/shasx_folio.pdf`,
            size: 188276,
            lastModified: new Date("2026-07-14T11:21:00Z"),
        },
        record: null,
        prefix: PREFIX,
    });
    assert.equal(plan.action, "adopt");
    assert.equal(plan.reparse, false);
});

test("a submitted invoice is never reparsed", () => {
    assert.equal(canReparse({ status: "Submitted" }), false);
    assert.equal(canReparse({ status: "Waiting for Confirm", charge_to_project: "Neoss-MoEx-2608" }), false);
    assert.equal(canReparse({ status: "Waiting for Confirm", generated_invoice_id: "Neoss-MoEx-2608-0001" }), false);
    assert.equal(canReparse({ status: "Waiting for Confirm", deleted_at: "2026-09-30T15:04:23Z" }), false);
    assert.equal(canReparse({ status: "Waiting for Confirm" }), true);
    assert.equal(canReparse(null), true);
});

test("a replaced file belonging to a submitted invoice keeps its fields", () => {
    const plan = planDriveFileSync({
        driveFile: driveFile({ size: "1267645" }),
        namedKey: {
            key: `${PREFIX}/Your booking confirmation XAGY89.pdf`,
            size: 1267726,
            lastModified: new Date("2026-09-22T15:02:14Z"),
        },
        record: {
            id: 10595,
            status: "Submitted",
            charge_to_project: "Neoss-MoEp-2610",
            file_link_r2: `https://pub.example.com/${PREFIX}/Your booking confirmation XAGY89.pdf`,
        },
        prefix: PREFIX,
    });
    assert.equal(plan.action, "replace");
    assert.equal(plan.reparse, false);
});

test("percent-encoded record links still match the plain key", () => {
    const plan = planDriveFileSync({
        driveFile: driveFile({ size: "1267645" }),
        namedKey: {
            key: `${PREFIX}/Your booking confirmation XAGY89.pdf`,
            size: 1267726,
            lastModified: new Date("2026-09-22T15:02:14Z"),
        },
        record: {
            id: 10595,
            status: "Waiting for Confirm",
            file_link_r2: `https://pub.example.com/${PREFIX}/Your%20booking%20confirmation%20XAGY89.pdf`,
        },
        prefix: PREFIX,
    });
    assert.equal(plan.action, "replace");
});

test("a malformed percent sequence in a stored link does not throw", () => {
    assert.doesNotThrow(() => planDriveFileSync({
        driveFile: driveFile(),
        namedKey: { key: `${PREFIX}/x.pdf`, size: 1, lastModified: new Date() },
        record: { id: 1, status: "Waiting for Confirm", file_link_r2: "https://pub.example.com/100%.pdf" },
        prefix: PREFIX,
    }));
});

test("a missing drive size does not silently skip the file", () => {
    const plan = planDriveFileSync({
        driveFile: driveFile({ size: undefined }),
        ownedKey: {
            key: `${PREFIX}/Your booking confirmation XAGY89.pdf`,
            size: 1267645,
            lastModified: new Date("2026-09-22T15:02:14Z"),
        },
        prefix: PREFIX,
    });
    assert.equal(plan.action, "replace");
});
