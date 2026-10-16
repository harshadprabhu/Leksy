/**
 * The built-in local question engine. It recognises what a question is about
 * (sales, stores, staff, happiness, forecast…), works out the period and stores,
 * and computes the answer from the data. Every number is calculated, never
 * generated, so answers are exact. A language model (local or external) may
 * later reword the summary, but never supplies the figures.
 */
import { addDays, daily, inRange, inr, pct, totals, type Dataset, type Range } from "./dataset.js";
import { REGIONS, type Region } from "./calendar.js";
import { forecast, toWeekly, type ForecastResult, type Metric } from "./forecast.js";
import { nextWeekByRegion, upcomingMoments } from "./seasons.js";

export interface ChartPoint {
  label: string;
  value: number;
  low?: number;
  high?: number;
  forecast?: boolean;
  note?: string;
}

export interface Answer {
  id: string;
  question: string;
  intent: Intent;
  title: string;
  summary: string[];
  chart?: { kind: "line" | "bar"; unit: "inr" | "count" | "rating" | "pct"; points: ChartPoint[] };
  table?: { columns: string[]; rows: (string | number)[][] };
  forecast?: ForecastResult;
  period?: Range;
  stores?: string[];
}

export type Intent = "season" | "nextweek" | "forecast" | "stores" | "staff" | "categories" | "happiness" | "sales" | "bills" | "abv" | "preread" | "help";

export const SUGGESTIONS = [
  "Forecast next week by region",
  "Festival plan by region",
  "Sales in the last 30 days",
  "Forecast revenue for the next 8 weeks",
  "Which store has the lowest happiness?",
  "Top staff by revenue this month",
  "Category mix last 30 days",
  "Why are customers unhappy in Mumbai?",
  "Compare stores by average bill value",
  "Prepare the monthly pre-read",
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Work out the period a question refers to (defaults to the last 30 days). */
export function parsePeriod(q: string, asOf: string): Range {
  const s = q.toLowerCase();
  let m = s.match(/(?:last|past|previous)\s+(\d{1,3})\s+(day|week|month|year)s?/);
  if (m) {
    const n = Number(m[1]);
    const days = m[2] === "day" ? n : m[2] === "week" ? 7 * n : m[2] === "month" ? 30 * n : 365 * n;
    return { from: addDays(asOf, -(days - 1)), to: asOf, label: `last ${n} ${m[2]}${n > 1 ? "s" : ""}` };
  }
  if (/\b(today)\b/.test(s)) return { from: asOf, to: asOf, label: "today" };
  if (/\byesterday\b/.test(s)) return { from: addDays(asOf, -1), to: addDays(asOf, -1), label: "yesterday" };
  if (/\b(this|current) week\b/.test(s)) return { from: addDays(asOf, -((new Date(`${asOf}T00:00:00Z`).getUTCDay() + 6) % 7)), to: asOf, label: "this week" };
  if (/\blast week\b/.test(s)) return { from: addDays(asOf, -6), to: asOf, label: "last 7 days" };
  if (/\b(this|current) month\b|\bmtd\b/.test(s)) return { from: `${asOf.slice(0, 8)}01`, to: asOf, label: "this month" };
  if (/\blast month\b/.test(s)) {
    const first = `${asOf.slice(0, 8)}01`;
    const prevEnd = addDays(first, -1);
    return { from: `${prevEnd.slice(0, 8)}01`, to: prevEnd, label: "last month" };
  }
  if (/\b(this|current) year\b|\bytd\b/.test(s)) return { from: `${asOf.slice(0, 4)}-01-01`, to: asOf, label: "this year" };
  if (/\blast year\b/.test(s)) {
    const y = Number(asOf.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
  }
  if (/\b(quarter|qtd)\b/.test(s)) return { from: addDays(asOf, -89), to: asOf, label: "last 90 days" };
  const mi = MONTHS.findIndex((mo) => new RegExp(`\\b${mo}\\b`).test(s));
  if (mi >= 0) {
    let y = Number(asOf.slice(0, 4));
    if (mi + 1 > Number(asOf.slice(5, 7))) y -= 1;
    const from = `${y}-${String(mi + 1).padStart(2, "0")}-01`;
    const to = addDays(`${mi === 11 ? y + 1 : y}-${String(mi === 11 ? 1 : mi + 2).padStart(2, "0")}-01`, -1);
    return { from, to: to > asOf ? asOf : to, label: `${MONTHS[mi]![0]!.toUpperCase()}${MONTHS[mi]!.slice(1)} ${y}` };
  }
  return { from: addDays(asOf, -29), to: asOf, label: "last 30 days" };
}

/** Stores mentioned by code, name or city. */
export function parseStores(q: string, ds: Dataset): string[] {
  const s = q.toLowerCase();
  return ds.stores
    .filter((st) => {
      const words = [st.code, ...st.code.split("-"), st.name, st.city ?? ""].map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !["aurum", "store"].includes(w));
      return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(s));
    })
    .map((st) => st.code);
}

export function detectIntent(q: string): Intent {
  const s = q.toLowerCase();
  if (/pre-?read|monthly (review|report)|board (pack|deck)|summary deck|business review/.test(s)) return "preread";
  if (/next week|coming week|week ahead/.test(s) && !/next \d+ weeks/.test(s)) return "nextweek";
  if (/festiv|season|pongal|onam|ugadi|karva|lohri|dussehra|navratri|durga|puja|baisakh|padwa|ganesh|akshaya|dhanteras|diwali|wedding|\b(north|south|east|west)\b|region|strategy|what (should|to) (we )?push|maximi[sz]e/.test(s)) return "season";
  if (/forecast|predict|projection|project(ed)?|next \d+ (week|month)|expect|outlook/.test(s)) return "forecast";
  if (/staff|salesperson|sales person|employee|associate|team member|who sold/.test(s)) return "staff";
  if (/categor|product|item|collection|mix/.test(s)) return "categories";
  if (/happ|rating|nps|feedback|complain|unhappy|satisf|survey|why .*(drop|down|low)/.test(s)) return "happiness";
  if (/average bill|abv|ticket size|basket|per bill/.test(s)) return "abv";
  if (/compare|which store|best store|worst store|top store|stores? rank|by store|each store/.test(s)) return "stores";
  if (/bills|footfall|transactions|invoices|how many (sales|customers)/.test(s)) return "bills";
  if (/sales|revenue|turnover|business|income|how (are|did) we (do|doing)/.test(s)) return "sales";
  return "help";
}

const storeName = (ds: Dataset, code: string) => ds.stores.find((s) => s.code === code)?.name ?? code;
const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const r1 = (n: number | null) => (n == null ? "–" : n.toFixed(1));

function previous(r: Range): Range {
  const len = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 864e5) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1), label: "previous period" };
}

let seq = 0;
const newId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

export function ask(question: string, ds: Dataset, opts: { horizonWeeks?: number } = {}): Answer {
  const intent = detectIntent(question);
  const period = parsePeriod(question, ds.asOf);
  const stores = parseStores(question, ds);
  const base = { id: newId(), question, intent, period, stores };
  const scope = stores.length ? stores.map((c) => storeName(ds, c)).join(", ") : "all stores";

  switch (intent) {
    case "nextweek": {
      const rows = nextWeekByRegion(ds);
      const all = rows.find((r) => r.region === "All India");
      const regs = rows.filter((r) => r.region !== "All India").sort((a, b) => b.value - a.value);
      const sign = (n: number | null) => (n == null ? "–" : pct(n));
      return {
        ...base,
        title: `Next week forecast · week of ${all ? label(all.week) : ""}`,
        summary: all
          ? [
              `All India: ${inr(all.value)} (${inr(all.low)}–${inr(all.high)}) · ${sign(all.wowPct)} WoW · ${sign(all.yoyPct)} YoY`,
              ...regs.map((r) => `${r.region}: ${inr(r.value)} · ${sign(r.wowPct)} WoW${r.festival ? ` · ${r.festival}` : ""}`),
              `Model error (backtest): ${all.mape.toFixed(1)}%`,
            ]
          : ["Not enough history to forecast."],
        chart: { kind: "bar", unit: "inr", points: regs.map((r) => ({ label: String(r.region), value: r.value, low: r.low, high: r.high })) },
        table: { columns: ["Region", "Forecast", "Low", "High", "WoW", "YoY", "Festival"], rows: rows.map((r) => [String(r.region), inr(r.value), inr(r.low), inr(r.high), sign(r.wowPct), sign(r.yoyPct), r.festival ?? ""]) },
      };
    }
    case "season": {
      const s = question.toLowerCase();
      const want = REGIONS.filter((r) => new RegExp(`\\b${r.toLowerCase()}\\b`).test(s));
      const moments = upcomingMoments(ds, 75).filter((m) => !want.length || m.scope === "National" || m.scope.some((r: Region) => want.includes(r)));
      const lift = (x: number | null) => (x == null ? "–" : `${x >= 1 ? "+" : ""}${Math.round((x - 1) * 100)}%`);
      const where = (m: (typeof moments)[number]) => (m.scope === "National" ? "National" : m.scope.join("/"));
      return {
        ...base,
        title: `Festival plan · next 75 days${want.length ? ` · ${want.join(", ")}` : " · all regions"}`,
        summary: moments.length
          ? moments.slice(0, 6).map((m) => `${where(m)} · ${m.name} (${label(m.date)}, ${m.daysTo}d): last ${lift(m.lastLift)} · push ${m.play.push.toLowerCase()} · ${m.play.activate.split(";")[0]}`)
          : ["No festivals in the next 75 days for your regions."],
        chart: { kind: "bar", unit: "pct", points: moments.filter((m) => m.lastLift != null).map((m) => ({ label: `${m.name} (${where(m)})`, value: Math.round((m.lastLift! - 1) * 100) })) },
        table: { columns: ["When", "Days", "Where", "Occasion", "Last lift", "Push", "Stock", "Activate"], rows: moments.map((m) => [label(m.date), m.daysTo, where(m), m.name, lift(m.lastLift), m.play.push, m.play.stock, m.play.activate]) },
      };
    }
    case "forecast": {
      const metric: Metric = /bills|footfall|transactions|customers/.test(question.toLowerCase()) ? "bills" : "revenue";
      const n = Number(question.match(/next\s+(\d{1,2})\s+week/i)?.[1] ?? (Number(question.match(/next\s+(\d{1,2})\s+month/i)?.[1] ?? 0) * 4 || opts.horizonWeeks || 8));
      const horizon = Math.min(26, Math.max(2, n));
      const hist = toWeekly(ds.days.filter((d) => !stores.length || stores.includes(d.store)), metric, ds.asOf);
      const fc = forecast(hist, horizon, metric);
      const total = fc.forecast.reduce((s, p) => s + p.value, 0);
      const lo = fc.forecast.reduce((s, p) => s + p.low, 0);
      const hi = fc.forecast.reduce((s, p) => s + p.high, 0);
      const peak = fc.forecast.reduce((a, b) => (b.value > a.value ? b : a));
      const fmt = metric === "revenue" ? inr : (n: number) => Math.round(n).toLocaleString("en-IN");
      return {
        ...base,
        title: `${metric === "revenue" ? "Revenue" : "Bills"} forecast, next ${horizon} weeks · ${scope}`,
        summary: [
          `Expected ${fmt(total)} over the next ${horizon} weeks (80% range ${fmt(lo)} – ${fmt(hi)}).`,
          `Peak week: ${label(peak.week)} at ${fmt(peak.value)}${peak.festival ? ` (${peak.festival})` : ""}.`,
          ...fc.drivers,
          `Model: ${fc.modelLabel}. Backtest error on the last ${fc.holdoutWeeks} weeks: ${fc.mape.toFixed(1)}%.`,
        ],
        chart: {
          kind: "line",
          unit: metric === "revenue" ? "inr" : "count",
          points: [
            ...fc.history.slice(-26).map((p) => ({ label: p.week, value: p.value })),
            ...fc.forecast.map((p) => ({ label: p.week, value: p.value, low: p.low, high: p.high, forecast: true, note: p.festival })),
          ],
        },
        table: { columns: ["Week of", "Forecast", "Low (80%)", "High (80%)", "Note"], rows: fc.forecast.map((p) => [label(p.week), fmt(p.value), fmt(p.low), fmt(p.high), p.festival ?? ""]) },
        forecast: fc,
      };
    }
    case "stores":
    case "abv": {
      const rows = ds.stores
        .filter((s) => !stores.length || stores.includes(s.code))
        .map((s) => ({ s, t: totals(inRange(ds, period, [s.code])), p: totals(inRange(ds, previous(period), [s.code])) }))
        .filter((x) => x.t.bills > 0);
      const key = intent === "abv" || /average bill|abv|ticket/.test(question.toLowerCase()) ? "abv" : /happ|rating/.test(question.toLowerCase()) ? "rating" : "revenue";
      rows.sort((a, b) => (b.t[key] ?? 0) - (a.t[key] ?? 0));
      const fmt = (v: number | null) => (v == null ? "–" : key === "rating" ? r1(v) : inr(v));
      const top = rows[0];
      const bottom = rows.at(-1);
      return {
        ...base,
        title: `Stores by ${key === "abv" ? "average bill value" : key} · ${period.label}`,
        summary: top
          ? [
              `${storeName(ds, top.s.code)} leads with ${fmt(top.t[key])}${bottom && bottom !== top ? `; ${storeName(ds, bottom.s.code)} is lowest at ${fmt(bottom.t[key])}` : ""}.`,
              ...rows.slice(0, 4).map((x) => `${storeName(ds, x.s.code)}: revenue ${inr(x.t.revenue)} (${x.p.revenue ? pct((100 * (x.t.revenue - x.p.revenue)) / x.p.revenue) : "n/a"} vs previous period), ${x.t.bills} bills, rating ${r1(x.t.rating)}.`),
            ]
          : ["No bills in this period."],
        chart: { kind: "bar", unit: key === "rating" ? "rating" : "inr", points: rows.map((x) => ({ label: storeName(ds, x.s.code), value: x.t[key] ?? 0 })) },
        table: {
          columns: ["Store", "Revenue", "Bills", "Avg bill", "Rating", "NPS", "vs previous"],
          rows: rows.map((x) => [storeName(ds, x.s.code), inr(x.t.revenue), x.t.bills, x.t.abv ? inr(x.t.abv) : "–", r1(x.t.rating), x.t.nps == null ? "–" : Math.round(x.t.nps), x.p.revenue ? pct((100 * (x.t.revenue - x.p.revenue)) / x.p.revenue) : "–"]),
        },
      };
    }
    case "staff": {
      const rows = ds.staff.filter((s) => !stores.length || stores.includes(s.store)).sort((a, b) => b.revenue - a.revenue);
      return {
        ...base,
        period: { from: addDays(ds.asOf, -(ds.detailDays - 1)), to: ds.asOf, label: `last ${ds.detailDays} days` },
        title: `Staff leaderboard · last ${ds.detailDays} days · ${scope}`,
        summary: rows.length
          ? [
              `${rows[0]!.name} (${storeName(ds, rows[0]!.store)}) leads with ${inr(rows[0]!.revenue)} from ${rows[0]!.bills} bills.`,
              ...rows
                .filter((r) => r.ratingCount >= 2)
                .sort((a, b) => b.ratingSum / b.ratingCount - a.ratingSum / a.ratingCount)
                .slice(0, 1)
                .map((r) => `Happiest customers: ${r.name}, average ${(r.ratingSum / r.ratingCount).toFixed(1)} from ${r.ratingCount} ratings.`),
            ]
          : ["No staff data in this period."],
        chart: { kind: "bar", unit: "inr", points: rows.slice(0, 10).map((r) => ({ label: `${r.name} · ${storeName(ds, r.store).replace(ds.brand, "").trim()}`, value: r.revenue })) },
        table: { columns: ["Staff", "Store", "Revenue", "Bills", "Avg rating"], rows: rows.map((r) => [r.name, storeName(ds, r.store), inr(r.revenue), r.bills, r.ratingCount ? r1(r.ratingSum / r.ratingCount) : "–"]) },
      };
    }
    case "categories": {
      const total = ds.categories.reduce((s, c) => s + c.revenue, 0) || 1;
      const rows = [...ds.categories].sort((a, b) => b.revenue - a.revenue);
      return {
        ...base,
        period: { from: addDays(ds.asOf, -(ds.detailDays - 1)), to: ds.asOf, label: `last ${ds.detailDays} days` },
        title: `Category mix · last ${ds.detailDays} days`,
        summary: rows.length ? [`${rows[0]!.category} is the largest category at ${((100 * rows[0]!.revenue) / total).toFixed(0)}% of revenue (${inr(rows[0]!.revenue)}).`, `${rows.length} categories sold; top 3 make up ${((100 * rows.slice(0, 3).reduce((s, c) => s + c.revenue, 0)) / total).toFixed(0)}% of revenue.`] : ["No item data."],
        chart: { kind: "bar", unit: "inr", points: rows.map((c) => ({ label: c.category, value: c.revenue })) },
        table: { columns: ["Category", "Revenue", "Share", "Units"], rows: rows.map((c) => [c.category, inr(c.revenue), `${((100 * c.revenue) / total).toFixed(1)}%`, c.units]) },
      };
    }
    case "happiness": {
      const rows = ds.stores
        .filter((s) => !stores.length || stores.includes(s.code))
        .map((s) => ({ s, t: totals(inRange(ds, period, [s.code])), p: totals(inRange(ds, previous(period), [s.code])) }))
        .filter((x) => x.t.responses > 0)
        .sort((a, b) => (a.t.rating ?? 9) - (b.t.rating ?? 9));
      const all = totals(inRange(ds, period, stores));
      const themes = ds.themes.slice(0, 5);
      const worst = rows[0];
      return {
        ...base,
        title: `Customer happiness · ${period.label} · ${scope}`,
        summary: [
          `Average rating ${r1(all.rating)} / 5 from ${all.responses} responses; NPS ${all.nps == null ? "–" : Math.round(all.nps)}.`,
          ...(worst ? [`Least happy: ${storeName(ds, worst.s.code)} at ${r1(worst.t.rating)} (${worst.p.rating ? `${worst.t.rating! - worst.p.rating >= 0 ? "+" : ""}${(worst.t.rating! - worst.p.rating).toFixed(1)} vs previous period` : "no earlier data"}).`] : []),
          ...(themes.length ? [`Most-mentioned problems (last ${ds.detailDays} days): ${themes.map((t) => `${t.option} (${t.count})`).join(", ")}.`] : []),
          ...(themes[0] ? [`Suggested action: fix "${themes[0].option.toLowerCase()}" first${worst ? ` at ${storeName(ds, worst.s.code)}` : ""}, then re-check next week.`] : []),
        ],
        chart: { kind: "bar", unit: "rating", points: rows.map((x) => ({ label: storeName(ds, x.s.code), value: x.t.rating ?? 0 })) },
        table: { columns: ["Store", "Rating", "Responses", "NPS", "Previous rating"], rows: rows.map((x) => [storeName(ds, x.s.code), r1(x.t.rating), x.t.responses, x.t.nps == null ? "–" : Math.round(x.t.nps), r1(x.p.rating)]) },
      };
    }
    case "sales":
    case "bills": {
      const cur = inRange(ds, period, stores);
      const t = totals(cur);
      const p = totals(inRange(ds, previous(period), stores));
      const d = daily(cur);
      const key = intent === "bills" ? "bills" : "revenue";
      const change = p[key] ? (100 * (t[key] - p[key])) / p[key] : null;
      const best = d.length ? d.reduce((a, b) => (b[key] > a[key] ? b : a)) : null;
      const fmt = key === "revenue" ? inr : (n: number) => Math.round(n).toLocaleString("en-IN");
      return {
        ...base,
        title: `${key === "revenue" ? "Sales" : "Bills"} · ${period.label} · ${scope}`,
        summary: [
          `${key === "revenue" ? "Revenue" : "Bills"}: ${fmt(t[key])}${change == null ? "" : ` (${pct(change)} vs the previous ${period.label.replace(/^last /, "")})`}.`,
          `${t.bills.toLocaleString("en-IN")} bills, average bill ${t.abv ? inr(t.abv) : "–"}.`,
          ...(best ? [`Best day: ${label(best.date)} with ${fmt(best[key])}.`] : []),
        ],
        chart: { kind: d.length > 45 ? "line" : "bar", unit: key === "revenue" ? "inr" : "count", points: d.map((r) => ({ label: r.date, value: r[key] })) },
        table: { columns: ["Date", "Revenue", "Bills", "Avg bill"], rows: d.map((r) => [label(r.date), inr(r.revenue), r.bills, r.bills ? inr(r.revenue / r.bills) : "–"]) },
      };
    }
    case "preread": {
      const parts = preRead(ds);
      return { ...base, title: "Monthly pre-read", summary: parts.flatMap((p) => [`${p.heading}:`, ...p.points]) };
    }
    case "help":
    default:
      return {
        ...base,
        intent: "help",
        title: "Here is what I can answer",
        summary: ["Ask about sales, bills, average bill value, stores, staff, categories, customer happiness, or a forecast. Name a store or city and a period (\"last 3 months\", \"this year\", \"October\") to narrow it.", ...SUGGESTIONS.map((s) => `Try: "${s}"`)],
      };
  }
}

export interface PreReadSection {
  heading: string;
  points: string[];
}

/** The executive pre-read that opens the deck: what happened, why, what next. */
export function preRead(ds: Dataset): PreReadSection[] {
  const cur: Range = { from: addDays(ds.asOf, -29), to: ds.asOf, label: "last 30 days" };
  const t = totals(inRange(ds, cur));
  const p = totals(inRange(ds, previous(cur)));
  const ly = totals(inRange(ds, { from: addDays(cur.from, -364), to: addDays(cur.to, -364), label: "same period last year" }));
  const storesRanked = ds.stores
    .map((s) => ({ s, t: totals(inRange(ds, cur, [s.code])) }))
    .filter((x) => x.t.bills)
    .sort((a, b) => b.t.revenue - a.t.revenue);
  const unhappy = [...storesRanked].filter((x) => x.t.responses).sort((a, b) => (a.t.rating ?? 9) - (b.t.rating ?? 9))[0];
  let fc: ForecastResult | null = null;
  try {
    fc = forecast(toWeekly(ds.days, "revenue", ds.asOf), 8, "revenue");
  } catch {
    fc = null;
  }
  const out: PreReadSection[] = [
    {
      heading: "Performance",
      points: [
        `Revenue ${inr(t.revenue)} in the last 30 days, ${p.revenue ? pct((100 * (t.revenue - p.revenue)) / p.revenue) : "n/a"} vs the previous 30 days${ly.revenue ? ` and ${pct((100 * (t.revenue - ly.revenue)) / ly.revenue)} vs last year` : ""}.`,
        `${t.bills.toLocaleString("en-IN")} bills at an average of ${t.abv ? inr(t.abv) : "–"}.`,
        ...(storesRanked[0] ? [`Top store: ${storesRanked[0].s.name} (${inr(storesRanked[0].t.revenue)}).`] : []),
      ],
    },
    {
      heading: "Customer happiness",
      points: [
        `Average rating ${r1(t.rating)} / 5 and NPS ${t.nps == null ? "–" : Math.round(t.nps)} from ${t.responses} responses.`,
        ...(unhappy ? [`Watch ${unhappy.s.name}: rating ${r1(unhappy.t.rating)}.`] : []),
        ...(ds.themes[0] ? [`Top complaint: ${ds.themes[0].option} (${ds.themes[0].count} mentions).`] : []),
      ],
    },
  ];
  if (fc) {
    const total = fc.forecast.reduce((s, x) => s + x.value, 0);
    const lo = fc.forecast.reduce((s, x) => s + x.low, 0);
    const hi = fc.forecast.reduce((s, x) => s + x.high, 0);
    out.push({ heading: "Outlook (next 8 weeks)", points: [`Expected revenue ${inr(total)} (80% range ${inr(lo)} – ${inr(hi)}).`, ...fc.drivers, `Forecast backtest error: ${fc.mape.toFixed(1)}%.`] });
  }
  const recs: string[] = [];
  if (fc?.forecast.some((x) => x.festival)) recs.push("Stock up on bestsellers and add billing staff for the festival weeks ahead.");
  if (unhappy && (unhappy.t.rating ?? 5) < 3.8) recs.push(`Fix "${(ds.themes[0]?.option ?? "service").toLowerCase()}" at ${unhappy.s.name}; review its tickets weekly.`);
  if (t.abv && p.abv && t.abv < p.abv) recs.push("Average bill value fell: train staff on add-on suggestions (earrings with necklaces, coins at checkout).");
  recs.push("Thank customers who rated 5 stars and invite them to the next collection launch.");
  out.push({ heading: "Recommended actions", points: recs });
  return out;
}
