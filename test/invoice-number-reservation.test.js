import assert from "node:assert/strict";
import test from "node:test";

import { reserveInvoiceNumber } from "../lib/invoice-number-reservation.js";

class ReservationFake {
    constructor() {
        this.calls = [];
        this.reservations = new Map();
    }

    async rpc(name, input) {
        this.calls.push({ name, input });
        let reservation = this.reservations.get(input.p_invoice_id);
        if (!reservation) {
            reservation = {
                project_sequence: this.reservations.size + 1,
                generated_invoice_id: `${input.p_project_code}-0001-1235EUR`,
            };
            this.reservations.set(input.p_invoice_id, reservation);
        }
        return { data: [reservation], error: null };
    }
}

test("maps reservation RPC arguments and snake_case result", async () => {
    const supabase = new ReservationFake();

    const result = await reserveInvoiceNumber(supabase, {
        invoiceId: 42,
        projectCode: "Project-A",
        amount: "1,234.50",
        currency: " eur ",
    });

    assert.deepEqual(supabase.calls, [{
        name: "reserve_invoice_number",
        input: {
            p_invoice_id: 42,
            p_project_code: "Project-A",
            p_amount: 1234.5,
            p_currency: "EUR",
        },
    }]);
    assert.deepEqual(result, {
        projectSequence: 1,
        generatedInvoiceId: "Project-A-0001-1235EUR",
    });
});

test("throws the reservation RPC error", async () => {
    const supabase = {
        async rpc() {
            return { data: null, error: { message: "reservation failed" } };
        },
    };

    await assert.rejects(
        reserveInvoiceNumber(supabase, {
            invoiceId: 42,
            projectCode: "Project-A",
            amount: 10,
            currency: "EUR",
        }),
        /reservation failed/,
    );
});

test("returns the same reserved invoice number on retry", async () => {
    const supabase = new ReservationFake();
    const input = {
        invoiceId: 42,
        projectCode: "Project-A",
        amount: 1234.5,
        currency: "EUR",
    };

    const first = await reserveInvoiceNumber(supabase, input);
    const retry = await reserveInvoiceNumber(supabase, input);

    assert.deepEqual(retry, first);
    assert.equal(supabase.calls.length, 2);
});
