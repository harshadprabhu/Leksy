/**
 * The data Insights works on: daily aggregates per store plus a few breakdowns.
 * It never contains customer names, phone numbers or free-text comments, so it is
 * safe to keep in the browser and is the most that can ever be shared outward.
 */

export interface DayRow {
  date: string; // YYYY-MM-DD, store local time
  store: string;
  revenue: number;
  bills: number;
  ratingSum: number;
  ratingCount: number;
  promoters: number;
  detractors: number;
  npsCount: number;
  /** Bills sent to customers and opened by them (optional; dashboard funnel). */
  sent?: number;
  opened?: number;
  /** Responses rated 3 or lower (base for complaint themes). */
  low?: number;
}

export interface StoreInfo {
  code: string;
  name: string;
  city?: string;
  /** North/South/East/West; inferred from the city when missing. */
  region?: string;
  /** City tier (1 = metro, 2 = large city). */
  tier?: 1 | 2;
}

export interface StaffRow {
  id: string;
  name: string;
  store: string;
  bills: number;
  revenue: number;
  ratingSum: number;
  ratingCount: number;
}

export interface Dataset {
  brand: string;
  asOf: string; // YYYY-MM-DD
  stores: StoreInfo[];
  days: DayRow[];
  /** Last `detailDays` days only (bill-level breakdowns). */
  detailDays: number;
  staff: StaffRow[];
  /** Last `detailDays` days, per store when `store` is set. */
  categories: { store?: string; category: string; revenue: number; units: number }[];
  /** Complaint mentions, last `detailDays` days, per store when `store` is set. */
  themes: { store?: string; option: string; count: number }[];
  goldRate?: { date: string; rate: number }[];
}

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

export interface Range {
  from: string;
  to: string; // inclusive
  label: string;
}

export interface Totals {
  revenue: number;
  bills: number;
  abv: number | null;
  rating: number | null;
  responses: number;
  nps: number | null;
}

export function totals(rows: DayRow[]): Totals {
  const t = rows.reduce(
    (a, r) => ({
      revenue: a.revenue + r.revenue,
      bills: a.bills + r.bills,
      ratingSum: a.ratingSum + r.ratingSum,
      ratingCount: a.ratingCount + r.ratingCount,
      promoters: a.promoters + r.promoters,
      detractors: a.detractors + r.detractors,
      npsCount: a.npsCount + r.npsCount,
    }),
    { revenue: 0, bills: 0, ratingSum: 0, ratingCount: 0, promoters: 0, detractors: 0, npsCount: 0 },
  );
  return {
    revenue: t.revenue,
    bills: t.bills,
    abv: t.bills ? t.revenue / t.bills : null,
    rating: t.ratingCount ? t.ratingSum / t.ratingCount : null,
    responses: t.ratingCount,
    nps: t.npsCount ? (100 * (t.promoters - t.detractors)) / t.npsCount : null,
  };
}

export function inRange(ds: Dataset, r: Range, stores?: string[]) {
  const only = stores?.length ? new Set(stores) : null;
  return ds.days.filter((d) => d.date >= r.from && d.date <= r.to && (!only || only.has(d.store)));
}

/** Sum rows by date (all stores together). */
export function daily(rows: DayRow[]): DayRow[] {
  const m = new Map<string, DayRow>();
  for (const r of rows) {
    const a = m.get(r.date) ?? { date: r.date, store: "*", revenue: 0, bills: 0, ratingSum: 0, ratingCount: 0, promoters: 0, detractors: 0, npsCount: 0 };
    a.revenue += r.revenue;
    a.bills += r.bills;
    a.ratingSum += r.ratingSum;
    a.ratingCount += r.ratingCount;
    a.promoters += r.promoters;
    a.detractors += r.detractors;
    a.npsCount += r.npsCount;
    m.set(r.date, a);
  }
  return [...m.values()].sort((x, y) => x.date.localeCompare(y.date));
}

export const inr = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};
export const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const EMPTY = () => ({ revenue: 0, bills: 0, ratingSum: 0, ratingCount: 0, promoters: 0, detractors: 0, npsCount: 0 });

/**
 * One pass over the days: totals per group (store, region, tier, city…).
 * `key` returns the group for a store code, or null to skip it.
 */
export function groupTotals(ds: Dataset, r: Range, key: (store: string) => string | null): Map<string, Totals> {
  const acc = new Map<string, ReturnType<typeof EMPTY>>();
  const cache = new Map<string, string | null>();
  for (const d of ds.days) {
    if (d.date < r.from || d.date > r.to) continue;
    let k = cache.get(d.store);
    if (k === undefined) {
      k = key(d.store);
      cache.set(d.store, k);
    }
    if (k === null) continue;
    const a = acc.get(k) ?? EMPTY();
    a.revenue += d.revenue;
    a.bills += d.bills;
    a.ratingSum += d.ratingSum;
    a.ratingCount += d.ratingCount;
    a.promoters += d.promoters;
    a.detractors += d.detractors;
    a.npsCount += d.npsCount;
    acc.set(k, a);
  }
  const out = new Map<string, Totals>();
  for (const [k, t] of acc) {
    out.set(k, {
      revenue: t.revenue,
      bills: t.bills,
      abv: t.bills ? t.revenue / t.bills : null,
      rating: t.ratingCount ? t.ratingSum / t.ratingCount : null,
      responses: t.ratingCount,
      nps: t.npsCount ? (100 * (t.promoters - t.detractors)) / t.npsCount : null,
    });
  }
  return out;
}

/** Category totals for a set of stores (all when empty), largest first. */
export function categoriesFor(ds: Dataset, stores?: string[]) {
  const only = stores?.length ? new Set(stores) : null;
  const m = new Map<string, { category: string; revenue: number; units: number }>();
  for (const c of ds.categories) {
    if (only && c.store && !only.has(c.store)) continue;
    const a = m.get(c.category) ?? { category: c.category, revenue: 0, units: 0 };
    a.revenue += c.revenue;
    a.units += c.units;
    m.set(c.category, a);
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category));
}

/** Complaint themes for a set of stores (all when empty), most mentioned first. */
export function themesFor(ds: Dataset, stores?: string[]) {
  const only = stores?.length ? new Set(stores) : null;
  const m = new Map<string, number>();
  for (const t of ds.themes) {
    if (only && t.store && !only.has(t.store)) continue;
    m.set(t.option, (m.get(t.option) ?? 0) + t.count);
  }
  return [...m].map(([option, count]) => ({ option, count })).sort((a, b) => b.count - a.count || a.option.localeCompare(b.option));
}

/** The window the bill-level breakdowns (staff, categories, complaints) cover. */
export const detailRange = (ds: Dataset): Range => ({ from: addDays(ds.asOf, -(ds.detailDays - 1)), to: ds.asOf, label: `last ${ds.detailDays} days` });
