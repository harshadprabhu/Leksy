/**
 * Data binding for templates: "{{ customer.name | upper }}".
 * Paths support dots and indexes (items.0.name, items[0].name).
 * Formatters are a fixed, safe list — no code execution.
 */

export type Ctx = Record<string, unknown>;

export function getPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    if (p === "__proto__" || p === "constructor" || p === "prototype") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Collect values along a path where "[]" fans out over arrays: items[].jewellery.huid */
export function getAll(obj: unknown, path: string): unknown[] {
  const i = path.indexOf("[]");
  if (i === -1) {
    const v = getPath(obj, path);
    return v === undefined ? [] : [v];
  }
  const head = getPath(obj, path.slice(0, i));
  const rest = path.slice(i + 2).replace(/^\./, "");
  if (!Array.isArray(head)) return [];
  return head.flatMap((el) => (rest ? getAll(el, rest) : [el]));
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/** Format a date as written in the bill (keeps the store's local time from the ISO offset). */
function formatDate(v: unknown, pattern: string): string {
  if (typeof v !== "string") return "";
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return v;
  const [, y, mo, d, hh, mm] = m;
  const h = Number(hh ?? 0);
  const map: Record<string, string> = {
    YYYY: y!,
    MMM: MONTHS[Number(mo) - 1] ?? mo!,
    MM: mo!,
    DD: d!,
    HH: hh ?? "00",
    hh: String(((h + 11) % 12) + 1).padStart(2, "0"),
    mm: mm ?? "00",
    A: h < 12 ? "AM" : "PM",
  };
  return pattern.replace(/YYYY|MMM|MM|DD|HH|hh|mm|A/g, (t) => map[t] ?? t);
}

export const FORMATTERS: Record<string, (v: unknown, arg?: string) => unknown> = {
  inr: (v) => {
    const n = toNumber(v);
    return n === undefined ? "" : inr.format(n);
  },
  currency: (v, arg) => {
    const n = toNumber(v);
    if (n === undefined) return "";
    try {
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: arg || "INR" }).format(n);
    } catch {
      return n.toFixed(2);
    }
  },
  number: (v, arg) => {
    const n = toNumber(v);
    const digits = arg ? Number(arg) : 2;
    return n === undefined ? "" : n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  grams: (v) => {
    const n = toNumber(v);
    return n === undefined ? "" : `${n.toFixed(3)} g`;
  },
  percent: (v) => {
    const n = toNumber(v);
    return n === undefined ? "" : `${n}%`;
  },
  date: (v, arg) => formatDate(v, arg || "DD MMM YYYY"),
  datetime: (v, arg) => formatDate(v, arg || "DD MMM YYYY, hh:mm A"),
  upper: (v) => (v == null ? "" : String(v).toUpperCase()),
  lower: (v) => (v == null ? "" : String(v).toLowerCase()),
  title: (v) => (v == null ? "" : String(v).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())),
  default: (v, arg) => (v == null || v === "" ? (arg ?? "") : v),
  /** Add text before/after a value only when the value is present. */
  prefix: (v, arg) => (v == null || v === "" ? "" : `${arg ?? ""}${v}`),
  suffix: (v, arg) => (v == null || v === "" ? "" : `${v}${arg ?? ""}`),
  count: (v) => (Array.isArray(v) ? v.length : 0),
  sum: (v, arg) => (Array.isArray(v) ? v.reduce((s: number, el) => s + (toNumber(arg ? getPath(el, arg) : el) ?? 0), 0) : 0),
  join: (v, arg) => (Array.isArray(v) ? v.join(arg ?? ", ") : v),
  /** Rupees in words, Indian system: "Rupees One Lakh Three Thousand and Fifty Paise Only". */
  words: (v) => {
    const n = toNumber(v);
    return n == null ? "" : rupeesInWords(n);
  },
  mask: (v) => {
    const s = v == null ? "" : String(v);
    return s.length <= 4 ? s : `${"•".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
  },
};

interface Pipe {
  name: string;
  arg?: string;
}

function parseExpression(expr: string): { path: string; pipes: Pipe[] } {
  const [path, ...rest] = expr.split("|").map((s) => s.trim());
  const pipes = rest.map((p) => {
    const idx = p.indexOf(":");
    if (idx === -1) return { name: p };
    let arg = p.slice(idx + 1).trim();
    if (/^(["']).*\1$/.test(arg)) arg = arg.slice(1, -1);
    return { name: p.slice(0, idx).trim(), arg };
  });
  return { path: path ?? "", pipes };
}

export function evaluate(expr: string, ctx: Ctx): unknown {
  const { path, pipes } = parseExpression(expr);
  let v: unknown = /^(["']).*\1$/.test(path) ? path.slice(1, -1) : getPath(ctx, path);
  for (const p of pipes) {
    const f = FORMATTERS[p.name];
    if (f) v = f(v, p.arg);
  }
  return v;
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  if (typeof v === "object") return "";
  return String(v);
}

/** Replace every {{ ... }} in a string with its value (plain text, not escaped). */
export function interpolate(template: string, ctx: Ctx): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, e: string) => stringify(evaluate(e, ctx)));
}

/** True when a template string has bindings and every one of them is empty. */
export function allBindingsEmpty(template: string, ctx: Ctx): boolean {
  const exprs = [...template.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]!);
  return exprs.length > 0 && exprs.every((e) => stringify(evaluate(e.split("|")[0]!, ctx)) === "");
}

/** Paths a template references; used to warn when a binding has no data. */
export function referencedPaths(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)].map((m) => m[1]!.trim());
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const twoDigits = (n: number) => (n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const threeDigits = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", n % 100 ? twoDigits(n % 100) : ""].filter(Boolean).join(" ");

/** Whole rupees and paise in words, Indian grouping (crore, lakh, thousand). */
export function rupeesInWords(amount: number): string {
  const paiseTotal = Math.round(Math.abs(amount) * 100);
  let r = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  const parts: string[] = [];
  const crore = Math.floor(r / 1e7);
  r %= 1e7;
  if (crore) parts.push(`${crore >= 1000 ? rupeesInWords(crore).replace(/^Rupees | Only$/g, "") : crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  const lakh = Math.floor(r / 1e5);
  r %= 1e5;
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  const thousand = Math.floor(r / 1000);
  r %= 1000;
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (r) parts.push(threeDigits(r));
  const rupees = parts.length ? parts.join(" ") : "Zero";
  return `Rupees ${rupees}${paise ? ` and ${twoDigits(paise)} Paise` : ""} Only`;
}
