import { describe, expect, it } from "vitest";
import { BillSchema, computeTotals, validateBill } from "./index.js";

const sample = {
  invoice_no: "INV-1",
  store_code: "BLR-01",
  issued_at: "2026-10-15T14:32:00+05:30",
  customer: { name: "Ananya", phone: "+919812345678" },
  items: [{ name: "Necklace", qty: 1, unit_price: 100000, discount: 0 }],
  taxes: [
    { type: "CGST", rate: 1.5, amount: 1500 },
    { type: "SGST", rate: 1.5, amount: 1500 },
  ],
  total: 103000,
  payments: [{ mode: "UPI", amount: 103000 }],
};

describe("bill schema", () => {
  it("parses a valid bill with defaults", () => {
    const bill = BillSchema.parse(sample);
    expect(bill.currency).toBe("INR");
    expect(bill.customer.consent).toBe(true);
    expect(bill.items[0]!.certificates).toEqual([]);
  });

  it("rejects a non-E.164 phone", () => {
    const r = BillSchema.safeParse({ ...sample, customer: { phone: "98123" } });
    expect(r.success).toBe(false);
  });

  it("computes totals and finds no issues on a consistent bill", () => {
    const bill = BillSchema.parse(sample);
    expect(computeTotals(bill).computed_total).toBe(103000);
    expect(validateBill(bill)).toEqual([]);
  });

  it("warns on total mismatch", () => {
    const bill = BillSchema.parse({ ...sample, total: 99000, payments: [] });
    expect(validateBill(bill).map((i) => i.code)).toContain("total_mismatch");
  });
});
