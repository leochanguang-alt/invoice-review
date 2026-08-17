import assert from "node:assert/strict";
import test from "node:test";

import { mergeProjectFileKeys } from "../api/export-zip.js";

test("merges current-folder and archived invoice keys without duplicates", () => {
    const currentFolderKeys = [
        "bui_invoice/projects/NEOSS-MoEp-2606/new-1.pdf",
        "bui_invoice/projects/NEOSS-MoEp-2606/shared.pdf",
    ];
    const archivedInvoiceKeys = [
        "bui_invoice/projects/NEOSS-MoEp-2506/old-1.pdf",
        "bui_invoice/projects/NEOSS-MoEp-2606/shared.pdf",
    ];

    assert.deepEqual(
        mergeProjectFileKeys(currentFolderKeys, archivedInvoiceKeys),
        [
            "bui_invoice/projects/NEOSS-MoEp-2606/new-1.pdf",
            "bui_invoice/projects/NEOSS-MoEp-2606/shared.pdf",
            "bui_invoice/projects/NEOSS-MoEp-2506/old-1.pdf",
        ],
    );
});
