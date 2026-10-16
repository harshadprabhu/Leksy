/**
 * Leadership pack (PowerPoint). Metric-first slides with native, editable charts.
 * Works in the browser and in Node: the caller passes the PptxGenJS constructor.
 *
 * Keep to the rules PowerPoint enforces: plain 6-digit hex colours, escaped "&" in
 * document properties, no null chart values, inside-only labels on stacked charts.
 */
import type * as PptxModule from "pptxgenjs";
import { REGIONS, type Region } from "./calendar.js";
import { addDays, inRange, totals, type Dataset } from "./dataset.js";
import { forecast, toWeekly } from "./forecast.js";
import { decisions, nextWeekByRegion, upcomingMoments, type RegionWeek, type SeasonMoment } from "./seasons.js";
import type { Answer } from "./ask.js";

export interface DeckTheme {
  company: string;
  primary: string;
  accent: string;
  text: string;
  headingFont: string;
  bodyFont: string;
  logo?: string;
  footer: string;
}

type Pptx = PptxModule.default;
type Slide = ReturnType<Pptx["addSlide"]>;

/** Validated categorical palette (colour-blind safe in this order). */
const CAT = ["2A78D6", "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300", "6250D6", "E34948"];
const REGION_COLOR: Record<Region | "All India", string> = { North: CAT[0]!, South: CAT[1]!, East: CAT[2]!, West: CAT[3]!, "All India": CAT[6]! };
const GOOD = "008300";
const BAD = "E34948";
const INK = "1F2937";
const MUTED = "6B7280";
const CARD = "F3F4F6";
const LINE = "E5E7EB";

const hex = (c: string) => c.replace("#", "").slice(0, 6).toUpperCase();
const xmlSafe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const L = (n: number) => Math.round(n / 1e4) / 10; // rupees → lakhs, 1 dp
const money = (n: number) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : `₹${(n / 1e5).toFixed(1)} L`);
const pctTxt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "–" : `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(1)}%`);
const pctColor = (n: number | null | undefined) => (n == null ? MUTED : n >= 0 ? GOOD : BAD);
const dd = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const liftTxt = (x: number | null) => (x == null ? "–" : `${x >= 1 ? "+" : ""}${Math.round((x - 1) * 100)}%`);

export interface DeckInput {
  ds: Dataset;
  theme: DeckTheme;
  answers: Answer[];
}

export function buildLeadershipDeck(PptxGenJS: new () => Pptx, { ds, theme, answers }: DeckInput): Pptx {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in
  pptx.company = xmlSafe(theme.company);
  pptx.title = `${theme.company} leadership pack`;
  pptx.author = "Leksy Insights";
  pptx.theme = { headFontFace: theme.headingFont, bodyFontFace: theme.bodyFont };
  const P = hex(theme.primary);
  const A = hex(theme.accent);
  const HF = theme.headingFont;
  const BF = theme.bodyFont;
  const logo = theme.logo && /^(data:image\/(png|jpeg);base64,|https:\/\/)/.test(theme.logo) ? theme.logo : undefined;
  const logoOpts = (x: number, y: number, h: number) => (logo ? { ...(logo.startsWith("data:") ? { data: logo } : { path: logo }), x, y, h, w: h * 2.4, sizing: { type: "contain" as const, w: h * 2.4, h } } : null);

  pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: "FFFFFF" },
    objects: [
      { text: { text: `${theme.company} · ${theme.footer}`, options: { x: 0.5, y: 7.0, w: 9, h: 0.3, fontFace: BF, fontSize: 9, color: MUTED, isTextBox: true } } },
      ...(logoOpts(11.4, 0.35, 0.45) ? [{ image: logoOpts(11.4, 0.35, 0.45)! }] : []),
    ],
    slideNumber: { x: 12.4, y: 7.0, w: 0.5, h: 0.3, fontFace: BF, fontSize: 9, color: MUTED },
  });

  const title = (s: Slide, t: string, kicker?: string) => {
    if (kicker) s.addText(kicker.toUpperCase(), { x: 0.5, y: 0.35, w: 10.6, h: 0.3, fontFace: BF, fontSize: 11, bold: true, color: A, charSpacing: 2, margin: 0, isTextBox: true });
    s.addText(t, { x: 0.5, y: 0.65, w: 10.6, h: 0.7, fontFace: HF, fontSize: 30, bold: true, color: P, margin: 0, isTextBox: true });
  };
  const chip = (s: Slide, text: string, x: number, y: number, color: string, w = 1.5) => {
    s.addShape("roundRect", { x, y, w, h: 0.34, fill: { color }, line: { color }, rectRadius: 0.17 });
    s.addText(text, { x, y, w, h: 0.34, fontFace: BF, fontSize: 11, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true });
  };
  const card = (s: Slide, x: number, y: number, w: number, h: number, fill = CARD) => s.addShape("roundRect", { x, y, w, h, fill: { color: fill }, line: { color: fill }, rectRadius: 0.12 });
  const axis = { catAxisLabelFontFace: BF, valAxisLabelFontFace: BF, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, valGridLine: { color: LINE, size: 0.75 }, catGridLine: { style: "none" as const }, dataLabelFontFace: BF, dataLabelFontSize: 10, legendFontFace: BF, legendFontSize: 11 };

  // ---- data ----
  const cur = { from: addDays(ds.asOf, -29), to: ds.asOf, label: "last 30 days" };
  const prev = { from: addDays(ds.asOf, -59), to: addDays(ds.asOf, -30), label: "previous 30 days" };
  const ly = { from: addDays(cur.from, -364), to: addDays(cur.to, -364), label: "last year" };
  const t = totals(inRange(ds, cur));
  const p = totals(inRange(ds, prev));
  const y = totals(inRange(ds, ly));
  const ch = (a: number | null, b: number | null) => (a != null && b ? (100 * (a - b)) / b : null);
  const weeks = nextWeekByRegion(ds);
  const india = weeks.find((w) => w.region === "All India");
  const regionsPresent = weeks.filter((w) => w.region !== "All India") as (RegionWeek & { region: Region })[];
  const moments = upcomingMoments(ds, 75);
  const decs = decisions(ds, moments, weeks);
  let trend: ReturnType<typeof forecast> | null = null;
  try {
    trend = forecast(toWeekly(ds.days, "revenue", ds.asOf), 2, "revenue");
  } catch {
    trend = null;
  }

  // ---- 1. Cover ----
  {
    const s = pptx.addSlide();
    s.background = { color: P };
    const lo = logoOpts(0.7, 0.6, 0.8);
    if (lo) s.addImage(lo);
    s.addText(theme.company, { x: 0.7, y: 2.0, w: 11.5, h: 1.0, fontFace: HF, fontSize: 44, bold: true, color: "FFFFFF", margin: 0, isTextBox: true });
    s.addText("Leadership pack · performance, outlook, festive plan", { x: 0.7, y: 3.0, w: 11.5, h: 0.5, fontFace: BF, fontSize: 20, color: A, margin: 0, isTextBox: true });
    if (india) {
      const stats: [string, string, string][] = [
        [money(india.value), `Next week (w/c ${dd(india.week)})`, "FFFFFF"],
        [pctTxt(india.wowPct), "vs this week", india.wowPct == null ? "FFFFFF" : india.wowPct >= 0 ? "7EE07E" : "FF9A9A"],
        [money(t.revenue), "Last 30 days", "FFFFFF"],
        [t.rating == null ? "–" : `${t.rating.toFixed(1)}★`, "Customer rating", "FFFFFF"],
      ];
      stats.forEach(([v, l, c], i) => {
        s.addText(v, { x: 0.7 + i * 3.0, y: 4.6, w: 2.8, h: 0.8, fontFace: HF, fontSize: 32, bold: true, color: c, margin: 0, isTextBox: true });
        s.addText(l, { x: 0.7 + i * 3.0, y: 5.4, w: 2.8, h: 0.35, fontFace: BF, fontSize: 12, color: "D1D5DB", margin: 0, isTextBox: true });
      });
    }
    s.addText(`Data to ${dd(ds.asOf)} · generated on-device by Leksy`, { x: 0.7, y: 6.7, w: 11, h: 0.35, fontFace: BF, fontSize: 11, color: "9CA3AF", margin: 0, isTextBox: true });
  }

  // ---- 2. Scorecard ----
  {
    const s = pptx.addSlide({ masterName: "CONTENT" });
    title(s, "Scorecard · last 30 days", "Performance");
    const tiles: [string, string, number | null, number | null][] = [
      ["Revenue", money(t.revenue), ch(t.revenue, p.revenue), ch(t.revenue, y.revenue)],
      ["Bills", t.bills.toLocaleString("en-IN"), ch(t.bills, p.bills), ch(t.bills, y.bills)],
      ["Avg bill value", t.abv ? money(t.abv) : "–", ch(t.abv, p.abv), ch(t.abv, y.abv)],
      ["Customer rating", t.rating ? `${t.rating.toFixed(2)} / 5` : "–", ch(t.rating, p.rating), null],
      ["NPS", t.nps == null ? "–" : String(Math.round(t.nps)), t.nps != null && p.nps != null ? t.nps - p.nps : null, null],
      ["Survey responses", t.responses.toLocaleString("en-IN"), ch(t.responses, p.responses), null],
    ];
    tiles.forEach(([label, value, mom, yoy], i) => {
      const x = 0.5 + (i % 3) * 4.15;
      const yy = 1.7 + Math.floor(i / 3) * 2.55;
      card(s, x, yy, 3.95, 2.3);
      s.addText(label, { x: x + 0.3, y: yy + 0.25, w: 3.4, h: 0.35, fontFace: BF, fontSize: 14, color: MUTED, margin: 0, isTextBox: true });
      s.addText(value, { x: x + 0.3, y: yy + 0.65, w: 3.4, h: 0.8, fontFace: HF, fontSize: 36, bold: true, color: INK, margin: 0, isTextBox: true });
      s.addText(
        [
          { text: label === "NPS" && mom != null ? `${mom >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(mom))} pts` : pctTxt(mom), options: { color: pctColor(mom), bold: true } },
          { text: "  vs prior 30d", options: { color: MUTED } },
          ...(yoy != null ? [{ text: `   ${pctTxt(yoy)}`, options: { color: pctColor(yoy), bold: true } }, { text: "  YoY", options: { color: MUTED } }] : []),
        ],
        { x: x + 0.3, y: yy + 1.6, w: 3.5, h: 0.4, fontFace: BF, fontSize: 13, margin: 0, isTextBox: true },
      );
    });
  }

  // ---- 3. Next week by region ----
  if (india) {
    const s = pptx.addSlide({ masterName: "CONTENT" });
    title(s, `Next week: ${money(india.value)}`, `Forecast · week of ${dd(india.week)}`);
    card(s, 0.5, 1.7, 3.9, 4.95);
    s.addText("All India", { x: 0.8, y: 1.95, w: 3.4, h: 0.35, fontFace: BF, fontSize: 14, color: MUTED, margin: 0, isTextBox: true });
    s.addText(money(india.value), { x: 0.8, y: 2.35, w: 3.4, h: 0.8, fontFace: HF, fontSize: 40, bold: true, color: INK, margin: 0, isTextBox: true });
    s.addText(`80% range ${money(india.low)} – ${money(india.high)}`, { x: 0.8, y: 3.15, w: 3.4, h: 0.35, fontFace: BF, fontSize: 13, color: MUTED, margin: 0, isTextBox: true });
    chip(s, `${pctTxt(india.wowPct)} WoW`, 0.8, 3.75, pctColor(india.wowPct), 1.55);
    chip(s, `${pctTxt(india.yoyPct)} YoY`, 2.5, 3.75, pctColor(india.yoyPct), 1.55);
    s.addText(
      [
        { text: "Model error ", options: { color: MUTED } },
        { text: `${india.mape.toFixed(1)}%`, options: { bold: true, color: INK } },
        { text: "\nFestival ", options: { color: MUTED } },
        { text: india.festival ?? "none in week", options: { bold: true, color: INK } },
      ],
      { x: 0.8, y: 4.45, w: 3.4, h: 1.0, fontFace: BF, fontSize: 13, margin: 0, isTextBox: true, valign: "top" },
    );
    // One series per region so each bar keeps its region colour (zeros elsewhere are hidden).
    const labels = regionsPresent.map((r) => r.region);
    s.addChart(
      "bar",
      regionsPresent.map((r) => ({ name: r.region, labels, values: labels.map((l) => (l === r.region ? L(r.value) : 0)) })),
      {
        x: 4.7, y: 1.6, w: 8.1, h: 3.4, barDir: "col", barGrouping: "stacked", barGapWidthPct: 60,
        chartColors: regionsPresent.map((r) => REGION_COLOR[r.region]),
        showValue: true, dataLabelPosition: "inEnd", dataLabelColor: "FFFFFF", dataLabelFormatCode: '0.0" L";;;',
        showLegend: false, valAxisLabelFormatCode: '0" L"', showTitle: true, title: "Next week forecast by region (₹ lakh)", titleFontFace: BF, titleFontSize: 13, titleColor: INK, ...axis,
      },
    );
    const rows = regionsPresent.map((r) => [
      { text: r.region, options: { bold: true, color: REGION_COLOR[r.region] } },
      { text: money(r.value) },
      { text: pctTxt(r.wowPct), options: { color: pctColor(r.wowPct), bold: true } },
      { text: pctTxt(r.yoyPct), options: { color: pctColor(r.yoyPct), bold: true } },
      { text: r.festival ?? "–" },
    ]);
    s.addTable([["Region", "Forecast", "WoW", "YoY", "Festival in week"].map((h) => ({ text: h, options: { bold: true, color: MUTED } })), ...rows], {
      x: 4.8, y: 5.1, w: 8.0, colW: [1.3, 1.5, 1.3, 1.3, 2.6], fontFace: BF, fontSize: 12, color: INK, border: { type: "solid", color: LINE, pt: 0.75 }, rowH: 0.3, margin: 0.04,
    });
  }

  // ---- 4. Trend ----
  if (trend) {
    const s = pptx.addSlide({ masterName: "CONTENT" });
    const hist = trend.history.slice(-12);
    const nf = trend.forecast[1] ?? trend.forecast[0]!;
    const next = india ? { week: india.week, value: india.value } : nf;
    const labels = [...hist.map((h) => dd(h.week)), `${dd(next.week)} (F)`];
    const last4 = hist.slice(-4).reduce((a, h) => a + h.value, 0) / 4;
    title(s, `Revenue trend: next week ${pctTxt(last4 ? (100 * (next.value - last4)) / last4 : null)} vs 4-week average`, "Trend · weekly revenue");
    s.addChart(
      "bar",
      [
        { name: "Actual", labels, values: [...hist.map((h) => L(h.value)), 0] },
        { name: "Forecast", labels, values: [...hist.map(() => 0), L(next.value)] },
      ],
      {
        x: 0.5, y: 1.6, w: 12.3, h: 5.1, barDir: "col", barGrouping: "stacked", barGapWidthPct: 45,
        chartColors: [CAT[0]!, CAT[1]!], showValue: true, dataLabelPosition: "inEnd", dataLabelColor: "FFFFFF", dataLabelFormatCode: '0" L";;;',
        showLegend: true, legendPos: "t", valAxisLabelFormatCode: '0" L"', ...axis,
      },
    );
  }

  // ---- 5. Regional season radar ----
  {
    const s = pptx.addSlide({ masterName: "CONTENT" });
    const far = upcomingMoments(ds, 120);
    const nat0 = moments.find((z) => z.scope === "National");
    title(s, "Regional season radar", `Festive plan${nat0 ? ` · national: ${nat0.name} in ${nat0.daysTo} days` : ""}`);
    const present = REGIONS.filter((r) => regionsPresent.some((w) => w.region === r));
    const cols = present.length || 1;
    const w = (12.3 - (cols - 1) * 0.3) / cols;
    present.forEach((r, i) => {
      const x = 0.5 + i * (w + 0.3);
      const wk = regionsPresent.find((z) => z.region === r);
      const m: SeasonMoment | undefined = far.find((z) => z.scope !== "National" && z.scope.includes(r)) ?? nat0;
      card(s, x, 1.65, w, 5.1);
      s.addShape("ellipse", { x: x + 0.3, y: 1.9, w: 0.32, h: 0.32, fill: { color: REGION_COLOR[r] }, line: { color: REGION_COLOR[r] } });
      s.addText(r, { x: x + 0.75, y: 1.84, w: w - 1.0, h: 0.45, fontFace: HF, fontSize: 20, bold: true, color: INK, margin: 0, isTextBox: true });
      s.addText(
        [
          { text: wk ? money(wk.value) : "–", options: { bold: true, color: INK, fontSize: 22 } },
          { text: "  next week", options: { color: MUTED, fontSize: 12 } },
          { text: `\n${pctTxt(wk?.wowPct)} WoW`, options: { color: pctColor(wk?.wowPct), bold: true, fontSize: 12 } },
        ],
        { x: x + 0.3, y: 2.4, w: w - 0.5, h: 0.85, fontFace: BF, margin: 0, isTextBox: true, valign: "top" },
      );
      if (m) {
        s.addText(
          [
            { text: m.name, options: { bold: true, color: REGION_COLOR[r], fontSize: 18 } },
            { text: `\n${dd(m.date)} · in ${m.daysTo} days${m.scope === "National" ? " · national" : ""}`, options: { color: MUTED, fontSize: 12 } },
          ],
          { x: x + 0.3, y: 3.4, w: w - 0.5, h: 0.75, fontFace: BF, margin: 0, isTextBox: true, valign: "top" },
        );
        s.addText(
          [
            { text: liftTxt(m.lastLift), options: { bold: true, fontSize: 26, color: m.lastLift && m.lastLift >= 1 ? GOOD : INK } },
            { text: "\nsales lift last time", options: { fontSize: 11, color: MUTED } },
          ],
          { x: x + 0.3, y: 4.15, w: w - 0.5, h: 0.85, fontFace: HF, margin: 0, isTextBox: true, valign: "top" },
        );
        s.addText(
          [
            { text: "Push ", options: { bold: true } },
            { text: `${m.play.push}\n` },
            { text: "Stock ", options: { bold: true } },
            { text: `${m.play.stock}\n` },
            { text: "Go ", options: { bold: true } },
            { text: m.play.activate.split(";")[0]! },
          ],
          { x: x + 0.3, y: 5.05, w: w - 0.5, h: 1.6, fontFace: BF, fontSize: present.length > 3 ? 12 : 13, color: INK, margin: 0, isTextBox: true, valign: "top", paraSpaceAfter: 4 },
        );
      } else {
        s.addText("No festival in window", { x: x + 0.3, y: 3.4, w: w - 0.5, h: 0.4, fontFace: BF, fontSize: 12, color: MUTED, margin: 0, isTextBox: true });
      }
    });
  }

  // ---- 6. National moments ----
  {
    const nat = moments.filter((m) => m.scope === "National");
    const s = pptx.addSlide({ masterName: "CONTENT" });
    title(s, nat[0] ? `${nat.map((m) => m.name).join(" + ")}: ${nat[0].daysTo} days to go` : "National moments", "All-India festive plan");
    const items = nat.length ? nat.slice(0, 3) : [];
    const w = items.length ? (12.3 - (items.length - 1) * 0.3) / items.length : 12.3;
    items.forEach((m, i) => {
      const x = 0.5 + i * (w + 0.3);
      card(s, x, 1.65, w, 5.1);
      chip(s, `in ${m.daysTo} days`, x + 0.3, 1.95, CAT[6]!, 1.6);
      s.addText(m.name, { x: x + 0.3, y: 2.45, w: w - 0.6, h: 0.6, fontFace: HF, fontSize: 26, bold: true, color: INK, margin: 0, isTextBox: true });
      s.addText(dd(m.date), { x: x + 0.3, y: 3.0, w: w - 0.6, h: 0.35, fontFace: BF, fontSize: 13, color: MUTED, margin: 0, isTextBox: true });
      const stats: [string, string][] = [
        [m.forecastWeek ? money(m.forecastWeek) : "–", "forecast, festival week"],
        [liftTxt(m.lastLift), `lift last time (${m.lastDate ? dd(m.lastDate) : "–"})`],
      ];
      stats.forEach(([v, l], k) => {
        s.addText(v, { x: x + 0.3 + k * ((w - 0.6) / 2), y: 3.5, w: (w - 0.6) / 2, h: 0.6, fontFace: HF, fontSize: 24, bold: true, color: k === 1 ? GOOD : INK, margin: 0, isTextBox: true });
        s.addText(l, { x: x + 0.3 + k * ((w - 0.6) / 2), y: 4.1, w: (w - 0.6) / 2, h: 0.35, fontFace: BF, fontSize: 11, color: MUTED, margin: 0, isTextBox: true });
      });
      s.addText(
        [
          { text: "Push ", options: { bold: true } },
          { text: `${m.play.push}\n` },
          { text: "Stock ", options: { bold: true } },
          { text: `${m.play.stock}\n` },
          { text: "Activate ", options: { bold: true } },
          { text: m.play.activate },
        ],
        { x: x + 0.3, y: 4.65, w: w - 0.6, h: 1.95, fontFace: BF, fontSize: 15, color: INK, margin: 0, isTextBox: true, valign: "top", paraSpaceAfter: 8 },
      );
    });
    if (!items.length) s.addText("No national festival in the next 75 days.", { x: 0.5, y: 2, w: 12, h: 0.5, fontFace: BF, fontSize: 16, color: MUTED, isTextBox: true });
  }

  // ---- 7. Stores ----
  {
    const s = pptx.addSlide({ masterName: "CONTENT" });
    const rows = ds.stores
      .map((st) => ({ st, cur: totals(inRange(ds, cur, [st.code])), prev: totals(inRange(ds, prev, [st.code])), region: regionsPresent.find((r) => r.stores.includes(st.code))?.region }))
      .filter((r) => r.cur.bills)
      .sort((a, b) => b.cur.revenue - a.cur.revenue);
    title(s, rows[0] ? `${rows[0].st.name} leads with ${money(rows[0].cur.revenue)}` : "Stores", "Stores · last 30 days");
    const short = (n: string) => n.replace(ds.brand, "").trim() || n;
    const labels = rows.map((r) => short(r.st.name));
    const regs = [...new Set(rows.map((r) => r.region ?? "All India"))] as (Region | "All India")[];
    s.addChart(
      "bar",
      regs.map((g) => ({ name: g, labels, values: rows.map((r) => ((r.region ?? "All India") === g ? L(r.cur.revenue) : 0)) })),
      {
        x: 0.5, y: 1.6, w: 7.4, h: 5.1, barDir: "bar", barGrouping: "stacked", barGapWidthPct: 50,
        chartColors: regs.map((g) => REGION_COLOR[g]), showValue: true, dataLabelPosition: "inEnd", dataLabelColor: "FFFFFF", dataLabelFormatCode: '0.0" L";;;',
        showLegend: true, legendPos: "b", valAxisLabelFormatCode: '0" L"', catAxisOrientation: "maxMin" as "minMax", ...axis,
      },
    );
    s.addTable(
      [
        ["Store", "MoM", "Rating", "NPS"].map((h) => ({ text: h, options: { bold: true, color: MUTED } })),
        ...rows.map((r) => {
          const mom = ch(r.cur.revenue, r.prev.revenue);
          return [
            { text: labels[rows.indexOf(r)]! },
            { text: pctTxt(mom), options: { color: pctColor(mom), bold: true } },
            { text: r.cur.rating ? r.cur.rating.toFixed(1) : "–", options: { bold: true, color: r.cur.rating && r.cur.rating < 3.8 ? BAD : INK } },
            { text: r.cur.nps == null ? "–" : String(Math.round(r.cur.nps)) },
          ];
        }),
      ],
      { x: 8.2, y: 1.75, w: 4.6, colW: [1.9, 1.0, 0.85, 0.85], fontFace: BF, fontSize: 12, color: INK, border: { type: "solid", color: LINE, pt: 0.75 }, rowH: 0.36, margin: 0.05 },
    );
  }

  // ---- 8. Customer happiness ----
  {
    const s = pptx.addSlide({ masterName: "CONTENT" });
    const top = ds.themes.slice(0, 6);
    const totalMentions = top.reduce((a, x) => a + x.count, 0);
    title(s, top[0] ? `${top[0].option}: ${Math.round((100 * top[0].count) / Math.max(1, totalMentions))}% of complaints` : "Customer happiness", "Mission Happiness · last 30 days");
    if (top.length) {
      s.addChart("doughnut", [{ name: "Complaints", labels: top.map((x) => x.option), values: top.map((x) => x.count) }], {
        x: 0.5, y: 1.6, w: 6.0, h: 5.1, holeSize: 58, chartColors: CAT.slice(0, top.length), showPercent: true, showValue: false, showLegend: true, legendPos: "r",
        dataLabelColor: "FFFFFF", showTitle: true, title: "What customers want fixed", titleFontFace: BF, titleFontSize: 13, titleColor: INK, ...axis,
      });
    }
    const stores = ds.stores
      .map((st) => ({ st, t: totals(inRange(ds, cur, [st.code])) }))
      .filter((r) => r.t.responses)
      .sort((a, b) => (a.t.rating ?? 0) - (b.t.rating ?? 0));
    if (stores.length) {
      s.addChart("bar", [{ name: "Rating", labels: stores.map((r) => r.st.name.replace(ds.brand, "").trim() || r.st.name), values: stores.map((r) => Math.round((r.t.rating ?? 0) * 100) / 100) }], {
        x: 6.8, y: 1.6, w: 6.0, h: 5.1, barDir: "bar", chartColors: [CAT[6]!], showValue: true, dataLabelPosition: "outEnd", dataLabelColor: INK, dataLabelFormatCode: "0.0",
        valAxisMinVal: 0, valAxisMaxVal: 5, showLegend: false, showTitle: true, title: "Rating by store (out of 5)", titleFontFace: BF, titleFontSize: 13, titleColor: INK, ...axis,
      });
    }
  }

  // ---- 9. Category mix ----
  if (ds.categories.length) {
    const s = pptx.addSlide({ masterName: "CONTENT" });
    const cats = [...ds.categories].sort((a, b) => b.revenue - a.revenue);
    const shown = cats.slice(0, 6);
    const other = cats.slice(6).reduce((a, c) => a + c.revenue, 0);
    const total = cats.reduce((a, c) => a + c.revenue, 0) || 1;
    title(s, `${cats[0]!.category} = ${Math.round((100 * cats[0]!.revenue) / total)}% of revenue`, "Category mix · last 30 days");
    s.addChart(
      "doughnut",
      [{ name: "Revenue", labels: [...shown.map((c) => c.category), ...(other ? ["Other"] : [])], values: [...shown.map((c) => L(c.revenue)), ...(other ? [L(other)] : [])] }],
      { x: 0.5, y: 1.6, w: 6.4, h: 5.1, holeSize: 58, chartColors: [...CAT.slice(0, shown.length), ...(other ? ["9CA3AF"] : [])], showPercent: true, showValue: false, showLegend: true, legendPos: "r", dataLabelColor: "FFFFFF", ...axis },
    );
    shown.slice(0, 3).forEach((c, i) => {
      const y0 = 1.8 + i * 1.6;
      card(s, 7.3, y0, 5.5, 1.4);
      s.addShape("ellipse", { x: 7.55, y: y0 + 0.5, w: 0.3, h: 0.3, fill: { color: CAT[i]! }, line: { color: CAT[i]! } });
      s.addText(
        [
          { text: c.category, options: { bold: true, fontSize: 16, color: INK } },
          { text: `\n${money(c.revenue)} · ${c.units} units · ${Math.round((100 * c.revenue) / total)}%`, options: { fontSize: 13, color: MUTED } },
        ],
        { x: 8.05, y: y0 + 0.2, w: 4.6, h: 1.0, fontFace: BF, margin: 0, isTextBox: true, valign: "middle" },
      );
    });
  }

  // ---- 10. Decisions ----
  {
    const s = pptx.addSlide({ masterName: "CONTENT" });
    title(s, `${decs.length} decisions for this week`, "Leadership actions");
    decs.forEach((d, i) => {
      const y0 = 1.65 + i * 0.84;
      card(s, 0.5, y0, 12.3, 0.72);
      s.addShape("ellipse", { x: 0.7, y: y0 + 0.16, w: 0.4, h: 0.4, fill: { color: CAT[i % CAT.length]! }, line: { color: CAT[i % CAT.length]! } });
      s.addText(String(i + 1), { x: 0.7, y: y0 + 0.16, w: 0.4, h: 0.4, fontFace: BF, fontSize: 13, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true });
      s.addText(d.decision, { x: 1.3, y: y0, w: 5.6, h: 0.72, fontFace: BF, fontSize: 13, bold: true, color: INK, valign: "middle", margin: 0, isTextBox: true });
      s.addText(d.metric, { x: 7.0, y: y0, w: 3.4, h: 0.72, fontFace: BF, fontSize: 12, color: INK, valign: "middle", margin: 0, isTextBox: true });
      s.addText([{ text: d.owner, options: { bold: true } }, { text: `\nby ${dd(d.by)}`, options: { color: MUTED } }], { x: 10.5, y: y0, w: 2.2, h: 0.72, fontFace: BF, fontSize: 11, color: INK, valign: "middle", margin: 0, isTextBox: true });
    });
  }

  // ---- 11+. Questions the user added ----
  for (const a of answers) {
    if (["help", "preread", "season", "nextweek"].includes(a.intent)) continue; // already covered by the pack
    const s = pptx.addSlide({ masterName: "CONTENT" });
    title(s, a.title.split(" · ")[0]!, a.title.split(" · ").slice(1).join(" · ") || "Analysis");
    const pts = a.summary.slice(0, 3).map((x) => (x.length > 80 ? `${x.slice(0, 78)}…` : x));
    s.addText(pts.map((x, i) => ({ text: x, options: { bullet: true, breakLine: i < pts.length - 1 } })), { x: 0.5, y: 1.65, w: 4.6, h: 5.0, fontFace: BF, fontSize: 14, color: INK, valign: "top", paraSpaceAfter: 8, isTextBox: true });
    const cp = (a.chart?.points ?? []).slice(-14);
    if (cp.length) {
      const isBar = a.chart!.kind === "bar";
      const isTime = cp.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.label));
      const toVal = (v: number) => (a.chart!.unit === "inr" ? L(v) : Math.round(v * 100) / 100);
      const labels = cp.map((x) => (/^\d{4}-\d{2}-\d{2}$/.test(x.label) ? dd(x.label) : x.label.length > 22 ? `${x.label.slice(0, 21)}…` : x.label));
      const fmt = a.chart!.unit === "inr" ? '0.0" L"' : a.chart!.unit === "rating" ? "0.0" : a.chart!.unit === "pct" ? '0"%"' : "#,##0";
      if (isBar && isTime) {
        s.addChart("bar", [{ name: "Value", labels, values: cp.map((x) => toVal(x.value)) }], {
          x: 5.4, y: 1.6, w: 7.4, h: 5.1, barDir: "col", barGapWidthPct: 40, chartColors: [CAT[0]!], showValue: true, dataLabelPosition: "outEnd", dataLabelColor: INK, dataLabelFormatCode: fmt,
          showLegend: false, valAxisLabelFormatCode: fmt, ...axis,
        });
      } else if (isBar) {
        // One colour per bar via one series per bar (zeros hidden).
        s.addChart("bar", cp.map((x, i) => ({ name: labels[i]!, labels, values: cp.map((_, j) => (j === i ? toVal(x.value) : 0)) })), {
          x: 5.4, y: 1.6, w: 7.4, h: 5.1, barDir: cp.length > 6 ? "bar" : "col", barGrouping: "stacked", barGapWidthPct: 50,
          chartColors: cp.map((_, i) => CAT[i % CAT.length]!), showValue: true, dataLabelPosition: "inEnd", dataLabelColor: "FFFFFF", dataLabelFormatCode: `${fmt};;;`,
          showLegend: false, catAxisOrientation: (cp.length > 6 ? "maxMin" : "minMax") as "minMax", ...axis,
        });
      } else {
        s.addChart("line", [{ name: "Value", labels, values: cp.map((x) => toVal(x.value)) }], {
          x: 5.4, y: 1.6, w: 7.4, h: 5.1, chartColors: [CAT[0]!], lineSize: 3, lineDataSymbol: "circle", lineDataSymbolSize: 7, showLegend: false, valAxisLabelFormatCode: fmt, ...axis,
        });
      }
    }
  }

  // ---- Close: method ----
  {
    const s = pptx.addSlide();
    s.background = { color: P };
    s.addText("How the numbers were made", { x: 0.7, y: 0.8, w: 11.5, h: 0.7, fontFace: HF, fontSize: 30, bold: true, color: "FFFFFF", margin: 0, isTextBox: true });
    const lines = [
      `Source: ${theme.company}'s Leksy e-bills and Mission Happiness, aggregated by day and store`,
      "Figures are calculated, not written by AI",
      `Forecast: best of 3 models on an 8-week backtest${india ? `, error ${india.mape.toFixed(1)}%` : ""}; 80% ranges`,
      "Regional and national festival dates are built in (lunar dates approximate)",
      "Generated on this device; no customer names, phones or comments included",
    ];
    s.addText(lines.map((x, i) => ({ text: x, options: { bullet: true, breakLine: i < lines.length - 1 } })), { x: 0.7, y: 1.8, w: 11.5, h: 4.5, fontFace: BF, fontSize: 16, color: "E5E7EB", paraSpaceAfter: 10, valign: "top", isTextBox: true });
  }

  return pptx;
}
