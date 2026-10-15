import { BillSchema, validateBill, type Bill } from "@leksy/bill-schema";
import { and, eq, sql } from "drizzle-orm";
import { canonicalJson, randomToken } from "../crypto.js";
import { bills, events, stores, type Db } from "../db/index.js";

export class IngestError extends Error {
  constructor(
    message: string,
    public readonly details: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export interface IngestOptions {
  source: "api" | "push" | "pull" | "ocr" | "print" | "manual";
  connectorId?: string;
  raw?: unknown;
  /** Create the store row on first sight instead of rejecting unknown stores. */
  autoCreateStore?: boolean;
}

export interface IngestResult {
  id: string;
  token: string;
  created: boolean;
  changed: boolean;
  bill: Bill;
  issues: ReturnType<typeof validateBill>;
}

/**
 * Store a bill idempotently. The natural key is (brand, store, invoice_no):
 * re-sending the same bill returns the existing record; sending changed data
 * updates it and reports `changed` so `bill.updated` triggers can fire.
 */
export async function ingestBill(db: Db, brandId: string, input: unknown, opts: IngestOptions): Promise<IngestResult> {
  const parsed = BillSchema.safeParse(input);
  if (!parsed.success) {
    throw new IngestError(
      "Bill failed validation",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const bill = parsed.data;
  const issues = validateBill(bill);

  const store = await db.query.stores.findFirst({ where: and(eq(stores.brandId, brandId), eq(stores.code, bill.store_code)) });
  if (!store) {
    if (!opts.autoCreateStore) throw new IngestError("Unknown store", [{ path: "store_code", message: `No store with code ${bill.store_code}` }]);
    await db.insert(stores).values({ brandId, code: bill.store_code, name: bill.store_code }).onConflictDoNothing();
  }

  const values = {
    brandId,
    storeCode: bill.store_code,
    invoiceNo: bill.invoice_no,
    source: opts.source,
    connectorId: opts.connectorId,
    raw: opts.raw ?? null,
    data: bill,
    total: bill.total.toFixed(2),
    issuedAt: new Date(bill.issued_at),
    customerPhone: bill.customer.phone ?? null,
    customerEmail: bill.customer.email ?? null,
    staffId: bill.staff?.id ?? null,
    issues,
  };

  const inserted = await db
    .insert(bills)
    .values({ ...values, token: randomToken(22) })
    .onConflictDoNothing({ target: [bills.brandId, bills.storeCode, bills.invoiceNo] })
    .returning({ id: bills.id, token: bills.token });

  if (inserted[0]) {
    await db.insert(events).values({ brandId, billId: inserted[0].id, type: "bill.received", data: { source: opts.source } });
    return { ...inserted[0], created: true, changed: true, bill, issues };
  }

  const existing = await db.query.bills.findFirst({
    where: and(eq(bills.brandId, brandId), eq(bills.storeCode, bill.store_code), eq(bills.invoiceNo, bill.invoice_no)),
  });
  if (!existing) throw new Error("bill vanished during upsert");
  // jsonb does not keep key order, so compare canonical forms.
  const changed = canonicalJson(existing.data) !== canonicalJson(bill);
  if (changed) {
    await db.update(bills).set({ ...values, updatedAt: sql`now()` }).where(eq(bills.id, existing.id));
    await db.insert(events).values({ brandId, billId: existing.id, type: "bill.updated", data: { source: opts.source } });
  }
  // A bill that was stored but never processed (e.g. the queue was down) is still "new".
  if (existing.status === "received") return { id: existing.id, token: existing.token, created: true, changed: true, bill, issues };
  return { id: existing.id, token: existing.token, created: false, changed, bill, issues };
}
