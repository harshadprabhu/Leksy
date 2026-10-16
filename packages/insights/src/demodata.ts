/**
 * The demo's single source of truth: two years of daily totals per store
 * (generated) plus every itemised sample bill added on top. Staff, category and
 * complaint breakdowns are cut from those same totals with exact integer
 * splitting, so every view of the data reconciles to the rupee.
 */
import { addDays, type Dataset, type DayRow, type StaffRow, type StoreInfo } from "./dataset.js";
import { simulateHistory } from "./simulate.js";

export interface SampleBill {
  date: string; // store-local YYYY-MM-DD
  store: string;
  total: number;
  sent: boolean;
  opened: boolean;
  staff?: { id: string; name: string };
  items: { category: string; amount: number }[];
  feedback?: { rating: number; nps?: number | null; improve?: string[] };
}

/** Small deterministic hash → [0, 1). */
export function unit(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const FIRST = ["Rahul", "Priya", "Arjun", "Fatima", "Vikram", "Ananya", "Joseph", "Meera", "Karan", "Sneha", "Imran", "Divya", "Rohan", "Kavya", "Sanjay", "Neha", "Aditya", "Pooja", "Farhan", "Lakshmi", "Suresh", "Ritika", "Manoj", "Asha"];
const LAST = ["S", "K", "R", "M", "P", "D", "N", "G", "T", "B"];

/** The staff of a store (3–5 people), identical wherever it is asked for. */
export function staffFor(store: string): { id: string; name: string }[] {
  const n = 3 + Math.floor(unit(store, 1) * 3);
  return Array.from({ length: n }, (_, i) => ({
    id: `${store}-S${i + 1}`,
    name: `${FIRST[Math.floor(unit(store, 10 + i) * FIRST.length)]!} ${LAST[Math.floor(unit(store, 30 + i) * LAST.length)]!}.`,
  }));
}

export const CATEGORIES: { name: string; avgPrice: number; share: number }[] = [
  { name: "Necklace", avgPrice: 185000, share: 0.27 },
  { name: "Bangles", avgPrice: 140000, share: 0.17 },
  { name: "Earrings", avgPrice: 62000, share: 0.16 },
  { name: "Rings", avgPrice: 48000, share: 0.13 },
  { name: "Mangalsutra", avgPrice: 90000, share: 0.08 },
  { name: "Bracelet", avgPrice: 110000, share: 0.07 },
  { name: "Coins", avgPrice: 38000, share: 0.07 },
  { name: "Pendant", avgPrice: 42000, share: 0.05 },
];

export const THEMES = ["Waiting time", "Staff help", "Billing", "Product range", "Pricing", "Store ambience"];

/** Split an integer total over weights so the parts are integers that add up exactly. */
export function splitExact(total: number, weights: number[]): number[] {
  const W = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / W);
  const out = raw.map(Math.floor);
  let left = Math.round(total - out.reduce((a, b) => a + b, 0));
  raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left > 0) {
        out[i]! += 1;
        left -= 1;
      }
    });
  return out;
}

/** Per-store traits used by the generator (size and customer mood). */
export function storeProfile(st: StoreInfo) {
  const size = 0.6 + unit(st.code, 2) * 0.9;
  const dailyBase = Math.round((st.tier === 1 ? 230000 : 145000) * size);
  // A few cities run behind on service so the dashboard has something to find.
  const cityDrag = ["Mumbai", "Lucknow", "Patna"].includes(st.city ?? "") ? 0.55 : 0;
  const mood = Math.min(4.85, Math.max(2.9, 3.6 + unit(st.code, 3) * 1.2 - cityDrag));
  return { dailyBase, mood };
}

const blank = (date: string, store: string): DayRow => ({ date, store, revenue: 0, bills: 0, ratingSum: 0, ratingCount: 0, promoters: 0, detractors: 0, npsCount: 0, sent: 0, opened: 0, low: 0 });

export function buildDemoDataset(opts: { brand: string; stores: StoreInfo[]; asOf: string; samples: SampleBill[]; historyDays?: number }): Dataset {
  const { brand, stores, asOf, samples } = opts;
  const profiles = new Map(stores.map((s) => [s.code, storeProfile(s)]));
  // Generated history runs to yesterday; today holds only real (sample) bills so far.
  const days = simulateHistory({
    stores,
    from: addDays(asOf, -(opts.historyDays ?? 760)),
    toExclusive: asOf,
    asOf,
    dailyBase: Object.fromEntries([...profiles].map(([c, p]) => [c, p.dailyBase])),
    mood: Object.fromEntries([...profiles].map(([c, p]) => [c, p.mood])),
  });
  const detailFrom = addDays(asOf, -29);

  // 30-day generated totals per store, before sample bills are added.
  const gen30 = new Map<string, DayRow>();
  for (const d of days) {
    if (d.date < detailFrom) continue;
    const a = gen30.get(d.store) ?? blank("", d.store);
    a.revenue += d.revenue;
    a.bills += d.bills;
    a.ratingSum += d.ratingSum;
    a.ratingCount += d.ratingCount;
    a.low! += d.low ?? 0;
    gen30.set(d.store, a);
  }

  // Add each sample bill to its day.
  const index = new Map(days.map((d, i) => [`${d.date}|${d.store}`, i]));
  for (const b of samples) {
    const k = `${b.date}|${b.store}`;
    let i = index.get(k);
    if (i === undefined) {
      i = days.push(blank(b.date, b.store)) - 1;
      index.set(k, i);
    }
    const r = days[i]!;
    r.revenue += b.total;
    r.bills += 1;
    r.sent! += b.sent ? 1 : 0;
    r.opened! += b.opened ? 1 : 0;
    if (b.feedback) {
      r.ratingSum += b.feedback.rating;
      r.ratingCount += 1;
      r.low! += b.feedback.rating <= 3 ? 1 : 0;
      if (b.feedback.nps != null) {
        r.npsCount += 1;
        r.promoters += b.feedback.nps >= 9 ? 1 : 0;
        r.detractors += b.feedback.nps <= 6 ? 1 : 0;
      }
    }
  }
  days.sort((a, b) => (a.date === b.date ? a.store.localeCompare(b.store) : a.date.localeCompare(b.date)));

  // Staff: each store's generated 30-day totals split exactly over its team, plus sample bills.
  const staff = new Map<string, StaffRow>();
  for (const st of stores) {
    const team = staffFor(st.code);
    const g = gen30.get(st.code) ?? blank("", st.code);
    const w = team.map((_, i) => 1 + unit(st.code, 50 + i) * 1.5);
    const rev = splitExact(g.revenue, w);
    const bills = splitExact(g.bills, w);
    const rs = splitExact(g.ratingSum, w);
    const rc = splitExact(g.ratingCount, w);
    team.forEach((p, i) => staff.set(p.id, { id: p.id, name: p.name, store: st.code, revenue: rev[i]!, bills: bills[i]!, ratingSum: rs[i]!, ratingCount: rc[i]! }));
  }
  // Categories: generated revenue split by a store-specific mix, plus sample items.
  const cats = new Map<string, { store: string; category: string; revenue: number; units: number }>();
  const catRow = (store: string, category: string) => {
    const k = `${store}|${category}`;
    let r = cats.get(k);
    if (!r) cats.set(k, (r = { store, category, revenue: 0, units: 0 }));
    return r;
  };
  for (const st of stores) {
    const g = gen30.get(st.code);
    if (!g) continue;
    const parts = splitExact(g.revenue, CATEGORIES.map((c, i) => c.share * (0.8 + unit(st.code, 70 + i) * 0.4)));
    CATEGORIES.forEach((c, i) => {
      const row = catRow(st.code, c.name);
      row.revenue += parts[i]!;
      row.units += Math.round(parts[i]! / c.avgPrice);
    });
  }
  // Complaint themes: one per low rating, generated part split by a store mix.
  const themes = new Map<string, { store: string; option: string; count: number }>();
  const themeRow = (store: string, option: string) => {
    const k = `${store}|${option}`;
    let r = themes.get(k);
    if (!r) themes.set(k, (r = { store, option, count: 0 }));
    return r;
  };
  for (const st of stores) {
    const g = gen30.get(st.code);
    if (!g?.low) continue;
    const slow = ["Mumbai", "Lucknow", "Patna"].includes(st.city ?? "");
    const parts = splitExact(g.low, THEMES.map((t, i) => (slow && t === "Waiting time" ? 4 : 1) * (0.5 + unit(st.code, 90 + i))));
    THEMES.forEach((t, i) => (themeRow(st.code, t).count += parts[i]!));
  }
  for (const b of samples) {
    if (b.date < detailFrom) continue;
    if (b.staff) {
      const row = staff.get(b.staff.id) ?? { id: b.staff.id, name: b.staff.name, store: b.store, revenue: 0, bills: 0, ratingSum: 0, ratingCount: 0 };
      row.revenue += b.total;
      row.bills += 1;
      if (b.feedback) {
        row.ratingSum += b.feedback.rating;
        row.ratingCount += 1;
      }
      staff.set(b.staff.id, row);
    }
    // A bill's total (incl. tax) is shared over its items by their pre-tax amounts.
    const pre = b.items.reduce((a, it) => a + it.amount, 0);
    const shares = splitExact(Math.round(b.total * 100), b.items.map((it) => (pre ? it.amount : 1)));
    b.items.forEach((it, i) => {
      const row = catRow(b.store, it.category);
      row.revenue += shares[i]! / 100;
      row.units += 1;
    });
    for (const t of b.feedback?.improve ?? []) themeRow(b.store, t).count += 1;
  }

  return {
    brand,
    asOf,
    stores,
    days,
    detailDays: 30,
    staff: [...staff.values()],
    categories: [...cats.values()].filter((c) => c.revenue > 0),
    themes: [...themes.values()].filter((t) => t.count > 0),
  };
}
