import { BillSchema, type Bill } from "@leksy/bill-schema";
import type { BrandInfo, StoreInfo } from "./context.js";

export const SAMPLE_BILL: Bill = BillSchema.parse({
  invoice_no: "AUR-BLR-2026-00981",
  store_code: "BLR-INDIRANAGAR",
  issued_at: "2026-10-15T14:32:00+05:30",
  customer: { name: "Ananya Rao", phone: "+919812345678", email: "ananya@example.com" },
  staff: { id: "S-114", name: "Rahul" },
  items: [
    {
      sku: "NK-22K-0091",
      name: "Temple Necklace",
      category: "Necklace",
      qty: 1,
      unit_price: 184_388,
      hsn: "7113",
      tax_rate: 3,
      jewellery: { metal: "Gold", purity: "22K", gross_wt_g: 24.6, net_wt_g: 23.9, rate_per_g: 7120, making_charges: 14_220, huid: "AB12CD" },
      certificates: [{ type: "BIS_HALLMARK", number: "AB12CD", issuer: "Bureau of Indian Standards" }],
    },
    {
      sku: "ER-18K-D-0412",
      name: "Solitaire Studs",
      category: "Earrings",
      qty: 1,
      unit_price: 96_500,
      discount: 4_825,
      hsn: "7113",
      tax_rate: 3,
      jewellery: { metal: "Gold", purity: "18K", gross_wt_g: 3.2, net_wt_g: 2.9, stone_wt_ct: 0.5, huid: "ZX98QW" },
      certificates: [{ type: "IGI", number: "LG612345678", issuer: "International Gemological Institute", url: "https://www.igi.org/verify-your-report/" }],
    },
  ],
  taxes: [
    { type: "CGST", rate: 1.5, amount: 4140.95 },
    { type: "SGST", rate: 1.5, amount: 4140.95 },
  ],
  round_off: 0.1,
  total: 284_345,
  payments: [
    { mode: "UPI", amount: 200_000 },
    { mode: "CARD", amount: 84_345 },
  ],
  loyalty: { points_earned: 2843, points_balance: 12_410, tier: "Gold" },
  meta: { gold_rate_22k: 7120, gold_rate_24k: 7768 },
});

export const SAMPLE_BRAND: BrandInfo = { name: "Aurum & Co.", website: "https://example.com", support_phone: "+91 80 4000 1234" };

export const SAMPLE_STORE: StoreInfo = {
  code: "BLR-INDIRANAGAR",
  name: "Aurum & Co. Indiranagar",
  address: "100 Feet Road, Indiranagar",
  city: "Bengaluru",
  phone: "+91 80 4000 1234",
  gstin: "29ABCDE1234F1Z5",
};
