import { describe, expect, it } from "vitest";
import { applyMapping, normalizePhone, parseDate, samplePaths, suggestMapping, type Mapping } from "./index.js";

const erp = {
  InvoiceNumber: "T-1009",
  Branch: "MUM-02",
  InvDate: "15/10/2026 18:05",
  Mobile: "098123 45678",
  CustomerName: "Kabir",
  GrandTotal: "1,03,000.00",
  Lines: [
    { ItemName: "Ring", Qty: "1", Rate: "100000", HUID: "AB12CD" },
    { ItemName: "Box", Qty: "2", Rate: "0" },
  ],
};

describe("mapper", () => {
  it("maps nested arrays and transforms", () => {
    const mapping: Mapping = {
      invoice_no: "InvoiceNumber",
      store_code: "Branch",
      issued_at: { from: "InvDate", transform: [{ fn: "date", arg: "DD/MM/YYYY HH:mm" }] },
      "customer.phone": { from: "Mobile", transform: [{ fn: "phone", arg: "91" }] },
      "customer.name": "CustomerName",
      total: { from: "GrandTotal", transform: [{ fn: "number" }] },
      currency: { value: "INR" },
      items: {
        each: {
          from: "Lines",
          fields: {
            name: "ItemName",
            qty: { from: "Qty", transform: [{ fn: "number" }] },
            unit_price: { from: "Rate", transform: [{ fn: "number" }] },
            "jewellery.huid": "HUID",
            store: "$root.Branch",
          },
        },
      },
    };
    const out = applyMapping(mapping, erp);
    expect(out).toMatchObject({
      invoice_no: "T-1009",
      issued_at: "2026-10-15T18:05:00+05:30",
      customer: { phone: "+919812345678", name: "Kabir" },
      total: 103000,
      items: [
        { name: "Ring", qty: 1, unit_price: 100000, jewellery: { huid: "AB12CD" }, store: "MUM-02" },
        { name: "Box", qty: 2, unit_price: 0 },
      ],
    });
  });

  it("normalises phones and dates", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("919812345678")).toBe("+919812345678");
    expect(parseDate("2026-10-15 09:00")).toBe("2026-10-15T09:00:00+05:30");
    expect(parseDate(1_792_000_000)).toMatch(/^2026-/);
  });

  it("refuses prototype pollution", () => {
    expect(() => applyMapping({ "__proto__.x": { value: 1 } }, {})).toThrow();
  });

  it("suggests a mapping from field names", () => {
    const m = suggestMapping(erp);
    expect(m.invoice_no).toBe("InvoiceNumber");
    expect(m.store_code).toBe("Branch");
    expect(m["customer.phone"]).toMatchObject({ from: "Mobile" });
    expect(m.items).toMatchObject({ each: { from: "Lines", fields: { name: "ItemName", "jewellery.huid": "HUID" } } });
  });

  it("lists sample paths", () => {
    expect(samplePaths(erp)).toContain("Lines[0].ItemName");
  });
});
