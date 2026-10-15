import { computeTotals, lineAmount, type Bill } from "@leksy/bill-schema";
import type { Ctx } from "./expr.js";

export interface BrandInfo {
  name: string;
  logo_url?: string;
  website?: string;
  support_phone?: string;
  instagram?: string;
}

export interface StoreInfo {
  code: string;
  name: string;
  address?: string;
  city?: string;
  phone?: string;
  gstin?: string;
  maps_url?: string;
}

export interface Links {
  page?: string;
  pdf?: string;
  image?: string;
  json?: string;
  verify?: string;
  review?: string;
}

/**
 * The data a template sees. Bill fields sit at the top level ({{customer.name}},
 * {{items}}), next to brand, store, totals and links.
 */
export function buildContext(bill: Bill, extra: { brand: BrandInfo; store: StoreInfo; links?: Links }): Ctx {
  const items = bill.items.map((it, i) => ({ ...it, line_no: i + 1, amount: lineAmount(it) }));
  return {
    ...bill,
    items,
    totals: { ...computeTotals(bill), items_count: items.length, qty: items.reduce((s, i) => s + i.qty, 0) },
    brand: extra.brand,
    store: extra.store,
    links: extra.links ?? {},
  };
}

export interface FieldInfo {
  path: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  sample: string;
}

/**
 * Every bindable path in a context, for the studio's field picker.
 * Arrays are listed once as "items" plus their element fields as "items[].name".
 */
export function listFields(ctx: unknown, prefix = "", out: FieldInfo[] = [], depth = 0): FieldInfo[] {
  if (depth > 6 || ctx == null || typeof ctx !== "object") return out;
  for (const [k, v] of Object.entries(ctx as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      out.push({ path, type: "array", sample: `${v.length} entries` });
      const first = v[0];
      if (first && typeof first === "object") listFields(first, `${path}[]`, out, depth + 1);
    } else if (v && typeof v === "object") {
      listFields(v, path, out, depth + 1);
    } else {
      const type = typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
      out.push({ path, type, sample: v == null ? "" : String(v).slice(0, 60) });
    }
  }
  return out;
}
