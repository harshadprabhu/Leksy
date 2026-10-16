"use client";
import type { ChartPoint } from "@leksy/insights";
import { inr } from "@leksy/insights";
import { useMemo, useState } from "react";

type Unit = "inr" | "count" | "rating" | "pct";

const fmt = (v: number, unit: Unit) => (unit === "inr" ? inr(v) : unit === "rating" ? v.toFixed(1) : unit === "pct" ? `${v >= 0 ? "+" : ""}${Math.round(v)}%` : Math.round(v).toLocaleString("en-IN"));
const dayLabel = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : s);

function niceTicks(max: number, n = 4) {
  if (max <= 0) return [0];
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
}

/**
 * Line chart for time series. Forecast points are dashed with an 80% band;
 * festival weeks are marked. Hover shows exact values.
 */
export function LineChart({ points, unit, height = 240, width = 720 }: { points: ChartPoint[]; unit: Unit; height?: number; width?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = width;
  const H = height;
  const m = { l: 64, r: 16, t: 12, b: 28 };
  const max = Math.max(...points.map((p) => p.high ?? p.value)) * 1.05;
  const ticks = niceTicks(max);
  const top = ticks.at(-1)! || 1;
  const x = (i: number) => m.l + (i * (W - m.l - m.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => m.t + (H - m.t - m.b) * (1 - v / top);
  const firstF = points.findIndex((p) => p.forecast);
  const actual = points.map((p, i) => [i, p] as const).filter(([, p]) => !p.forecast);
  const fc = firstF >= 0 ? [[firstF - 1, points[firstF - 1]!] as const, ...points.map((p, i) => [i, p] as const).filter(([, p]) => p.forecast)].filter(([i]) => i >= 0) : [];
  const band = points.map((p, i) => [i, p] as const).filter(([, p]) => p.forecast && p.low != null);
  const path = (pts: readonly (readonly [number, ChartPoint])[]) => pts.map(([i, p], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const every = Math.ceil(points.length / Math.max(3, Math.floor(W / 90)));
  const h = hover == null ? null : points[hover]!;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Trend chart" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - m.l) / (W - m.l - m.r)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{fmt(t, unit)}</text>
          </g>
        ))}
        {band.length > 0 && (
          <path d={`${band.map(([i, p], k) => `${k ? "L" : "M"}${x(i)},${y(p.high!)}`).join("")}${[...band].reverse().map(([i, p]) => `L${x(i)},${y(p.low!)}`).join("")}Z`} fill="var(--accent)" opacity={0.15} />
        )}
        {firstF > 0 && <line x1={x(firstF - 1)} x2={x(firstF - 1)} y1={m.t} y2={H - m.b} stroke="var(--muted)" strokeDasharray="3 4" strokeWidth={1} />}
        <path d={path(actual)} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />
        {fc.length > 1 && <path d={path(fc)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />}
        {points.map((p, i) => (p.note ? <circle key={i} cx={x(i)} cy={y(p.value)} r={5} fill="var(--accent)" stroke="var(--panel)" strokeWidth={2} /> : null))}
        {points.map((p, i) => (i % every === 0 ? <text key={`l${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{dayLabel(p.label)}</text> : null))}
        {h && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} stroke="var(--muted)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.value)} r={5} fill={h.forecast ? "var(--accent)" : "var(--ink)"} stroke="var(--panel)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && hover != null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{dayLabel(h.label)}</b>
          <div>
            {h.forecast ? "Forecast" : "Actual"}: {fmt(h.value, unit)}
          </div>
          {h.low != null && (
            <div className="muted">
              80% range {fmt(h.low, unit)} – {fmt(h.high!, unit)}
            </div>
          )}
          {h.note && <div style={{ color: "var(--accent)" }}>{h.note}</div>}
        </div>
      )}
      <div className="row small muted" style={{ gap: 16, marginTop: 4 }}>
        <span><span className="key" style={{ background: "var(--ink)" }} /> Actual</span>
        {firstF >= 0 && <span><span className="key dashed" /> Forecast</span>}
        {band.length > 0 && <span><span className="key band" /> 80% range</span>}
        {points.some((p) => p.note) && <span><span className="key dot" /> Festival week</span>}
      </div>
    </div>
  );
}

/** Horizontal bars, sorted as given. Hover shows the exact value. */
export function BarChart({ points, unit }: { points: ChartPoint[]; unit: Unit }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(...points.map((p) => p.value), unit === "rating" ? 5 : 0) || 1, [points, unit]);
  const shown = points.slice(0, 15);
  return (
    <div className="stack" style={{ gap: 6 }}>
      {shown.map((p, i) => (
        <div key={p.label} className="hbar" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="hbar-label" title={p.label}>{dayLabel(p.label)}</span>
          <span className="hbar-track">
            <i style={{ width: `${(100 * p.value) / max}%`, opacity: hover == null || hover === i ? 1 : 0.55 }} />
          </span>
          <span className="hbar-value">{fmt(p.value, unit)}</span>
        </div>
      ))}
      {points.length > shown.length && <div className="small muted">+{points.length - shown.length} more in the table</div>}
    </div>
  );
}
