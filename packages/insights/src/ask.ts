/**
 * The built-in local question engine. It recognises what a question is about
 * (sales, stores, staff, happiness, forecast…), works out the period and stores,
 * and computes the answer from the data. Every number is calculated, never
 * generated, so answers are exact. A language model (local or external) may
 * later reword the summary, but never supplies the figures.
 */
import { addDays, categoriesFor, daily, detailRange, groupTotals, inRange, inr, pct, themesFor, totals, type Dataset, type Range, type Totals } from "./dataset.js";
import { FESTIVALS, REGIONS, regionOf, type Region } from "./calendar.js";
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

export interface Scope {
  /** Store codes in scope; empty = all stores. */
  stores: string[];
  /** Short description, e.g. "Mumbai · 36 stores" or "South · Tier 1 · 52 stores". */
  label: string;
}

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Stores a question is about: named stores, cities, regions and tiers. */
export function parseScope(q: string, ds: Dataset): Scope {
  let rest = ` ${q.toLowerCase()} `;
  const take = (phrase: string) => {
    const re = new RegExp(`\\b${esc(phrase.toLowerCase())}\\b`);
    if (!re.test(rest)) return false;
    rest = rest.replace(re, " ");
    return true;
  };
  // Named stores (full name, name without the brand, or code), longest first.
  const short = (n: string) => (ds.brand && n.startsWith(`${ds.brand} `) ? n.slice(ds.brand.length + 1) : n);
  const named: string[] = [];
  for (const st of [...ds.stores].sort((x, y) => y.name.length - x.name.length)) {
    if (take(st.name) || (short(st.name) !== st.name && short(st.name).includes(" ") && take(short(st.name))) || take(st.code)) named.push(st.code);
  }
  // Cities, longest first so "navi mumbai" wins over "mumbai".
  const cities = [...new Set(ds.stores.map((st) => st.city).filter(Boolean) as string[])].sort((x, y) => y.length - x.length).filter((c) => take(c));
  const regions = REGIONS.filter((r) => new RegExp(`\\b${r.toLowerCase()}(ern)?\\b`).test(rest));
  const tiers = ([1, 2] as const).filter((t) => new RegExp(`\\btier[ -]?${t}\\b|\\bt${t}\\b`).test(rest) || (t === 1 && /\bmetros?\b/.test(rest)));
  const filtered = cities.length || regions.length || tiers.length
    ? ds.stores.filter((st) => (!cities.length || cities.includes(st.city ?? "")) && (!regions.length || regions.includes(regionOf(st) as Region)) && (!tiers.length || tiers.includes(st.tier as 1 | 2))).map((st) => st.code)
    : [];
  const codes = [...new Set([...named, ...filtered])];
  if (!codes.length) return { stores: [], label: named.length || cities.length || regions.length || tiers.length ? "no matching stores" : `all ${ds.stores.length} stores` };
  const parts = [
    ...(named.length ? [named.length <= 3 ? named.map((c) => short(storeName(ds, c))).join(", ") : `${named.length} named stores`] : []),
    ...(cities.length ? [cities.join(", ")] : []),
    ...(regions.length ? [regions.join(", ")] : []),
    ...(tiers.length ? [tiers.map((t) => `Tier ${t}`).join(", ")] : []),
  ];
  return { stores: codes, label: codes.length === 1 && named.length === 1 ? parts[0]! : `${parts.join(" · ")} · ${codes.length} stores` };
}

/** Store codes a question is about; empty = all. */
export function parseStores(q: string, ds: Dataset): string[] {
  return parseScope(q, ds).stores;
}

/** How to group stores in a comparison, from the wording. */
export function parseGrouping(q: string): "store" | "region" | "tier" | "city" {
  const s = q.toLowerCase();
  if (/\bby (region|zone)|\bregions\b.*\bcompar|compar\w*.*\bregions\b|each region|region[- ]wise|which region/.test(s)) return "region";
  if (/tier\s*1\s*(vs|versus|and)\s*tier\s*2|by tier|tier[- ]wise|each tier|compar\w*.*\btiers\b|which tier/.test(s)) return "tier";
  if (/by city|city[- ]wise|each city|compar\w*.*\bcities\b|which city/.test(s)) return "city";
  return "store";
}

/** Product categories by the words customers and staff use for them. */
const CATEGORY_WORDS: [RegExp, string][] = [
  [/\bnecklaces?\b|\bchains?\b|\bharams?\b/, "Necklace"],
  [/\bbangles?\b|\bkadas?\b/, "Bangles"],
  [/\bearrings?\b|\bstuds?\b|\bjhumkas?\b/, "Earrings"],
  [/\brings?\b(?! road)|\bbands?\b/, "Rings"],
  [/\bmangalsutras?\b/, "Mangalsutra"],
  [/\bbracelets?\b/, "Bracelet"],
  [/\bcoins?\b|\bbars?\b|\bbullion\b/, "Coins"],
  [/\bpendants?\b/, "Pendant"],
];
function categoryIn(s: string): string | null {
  return CATEGORY_WORDS.find(([re]) => re.test(s))?.[1] ?? null;
}

export function detectIntent(q: string): Intent {
  const s = q.toLowerCase();
  if (/pre-?read|monthly (review|report)|board (pack|deck)|summary deck|business review/.test(s)) return "preread";
  if (/next week|coming week|week ahead/.test(s) && !/next \d+ weeks/.test(s)) return "nextweek";
  if (/festiv|season|pongal|onam|ugadi|karva|lohri|dussehra|navratri|durga|puja|baisakh|padwa|ganesh|akshaya|dhanteras|diwali|wedding|strategy|what (should|to) (we )?push|maximi[sz]e|playbook/.test(s)) return "season";
  if (/forecast|predict|projection|project(ed)?|next \d+ (week|month)|expect|outlook/.test(s)) return "forecast";
  if (/staff|salesperson|sales person|employee|associate|team member|who sold/.test(s)) return "staff";
  if (/categor|product|item|collection|\bmix\b/.test(s) || categoryIn(s)) return "categories";
  if (/happ|\brat(ing|ings|ed)\b|\bnps\b|feedback|complain|unhappy|satisf|survey|reviews?\b|why .*(drop|down|low)/.test(s)) return "happiness";
  if (/average bill|abv|ticket size|basket|per bill/.test(s)) return "abv";
  if (/compare|\bvs\.?\b|versus|which (store|region|city|tier)|(best|worst|top|bottom|lowest|highest)( \d+)? (stores?|cities|regions|tiers)|stores? rank|rank\w* stores|by (store|region|zone|tier|city)|each (store|region|tier|city)|(region|tier|city|store)[- ]wise|tier ?1 (vs|versus) tier ?2|grow\w*|declin\w*/.test(s) && !/this year vs last year|vs last year|year on year|yoy/.test(s)) return "stores";
  if (/\bbills\b|footfall|transactions|invoices|how many (sales|customers|bills)/.test(s)) return "bills";
  if (/sales|revenue|turnover|business|income|how (are|did|is|was) .*(do|doing|perform)|performance|perform\w*/.test(s)) return "sales";
  return "help";
}

const names = new WeakMap<Dataset, Map<string, string>>();
const storeName = (ds: Dataset, code: string) => {
  let m = names.get(ds);
  if (!m) names.set(ds, (m = new Map(ds.stores.map((s) => [s.code, s.name]))));
  return m.get(code) ?? code;
};
const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const r1 = (n: number | null) => (n == null ? "–" : n.toFixed(1));

const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, monthEnd(y, m))).padStart(2, "0")}`;
const shiftMonths = (date: string, k: number) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = y * 12 + (m - 1) + k;
  return iso(Math.floor(t / 12), (t % 12) + 1, d);
};
const span = (a: string, b: string) => {
  const ya = a.slice(0, 4);
  const yb = b.slice(0, 4);
  return a === b ? `${label(a)} ${ya}` : `${label(a)}${ya !== yb ? ` ${ya}` : ""}–${label(b)} ${yb}`;
};

/**
 * The period to compare with, on the calendar: this week → the same weekdays last
 * week, this month → the same days last month, this year → the same dates last
 * year, a month or year → the one before, otherwise the same number of days just
 * before. The label always names the dates.
 */
export function previous(r: Range): Range {
  const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 864e5) + 1;
  let from: string;
  let to: string;
  if (r.label === "this week") [from, to] = [addDays(r.from, -7), addDays(r.to, -7)];
  else if (r.label === "this year" || /^\d{4}$/.test(r.label)) [from, to] = [shiftMonths(r.from, -12), shiftMonths(r.to, -12)];
  else if (r.label === "this month" || r.label === "last month" || /^[A-Z][a-z]+ \d{4}$/.test(r.label)) {
    from = shiftMonths(r.from, -1);
    const [y, m] = from.split("-").map(Number) as [number, number];
    to = iso(y, m, Number(r.to.slice(8, 10)) === monthEnd(Number(r.to.slice(0, 4)), Number(r.to.slice(5, 7))) ? 31 : Number(r.to.slice(8, 10)));
  } else [from, to] = [addDays(r.from, -days), addDays(r.from, -1)];
  return { from, to, label: span(from, to) };
}

/** Minimum ratings before a store is ranked on happiness (avoids 1-review extremes). */
export const MIN_RESPONSES = 10;
const CHART_MAX = 15;
const TABLE_MAX = 500;

/** Group key for a store code, restricted to the stores in scope (all when empty). */
function groupKey(ds: Dataset, grouping: "store" | "region" | "tier" | "city", scope: string[]) {
  const only = scope.length ? new Set(scope) : null;
  const info = new Map(ds.stores.map((s) => [s.code, s]));
  return (code: string): string | null => {
    if (only && !only.has(code)) return null;
    const st = info.get(code);
    if (!st) return null;
    if (grouping === "store") return code;
    if (grouping === "region") return regionOf(st) ?? "Other";
    if (grouping === "tier") return st.tier ? `Tier ${st.tier}` : "Untiered";
    return st.city ?? "Other";
  };
}

/** Says so when the breakdown window differs from the period asked about. */
function detailNote(ds: Dataset, period: Range, what = "Staff, category and complaint breakdowns"): string[] {
  const d = detailRange(ds);
  return period.from === d.from && period.to === d.to ? [] : [`Note: ${what} cover the last ${ds.detailDays} days (${label(d.from)}–${label(d.to)}), not ${period.label}.`];
}

let seq = 0;
const newId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

export function ask(question: string, ds: Dataset, opts: { horizonWeeks?: number } = {}): Answer {
  const intent = detectIntent(question);
  const period = parsePeriod(question, ds.asOf);
  const sc = parseScope(question, ds);
  const stores = sc.stores;
  const base = { id: newId(), question, intent, period, stores };
  const scope = sc.label;
  if (sc.label === "no matching stores" && intent !== "help" && intent !== "season" && intent !== "nextweek")
    return { ...base, title: "No matching stores", summary: ["No stores match that city, region or tier. Check the spelling, or ask about all stores."] };

  switch (intent) {
    case "nextweek": {
      const rows = nextWeekByRegion(ds);
      const all = rows.find((r) => r.region === "All India");
      const regs = rows.filter((r) => r.region !== "All India").sort((a, b) => b.value - a.value);
      const sign = (n: number | null) => (n == null ? "–" : pct(n));
      const vsWk = all ? `vs wk of ${label(all.lastWeekOf)}` : "";
      return {
        ...base,
        title: `Next week forecast · week of ${all ? label(all.week) : ""}`,
        summary: all
          ? [
              `All India: ${inr(all.value)} (${inr(all.low)}–${inr(all.high)}) · ${sign(all.wowPct)} ${vsWk} · ${sign(all.yoyPct)} vs same week last year`,
              ...regs.map((r) => `${r.region}: ${inr(r.value)} · ${sign(r.wowPct)} ${vsWk}${r.festival ? ` · ${r.festival}` : ""}`),
              `Model error (backtest): ${all.mape.toFixed(1)}%`,
            ]
          : ["Not enough history to forecast."],
        chart: { kind: "bar", unit: "inr", points: regs.map((r) => ({ label: String(r.region), value: r.value, low: r.low, high: r.high })) },
        table: { columns: ["Region", "Forecast", "Low", "High", all ? `vs wk of ${label(all.lastWeekOf)}` : "vs last full week", "vs last year", "Festival"], rows: rows.map((r) => [String(r.region), inr(r.value), inr(r.low), inr(r.high), sign(r.wowPct), sign(r.yoyPct), r.festival ?? ""]) },
      };
    }
    case "season": {
      const s = question.toLowerCase();
      const want = REGIONS.filter((r) => new RegExp(`\\b${r.toLowerCase()}\\b`).test(s));
      const asked = [...new Set(FESTIVALS.map((f) => f.name))].filter((n) => s.includes(n.toLowerCase()) || (n === "Akshaya Tritiya" && /akshay/.test(s)) || (n === "Durga Puja" && /\bpuja|pujo/.test(s)));
      const named = asked.length ? upcomingMoments(ds, 366, asked) : [];
      const soon = upcomingMoments(ds, 75).filter((m) => !want.length || m.scope === "National" || m.scope.some((r: Region) => want.includes(r)));
      const moments = [...named.slice(0, 1), ...soon.filter((m) => !named.slice(0, 1).some((n) => n.name === m.name && n.date === m.date))];
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
      const ql = question.toLowerCase();
      const grouping = parseGrouping(question);
      const key: "abv" | "rating" | "revenue" | "bills" | "growth" = intent === "abv" || /average bill|abv|ticket/.test(ql) ? "abv" : /grow|declin|falling|dropp/.test(ql) ? "growth" : /happ|rating|satisf/.test(ql) ? "rating" : /\bbills\b|footfall|transactions/.test(ql) ? "bills" : "revenue";
      const ascending = /\b(bottom|lowest|worst|weakest|least|declin\w*|falling|dropp\w*|slowest)\b/.test(ql);
      const topN = Number(ql.match(/\b(?:top|bottom|best|worst|lowest|highest)\s+(\d{1,3})\b/)?.[1] ?? 0);
      const keyOf = groupKey(ds, grouping, stores);
      const prevRange = previous(period);
      const cur = groupTotals(ds, period, keyOf);
      const prev = groupTotals(ds, prevRange, keyOf);
      const minResp = key === "rating" && grouping === "store" ? MIN_RESPONSES : 1;
      const growth = (t: Totals, p?: Totals) => (p?.revenue ? (100 * (t.revenue - p.revenue)) / p.revenue : null);
      const value = (x: { t: Totals; p?: Totals }) => (key === "growth" ? growth(x.t, x.p) : x.t[key]);
      const rows = [...cur]
        .map(([g, t]) => ({ g, name: grouping === "store" ? storeName(ds, g) : g, t, p: prev.get(g) }))
        .filter((x) => x.t.bills > 0 && (key !== "rating" || x.t.responses >= minResp) && value(x) != null);
      rows.sort((a, b) => (ascending ? value(a)! - value(b)! : value(b)! - value(a)!) || a.name.localeCompare(b.name));
      const fmt = (v: number | null) => (v == null ? "–" : key === "rating" ? r1(v) : key === "bills" ? v.toLocaleString("en-IN") : key === "growth" ? pct(v) : inr(v));
      const vs = (x: (typeof rows)[number]) => (x.p?.revenue ? pct(growth(x.t, x.p)!) : "–");
      const first = rows[0];
      const last = rows.at(-1);
      const what = key === "abv" ? "average bill value" : key === "growth" ? "revenue growth" : key;
      const unitWord = grouping === "store" ? "stores" : grouping === "city" ? "cities" : grouping === "tier" ? "tiers" : "regions";
      const listed = topN ? rows.slice(0, topN) : rows;
      const shown = listed.slice(0, Math.max(CHART_MAX, topN && topN <= 30 ? topN : 0));
      const head = grouping === "store" ? "Stores" : unitWord[0]!.toUpperCase() + unitWord.slice(1);
      return {
        ...base,
        title: `${topN ? `${ascending ? "Bottom" : "Top"} ${topN} ${head.toLowerCase()}` : head} by ${what}${ascending ? " (lowest first)" : ""} · ${period.label} · ${scope}`,
        summary: first
          ? [
              `${ascending ? "Lowest" : "Highest"}: ${first.name} at ${fmt(value(first))}${last && last !== first ? `; ${ascending ? "highest" : "lowest"}: ${last.name} at ${fmt(value(last))}` : ""} (${rows.length} ${unitWord}${minResp > 1 ? `, each with at least ${minResp} ratings` : ""}).`,
              ...listed.slice(0, 4).map((x) => `${x.name}: revenue ${inr(x.t.revenue)} (${vs(x)}), ${x.t.bills.toLocaleString("en-IN")} bills, avg bill ${x.t.abv ? inr(x.t.abv) : "–"}, rating ${r1(x.t.rating)}.`),
              `Change is against ${prevRange.label}.`,
            ]
          : ["No bills in this period."],
        chart: { kind: "bar", unit: key === "rating" ? "rating" : key === "bills" ? "count" : key === "growth" ? "pct" : "inr", points: shown.map((x) => ({ label: x.name, value: value(x) ?? 0 })) },
        table: {
          columns: [grouping === "store" ? "Store" : grouping[0]!.toUpperCase() + grouping.slice(1), "Revenue", "Bills", "Avg bill", "Rating", "Responses", "NPS", `vs ${prevRange.label}`],
          rows: listed.slice(0, TABLE_MAX).map((x) => [x.name, inr(x.t.revenue), x.t.bills, x.t.abv ? inr(x.t.abv) : "–", r1(x.t.rating), x.t.responses, x.t.nps == null ? "–" : Math.round(x.t.nps), vs(x)]),
        },
      };
    }
    case "staff": {
      const only = stores.length ? new Set(stores) : null;
      const rows = ds.staff.filter((s) => !only || only.has(s.store)).sort((a, b) => b.revenue - a.revenue || a.id.localeCompare(b.id));
      const rated = rows.filter((r) => r.ratingCount >= MIN_RESPONSES).sort((a, b) => b.ratingSum / b.ratingCount - a.ratingSum / a.ratingCount || b.ratingCount - a.ratingCount);
      const who = (r: (typeof rows)[number]) => `${r.name} (${storeName(ds, r.store)})`;
      return {
        ...base,
        period: detailRange(ds),
        title: `Staff leaderboard · last ${ds.detailDays} days · ${scope}`,
        summary: rows.length
          ? [
              `${who(rows[0]!)} leads with ${inr(rows[0]!.revenue)} from ${rows[0]!.bills.toLocaleString("en-IN")} bills.`,
              `${rows.length.toLocaleString("en-IN")} staff · ${inr(rows.reduce((s, r) => s + r.revenue, 0))} revenue between them.`,
              ...rated.slice(0, 1).map((r) => `Happiest customers: ${who(r)}, average ${(r.ratingSum / r.ratingCount).toFixed(1)} from ${r.ratingCount} ratings.`),
              ...(rows.length > TABLE_MAX ? [`The table lists the top ${TABLE_MAX} of ${rows.length.toLocaleString("en-IN")} staff by revenue.`] : []),
              ...detailNote(ds, period),
            ]
          : ["No staff data in this period."],
        chart: { kind: "bar", unit: "inr", points: rows.slice(0, 10).map((r) => ({ label: `${r.name} · ${storeName(ds, r.store).replace(ds.brand, "").trim()}`, value: r.revenue })) },
        table: { columns: ["Staff", "Store", "Revenue", "Bills", "Avg rating", "Ratings"], rows: rows.slice(0, TABLE_MAX).map((r) => [r.name, storeName(ds, r.store), inr(r.revenue), r.bills, r.ratingCount ? r1(r.ratingSum / r.ratingCount) : "–", r.ratingCount]) },
      };
    }
    case "categories": {
      const rows = categoriesFor(ds, stores);
      const total = rows.reduce((s, c) => s + c.revenue, 0);
      const share = (v: number) => (total ? (100 * v) / total : 0);
      const asked = categoryIn(question.toLowerCase());
      const focus = asked ? rows.find((c) => c.category === asked) : undefined;
      return {
        ...base,
        period: detailRange(ds),
        title: `Category mix · last ${ds.detailDays} days · ${scope}`,
        summary: rows.length
          ? [
              ...(asked ? [focus ? `${focus.category}: ${inr(focus.revenue)} (${share(focus.revenue).toFixed(1)}% of revenue), ${focus.units.toLocaleString("en-IN")} units, rank ${rows.indexOf(focus) + 1} of ${rows.length}.` : `No ${asked.toLowerCase()} sales in this period.`] : []),
              `${rows[0]!.category} is the largest category at ${share(rows[0]!.revenue).toFixed(1)}% of revenue (${inr(rows[0]!.revenue)} of ${inr(total)}).`,
              `${rows.length} categories sold; top 3 make up ${share(rows.slice(0, 3).reduce((s, c) => s + c.revenue, 0)).toFixed(1)}% of revenue.`,
              ...detailNote(ds, period),
            ]
          : ["No item data."],
        chart: { kind: "bar", unit: "inr", points: rows.map((c) => ({ label: c.category, value: c.revenue })) },
        table: { columns: ["Category", "Revenue", "Share", "Units"], rows: rows.map((c) => [c.category, inr(c.revenue), `${share(c.revenue).toFixed(1)}%`, c.units]) },
      };
    }
    case "happiness": {
      const grouping = parseGrouping(question);
      const keyOf = groupKey(ds, grouping, stores);
      const cur = groupTotals(ds, period, keyOf);
      const prevRange = previous(period);
      const prev = groupTotals(ds, prevRange, keyOf);
      const minResp = MIN_RESPONSES;
      const rows = [...cur]
        .map(([g, t]) => ({ g, name: grouping === "store" ? storeName(ds, g) : g, t, p: prev.get(g) }))
        .filter((x) => x.t.responses >= minResp)
        .sort((a, b) => (a.t.rating ?? 9) - (b.t.rating ?? 9) || b.t.responses - a.t.responses || a.name.localeCompare(b.name));
      const all = totals(inRange(ds, period, stores));
      const themes = themesFor(ds, stores).slice(0, 5);
      const worst = rows[0];
      const worstStores = worst ? (grouping === "store" ? [worst.g] : ds.stores.filter((s) => keyOf(s.code) === worst.g).map((s) => s.code)) : [];
      const worstTheme = worst ? themesFor(ds, worstStores)[0] : undefined;
      const delta = (x: (typeof rows)[number]) => {
        if (x.p?.rating == null || x.t.rating == null) return "no earlier ratings";
        const d = Math.round((x.t.rating - x.p.rating) * 10) / 10;
        return d === 0 ? `unchanged vs ${prevRange.label}` : `${d > 0 ? "+" : ""}${d.toFixed(1)} vs ${prevRange.label}`;
      };
      const best = rows.length > 1 ? rows.at(-1) : undefined;
      return {
        ...base,
        title: `Customer happiness${grouping === "store" ? "" : ` by ${grouping}`} · ${period.label} · ${scope}`,
        summary: [
          `Average rating ${r1(all.rating)} / 5 from ${all.responses.toLocaleString("en-IN")} responses; NPS ${all.nps == null ? "–" : Math.round(all.nps)}.`,
          ...(worst ? [`Least happy (min ${minResp} ratings): ${worst.name} at ${r1(worst.t.rating)} from ${worst.t.responses.toLocaleString("en-IN")} ratings (${delta(worst)}).`] : []),
          ...(best ? [`Happiest: ${best.name} at ${r1(best.t.rating)} from ${best.t.responses.toLocaleString("en-IN")} ratings.`] : []),
          ...(themes.length ? [`Most-mentioned problems (last ${ds.detailDays} days): ${themes.map((t) => `${t.option} (${t.count})`).join(", ")}.`] : []),
          ...(worst && worstTheme ? [`Suggested action: fix "${worstTheme.option.toLowerCase()}" at ${worst.name} first (${worstTheme.count} mentions there), then re-check next week.`] : []),
          ...(themes.length ? detailNote(ds, period, "Complaint counts") : []),
        ],
        chart: { kind: "bar", unit: "rating", points: rows.slice(0, CHART_MAX).map((x) => ({ label: x.name, value: x.t.rating ?? 0 })) },
        table: { columns: [grouping === "store" ? "Store" : grouping[0]!.toUpperCase() + grouping.slice(1), "Rating", "Responses", "NPS", "Previous rating"], rows: rows.map((x) => [x.name, r1(x.t.rating), x.t.responses, x.t.nps == null ? "–" : Math.round(x.t.nps), r1(x.p?.rating ?? null)]) },
      };
    }
    case "sales":
    case "bills": {
      const cur = inRange(ds, period, stores);
      const t = totals(cur);
      const prevRange = previous(period);
      const p = totals(inRange(ds, prevRange, stores));
      const d = daily(cur);
      const key = intent === "bills" ? "bills" : "revenue";
      const change = p[key] ? (100 * (t[key] - p[key])) / p[key] : null;
      const best = d.length ? d.reduce((a, b) => (b[key] > a[key] ? b : a)) : null;
      const fmt = key === "revenue" ? inr : (n: number) => Math.round(n).toLocaleString("en-IN");
      return {
        ...base,
        title: `${key === "revenue" ? "Sales" : "Bills"} · ${period.label} · ${scope}`,
        summary: [
          `${key === "revenue" ? "Revenue" : "Bills"}: ${fmt(t[key])}${change == null ? "" : ` (${pct(change)} vs ${prevRange.label}: ${fmt(p[key])})`}.`,
          `${t.bills.toLocaleString("en-IN")} bills, average bill ${t.abv ? inr(t.abv) : "–"}.`,
          ...(best && d.length > 1 ? [`Best day: ${label(best.date)} with ${fmt(best[key])}.`] : []),
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
  const byStore = groupTotals(ds, cur, (c) => c);
  const storesRanked = ds.stores
    .map((s) => ({ s, t: byStore.get(s.code) }))
    .filter((x): x is { s: (typeof ds.stores)[number]; t: NonNullable<typeof x.t> } => !!x.t?.bills)
    .sort((a, b) => b.t.revenue - a.t.revenue || a.s.code.localeCompare(b.s.code));
  const unhappy = [...storesRanked].filter((x) => x.t.responses >= MIN_RESPONSES).sort((a, b) => (a.t.rating ?? 9) - (b.t.rating ?? 9) || b.t.responses - a.t.responses)[0];
  const topTheme = themesFor(ds)[0];
  const unhappyTheme = unhappy ? themesFor(ds, [unhappy.s.code])[0] : undefined;
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
        ...(unhappy ? [`Watch ${unhappy.s.name}: rating ${r1(unhappy.t.rating)} from ${unhappy.t.responses} ratings.`] : []),
        ...(topTheme ? [`Top complaint: ${topTheme.option} (${topTheme.count.toLocaleString("en-IN")} mentions, last ${ds.detailDays} days).`] : []),
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
  if (unhappy && (unhappy.t.rating ?? 5) < 3.8) recs.push(`Fix "${(unhappyTheme?.option ?? "service").toLowerCase()}" at ${unhappy.s.name}; review its tickets weekly.`);
  if (t.abv && p.abv && t.abv < p.abv) recs.push("Average bill value fell: train staff on add-on suggestions (earrings with necklaces, coins at checkout).");
  recs.push("Thank customers who rated 5 stars and invite them to the next collection launch.");
  out.push({ heading: "Recommended actions", points: recs });
  return out;
}
