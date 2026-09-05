import assert from "node:assert/strict";
import test from "node:test";

import { fetchAllExpenses } from "../api/expenses.js";

function makeSupabase(pages) {
    const calls = [];
    return {
        calls,
        from(table) {
            const call = { table, orders: [], filters: [], range: null };
            calls.push(call);
            const query = {
                select(columns) {
                    call.columns = columns;
                    return query;
                },
                is(column, value) {
                    call.filters.push(["is", column, value]);
                    return query;
                },
                ilike(column, value) {
                    call.filters.push(["ilike", column, value]);
                    return query;
                },
                order(column, options) {
                    call.orders.push([column, options]);
                    return query;
                },
                async range(from, to) {
                    call.range = [from, to];
                    return pages[calls.length - 1];
                },
            };
            return query;
        },
    };
}

test("fetchAllExpenses range-pages beyond Supabase's 1000-row response limit", async () => {
    const first = Array.from({ length: 1000 }, (_, id) => ({ id }));
    const second = Array.from({ length: 1000 }, (_, id) => ({ id: 1000 + id }));
    const third = Array.from({ length: 5 }, (_, id) => ({ id: 2000 + id }));
    const supabase = makeSupabase([
        { data: first, error: null },
        { data: second, error: null },
        { data: third, error: null },
    ]);

    const rows = await fetchAllExpenses(supabase, {
        statusFilter: "Submitted",
        pageSize: 1000,
    });

    assert.equal(rows.length, 2005);
    assert.deepEqual(supabase.calls.map(call => call.range), [
        [0, 999],
        [1000, 1999],
        [2000, 2999],
    ]);
    for (const call of supabase.calls) {
        assert.equal(call.table, "invoices");
        assert.deepEqual(call.filters, [
            ["is", "deleted_at", null],
            ["ilike", "status", "Submitted"],
        ]);
        assert.deepEqual(call.orders.map(order => order[0]), ["created_at", "id"]);
    }
});

test("fetchAllExpenses aborts immediately when any page returns an error", async () => {
    const supabase = makeSupabase([
        { data: Array.from({ length: 2 }, (_, id) => ({ id })), error: null },
        { data: null, error: { message: "page two failed" } },
    ]);

    await assert.rejects(
        fetchAllExpenses(supabase, { pageSize: 2 }),
        /page two failed/,
    );
    assert.deepEqual(supabase.calls.map(call => call.range), [
        [0, 1],
        [2, 3],
    ]);
});
