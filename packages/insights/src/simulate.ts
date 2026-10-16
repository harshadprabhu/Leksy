/**
 * Realistic sample history for demos and tests: daily sales per store with
 * weekends, wedding season, monsoon dip, 12% yearly growth and the festivals of
 * each store's region (national ones everywhere). Not used with real customers.
 */
import { FESTIVALS, regionOf } from "./calendar.js";
import type { DayRow, StoreInfo } from "./dataset.js";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Typical festival multipliers for jewellery (national events are the biggest). */
const BOOST: Record<string, number> = {
  Dhanteras: 3.4, Diwali: 2.2, "Akshaya Tritiya": 2.6, "Karva Chauth": 1.9, Lohri: 1.4, Dussehra: 1.6, "Raksha Bandhan": 1.3,
  Pongal: 2.0, Ugadi: 1.7, Onam: 2.1, "Durga Puja": 2.3, "Poila Baisakh": 1.8, "Gudi Padwa": 1.8, Navratri: 1.5, "Ganesh Chaturthi": 1.4,
};

export function simulateHistory(opts: { stores: StoreInfo[]; from: string; toExclusive: string; asOf: string; dailyBase: Record<string, number>; mood?: Record<string, number>; seed?: number }): DayRow[] {
  const rand = rng(opts.seed ?? 7);
  const out: DayRow[] = [];
  const asOfT = Date.parse(`${opts.asOf}T00:00:00Z`);
  const regionFests = new Map(opts.stores.map((s) => [s.code, FESTIVALS.filter((f) => f.regions === "National" || (regionOf(s) && f.regions.includes(regionOf(s)!)))]));
  for (let t = Date.parse(`${opts.from}T00:00:00Z`); ; t += 864e5) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (date >= opts.toExclusive) break;
    const yearsBack = (asOfT - t) / (365 * 864e5);
    const dow = new Date(t).getUTCDay();
    const month = Number(date.slice(5, 7));
    const wedding = [11, 12, 1, 2, 4, 5, 6].includes(month) ? 1.22 : [7, 8].includes(month) ? 0.82 : 1;
    const weekend = dow === 0 || dow === 6 ? 1.35 : dow === 2 ? 0.85 : 1;
    for (const st of opts.stores) {
      // Buying starts a few days before a festival and peaks on the day.
      let festival = 1;
      for (const f of regionFests.get(st.code) ?? []) {
        const d = (Date.parse(`${f.date}T00:00:00Z`) - t) / 864e5;
        if (d >= -1 && d <= 4) festival = Math.max(festival, 1 + ((BOOST[f.name] ?? 1.5) - 1) * (d <= 0 ? 1 : 1 - d / 5));
      }
      const base = (opts.dailyBase[st.code] ?? 150000) / Math.pow(1.12, yearsBack);
      const revenue = Math.round(base * festival * wedding * weekend * (0.82 + rand() * 0.36));
      const bills = Math.max(1, Math.round(revenue / (95000 + rand() * 30000)));
      const responses = Math.round(bills * 0.35 * (0.6 + rand() * 0.8));
      const m = (opts.mood?.[st.code] ?? 4) - (festival > 1.5 ? 0.3 : 0);
      const ratingSum = Math.round(responses * Math.min(5, Math.max(1, m + (rand() - 0.5) * 0.6)));
      out.push({ date, store: st.code, revenue, bills, ratingSum, ratingCount: responses, promoters: Math.round(responses * Math.max(0, (m - 3) / 2) * 0.8), detractors: Math.round(responses * Math.max(0, (4 - m) / 3) * 0.6), npsCount: responses });
    }
  }
  return out;
}
