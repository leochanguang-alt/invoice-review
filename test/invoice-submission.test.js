import assert from "node:assert/strict";
import test from "node:test";

import {
    buildSubmitMessage,
    requireSingleSubmittedUpdate,
} from "../lib/invoice-submission.js";

test("includes the first concrete failure in the submit summary", () => {
    assert.equal(
        buildSubmitMessage([
            { success: true },
            { success: false, error: "archive length mismatch" },
            { success: false, error: "later error" },
        ]),
        "Submitted 1 record(s), 2 failed: archive length mismatch",
    );
});

test("accepts exactly one conditionally updated invoice", () => {
    assert.deepEqual(
        requireSingleSubmittedUpdate({ data: [{ id: 42 }], error: null }),
        { id: 42 },
    );
});

test("rejects update errors and zero or multiple condition matches", () => {
    assert.throws(
        () => requireSingleSubmittedUpdate({
            data: null,
            error: { message: "database unavailable" },
        }),
        /database unavailable/,
    );
    assert.throws(
        () => requireSingleSubmittedUpdate({ data: [], error: null }),
        /expected exactly one invoice, updated 0/,
    );
    assert.throws(
        () => requireSingleSubmittedUpdate({
            data: [{ id: 1 }, { id: 2 }],
            error: null,
        }),
        /expected exactly one invoice, updated 2/,
    );
});
