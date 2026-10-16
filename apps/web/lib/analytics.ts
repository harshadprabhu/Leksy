/**
 * Dashboard analytics over the same daily facts Insights uses. Every number on the
 * dashboard comes from these one-pass sums, so the two pages always agree.
 */
import { addDays, regionOf, type Dataset, type DayRow, type Region } from "@leksy/insights";

export interface Acc {
  revenue: number;
  bills: number;
  sent: number;
  opened: number;
  ratingSum: number;
  ratingCount: number;
  promoters: number;
  detractors: number;
  npsCount: number;
  low: number;
}

export const blank = (): Acc => ({ revenue: 0, bills: 0, sent: 0, opened: 0, ratingSum: 0, ratingCount: 0, promoters: 0, detractors: 0, npsCount: 0, low: 0 });

export function add(a: Acc, d: DayRow) {
  a.revenue += d.revenue;
  a.bills += d.bills;
  a.sent += d.sent ?? 0;
  a.opened += d.opened ?? 0;
  a.ratingSum += d.ratingSum;
  a.ratingCount += d.ratingCount;
  a.promoters += d.promoters;
  a.detractors += d.detractors;
  a.npsCount += d.npsCount;
  a.low += d.low ?? 0;
}

export type MetricKey = "revenue" | "bills" | "abv" | "rating" | "nps" | "openRate" | "responseRate";

export const METRICS: Record<MetricKey, { label: string; color: string; kind: "inr" | "count" | "rating" | "nps" | "pct"; higherIsBetter: boolean }> = {
  revenue: { label: "Revenue", color: "#2A78D6", kind: "inr", higherIsBetter: true },
  bills: { label: "Bills", color: "#EB6834", kind: "count", higherIsBetter: true },
  abv: { label: "Avg bill value", color: "#6250D6", kind: "inr", higherIsBetter: true },
  rating: { label: "Happiness", color: "#1BAF7A", kind: "rating", higherIsBetter: true },
  nps: { label: "NPS", color: "#E87BA4", kind: "nps", higherIsBetter: true },
  openRate: { label: "Bills opened", color: "#EDA100", kind: "pct", higherIsBetter: true },
  responseRate: { label: "Survey response", color: "#008300", kind: "pct", higherIsBetter: true },
};

/** A metric's value for a set of sums, or null when it is undefined (no bills, no ratings…). */
export function value(a: Acc, m: MetricKey): number | null {
  switch (m) {
    case "revenue":
      return a.revenue;
    case "bills":
      return a.bills;
    case "abv":
      return a.bills ? a.revenue / a.bills : null;
    case "rating":
      return a.ratingCount ? a.ratingSum / a.ratingCount : null;
    case "nps":
      return a.npsCount ? (100 * (a.promoters - a.detractors)) / a.npsCount : null;
    case "openRate":
      return a.sent ? (100 * a.opened) / a.sent : null;
    case "responseRate":
      return a.opened ? (100 * a.ratingCount) / a.opened : null;
  }
}

export interface Filter {
  region?: Region;
  tier?: 1 | 2;
  city?: string;
  store?: string;
}

export const REGION_COLORS: Record<string, string> = { North: "#2A78D6", South: "#EB6834", East: "#1BAF7A", West: "#EDA100", Other: "#9CA3AF" };
export const PALETTE = ["#2A78D6", "#EB6834", "#1BAF7A", "#EDA100", "#E87BA4", "#008300", "#6250D6", "#E34948", "#0EA5E9", "#A16207"];

export interface StoreMeta {
  code: string;
  name: string;
  city: string;
  region: string;
  tier: 1 | 2 | null;
}

export function storeMeta(ds: Dataset): StoreMeta[] {
  return ds.stores.map((s) => ({ code: s.code, name: s.name, city: s.city ?? "Other", region: regionOf(s) ?? "Other", tier: s.tier ?? null }));
}

/** Store codes that pass the filter (all when the filter is empty). */
export function inScope(meta: StoreMeta[], f: Filter): Set<string> {
  return new Set(meta.filter((s) => (!f.region || s.region === f.region) && (!f.tier || s.tier === f.tier) && (!f.city || s.city === f.city) && (!f.store || s.code === f.store)).map((s) => s.code));
}

export interface Range {
  from: string;
  to: string;
}

/** The comparison period: the same number of days just before. */
export function previousRange(r: Range): Range {
  const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 864e5) + 1;
  return { from: addDays(r.from, -days), to: addDays(r.from, -1) };
}

/**
 * Everything the dashboard draws, in one pass over the days: totals for the
 * period and the one before, a daily series for both, and totals per store.
 */
export function crunch(ds: Dataset, scope: Set<string>, r: Range) {
  const prev = previousRange(r);
  const total = blank();
  const before = blank();
  const byDay = new Map<string, Acc>();
  const byDayPrev = new Map<string, Acc>();
  const byStore = new Map<string, Acc>();
  const byStorePrev = new Map<string, Acc>();
  for (const d of ds.days) {
    if (!scope.has(d.store)) continue;
    if (d.date >= r.from && d.date <= r.to) {
      add(total, d);
      add(byDay.get(d.date) ?? byDay.set(d.date, blank()).get(d.date)!, d);
      add(byStore.get(d.store) ?? byStore.set(d.store, blank()).get(d.store)!, d);
    } else if (d.date >= prev.from && d.date <= prev.to) {
      add(before, d);
      add(byDayPrev.get(d.date) ?? byDayPrev.set(d.date, blank()).get(d.date)!, d);
      add(byStorePrev.get(d.store) ?? byStorePrev.set(d.store, blank()).get(d.store)!, d);
    }
  }
  return { total, before, byDay, byDayPrev, byStore, byStorePrev, prev };
}

/** Sum per-store totals into groups (region, tier, city…). */
export function group(byStore: Map<string, Acc>, meta: StoreMeta[], key: (s: StoreMeta) => string): Map<string, Acc> {
  const out = new Map<string, Acc>();
  const m = new Map(meta.map((s) => [s.code, s]));
  for (const [code, a] of byStore) {
    const s = m.get(code);
    if (!s) continue;
    const k = key(s);
    const g = out.get(k) ?? out.set(k, blank()).get(k)!;
    for (const f of Object.keys(a) as (keyof Acc)[]) g[f] += a[f];
  }
  return out;
}

/** Revenue by weekday (rows Mon–Sun) and week (columns), for the heatmap. */
export function weekdayHeat(byDay: Map<string, Acc>, r: Range, m: MetricKey) {
  const weeks: string[] = [];
  const cells = new Map<string, number | null>();
  for (let t = Date.parse(`${r.from}T00:00:00Z`); t <= Date.parse(`${r.to}T00:00:00Z`); t += 864e5) {
    const date = new Date(t).toISOString().slice(0, 10);
    const dow = (new Date(t).getUTCDay() + 6) % 7;
    const monday = addDays(date, -dow);
    if (!weeks.includes(monday)) weeks.push(monday);
    const a = byDay.get(date);
    cells.set(`${monday}|${dow}`, a ? value(a, m) : null);
  }
  return { weeks, cells };
}

export const fmtInr = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};

export function fmt(v: number | null, m: MetricKey): string {
  if (v == null) return "–";
  const k = METRICS[m].kind;
  if (k === "inr") return fmtInr(v);
  if (k === "count") return Math.round(v).toLocaleString("en-IN");
  if (k === "rating") return v.toFixed(2);
  if (k === "nps") return String(Math.round(v));
  return `${v.toFixed(1)}%`;
}

/** Change vs the previous period: percent for amounts, points for ratings, NPS and rates. */
export function change(cur: number | null, prev: number | null, m: MetricKey): { text: string; good: boolean | null } {
  if (cur == null || prev == null) return { text: "–", good: null };
  const k = METRICS[m].kind;
  if (k === "inr" || k === "count") {
    if (!prev) return { text: "–", good: null };
    const p = (100 * (cur - prev)) / prev;
    return { text: `${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1)}%`, good: p >= 0 };
  }
  const d = cur - prev;
  const digits = k === "rating" ? 2 : 1;
  const unit = k === "pct" ? " pts" : k === "nps" ? " pts" : "";
  return { text: `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(digits)}${unit}`, good: d >= 0 };
}
