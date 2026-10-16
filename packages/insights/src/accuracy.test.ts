/**
 * Accuracy suite for a 400-store national network. Every figure the engine shows
 * is recomputed here by brute force, independently of the engine's helpers, and
 * must match to the rupee (or to the displayed rounding).
 */
import { beforeAll, describe, expect, it } from "vitest";
import PptxGenJS from "pptxgenjs";
import {
  ask,
  buildDemoDataset,
  buildLeadershipDeck,
  buildNetwork,
  decisions,
  guardNumbers,
  inr,
  nextWeekByRegion,
  parsePeriod,
  preRead,
  regionOf,
  staffFor,
  storeProfile,
  THEMES,
  upcomingMoments,
  type Dataset,
  type DayRow,
  type Range,
  type SampleBill,
} from "./index.js";

const ASOF = "2026-10-16";
const CATS = ["Necklace", "Bangles", "Earrings", "Rings", "Mangalsutra", "Bracelet", "Coins", "Pendant"];

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Itemised bills like the demo's: random stores, staff of that store, 1–2 items, some feedback. */
function samples(stores: ReturnType<typeof buildNetwork>, n: number): SampleBill[] {
  const r = rng(99);
  const out: SampleBill[] = [];
  for (let i = 0; i < n; i++) {
    const st = stores[Math.floor(r() * stores.length)]!;
    const date = new Date(Date.parse(`${ASOF}T00:00:00Z`) - Math.floor(r() * 30) * 864e5).toISOString().slice(0, 10);
    const items = Array.from({ length: 1 + Math.floor(r() * 2) }, () => ({ category: CATS[Math.floor(r() * CATS.length)]!, amount: 20000 + Math.floor(r() * 200000) }));
    const pre = items.reduce((a, x) => a + x.amount, 0);
    const team = staffFor(st.code);
    const rating = Math.max(1, Math.min(5, Math.round(storeProfile(st).mood + (r() - 0.5) * 2.2)));
    const fb = r() < 0.4;
    out.push({
      date,
      store: st.code,
      total: Math.round(pre * 1.03),
      sent: true,
      opened: r() < 0.75,
      staff: team[Math.floor(r() * team.length)]!,
      items,
      ...(fb ? { feedback: { rating, nps: r() < 0.9 ? Math.min(10, rating * 2) : null, improve: rating <= 3 ? [THEMES[Math.floor(r() * THEMES.length)]!] : [] } } : {}),
    });
  }
  return out;
}

// ---------- brute-force reference (no engine helpers) ----------

function sumDays(ds: Dataset, from: string, to: string, stores: Set<string> | null) {
  let revenue = 0, bills = 0, rs = 0, rc = 0, p = 0, d = 0, n = 0;
  for (const x of ds.days) {
    if (x.date < from || x.date > to) continue;
    if (stores && !stores.has(x.store)) continue;
    revenue += x.revenue;
    bills += x.bills;
    rs += x.ratingSum;
    rc += x.ratingCount;
    p += x.promoters;
    d += x.detractors;
    n += x.npsCount;
  }
  return { revenue, bills, rating: rc ? rs / rc : null, responses: rc, nps: n ? (100 * (p - d)) / n : null };
}

/** Per-store totals in one pass (still independent of the engine). */
function perStore(ds: Dataset, from: string, to: string) {
  const m = new Map<string, { revenue: number; bills: number; rs: number; rc: number; p: number; d: number; n: number }>();
  for (const x of ds.days) {
    if (x.date < from || x.date > to) continue;
    const a = m.get(x.store) ?? { revenue: 0, bills: 0, rs: 0, rc: 0, p: 0, d: 0, n: 0 };
    a.revenue += x.revenue;
    a.bills += x.bills;
    a.rs += x.ratingSum;
    a.rc += x.ratingCount;
    a.p += x.promoters;
    a.d += x.detractors;
    a.n += x.npsCount;
    m.set(x.store, a);
  }
  return (code: string) => {
    const a = m.get(code) ?? { revenue: 0, bills: 0, rs: 0, rc: 0, p: 0, d: 0, n: 0 };
    return { revenue: a.revenue, bills: a.bills, rating: a.rc ? a.rs / a.rc : null, responses: a.rc, nps: a.n ? (100 * (a.p - a.d)) / a.n : null };
  };
}

const r1 = (n: number | null) => (n == null ? "–" : n.toFixed(1));
const addDays = (iso: string, k: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + k * 864e5).toISOString().slice(0, 10);

let ds: Dataset;
let net: ReturnType<typeof buildNetwork>;
let built = 0;

beforeAll(() => {
  const t0 = performance.now();
  net = buildNetwork("Aurum & Co.", 400);
  ds = buildDemoDataset({ brand: "Aurum & Co.", stores: net, asOf: ASOF, samples: samples(net, 700) });
  built = performance.now() - t0;
});

describe("network", () => {
  it("has exactly 400 stores, unique codes, every store with a region and a tier", () => {
    expect(net).toHaveLength(400);
    expect(new Set(net.map((s) => s.code)).size).toBe(400);
    for (const s of net) {
      expect(regionOf(s), s.city).not.toBeNull();
      expect([1, 2]).toContain(s.tier);
    }
    const t1 = net.filter((s) => s.tier === 1).length;
    expect(t1).toBeGreaterThan(150);
    expect(400 - t1).toBeGreaterThan(100);
    for (const r of ["North", "South", "East", "West"]) expect(net.filter((s) => regionOf(s) === r).length).toBeGreaterThan(30);
  });
  it("builds two years of history for 400 stores quickly", () => {
    expect(ds.days.length).toBeGreaterThan(400 * 700);
    expect(built).toBeLessThan(8000);
  });
});

describe("dataset invariants", () => {
  const detail = () => ({ from: addDays(ASOF, -29), to: ASOF });

  it("every day row is internally possible (ratings, low scores, NPS)", () => {
    const bad: string[] = [];
    for (const d of ds.days) {
      const L = d.low ?? 0;
      const ok =
        d.revenue >= 0 &&
        d.ratingSum >= d.ratingCount &&
        d.ratingSum <= 5 * d.ratingCount &&
        d.promoters + d.detractors <= d.npsCount &&
        L <= d.ratingCount &&
        // L ratings of 3 or lower and the rest 4+ must be able to make this rating sum.
        4 * d.ratingCount - 3 * L <= d.ratingSum &&
        d.ratingSum <= 5 * d.ratingCount - 2 * L &&
        (d.opened ?? 0) <= (d.sent ?? 0);
      if (!ok) bad.push(`${d.date} ${d.store}`);
    }
    expect(bad).toEqual([]);
  });

  it("staff totals add up exactly to each store's 30-day totals", () => {
    const { from, to } = detail();
    for (const st of net) {
      const t = sumDays(ds, from, to, new Set([st.code]));
      const staff = ds.staff.filter((s) => s.store === st.code);
      expect(staff.reduce((a, s) => a + s.revenue, 0)).toBeCloseTo(t.revenue, 6);
      expect(staff.reduce((a, s) => a + s.bills, 0)).toBe(t.bills);
      expect(staff.reduce((a, s) => a + s.ratingCount, 0)).toBe(t.responses);
    }
  });

  it("category revenue adds up to each store's 30-day revenue (to the paisa)", () => {
    const { from, to } = detail();
    for (const st of net) {
      const t = sumDays(ds, from, to, new Set([st.code]));
      const c = ds.categories.filter((x) => x.store === st.code).reduce((a, x) => a + x.revenue, 0);
      expect(Math.abs(c - t.revenue)).toBeLessThan(0.01);
    }
  });

  it("staff belong to their store and names are stable", () => {
    for (const s of ds.staff) expect(staffFor(s.store).some((p) => p.id === s.id && p.name === s.name)).toBe(true);
  });
});

describe("answers match brute force", () => {
  const PERIODS = ["last 30 days", "last 7 days", "this month", "last month", "this year", "last year", "September", "yesterday", "today", "last 3 months", "this week"];
  const SCOPES: [string, (s: (typeof net)[number]) => boolean][] = [
    ["", () => true],
    [" in Mumbai", (s) => s.city === "Mumbai"],
    [" in Navi Mumbai", (s) => s.city === "Navi Mumbai"],
    [" for tier 2 stores", (s) => s.tier === 2],
    [" in the North", (s) => regionOf(s) === "North"],
    [" South tier 1", (s) => regionOf(s) === "South" && s.tier === 1],
    [" in Kolkata", (s) => s.city === "Kolkata"],
  ];

  it("sales: revenue, bills and average bill for every period × scope", () => {
    let checked = 0;
    for (const p of PERIODS) {
      for (const [w, f] of SCOPES) {
        const q = `Sales${w} ${p}`;
        const a = ask(q, ds);
        expect(a.intent, q).toBe("sales");
        const want = new Set(net.filter(f).map((s) => s.code));
        expect(new Set(a.stores?.length ? a.stores : net.map((s) => s.code)), q).toEqual(want);
        const r = a.period!;
        const t = sumDays(ds, r.from, r.to, want);
        expect(a.summary[0], q).toContain(`Revenue: ${inr(t.revenue)}`);
        expect(a.summary[1], q).toContain(`${t.bills.toLocaleString("en-IN")} bills`);
        if (t.bills) expect(a.summary[1], q).toContain(inr(t.revenue / t.bills));
        // Daily chart sums back to the total.
        const chartSum = (a.chart?.points ?? []).reduce((s, x) => s + x.value, 0);
        expect(Math.abs(chartSum - t.revenue), q).toBeLessThan(0.01);
        checked++;
      }
    }
    expect(checked).toBe(PERIODS.length * SCOPES.length);
  });

  it("periods resolve to the right calendar dates", () => {
    const cases: [string, string, string][] = [
      ["last 30 days", "2026-09-17", "2026-10-16"],
      ["last 7 days", "2026-10-10", "2026-10-16"],
      ["this month", "2026-10-01", "2026-10-16"],
      ["last month", "2026-09-01", "2026-09-30"],
      ["this year", "2026-01-01", "2026-10-16"],
      ["last year", "2025-01-01", "2025-12-31"],
      ["September", "2026-09-01", "2026-09-30"],
      ["November", "2025-11-01", "2025-11-30"],
      ["yesterday", "2026-10-15", "2026-10-15"],
      ["this week", "2026-10-12", "2026-10-16"],
    ];
    for (const [q, from, to] of cases) {
      const r = parsePeriod(q, ASOF);
      expect([r.from, r.to], q).toEqual([from, to]);
    }
  });

  it("store ranking: every row's revenue, bills, rating and NPS", () => {
    for (const [w, f] of SCOPES) {
      const q = `Compare stores${w} last 30 days`;
      const a = ask(q, ds);
      expect(a.intent).toBe("stores");
      const want = net.filter(f);
      const r = a.period!;
      const ps = perStore(ds, r.from, r.to);
      const rows = want.map((s) => ({ s, t: ps(s.code) })).filter((x) => x.t.bills > 0);
      expect(a.table!.rows.length, q).toBe(rows.length);
      for (const row of a.table!.rows) {
        const x = rows.find((y) => y.s.name === row[0])!;
        expect(x, String(row[0])).toBeDefined();
        expect(row[1]).toBe(inr(x.t.revenue));
        expect(row[2]).toBe(x.t.bills);
        expect(row[3]).toBe(inr(x.t.revenue / x.t.bills));
        expect(row[4]).toBe(r1(x.t.rating));
        expect(row[5]).toBe(x.t.responses);
        expect(row[6]).toBe(x.t.nps == null ? "–" : Math.round(x.t.nps));
      }
      // Sorted by revenue, highest first.
      const revs = a.chart!.points.map((p) => p.value);
      expect([...revs].sort((x, y) => y - x)).toEqual(revs);
    }
  });

  it("region, tier and city groupings add up to the national total", () => {
    const all = sumDays(ds, addDays(ASOF, -29), ASOF, null);
    for (const [q, n] of [["Sales by region last 30 days", 4], ["Compare tier 1 vs tier 2 last 30 days", 2], ["Revenue by city last 30 days", new Set(net.map((s) => s.city)).size]] as const) {
      const a = ask(q, ds);
      expect(a.intent, q).toBe("stores");
      expect(a.table!.rows.length, q).toBe(n);
      // Group revenues (exact, from the bars when all fit) add up to the national total.
      if (a.chart!.points.length === n) {
        const sum = a.chart!.points.reduce((s, p) => s + p.value, 0);
        expect(Math.abs(sum - all.revenue), q).toBeLessThan(0.01);
      }
    }
    for (const row of ask("Revenue by city last 30 days", ds).table!.rows) {
      const t = sumDays(ds, addDays(ASOF, -29), ASOF, new Set(net.filter((s) => s.city === row[0]).map((s) => s.code)));
      expect(row[1], String(row[0])).toBe(inr(t.revenue));
    }
    for (const row of ask("Compare tier 1 vs tier 2 last 30 days", ds).table!.rows) {
      const t = sumDays(ds, addDays(ASOF, -29), ASOF, new Set(net.filter((s) => `Tier ${s.tier}` === row[0]).map((s) => s.code)));
      expect(row[1], String(row[0])).toBe(inr(t.revenue));
      expect(row[2], String(row[0])).toBe(t.bills);
    }
    // Each region against brute force.
    const a = ask("Sales by region last 30 days", ds);
    for (const row of a.table!.rows) {
      const t = sumDays(ds, addDays(ASOF, -29), ASOF, new Set(net.filter((s) => regionOf(s) === row[0]).map((s) => s.code)));
      expect(row[1]).toBe(inr(t.revenue));
      expect(row[2]).toBe(t.bills);
    }
  });

  it("happiness: rating, NPS, least-happy store and complaint counts are scoped", () => {
    for (const [w, f] of SCOPES) {
      const q = `Why are customers unhappy${w} last 30 days?`;
      const a = ask(q, ds);
      expect(a.intent, q).toBe("happiness");
      const want = net.filter(f);
      const codes = new Set(want.map((s) => s.code));
      const r = a.period!;
      const t = sumDays(ds, r.from, r.to, codes);
      expect(a.summary[0], q).toBe(`Average rating ${r1(t.rating)} / 5 from ${t.responses.toLocaleString("en-IN")} responses; NPS ${t.nps == null ? "–" : Math.round(t.nps)}.`);
      // Complaint themes counted only in these stores.
      const counts = new Map<string, number>();
      for (const x of ds.themes) if (x.store && codes.has(x.store)) counts.set(x.option, (counts.get(x.option) ?? 0) + x.count);
      const top = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 5);
      const line = a.summary.find((s) => s.startsWith("Most-mentioned"));
      expect(line, q).toBe(`Most-mentioned problems (last 30 days): ${top.map(([o, c]) => `${o} (${c})`).join(", ")}.`);
      // Least happy store: lowest rating among stores with ≥10 ratings.
      const ps = perStore(ds, r.from, r.to);
      const ranked = want
        .map((s) => ({ s, t: ps(s.code) }))
        .filter((x) => x.t.responses >= 10)
        .sort((x, y) => x.t.rating! - y.t.rating! || y.t.responses - x.t.responses || x.s.name.localeCompare(y.s.name));
      if (ranked[0]) expect(a.summary[1], q).toContain(`Least happy (min 10 ratings): ${ranked[0].s.name} at ${r1(ranked[0].t.rating)} from ${ranked[0].t.responses} ratings`);
    }
  });

  it("categories: shares and revenue per scope", () => {
    for (const [w, f] of SCOPES) {
      const q = `Category mix${w}`;
      const a = ask(q, ds);
      expect(a.intent, q).toBe("categories");
      const codes = new Set(net.filter(f).map((s) => s.code));
      const m = new Map<string, number>();
      for (const c of ds.categories) if (c.store && codes.has(c.store)) m.set(c.category, (m.get(c.category) ?? 0) + c.revenue);
      const total = [...m.values()].reduce((x, y) => x + y, 0);
      const t = sumDays(ds, addDays(ASOF, -29), ASOF, codes);
      expect(Math.abs(total - t.revenue), q).toBeLessThan(0.01);
      for (const row of a.table!.rows) {
        expect(row[1]).toBe(inr(m.get(String(row[0]))!));
        expect(row[2]).toBe(`${((100 * m.get(String(row[0]))!) / total).toFixed(1)}%`);
      }
      const shares = a.table!.rows.reduce((s, r) => s + Number(String(r[2]).replace("%", "")), 0);
      expect(Math.abs(shares - 100)).toBeLessThan(0.5);
    }
  });

  it("staff leaderboard per scope and a note when the period differs", () => {
    for (const [w, f] of SCOPES) {
      const a = ask(`Top staff by revenue${w}`, ds);
      expect(a.intent).toBe("staff");
      const codes = new Set(net.filter(f).map((s) => s.code));
      const staff = ds.staff.filter((s) => codes.has(s.store)).sort((x, y) => y.revenue - x.revenue || x.id.localeCompare(y.id));
      expect(a.summary[0]).toContain(`leads with ${inr(staff[0]!.revenue)} from ${staff[0]!.bills.toLocaleString("en-IN")} bills`);
      expect(a.summary[1]).toBe(`${staff.length.toLocaleString("en-IN")} staff · ${inr(staff.reduce((s, x) => s + x.revenue, 0))} revenue between them.`);
    }
    const y = ask("Top staff this year", ds);
    expect(y.summary.some((s) => s.startsWith("Note:"))).toBe(true);
  });

  it("next week: All India equals the sum of the regions", () => {
    const rows = nextWeekByRegion(ds);
    const all = rows.find((r) => r.region === "All India")!;
    const regs = rows.filter((r) => r.region !== "All India");
    expect(regs).toHaveLength(4);
    for (const k of ["value", "low", "high", "lastWeek"] as const) expect(Math.abs(all[k] - regs.reduce((s, r) => s + r[k], 0))).toBeLessThan(1e-6);
    for (const r of rows) expect(r.low <= r.value && r.value <= r.high).toBe(true);
    // Last week is the real last full week for each region.
    for (const r of regs) {
      const codes = new Set(r.stores);
      const lw = sumDays(ds, addDays(r.week, -14), addDays(r.week, -8), codes);
      expect(Math.abs(r.lastWeek - lw.revenue), r.region).toBeLessThan(0.01);
    }
  });

  it("forecasts are well-formed and backtested for every scope", () => {
    for (const [w] of SCOPES) {
      const a = ask(`Forecast revenue${w} for the next 8 weeks`, ds);
      const fc = a.forecast!;
      expect(fc.forecast).toHaveLength(8);
      for (const p of fc.forecast) expect(p.low <= p.value && p.value <= p.high && p.low >= 0).toBe(true);
      expect(Number.isFinite(fc.mape)).toBe(true);
      expect(fc.mape).toBeLessThan(25);
      const total = fc.forecast.reduce((s, p) => s + p.value, 0);
      expect(a.summary[0]).toContain(`Expected ${inr(total)}`);
    }
  });

  it("season answers and decisions only use dates in the future and real lifts", () => {
    const m = upcomingMoments(ds, 75);
    for (const x of m) {
      expect(x.date >= ASOF).toBe(true);
      expect(x.daysTo).toBe(Math.round((Date.parse(x.date) - Date.parse(ASOF)) / 864e5));
    }
    for (const d of decisions(ds)) expect(d.by >= ASOF).toBe(true);
  });

  it("pre-read headline numbers match brute force", () => {
    const pr = preRead(ds);
    const t = sumDays(ds, addDays(ASOF, -29), ASOF, null);
    const p = sumDays(ds, addDays(ASOF, -59), addDays(ASOF, -30), null);
    expect(pr[0]!.points[0]).toContain(`Revenue ${inr(t.revenue)} in the last 30 days, ${(100 * (t.revenue - p.revenue) / p.revenue >= 0 ? "+" : "")}${((100 * (t.revenue - p.revenue)) / p.revenue).toFixed(1)}%`);
    expect(pr[0]!.points[1]).toBe(`${t.bills.toLocaleString("en-IN")} bills at an average of ${inr(t.revenue / t.bills)}.`);
    expect(pr[1]!.points[0]).toBe(`Average rating ${r1(t.rating)} / 5 and NPS ${Math.round(t.nps!)} from ${t.responses} responses.`);
  });

  it("answers every question type for 400 stores fast", () => {
    const qs = ["Sales last 30 days", "Compare stores by average bill value", "Which store has the lowest happiness?", "Top staff by revenue this month", "Category mix last 30 days", "Forecast revenue for the next 8 weeks", "Forecast next week by region", "Festival plan by region", "Prepare the monthly pre-read", "Sales by region"];
    const t0 = performance.now();
    for (const q of qs) ask(q, ds);
    expect(performance.now() - t0).toBeLessThan(15000);
  });
});

describe("deck figures", () => {
  it("builds for 400 stores and shows the computed numbers", async () => {
    const pptx = buildLeadershipDeck(PptxGenJS as unknown as new () => InstanceType<typeof PptxGenJS>, {
      ds,
      theme: { company: "Aurum & Co.", primary: "#1E2761", accent: "#C9A227", text: "#1F2937", headingFont: "Cambria", bodyFont: "Calibri", footer: "Confidential" },
      answers: [ask("Sales by region last 30 days", ds)],
    });
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    // jszip ships with pptxgenjs; load it from there.
    const { createRequire } = await import("node:module");
    const req = createRequire(createRequire(import.meta.url).resolve("pptxgenjs"));
    const JSZip = req("jszip") as { loadAsync(b: Buffer): Promise<{ files: Record<string, unknown>; file(n: string): { async(t: "string"): Promise<string> } | null }> };
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides.length).toBeGreaterThan(8);
    const text = (await Promise.all(slides.map((f) => zip.file(f)!.async("string")))).join("\n");
    const t = sumDays(ds, addDays(ASOF, -29), ASOF, null);
    const money = (n: number) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : `₹${(n / 1e5).toFixed(1)} L`);
    expect(text).toContain(`400 stores · ${money(t.revenue)} in 30 days`);
    const app = await zip.file("docProps/app.xml")!.async("string");
    expect(app).toContain("Aurum &amp; Co.");
  });
});

describe("number guard for language-model wording", () => {
  const src = "Revenue: ₹2.45 Cr (+5.3% vs the previous 30 days). 12,345 bills, average bill ₹1,98,450. Rating 4.2 / 5 from 3,210 responses.";
  it("accepts wording that only repeats computed figures", () => {
    expect(guardNumbers("- Revenue reached ₹2.45 Cr, up 5.3%.\n- 12,345 bills at ₹1,98,450 each on average.\n- Rating 4.2 from 3,210 responses.\n1. Act on the top 3 issues.", src).ok).toBe(true);
  });
  it("rejects invented or recalculated figures", () => {
    const g = guardNumbers("Revenue was ₹2.5 Cr, about 6% growth, from 12,400 bills.", src);
    expect(g.ok).toBe(false);
    expect(g.unknown).toEqual(["2.5", "6", "12400"]);
  });
});

// Keep types referenced for readers.
export type { DayRow, Range };
