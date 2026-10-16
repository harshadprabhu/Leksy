import { describe, expect, it } from "vitest";
import { ask, buildBrief, DEFAULT_POLICY, detectIntent, findPersonalData, forecast, parsePeriod, parseStores, preRead, toWeekly, type Dataset, type DayRow } from "./index.js";

/** Two years of daily sales with weekly rhythm, growth and a Diwali spike. */
function synthetic(): Dataset {
  const days: DayRow[] = [];
  const start = Date.parse("2024-10-01T00:00:00Z");
  for (let i = 0; i < 746; i++) {
    const date = new Date(start + i * 864e5).toISOString().slice(0, 10);
    for (const [store, base] of [["BLR", 150000], ["MUM", 120000]] as const) {
      const dow = new Date(date).getUTCDay();
      const weekend = dow === 0 || dow === 6 ? 1.4 : 1;
      const diwali = ["2024-10-29", "2024-11-01", "2025-10-18", "2025-10-20"].some((d) => Math.abs(Date.parse(d) - Date.parse(date)) < 4 * 864e5) ? 3 : 1;
      const revenue = base * weekend * diwali * (1 + i / 3000) * (1 + 0.05 * Math.sin(i));
      days.push({ date, store, revenue, bills: Math.round(revenue / 100000) + 1, ratingSum: store === "MUM" ? 6 : 9, ratingCount: 2, promoters: 1, detractors: store === "MUM" ? 1 : 0, npsCount: 2 });
    }
  }
  return {
    brand: "Aurum & Co.",
    asOf: "2026-10-15",
    stores: [
      { code: "BLR", name: "Aurum Indiranagar", city: "Bengaluru" },
      { code: "MUM", name: "Aurum Bandra", city: "Mumbai" },
    ],
    days,
    detailDays: 30,
    staff: [{ id: "S1", name: "Rahul", store: "BLR", bills: 20, revenue: 2_000_000, ratingSum: 40, ratingCount: 9 }],
    categories: [
      { category: "Necklace", revenue: 3_000_000, units: 20 },
      { category: "Rings", revenue: 1_000_000, units: 30 },
    ],
    themes: [{ option: "Waiting time", count: 7 }],
  };
}

describe("parsing", () => {
  it("reads periods, stores and intents", () => {
    expect(parsePeriod("sales last 3 months", "2026-10-15")).toMatchObject({ from: "2026-07-18", to: "2026-10-15" });
    expect(parsePeriod("this month", "2026-10-15")).toMatchObject({ from: "2026-10-01" });
    expect(parsePeriod("revenue in september", "2026-10-15")).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(parseStores("why is mumbai unhappy", synthetic())).toEqual(["MUM"]);
    expect(detectIntent("Forecast revenue for the next 8 weeks")).toBe("forecast");
    expect(detectIntent("Top staff by revenue")).toBe("staff");
    expect(detectIntent("Which store has the lowest happiness?")).toBe("happiness");
  });
});

describe("forecast", () => {
  it("picks the most accurate model, sees Diwali coming and stays near the truth", () => {
    const ds = synthetic();
    const weeks = toWeekly(ds.days, "revenue", ds.asOf);
    const fc = forecast(weeks, 8, "revenue");
    expect(fc.forecast).toHaveLength(8);
    expect(fc.mape).toBeLessThan(15);
    const diwali = fc.forecast.find((p) => p.festival?.includes("Diwali") && !p.festival.includes("week before"))!;
    expect(diwali.festival).toBe("Dhanteras, Diwali");
    const normal = fc.forecast.find((p) => !p.festival)!;
    expect(diwali.value).toBeGreaterThan(normal.value);
    for (const p of fc.forecast) expect(p.low).toBeLessThan(p.high);
  });
});

describe("answers", () => {
  it("answers sales, stores and happiness with computed numbers", () => {
    const ds = synthetic();
    expect(ask("Sales last 30 days", ds).summary[0]).toMatch(/Revenue: ₹/);
    const st = ask("Compare stores by revenue", ds);
    expect(st.table!.rows[0]![0]).toBe("Aurum Indiranagar");
    const h = ask("Which store has the lowest happiness?", ds);
    expect(h.summary.join(" ")).toContain("Least happy (min 10 ratings): Aurum Bandra");
    expect(preRead(ds).map((s) => s.heading)).toContain("Recommended actions");
  });
});

describe("sharing", () => {
  it("masks stores, indexes money and flags personal data", () => {
    const ds = synthetic();
    const brief = buildBrief([ask("Compare stores by revenue", ds)], ds, { ...DEFAULT_POLICY, allowExternal: true, maskStores: true, indexMoney: true });
    expect(brief).not.toContain("Bandra");
    expect(brief).not.toContain("Aurum");
    expect(brief).not.toMatch(/₹/);
    expect(brief).toContain("Store B");
    expect(findPersonalData("call +91 98123 45678")).toEqual([]);
    expect(findPersonalData("call 9812345678")).toContain("a phone number");
    expect(findPersonalData("mail a@b.com")).toContain("an email address");
  });
});

import { nextWeekByRegion, regionOf, simulateHistory, upcomingMoments } from "./index.js";

describe("regional seasons", () => {
  const stores = [
    { code: "DEL", name: "Delhi store", city: "New Delhi" },
    { code: "BLR", name: "Bengaluru store", city: "Bengaluru" },
    { code: "KOL", name: "Kolkata store", city: "Kolkata" },
  ];
  const ds = {
    brand: "Demo",
    asOf: "2026-10-16",
    stores,
    days: simulateHistory({ stores, from: "2024-09-20", toExclusive: "2026-10-17", asOf: "2026-10-16", dailyBase: { DEL: 150000, BLR: 150000, KOL: 100000 } }),
    detailDays: 30,
    staff: [],
    categories: [],
    themes: [],
  };

  it("maps cities to regions", () => {
    expect(regionOf({ city: "New Delhi" })).toBe("North");
    expect(regionOf({ city: "Bengaluru" })).toBe("South");
    expect(regionOf({ city: "Kolkata" })).toBe("East");
    expect(regionOf({ city: "Atlantis" })).toBeNull();
    expect(regionOf({ city: "Atlantis", region: "West" })).toBe("West");
  });

  it("makes All India the sum of the regions", () => {
    const rows = nextWeekByRegion(ds);
    const india = rows.find((r) => r.region === "All India")!;
    const regions = rows.filter((r) => r.region !== "All India");
    expect(regions.map((r) => r.region).sort()).toEqual(["East", "North", "South"]);
    expect(india.value).toBeCloseTo(regions.reduce((a, r) => a + r.value, 0), 0);
  });

  it("finds regional festivals with last year's lift", () => {
    const m = upcomingMoments(ds, 30);
    const durga = m.find((x) => x.name === "Durga Puja");
    expect(durga?.scope).toEqual(["East"]);
    expect(durga!.lastLift!).toBeGreaterThan(1.1);
    expect(m.find((x) => x.name === "Karva Chauth")?.scope).toEqual(["North"]);
  });
});
