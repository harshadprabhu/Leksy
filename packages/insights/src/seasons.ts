/**
 * Season intelligence: next week's forecast by region, the regional and national
 * festivals coming up, how much each one lifted sales last time, and the levers
 * to pull. Everything is computed from the company's own history.
 */
import { FESTIVALS, festivalsFor, PLAYBOOK, REGIONS, regionOf, type Festival, type Play, type Region } from "./calendar.js";
import { addDays, daysBetween, inRange, totals, type Dataset } from "./dataset.js";
import { forecast, mondayOf, toWeekly, type ForecastResult } from "./forecast.js";

export interface RegionWeek {
  region: Region | "All India";
  stores: string[];
  week: string; // Monday of next week
  value: number;
  low: number;
  high: number;
  lastWeek: number;
  sameWeekLastYear: number | null;
  wowPct: number | null;
  yoyPct: number | null;
  festival?: string;
  mape: number;
}

export interface SeasonMoment {
  name: string;
  date: string;
  daysTo: number;
  scope: Region[] | "National";
  play: Play;
  /** Last occurrence's sales lift for the affected stores, e.g. 2.4 = +140% vs a normal week. */
  lastLift: number | null;
  lastDate: string | null;
  /** Forecast for the festival week, affected stores. */
  forecastWeek: number | null;
}

export interface Decision {
  decision: string;
  metric: string;
  owner: string;
  by: string;
}

export function storesByRegion(ds: Dataset): Map<Region, string[]> {
  const m = new Map<Region, string[]>();
  for (const s of ds.stores) {
    const r = regionOf(s);
    if (!r) continue;
    m.set(r, [...(m.get(r) ?? []), s.code]);
  }
  return m;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function fit(ds: Dataset, stores: string[] | null, regions: Region[] | undefined, horizon: number): ForecastResult | null {
  try {
    const weeks = toWeekly(ds.days.filter((d) => !stores || stores.includes(d.store)), "revenue", ds.asOf);
    return forecast(weeks, horizon, "revenue", 8, festivalsFor(regions));
  } catch {
    return null;
  }
}

/**
 * Next calendar week (Mon–Sun after the current one) per region, and All India as
 * the sum of the regions (plus any store without a region), so the numbers reconcile.
 */
export function nextWeekByRegion(ds: Dataset): RegionWeek[] {
  const out: RegionWeek[] = [];
  const byRegion = storesByRegion(ds);
  const unassigned = ds.stores.map((s) => s.code).filter((c) => ![...byRegion.values()].flat().includes(c));
  const groups: [RegionWeek["region"], string[] | null, Region[] | undefined][] = [
    ...[...byRegion].map(([r, s]) => [r, s, [r]] as [Region, string[], Region[]]),
    ...(unassigned.length ? [["All India", unassigned, undefined] as [RegionWeek["region"], string[], undefined]] : []),
  ];
  const parts: RegionWeek[] = [];
  for (const [region, stores, regs] of groups) {
    const fc = fit(ds, stores, regs, 2);
    if (!fc) continue;
    const next = fc.forecast[1] ?? fc.forecast[0]!;
    const last = fc.history.at(-1)!.value;
    const ly = fc.history.find((p) => p.week === addDays(next.week, -364))?.value ?? null;
    parts.push({
      region,
      stores: stores ?? ds.stores.map((s) => s.code),
      week: next.week,
      value: next.value,
      low: next.low,
      high: next.high,
      lastWeek: last,
      sameWeekLastYear: ly,
      wowPct: last ? (100 * (next.value - last)) / last : null,
      yoyPct: ly ? (100 * (next.value - ly)) / ly : null,
      festival: next.festival,
      mape: fc.mape,
    });
  }
  if (parts.length) {
    const tot = (k: "value" | "low" | "high" | "lastWeek") => sum(parts.map((x) => x[k]));
    const lyParts = parts.map((x) => x.sameWeekLastYear);
    const ly = lyParts.every((v) => v != null) ? sum(lyParts as number[]) : null;
    const v = tot("value");
    const last = tot("lastWeek");
    const fests = [...new Set(parts.flatMap((x) => (x.festival ? x.festival.replace(" (week before)", "").split(", ") : [])))];
    out.push({
      region: "All India",
      stores: ds.stores.map((s) => s.code),
      week: parts[0]!.week,
      value: v,
      low: tot("low"),
      high: tot("high"),
      lastWeek: last,
      sameWeekLastYear: ly,
      wowPct: last ? (100 * (v - last)) / last : null,
      yoyPct: ly ? (100 * (v - ly)) / ly : null,
      ...(fests.length ? { festival: fests.join(", ") } : {}),
      mape: sum(parts.map((x) => x.mape * x.value)) / Math.max(1, v),
    });
  }
  return [...out, ...parts.filter((x) => x.region !== "All India")];
}

/** How much a festival lifted the given stores the last time it happened. */
function lastLift(ds: Dataset, name: string, stores: string[]): { lift: number | null; date: string | null } {
  const prev = FESTIVALS.filter((f) => f.name === name && f.date < ds.asOf).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!prev) return { lift: null, date: null };
  const weeks = toWeekly(ds.days.filter((d) => stores.includes(d.store)), "revenue", ds.asOf);
  const w = mondayOf(prev.date);
  const at = weeks.find((p) => p.week === w);
  const around = weeks.filter((p) => Math.abs(daysBetween(w, p.week)) >= 21 && Math.abs(daysBetween(w, p.week)) <= 49).map((p) => p.value).sort((a, b) => a - b);
  if (!at || around.length < 3) return { lift: null, date: prev.date };
  const median = around[Math.floor(around.length / 2)]!;
  return { lift: median ? at.value / median : null, date: prev.date };
}

/** Festivals in the next `days`, for the regions this company trades in. */
export function upcomingMoments(ds: Dataset, days = 60): SeasonMoment[] {
  const byRegion = storesByRegion(ds);
  const present = [...byRegion.keys()];
  const end = addDays(ds.asOf, days);
  const seen = new Set<string>();
  const out: SeasonMoment[] = [];
  for (const f of FESTIVALS) {
    if (f.date < ds.asOf || f.date > end) continue;
    const scope = f.regions;
    if (scope !== "National" && !scope.some((r) => present.includes(r))) continue;
    const key = `${f.name}|${f.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stores = scope === "National" ? ds.stores.map((s) => s.code) : scope.flatMap((r) => byRegion.get(r) ?? []);
    const { lift, date } = lastLift(ds, f.name, stores);
    const horizon = Math.ceil((daysBetween(mondayOf(ds.asOf), mondayOf(f.date)) + 7) / 7) + 1;
    const fc = fit(ds, stores, scope === "National" ? present : scope, Math.max(2, horizon));
    const fw = fc?.forecast.find((p) => p.week === mondayOf(f.date))?.value ?? null;
    out.push({ name: f.name, date: f.date, daysTo: daysBetween(ds.asOf, f.date), scope, play: PLAYBOOK[f.name] ?? { push: "Festive collections", stock: "Bestsellers", activate: "Local-language campaign" }, lastLift: lift, lastDate: date, forecastWeek: fw });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const inrShort = (n: number) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : `₹${(n / 1e5).toFixed(1)} L`);

/** Decisions for leaders, each tied to a number. */
export function decisions(ds: Dataset, moments = upcomingMoments(ds), weeks = nextWeekByRegion(ds)): Decision[] {
  const out: Decision[] = [];
  const cur = { from: addDays(ds.asOf, -29), to: ds.asOf, label: "" };
  const all = totals(inRange(ds, cur));
  const national = moments.find((m) => m.scope === "National");
  if (national) {
    out.push({
      decision: `${national.name}: ${national.play.activate.split(";")[0]}`,
      metric: `${national.forecastWeek ? `${inrShort(national.forecastWeek)} forecast that week` : `${national.daysTo} days to go`}${national.lastLift ? ` · last time ${national.lastLift >= 1 ? "+" : ""}${Math.round((national.lastLift - 1) * 100)}% vs normal` : ""}`,
      owner: "Merchandising + Store ops",
      by: addDays(national.date, -21),
    });
  }
  for (const m of moments.filter((x) => x.scope !== "National").slice(0, 3)) {
    out.push({
      decision: `${(m.scope as Region[]).join("/")} · ${m.name}: push ${m.play.push.toLowerCase()}`,
      metric: `${m.daysTo} days to go${m.lastLift ? ` · last time ${m.lastLift >= 1 ? "+" : ""}${Math.round((m.lastLift - 1) * 100)}%` : ""}`,
      owner: `${(m.scope as Region[]).join("/")} regional head`,
      by: addDays(m.date, -10),
    });
  }
  const storeRows = ds.stores
    .map((s) => ({ s, t: totals(inRange(ds, cur, [s.code])) }))
    .filter((x) => x.t.responses >= 3)
    .sort((a, b) => (a.t.rating ?? 9) - (b.t.rating ?? 9));
  const worst = storeRows[0];
  if (worst && all.rating && (worst.t.rating ?? 5) < all.rating - 0.2) {
    out.push({
      decision: `${worst.s.name}: fix ${(ds.themes[0]?.option ?? "service").toLowerCase()} before festive peak`,
      metric: `Rating ${worst.t.rating!.toFixed(1)} vs ${all.rating.toFixed(1)} brand avg · NPS ${worst.t.nps == null ? "–" : Math.round(worst.t.nps)}`,
      owner: "Store manager",
      by: addDays(ds.asOf, 7),
    });
  }
  const fastest = weeks.filter((w) => w.region !== "All India" && w.wowPct != null).sort((a, b) => b.wowPct! - a.wowPct!)[0];
  if (fastest && fastest.wowPct! > 5) {
    out.push({ decision: `${fastest.region}: add floor staff next week`, metric: `${inrShort(fastest.value)} forecast · ${fastest.wowPct! >= 0 ? "+" : ""}${fastest.wowPct!.toFixed(0)}% WoW`, owner: `${fastest.region} regional head`, by: addDays(fastest.week, -2) });
  }
  const topCat = [...ds.categories].sort((a, b) => b.revenue - a.revenue)[0];
  if (topCat) {
    const share = (100 * topCat.revenue) / Math.max(1, sum(ds.categories.map((c) => c.revenue)));
    out.push({ decision: `Protect ${topCat.category.toLowerCase()} availability`, metric: `${share.toFixed(0)}% of revenue (30 days)`, owner: "Merchandising", by: addDays(ds.asOf, 7) });
  }
  // A deadline already passed means "now".
  return out.slice(0, 6).map((d) => (d.by < ds.asOf ? { ...d, by: ds.asOf } : d));
}
