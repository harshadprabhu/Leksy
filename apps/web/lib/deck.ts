"use client";
import { inr, preRead, type Answer, type Dataset, type ForecastResult } from "@leksy/insights";
import type { DeckTheme } from "./ai";

/**
 * Builds the PowerPoint in the browser (no upload anywhere), in the company's
 * colours, fonts and logo. Charts are native PowerPoint charts, so people can
 * restyle or edit the numbers after downloading.
 */
const hex = (c: string) => c.replace("#", "").toUpperCase();

export async function buildDeck(ds: Dataset, theme: DeckTheme, answers: Answer[], fc: ForecastResult | null): Promise<void> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.company = theme.company;
  pptx.title = `${theme.company} business review`;
  const P = hex(theme.primary);
  const A = hex(theme.accent);
  const T = hex(theme.text);
  const today = new Date(`${ds.asOf}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const logo = theme.logo && (theme.logo.startsWith("data:image/") || theme.logo.startsWith("https://")) ? theme.logo : undefined;
  const logoImg = (x: number, y: number, h: number) => (logo ? (logo.startsWith("data:") ? { data: logo, x, y, h, w: h * 2.4, sizing: { type: "contain" as const, w: h * 2.4, h } } : { path: logo, x, y, h, w: h * 2.4, sizing: { type: "contain" as const, w: h * 2.4, h } }) : null);

  pptx.defineSlideMaster({
    title: "LEKSY",
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: A } } },
      { text: { text: `${theme.company} · ${theme.footer}`, options: { x: 0.5, y: 7.05, w: 9, h: 0.3, fontFace: theme.bodyFont, fontSize: 9, color: "8A8A8A" } } },
      ...(logoImg(11.3, 0.3, 0.5) ? [{ image: logoImg(11.3, 0.3, 0.5)! }] : []),
    ],
    slideNumber: { x: 12.5, y: 7.05, fontFace: theme.bodyFont, fontSize: 9, color: "8A8A8A" },
  });

  const title = (s: ReturnType<typeof pptx.addSlide>, text: string, sub?: string) => {
    s.addText(text, { x: 0.5, y: 0.35, w: 10.5, h: 0.6, fontFace: theme.headingFont, fontSize: 26, color: P, bold: false });
    if (sub) s.addText(sub, { x: 0.5, y: 0.95, w: 10.5, h: 0.35, fontFace: theme.bodyFont, fontSize: 12, color: "7A7A7A" });
  };
  const bullets = (s: ReturnType<typeof pptx.addSlide>, items: string[], box: { x: number; y: number; w: number; h: number }, size = 14) =>
    s.addText(
      items.map((t) => ({ text: t, options: { bullet: { code: "25AA" }, paraSpaceAfter: 6 } })),
      { ...box, fontFace: theme.bodyFont, fontSize: size, color: T, valign: "top" },
    );

  // 1. Cover
  {
    const s = pptx.addSlide();
    s.background = { color: P };
    if (logoImg(0.7, 0.7, 0.9)) s.addImage(logoImg(0.7, 0.7, 0.9)!);
    s.addText(theme.company, { x: 0.7, y: 2.4, w: 11, h: 0.9, fontFace: theme.headingFont, fontSize: 40, color: "FFFFFF" });
    s.addText("Business review, customer happiness and outlook", { x: 0.7, y: 3.3, w: 11, h: 0.6, fontFace: theme.bodyFont, fontSize: 20, color: A });
    s.addText(`Prepared ${today} · Data to ${ds.asOf}`, { x: 0.7, y: 6.3, w: 11, h: 0.4, fontFace: theme.bodyFont, fontSize: 12, color: "DDDDDD" });
  }

  // 2. Pre-read
  {
    const s = pptx.addSlide({ masterName: "LEKSY" });
    title(s, "Pre-read", "What happened, why, and what to do next");
    const sections = preRead(ds);
    sections.slice(0, 4).forEach((sec, i) => {
      const x = 0.5 + (i % 2) * 6.25;
      const y = 1.5 + Math.floor(i / 2) * 2.75;
      s.addShape(pptx.ShapeType.roundRect, { x, y, w: 6, h: 2.55, fill: { color: "F7F5F1" }, line: { color: "E7E1D7" }, rectRadius: 0.08 });
      s.addText(sec.heading, { x: x + 0.25, y: y + 0.15, w: 5.5, h: 0.4, fontFace: theme.headingFont, fontSize: 16, color: A, bold: true });
      bullets(s, sec.points, { x: x + 0.25, y: y + 0.6, w: 5.5, h: 1.85 }, 12);
    });
  }

  // 3. Forecast
  if (fc) {
    const s = pptx.addSlide({ masterName: "LEKSY" });
    const total = fc.forecast.reduce((a, p) => a + p.value, 0);
    title(s, `Revenue outlook: next ${fc.forecast.length} weeks`, `Expected ${inr(total)} · backtest error ${fc.mape.toFixed(1)}% · ${fc.modelLabel}`);
    const hist = fc.history.slice(-20);
    const labels = [...hist.map((p) => p.week.slice(5)), ...fc.forecast.map((p) => p.week.slice(5))];
    const pad = (n: number, before: boolean, vals: number[]) => (before ? [...new Array<number | null>(n).fill(null), ...vals] : [...vals, ...new Array<number | null>(n).fill(null)]);
    s.addChart(
      pptx.ChartType.line,
      [
        { name: "Actual", labels, values: pad(fc.forecast.length, false, hist.map((p) => Math.round(p.value))) as number[] },
        { name: "Forecast", labels, values: pad(hist.length - 1, true, [Math.round(hist.at(-1)!.value), ...fc.forecast.map((p) => Math.round(p.value))]) as number[] },
        { name: "Low (80%)", labels, values: pad(hist.length, true, fc.forecast.map((p) => Math.round(p.low))) as number[] },
        { name: "High (80%)", labels, values: pad(hist.length, true, fc.forecast.map((p) => Math.round(p.high))) as number[] },
      ],
      {
        x: 0.5,
        y: 1.5,
        w: 8.3,
        h: 5.3,
        chartColors: [P, A, "C9C2B6", "C9C2B6"],
        lineSize: 2,
        lineDataSymbol: "none",
        showLegend: true,
        legendPos: "b",
        legendFontFace: theme.bodyFont,
        catAxisLabelFontFace: theme.bodyFont,
        valAxisLabelFontFace: theme.bodyFont,
        catAxisLabelFontSize: 9,
        valAxisLabelFontSize: 9,
        valAxisLabelFormatCode: "#,##0",
        valGridLine: { color: "EEEEEE", size: 0.5 },
      },
    );
    bullets(s, [...fc.drivers, ...fc.forecast.filter((p) => p.festival).map((p) => `Week of ${p.week}: ${p.festival}, ${inr(p.value)} expected`)], { x: 9.1, y: 1.6, w: 3.8, h: 5 }, 12);
  }

  // 4. Stores and the questions the user added
  for (const a of answers) {
    const s = pptx.addSlide({ masterName: "LEKSY" });
    title(s, a.title, `Question: ${a.question}`);
    const hasChart = !!a.chart && a.chart.points.length > 0 && !a.forecast;
    bullets(s, a.summary, { x: 0.5, y: 1.5, w: hasChart || a.table ? 4.6 : 12, h: 5.2 }, 13);
    if (hasChart) {
      const pts = a.chart!.points.slice(-40);
      s.addChart(a.chart!.kind === "bar" ? pptx.ChartType.bar : pptx.ChartType.line, [{ name: a.title, labels: pts.map((p) => (p.label.length === 10 ? p.label.slice(5) : p.label)), values: pts.map((p) => Math.round(p.value * 100) / 100) }], {
        x: 5.4,
        y: 1.5,
        w: 7.4,
        h: a.table ? 2.9 : 5.3,
        barDir: a.chart!.kind === "bar" && pts.length <= 12 ? "bar" : "col",
        chartColors: [A],
        showLegend: false,
        catAxisLabelFontFace: theme.bodyFont,
        valAxisLabelFontFace: theme.bodyFont,
        catAxisLabelFontSize: 9,
        valAxisLabelFontSize: 9,
        valGridLine: { color: "EEEEEE", size: 0.5 },
        lineDataSymbol: "none",
      });
    }
    if (a.table && a.table.rows.length) {
      const rows = a.table.rows.slice(0, hasChart ? 6 : 14);
      s.addTable(
        [a.table.columns.map((c) => ({ text: c, options: { bold: true, color: "FFFFFF", fill: { color: P } } })), ...rows.map((r) => r.map((c) => ({ text: String(c) })))],
        { x: 5.4, y: hasChart ? 4.6 : 1.5, w: 7.4, fontFace: theme.bodyFont, fontSize: 10, color: T, border: { type: "solid", color: "E7E1D7", pt: 0.5 }, rowH: 0.3 },
      );
    }
  }

  // 5. Method and data privacy
  {
    const s = pptx.addSlide({ masterName: "LEKSY" });
    title(s, "How these numbers were produced");
    bullets(
      s,
      [
        `Source: ${theme.company}'s own Leksy e-bills and Mission Happiness responses, aggregated by day and store.`,
        "Every figure is calculated from the data; none is generated by a language model.",
        fc ? `Forecast: ${fc.modelLabel}, chosen as the most accurate of ${fc.candidates.length} models on the last ${fc.holdoutWeeks} weeks (error ${fc.mape.toFixed(1)}%). Ranges are 80% intervals.` : "No forecast in this deck.",
        "Festival dates (Akshaya Tritiya, Dhanteras, Diwali) and wedding seasons are built into the forecast.",
        "Generated on this computer. No customer names, phone numbers or comments are included.",
      ],
      { x: 0.5, y: 1.5, w: 12, h: 5 },
      15,
    );
  }

  await pptx.writeFile({ fileName: `${theme.company.replace(/[^\w]+/g, "-")}-review-${ds.asOf}.pptx` });
}
