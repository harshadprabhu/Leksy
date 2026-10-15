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
  count: (v) => (Array.isArray(v) ? v.length : 0),
  sum: (v, arg) => (Array.isArray(v) ? v.reduce((s: number, el) => s + (toNumber(arg ? getPath(el, arg) : el) ?? 0), 0) : 0),
  join: (v, arg) => (Array.isArray(v) ? v.join(arg ?? ", ") : v),
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

/** Paths a template references; used to warn when a binding has no data. */
export function referencedPaths(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)].map((m) => m[1]!.trim());
}
