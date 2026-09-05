import assert from "node:assert/strict";
import test from "node:test";

import { fetchAllExpenses } from "../api/expenses.js";

function makeSupabase(pages) {
    const calls = [];
    return {
        calls,
        from(table) {
            const call = { table, orders: [], filters: [], limit: null };
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
                lt(column, value) {
                    call.filters.push(["lt", column, value]);
                    return query;
                },
                async limit(value) {
                    call.limit = value;
                    return pages[calls.length - 1];
                },
            };
            return query;
        },
    };
}

test("fetchAllExpenses keyset-pages by descending id beyond 1000 rows", async () => {
    const first = Array.from({ length: 1000 }, (_, index) => ({ id: 3000 - index }));
    const second = Array.from({ length: 1000 }, (_, index) => ({ id: 2000 - index }));
    const third = Array.from({ length: 5 }, (_, index) => ({ id: 1000 - index }));
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
    assert.deepEqual(supabase.calls.map(call => call.limit), [1000, 1000, 1000]);
    for (const [index, call] of supabase.calls.entries()) {
        assert.equal(call.table, "invoices");
        const expectedFilters = [
            ["is", "deleted_at", null],
            ["ilike", "status", "Submitted"],
        ];
        if (index > 0) {
            expectedFilters.push(["lt", "id", index === 1 ? 2001 : 1001]);
        }
        assert.deepEqual(call.filters, expectedFilters);
        assert.deepEqual(call.orders.map(order => order[0]), ["id"]);
        assert.equal(call.orders[0][1].ascending, false);
    }
});

test("fetchAllExpenses aborts immediately when any page returns an error", async () => {
    const supabase = makeSupabase([
        { data: [{ id: 2 }, { id: 1 }], error: null },
        { data: null, error: { message: "page two failed" } },
    ]);

    await assert.rejects(
        fetchAllExpenses(supabase, { pageSize: 2 }),
        /page two failed/,
    );
    assert.equal(supabase.calls.length, 2);
    assert.deepEqual(supabase.calls[1].filters.at(-1), ["lt", "id", 1]);
});

test("fetchAllExpenses fails closed when maxPages is exhausted", async () => {
    const supabase = makeSupabase([
        { data: [{ id: 4 }, { id: 3 }], error: null },
        { data: [{ id: 2 }, { id: 1 }], error: null },
    ]);

    await assert.rejects(
        fetchAllExpenses(supabase, { pageSize: 2, maxPages: 2 }),
        /maximum page limit.*2/i,
    );
    assert.equal(supabase.calls.length, 2);
});

test("fetchAllExpenses rejects a non-descending cursor to prevent infinite pagination", async () => {
    const supabase = makeSupabase([
        { data: [{ id: 4 }, { id: 3 }], error: null },
        { data: [{ id: 3 }, { id: 2 }], error: null },
    ]);

    await assert.rejects(
        fetchAllExpenses(supabase, { pageSize: 2 }),
        /cursor did not decrease/i,
    );
});
