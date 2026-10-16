/**
 * Weekly forecasting with classical, explainable models. No data leaves the
 * process: models are fitted on the company's own history every time.
 *
 * Candidates are compared on a hold-out of the most recent weeks (backtest) and
 * the most accurate one is used, so the engine "learns" which pattern fits each
 * company and store best. Ranges come from that model's own backtest errors.
 */
import { FESTIVALS, isWeddingSeason } from "./calendar.js";
import { addDays, daily, type DayRow } from "./dataset.js";

export type Metric = "revenue" | "bills";

export interface WeekPoint {
  week: string; // Monday, YYYY-MM-DD
  value: number;
}

export interface ForecastPoint extends WeekPoint {
  low: number;
  high: number;
  festival?: string;
}

export interface ForecastResult {
  metric: Metric;
  model: string;
  modelLabel: string;
  history: WeekPoint[];
  forecast: ForecastPoint[];
  /** Mean absolute percentage error on the hold-out weeks (lower is better). */
  mape: number;
  holdoutWeeks: number;
  candidates: { model: string; mape: number }[];
  drivers: string[];
}

export const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
};

/** Daily rows → weekly totals (complete weeks only). */
export function toWeekly(rows: DayRow[], metric: Metric, asOf: string): WeekPoint[] {
  const m = new Map<string, number>();
  for (const r of daily(rows)) {
    const w = mondayOf(r.date);
    m.set(w, (m.get(w) ?? 0) + r[metric]);
  }
  const lastFull = addDays(mondayOf(asOf), -7); // the current week is incomplete
  const weeks = [...m.keys()].sort();
  if (!weeks.length) return [];
  const out: WeekPoint[] = [];
  for (let w = weeks[0]!; w <= lastFull; w = addDays(w, 7)) out.push({ week: w, value: m.get(w) ?? 0 });
  return out;
}

/** Festivals falling in the week starting `week`, e.g. "Dhanteras, Diwali". */
const festivalIn = (week: string) => {
  const names = FESTIVALS.filter((f) => f.date >= week && f.date <= addDays(week, 6)).map((f) => f.name);
  return names.length ? { name: names.join(", ") } : undefined;
};
/** The week before a festival also lifts (people buy ahead of Dhanteras/Diwali). */
const festivalAhead = (week: string) => FESTIVALS.find((f) => f.date > addDays(week, 6) && f.date <= addDays(week, 13));

function features(week: string, t: number): number[] {
  const doy = (Date.parse(`${week}T00:00:00Z`) - Date.parse(`${week.slice(0, 4)}-01-01T00:00:00Z`)) / 864e5;
  const a = (2 * Math.PI * doy) / 365.25;
  return [
    1,
    t,
    Math.sin(a),
    Math.cos(a),
    Math.sin(2 * a),
    Math.cos(2 * a),
    festivalIn(week) ? 1 : 0,
    festivalAhead(week) ? 1 : 0,
    isWeddingSeason(addDays(week, 3)) ? 1 : 0,
  ];
}

/** Ridge regression via normal equations (tiny systems, Gaussian elimination). */
function ridge(X: number[][], y: number[], lambda = 0.5): number[] {
  const p = X[0]!.length;
  const A = Array.from({ length: p }, () => new Array<number>(p + 1).fill(0));
  for (let i = 0; i < X.length; i++) {
    const xi = X[i]!;
    for (let r = 0; r < p; r++) {
      for (let c = 0; c < p; c++) A[r]![c]! += xi[r]! * xi[c]!;
      A[r]![p]! += xi[r]! * y[i]!;
    }
  }
  for (let r = 1; r < p; r++) A[r]![r]! += lambda; // do not shrink the intercept
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    const d = A[col]![col]! || 1e-12;
    for (let c = col; c <= p; c++) A[col]![c]! /= d;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = A[r]![col]!;
      if (f) for (let c = col; c <= p; c++) A[r]![c]! -= f * A[col]![c]!;
    }
  }
  return A.map((row) => row[p]!);
}

type Model = (train: WeekPoint[], future: string[]) => number[];

/** Trend + yearly seasonality + festival and wedding-season effects, fitted in log space. */
const regression: Model = (train, future) => {
  const X = train.map((p, i) => features(p.week, i / 52));
  const y = train.map((p) => Math.log(Math.max(1, p.value)));
  const b = ridge(X, y);
  return future.map((w, j) => Math.exp(features(w, (train.length + j) / 52).reduce((s, x, k) => s + x * b[k]!, 0)));
};

/** Same week last year, scaled by recent year-on-year growth. */
const seasonalNaive: Model = (train, future) => {
  const byWeek = new Map(train.map((p) => [p.week, p.value]));
  const recent = train.slice(-8);
  const ly = recent.map((p) => byWeek.get(addDays(p.week, -364)));
  const lySum = ly.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const growth = ly.every((v) => v) && lySum > 0 ? recent.reduce((sum, p) => sum + p.value, 0) / lySum : 1;
  const last = train.at(-1)?.value ?? 0;
  return future.map((w) => (byWeek.get(addDays(w, -364)) ?? last) * growth);
};

/** Holt's linear trend (no seasonality): a baseline for short histories. */
const holt: Model = (train, future) => {
  const alpha = 0.4;
  const beta = 0.1;
  let level = train[0]?.value ?? 0;
  let trend = 0;
  for (const p of train.slice(1)) {
    const prev = level;
    level = alpha * p.value + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  return future.map((_, j) => Math.max(0, level + (j + 1) * trend));
};

/**
 * Festivals move every year (Diwali was 20 Oct in 2025, 8 Nov in 2026), so a
 * model that copies "the same week last year" would put the spike in the wrong
 * week. We measure each festival's lift from history, take it out before a model
 * learns, and put it back on the festival's new date.
 */
function festivalLift(history: WeekPoint[]) {
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)]! : 0;
  };
  const plain = (w: string) => !festivalIn(w) && !festivalAhead(w);
  const ratios = { in: [] as number[], ahead: [] as number[] };
  history.forEach((p, i) => {
    const kind = festivalIn(p.week) ? "in" : festivalAhead(p.week) ? "ahead" : null;
    if (!kind) return;
    const around = history.slice(Math.max(0, i - 4), i + 5).filter((x) => plain(x.week)).map((x) => x.value);
    const base = median(around);
    if (base > 0 && around.length >= 3) ratios[kind].push(p.value / base);
  });
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);
  const lift = { in: Math.max(1, avg(ratios.in)), ahead: Math.max(1, avg(ratios.ahead)) };
  return (week: string) => (festivalIn(week) ? lift.in : festivalAhead(week) ? lift.ahead : 1);
}

/** Wrap a festival-blind model: deflate history, predict, re-inflate festival weeks. */
const festivalAware =
  (model: Model): Model =>
  (train, future) => {
    const lift = festivalLift(train);
    const clean = train.map((p) => ({ week: p.week, value: p.value / lift(p.week) }));
    return model(clean, future).map((v, i) => v * lift(future[i]!));
  };

const MODELS: Record<string, { fn: Model; label: string; minWeeks: number }> = {
  regression: { fn: regression, label: "Seasonal regression (trend, yearly cycle, festivals, wedding season)", minWeeks: 30 },
  seasonal_naive: { fn: festivalAware(seasonalNaive), label: "Same week last year × growth, festival-adjusted", minWeeks: 60 },
  holt: { fn: festivalAware(holt), label: "Trend smoothing, festival-adjusted", minWeeks: 6 },
};

const mapeOf = (actual: number[], pred: number[]) => {
  const pairs = actual.map((a, i) => [a, pred[i]!] as const).filter(([a]) => a > 0);
  return pairs.length ? (100 * pairs.reduce((s, [a, p]) => s + Math.abs(a - p) / a, 0)) / pairs.length : Infinity;
};

export function forecast(history: WeekPoint[], horizon: number, metric: Metric, holdoutWeeks = 8): ForecastResult {
  if (history.length < 6) throw new Error("Need at least 6 weeks of history to forecast");
  const hold = Math.min(holdoutWeeks, Math.floor(history.length / 4));
  const train = history.slice(0, -hold);
  const test = history.slice(-hold);
  const candidates = Object.entries(MODELS)
    .filter(([, m]) => train.length >= m.minWeeks)
    .map(([name, m]) => {
      const pred = m.fn(train, test.map((p) => p.week));
      return { model: name, mape: mapeOf(test.map((p) => p.value), pred), errors: test.map((p, i) => Math.log(Math.max(1, p.value)) - Math.log(Math.max(1, pred[i]!))) };
    })
    .sort((a, b) => a.mape - b.mape);
  const best = candidates[0]!;
  const future = Array.from({ length: horizon }, (_, i) => addDays(history.at(-1)!.week, 7 * (i + 1)));
  const values = MODELS[best.model]!.fn(history, future);
  // 80% range from the backtest's log errors, widening with distance.
  const sd = Math.max(0.05, Math.sqrt(best.errors.reduce((s, e) => s + e * e, 0) / Math.max(1, best.errors.length)));
  const fc: ForecastPoint[] = future.map((week, i) => {
    const spread = 1.28 * sd * Math.sqrt(1 + i / 4);
    const f = festivalIn(week) ?? festivalAhead(week);
    return { week, value: values[i]!, low: values[i]! * Math.exp(-spread), high: values[i]! * Math.exp(spread), ...(f ? { festival: festivalIn(week) ? f.name : `${f.name} (week before)` } : {}) };
  });
  const drivers: string[] = [];
  const fest = fc.filter((p) => p.festival);
  if (fest.length) drivers.push(`Festival weeks ahead: ${[...new Set(fest.flatMap((p) => p.festival!.replace(" (week before)", "").split(", ")))].join(", ")}`);
  if (future.some((w) => isWeddingSeason(addDays(w, 3)))) drivers.push("Wedding season in the forecast window");
  const lastYear = history.filter((p) => p.week >= addDays(history.at(-1)!.week, -364 - 7 * 7) && p.week <= addDays(history.at(-1)!.week, -364));
  const recent = history.slice(-8);
  if (lastYear.length >= 6) {
    const g = (100 * (recent.reduce((s, p) => s + p.value, 0) / lastYear.slice(-8).reduce((s, p) => s + p.value, 0) - 1));
    if (Number.isFinite(g)) drivers.push(`Last 8 weeks vs same weeks last year: ${g >= 0 ? "+" : ""}${g.toFixed(1)}%`);
  }
  return {
    metric,
    model: best.model,
    modelLabel: MODELS[best.model]!.label,
    history,
    forecast: fc,
    mape: best.mape,
    holdoutWeeks: hold,
    candidates: candidates.map(({ model, mape }) => ({ model, mape })),
    drivers,
  };
}
