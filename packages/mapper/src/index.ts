import { z } from "zod";

/**
 * No-code field mapping: turns any JSON a POS/ERP sends (or returns from its
 * API) into the canonical Leksy bill. A mapping is data, edited in the UI.
 *
 *   {
 *     "invoice_no": "InvoiceNumber",
 *     "issued_at": { "from": "InvDate", "transform": [{ "fn": "date", "arg": "DD/MM/YYYY HH:mm" }] },
 *     "customer.phone": { "from": "Mobile", "transform": [{ "fn": "phone", "arg": "91" }] },
 *     "items": { "each": { "from": "Lines", "fields": { "name": "ItemName", "qty": { "from": "Qty", "transform": [{ "fn": "number" }] } } } }
 *   }
 */

export const TransformSchema = z.object({
  fn: z.enum(["number", "string", "boolean", "trim", "upper", "lower", "phone", "date", "multiply", "divide", "round", "lookup", "split", "first", "concat"]),
  arg: z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]).optional(),
});
export type Transform = z.infer<typeof TransformSchema>;

export type Rule =
  | string
  | {
      from?: string;
      /** A constant value. */
      value?: unknown;
      /** A string with {{source.path}} placeholders. */
      template?: string;
      transform?: Transform[];
      default?: unknown;
      each?: { from: string; fields: Mapping };
      /** Build an array from fixed entries, e.g. taxes from separate CGST/SGST columns. Entries whose `required` field is empty are dropped. */
      list?: { entries: Mapping[]; required?: string };
    };
export type Mapping = { [target: string]: Rule };

export const RuleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.union([
    z.string().max(300),
    z.object({
      from: z.string().max(300).optional(),
      value: z.unknown().optional(),
      template: z.string().max(1000).optional(),
      transform: z.array(TransformSchema).max(10).optional(),
      default: z.unknown().optional(),
      each: z.object({ from: z.string().max(300), fields: MappingSchema }).optional(),
      list: z.object({ entries: z.array(MappingSchema).max(20), required: z.string().max(100).optional() }).optional(),
    }),
  ]),
) as z.ZodType<Rule>;
export const MappingSchema: z.ZodType<Mapping> = z.lazy(() => z.record(z.string().max(300), RuleSchema)) as z.ZodType<Mapping>;

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

function splitPath(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
}

export function getPath(obj: unknown, path: string): unknown {
  if (path === "" || path === "$") return obj;
  let cur: unknown = obj;
  for (const p of splitPath(path.replace(/^\$\.?/, ""))) {
    if (FORBIDDEN.has(p) || cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = splitPath(path);
  let cur: Record<string, unknown> = obj;
  parts.forEach((p, i) => {
    if (FORBIDDEN.has(p)) throw new Error(`forbidden path segment: ${p}`);
    if (i === parts.length - 1) {
      cur[p] = value;
      return;
    }
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  });
}

/** Parse a date written in a known pattern (DD, MM, YYYY, HH, mm, ss) as local time at the given offset. */
export function parseDate(value: unknown, pattern = "auto", offset = "+05:30"): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  const s = String(value).trim();
  if (pattern === "auto") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) return `${s.replace(" ", "T")}${s.length === 16 ? ":00" : ""}${offset}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00${offset}`;
    if (/^\d{10,13}$/.test(s)) return parseDate(Number(s));
    // Indian ERPs mostly write day first.
    for (const p of ["DD/MM/YYYY HH:mm:ss", "DD/MM/YYYY HH:mm", "DD/MM/YYYY", "DD-MM-YYYY HH:mm:ss", "DD-MM-YYYY HH:mm", "DD-MM-YYYY", "DD.MM.YYYY HH:mm", "DD.MM.YYYY"]) {
      const out = parseDate(s, p, offset);
      if (out) return out;
    }
    return undefined;
  }
  const tokens = pattern.match(/YYYY|MM|DD|HH|mm|ss/g) ?? [];
  const re = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/YYYY/, "(\\d{4})").replace(/MM/, "(\\d{1,2})").replace(/DD/, "(\\d{1,2})").replace(/HH/, "(\\d{1,2})").replace(/mm/, "(\\d{2})").replace(/ss/, "(\\d{2})"));
  const m = s.match(re);
  if (!m || m[0].length !== s.length) return undefined;
  const parts: Record<string, string> = { YYYY: "1970", MM: "01", DD: "01", HH: "00", mm: "00", ss: "00" };
  tokens.forEach((t, i) => (parts[t] = (m[i + 1] ?? parts[t]!).padStart(2, "0")));
  return `${parts.YYYY}-${parts.MM}-${parts.DD}T${parts.HH}:${parts.mm}:${parts.ss}${offset}`;
}

/** Normalise a phone number to E.164, assuming a default country code. */
export function normalizePhone(value: unknown, countryCode = "91"): string | undefined {
  if (value == null) return undefined;
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return undefined;
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  const local = digits.replace(/^0+/, "");
  if (local.startsWith(countryCode) && local.length > 10) return `+${local}`;
  return `+${countryCode}${local}`;
}

function applyTransform(v: unknown, t: Transform, source: unknown): unknown {
  switch (t.fn) {
    case "number": {
      if (v == null || v === "") return undefined;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s₹]/g, ""));
      return Number.isNaN(n) ? undefined : n;
    }
    case "string":
      return v == null ? v : String(v);
    case "boolean":
      return typeof v === "boolean" ? v : ["true", "1", "yes", "y"].includes(String(v).toLowerCase());
    case "trim":
      return typeof v === "string" ? v.trim() : v;
    case "upper":
      return typeof v === "string" ? v.toUpperCase() : v;
    case "lower":
      return typeof v === "string" ? v.toLowerCase() : v;
    case "phone":
      return normalizePhone(v, typeof t.arg === "string" ? t.arg : "91");
    case "date":
      return parseDate(v, typeof t.arg === "string" ? t.arg : "auto");
    case "multiply":
      return typeof v === "number" ? v * Number(t.arg ?? 1) : v;
    case "divide":
      return typeof v === "number" ? v / Number(t.arg ?? 1) : v;
    case "round":
      return typeof v === "number" ? Math.round(v * 10 ** Number(t.arg ?? 2)) / 10 ** Number(t.arg ?? 2) : v;
    case "lookup": {
      const table = (t.arg && typeof t.arg === "object" ? t.arg : {}) as Record<string, unknown>;
      return v != null && String(v) in table ? table[String(v)] : v;
    }
    case "split":
      return typeof v === "string" ? v.split(typeof t.arg === "string" ? t.arg : ",").map((s) => s.trim()) : v;
    case "first":
      return Array.isArray(v) ? v[0] : v;
    case "concat":
      return `${v ?? ""}${typeof t.arg === "string" ? interpolateSource(t.arg, source) : ""}`;
  }
}

function interpolateSource(tpl: string, source: unknown): string {
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p: string) => {
    const v = getPath(source, p);
    return v == null ? "" : String(v);
  });
}

function evalRule(rule: Rule, source: unknown): unknown {
  if (typeof rule === "string") return getPath(source, rule);
  if (rule.each) {
    const arr = getPath(source, rule.each.from);
    const list = Array.isArray(arr) ? arr : arr != null ? [arr] : [];
    return list.map((el) => applyMapping(rule.each!.fields, el, source));
  }
  if (rule.list) {
    return rule.list.entries.map((m) => applyMapping(m, source)).filter((o) => !rule.list!.required || (getPath(o, rule.list!.required) !== undefined && getPath(o, rule.list!.required) !== ""));
  }
  let v: unknown = rule.value !== undefined ? rule.value : rule.template !== undefined ? interpolateSource(rule.template, source) : rule.from !== undefined ? getPath(source, rule.from) : undefined;
  for (const t of rule.transform ?? []) v = applyTransform(v, t, source);
  if ((v === undefined || v === null || v === "") && rule.default !== undefined) v = rule.default;
  return v;
}

/**
 * Apply a mapping to a source object. Inside `each`, a path starting with "$root."
 * reads from the top-level document instead of the current element.
 */
export function applyMapping(mapping: Mapping, source: unknown, root: unknown = source): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [target, rule] of Object.entries(mapping)) {
    const scoped = typeof rule === "string" && rule.startsWith("$root.") ? getPath(root, rule.slice(6)) : evalRule(rule, source);
    if (scoped !== undefined) setPath(out, target, scoped);
  }
  return out;
}

/** Walk every leaf path of a sample payload, for the mapper UI's source picker. */
export function samplePaths(obj: unknown, prefix = "", out: string[] = []): string[] {
  if (obj == null || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] === "object") samplePaths(obj[0], `${prefix}[0]`, out);
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      out.push(p);
      if (v.length && typeof v[0] === "object") samplePaths(v[0], `${p}[0]`, out);
    } else if (v && typeof v === "object") samplePaths(v, p, out);
    else out.push(p);
  }
  return out;
}

const SYNONYMS: Record<string, string[]> = {
  invoice_no: ["invoiceno", "invoicenumber", "billno", "billnumber", "invno", "docno", "receiptno", "vchno", "voucherno"],
  store_code: ["storecode", "storeid", "branchcode", "branch", "outlet", "outletcode", "location", "locationcode", "siteid"],
  issued_at: ["date", "invoicedate", "billdate", "createdat", "datetime", "txndate", "transactiondate", "timestamp", "invdate"],
  total: ["total", "grandtotal", "nettotal", "netamount", "billamount", "invoiceamount", "totalamount", "amountpayable"],
  round_off: ["roundoff", "rounding"],
  "customer.name": ["customername", "custname", "name", "partyname", "clientname"],
  "customer.phone": ["mobile", "mobileno", "phone", "phoneno", "contactno", "customermobile", "custmobile", "whatsapp"],
  "customer.email": ["email", "emailid", "customeremail"],
  "staff.id": ["staffid", "salesmanid", "employeeid", "cashierid", "userid"],
  "staff.name": ["staffname", "salesman", "salesperson", "cashier", "employeename"],
  items: ["items", "lines", "lineitems", "products", "details", "itemdetails", "billitems"],
  name: ["itemname", "productname", "name", "description", "itemdesc"],
  sku: ["sku", "itemcode", "productcode", "barcode", "code"],
  qty: ["qty", "quantity", "pcs", "units"],
  unit_price: ["rate", "price", "unitprice", "mrp", "sellingprice"],
  discount: ["discount", "disc", "discountamount"],
  hsn: ["hsn", "hsncode", "hsnsac"],
  amount: ["amount", "lineamount", "linetotal", "value", "taxablevalue", "taxableamount"],
  "jewellery.huid": ["huid", "hallmarkid", "hallmarkuid"],
  "jewellery.purity": ["purity", "karat", "carat", "kt"],
  "jewellery.gross_wt_g": ["grosswt", "grossweight", "gwt"],
  "jewellery.net_wt_g": ["netwt", "netweight", "nwt"],
  "jewellery.making_charges": ["making", "makingcharges", "mc", "labour"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Suggest a mapping from a sample payload by matching field names to known
 * synonyms. The UI shows suggestions for a person to confirm or change.
 */
export function suggestMapping(sample: Record<string, unknown>): Mapping {
  const mapping: Mapping = {};
  const keys = Object.keys(sample);
  const find = (target: string, pool: string[]) => {
    const syn = SYNONYMS[target] ?? [norm(target)];
    return pool.find((k) => syn.includes(norm(k))) ?? pool.find((k) => syn.some((s) => norm(k).endsWith(s) && s.length > 3));
  };
  for (const target of ["invoice_no", "store_code", "issued_at", "total", "round_off", "customer.name", "customer.phone", "customer.email", "staff.id", "staff.name"]) {
    const k = find(target, keys);
    if (!k) continue;
    if (target === "customer.phone") mapping[target] = { from: k, transform: [{ fn: "phone", arg: "91" }] };
    else if (target === "issued_at") mapping[target] = { from: k, transform: [{ fn: "date", arg: "auto" }] };
    else if (["total", "round_off"].includes(target)) mapping[target] = { from: k, transform: [{ fn: "number" }] };
    else mapping[target] = k;
  }
  const taxEntries: Mapping[] = [];
  for (const t of ["CGST", "SGST", "IGST", "UTGST", "CESS", "VAT"]) {
    const k = keys.find((x) => norm(x) === t.toLowerCase() || norm(x) === `${t.toLowerCase()}amount` || norm(x) === `${t.toLowerCase()}amt`);
    if (!k) continue;
    const rateKey = keys.find((x) => norm(x) === `${t.toLowerCase()}rate` || norm(x) === `${t.toLowerCase()}per` || norm(x) === `${t.toLowerCase()}percent`);
    taxEntries.push({ type: { value: t }, amount: { from: k, transform: [{ fn: "number" }] }, ...(rateKey ? { rate: { from: rateKey, transform: [{ fn: "number" }] } } : {}) });
  }
  if (taxEntries.length) mapping.taxes = { list: { entries: taxEntries, required: "amount" } };
  const itemsKey = find("items", keys.filter((k) => Array.isArray(sample[k])));
  if (itemsKey) {
    const first = (sample[itemsKey] as unknown[])[0];
    const itemKeys = first && typeof first === "object" ? Object.keys(first) : [];
    const fields: Mapping = {};
    for (const target of ["name", "sku", "qty", "unit_price", "discount", "hsn", "amount", "jewellery.huid", "jewellery.purity", "jewellery.gross_wt_g", "jewellery.net_wt_g", "jewellery.making_charges"]) {
      const k = find(target, itemKeys);
      if (!k) continue;
      const numeric = ["qty", "unit_price", "discount", "amount", "jewellery.gross_wt_g", "jewellery.net_wt_g", "jewellery.making_charges"].includes(target);
      fields[target] = numeric ? { from: k, transform: [{ fn: "number" }] } : k;
    }
    mapping.items = { each: { from: itemsKey, fields } };
  }
  return mapping;
}
