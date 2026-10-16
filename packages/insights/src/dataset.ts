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
}

export interface StoreInfo {
  code: string;
  name: string;
  city?: string;
  /** North/South/East/West; inferred from the city when missing. */
  region?: string;
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
  categories: { category: string; revenue: number; units: number }[];
  themes: { option: string; count: number }[];
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
  return ds.days.filter((d) => d.date >= r.from && d.date <= r.to && (!stores?.length || stores.includes(d.store)));
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
