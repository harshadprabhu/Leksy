import { z } from "zod";

/**
 * The canonical Leksy bill. Every ingestion route (push API, pull connector,
 * print capture, OCR) produces this shape; everything downstream consumes it.
 */

const money = z.number().finite().nonnegative();

export const CustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "phone must be E.164, e.g. +919812345678")
    .optional(),
  email: z.email().optional(),
  gstin: z.string().max(15).optional(),
  /** DPDP: customer agreed to receive the digital bill on this channel. */
  consent: z.boolean().default(true),
  language: z.string().max(10).optional(),
});

export const StaffSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(200).optional(),
});

export const CertificateSchema = z.object({
  type: z.string().max(64), // e.g. "BIS_HALLMARK", "IGI", "GIA", "WARRANTY"
  number: z.string().max(128).optional(),
  url: z.url().optional(),
  issuer: z.string().max(200).optional(),
});

export const ItemSchema = z.object({
  sku: z.string().max(128).optional(),
  name: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  category: z.string().max(128).optional(),
  image_url: z.url().optional(),
  qty: z.number().positive(),
  unit: z.string().max(16).optional(),
  unit_price: money,
  discount: money.default(0),
  hsn: z.string().max(16).optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  /** Line amount after discount, before tax. Computed when omitted. */
  amount: money.optional(),
  /** Jewellery-specific attributes. */
  jewellery: z
    .object({
      metal: z.string().max(32).optional(),
      purity: z.string().max(16).optional(),
      gross_wt_g: z.number().nonnegative().optional(),
      net_wt_g: z.number().nonnegative().optional(),
      stone_wt_ct: z.number().nonnegative().optional(),
      rate_per_g: money.optional(),
      making_charges: money.optional(),
      huid: z.string().max(16).optional(),
    })
    .optional(),
  certificates: z.array(CertificateSchema).default([]),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export const TaxLineSchema = z.object({
  type: z.string().max(16), // CGST, SGST, IGST, CESS, VAT
  rate: z.number().min(0).max(100).optional(),
  amount: money,
});

export const PaymentSchema = z.object({
  mode: z.string().max(32), // UPI, CARD, CASH, EMI, GIFT_CARD, OLD_GOLD
  amount: money,
  reference: z.string().max(128).optional(),
});

export const BillSchema = z.object({
  invoice_no: z.string().min(1).max(64),
  store_code: z.string().min(1).max(64),
  issued_at: z.iso.datetime({ offset: true }),
  currency: z.string().length(3).default("INR"),
  type: z.enum(["sale", "return", "exchange", "estimate"]).default("sale"),
  customer: CustomerSchema.default({ consent: true }),
  staff: StaffSchema.optional(),
  items: z.array(ItemSchema).min(1).max(500),
  taxes: z.array(TaxLineSchema).default([]),
  charges: z.array(z.object({ label: z.string().max(100), amount: z.number() })).default([]),
  round_off: z.number().default(0),
  total: money,
  payments: z.array(PaymentSchema).default([]),
  /** GST e-invoice fields for B2B. */
  e_invoice: z
    .object({ irn: z.string().max(64), ack_no: z.string().max(64).optional(), signed_qr: z.string().optional() })
    .optional(),
  loyalty: z
    .object({ points_earned: z.number().optional(), points_balance: z.number().optional(), tier: z.string().optional() })
    .optional(),
  notes: z.string().max(2000).optional(),
  /** Overrides for this bill; otherwise trigger rules decide. */
  template: z.string().max(64).optional(),
  survey: z.string().max(64).optional(),
  /** Anything else the brand wants available to its template as {{meta.*}}. */
  meta: z.record(z.string(), z.unknown()).default({}),
});

export type Bill = z.infer<typeof BillSchema>;
export type BillInput = z.input<typeof BillSchema>;
export type BillItem = z.infer<typeof ItemSchema>;

export interface BillTotals {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  charges: number;
  computed_total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function lineAmount(item: BillItem): number {
  return round2(item.amount ?? item.qty * item.unit_price - item.discount);
}

export function computeTotals(bill: Bill): BillTotals {
  const gross = bill.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const discount = bill.items.reduce((s, i) => s + i.discount, 0);
  const taxable = bill.items.reduce((s, i) => s + lineAmount(i), 0);
  const tax = bill.taxes.reduce((s, t) => s + t.amount, 0);
  const charges = bill.charges.reduce((s, c) => s + c.amount, 0);
  return {
    subtotal: round2(gross),
    discount: round2(discount),
    taxable: round2(taxable),
    tax: round2(tax),
    charges: round2(charges),
    computed_total: round2(taxable + tax + charges + bill.round_off),
  };
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

/** Business checks beyond the schema. Warnings never block sending. */
export function validateBill(bill: Bill, tolerance = 1): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const t = computeTotals(bill);
  if (Math.abs(t.computed_total - bill.total) > tolerance) {
    issues.push({
      code: "total_mismatch",
      message: `items + taxes + charges = ${t.computed_total}, but total is ${bill.total}`,
      severity: "warning",
    });
  }
  const paid = round2(bill.payments.reduce((s, p) => s + p.amount, 0));
  if (bill.payments.length > 0 && Math.abs(paid - bill.total) > tolerance) {
    issues.push({ code: "payment_mismatch", message: `payments ${paid} do not equal total ${bill.total}`, severity: "warning" });
  }
  if (!bill.customer.phone && !bill.customer.email) {
    issues.push({ code: "no_contact", message: "customer has no phone or email; bill cannot be delivered", severity: "warning" });
  }
  if (bill.customer.consent === false) {
    issues.push({ code: "no_consent", message: "customer did not consent; bill will be stored but not sent", severity: "warning" });
  }
  return issues;
}

export function parseBill(input: unknown) {
  return BillSchema.safeParse(input);
}
