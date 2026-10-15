"use client";
import { useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { inr } from "@/lib/api";
import { useApi } from "@/lib/useApi";

interface Summary {
  bills: number;
  sent: number;
  opened: number;
  responses: number;
  avgRating: number | null;
  nps: number | null;
  openTickets: number;
  revenue: number;
  byStore: { store: string; bills: number; opened: number; responses: number; avgRating: number | null; nps: number | null }[];
  byDay: { day: string; bills: number; opened: number; responses: number; avgRating: number | null }[];
  themes: { option: string; count: number }[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const range = useMemo(() => {
    const to = new Date();
    return { from: iso(new Date(to.getTime() - (days - 1) * 864e5)), to: iso(to) };
  }, [days]);
  const { data: s, error } = useApi<Summary>(`/v1/analytics/summary?from=${range.from}&to=${range.to}`);
  // One bar per calendar day in the range, zero where there were no bills.
  const days_ = useMemo(() => {
    const byDay = new Map((s?.byDay ?? []).map((d) => [d.day, d]));
    const out: { day: string; bills: number; opened: number }[] = [];
    for (let t = Date.parse(range.from); t <= Date.parse(range.to); t += 864e5) {
      const day = iso(new Date(t));
      const d = byDay.get(day);
      out.push({ day, bills: d?.bills ?? 0, opened: d?.opened ?? 0 });
    }
    return out;
  }, [s, range]);
  const maxDay = Math.max(1, ...days_.map((d) => d.bills));
  const maxTheme = Math.max(1, ...(s?.themes ?? []).map((t) => t.count));

  return (
    <Shell>
      <div className="head">
        <div>
          <h1>Dashboard</h1>
          <div className="muted">
            {range.from} to {range.to}
          </div>
        </div>
        <div className="seg">
          {[7, 30, 90].map((n) => (
            <button key={n} className={days === n ? "on" : ""} onClick={() => setDays(n)}>
              {n} days
            </button>
          ))}
        </div>
      </div>
      {error && <div className="err">{error}</div>}
      {s && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="grid kpis">
            <Kpi l="Bills" v={s.bills.toLocaleString("en-IN")} sub={inr(s.revenue)} />
            <Kpi l="Delivered" v={pct(s.sent, s.bills)} sub={`${s.sent} sent`} />
            <Kpi l="Opened" v={pct(s.opened, s.sent)} sub={`${s.opened} opens`} />
            <Kpi l="Survey response" v={pct(s.responses, s.opened)} sub={`${s.responses} answers`} />
            <Kpi l="Happiness" v={s.avgRating != null ? `${s.avgRating.toFixed(1)} / 5` : "–"} sub="average rating" />
            <Kpi l="NPS" v={s.nps != null ? String(Math.round(s.nps)) : "–"} sub={`${s.openTickets} open tickets`} />
          </div>
          <div className="grid two">
            <div className="card">
              <h2>Bills per day</h2>
              {s.byDay.length ? (
                <div className="chart-bars">
                  {days_.map((d) => (
                    <div key={d.day} style={{ height: `${(100 * d.bills) / maxDay}%` }} data-tip={`${d.day}: ${d.bills} bills, ${d.opened} opened`} />
                  ))}
                </div>
              ) : (
                <div className="empty">No bills yet in this period.</div>
              )}
            </div>
            <div className="card">
              <h2>What customers want fixed</h2>
              {s.themes.length ? (
                <div className="stack">
                  {s.themes.map((t) => (
                    <div key={t.option}>
                      <div className="spread small">
                        <span>{t.option}</span>
                        <span className="muted">{t.count}</span>
                      </div>
                      <div className="meter">
                        <i style={{ width: `${(100 * t.count) / maxTheme}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">No improvement themes yet.</div>
              )}
            </div>
          </div>
          <div className="card">
            <h2>Stores, least happy first</h2>
            <table className="t">
              <thead>
                <tr>
                  <th>Store</th>
                  <th className="num">Bills</th>
                  <th className="num">Opened</th>
                  <th className="num">Responses</th>
                  <th className="num">Rating</th>
                  <th className="num">NPS</th>
                </tr>
              </thead>
              <tbody>
                {s.byStore.map((r) => (
                  <tr key={r.store}>
                    <td>{r.store}</td>
                    <td className="num">{r.bills}</td>
                    <td className="num">{pct(r.opened, r.bills)}</td>
                    <td className="num">{r.responses}</td>
                    <td className="num">{r.avgRating != null ? <span className={`badge ${r.avgRating < 3 ? "bad" : r.avgRating < 4 ? "warn" : "good"}`}>{r.avgRating.toFixed(1)}</span> : "–"}</td>
                    <td className="num">{r.nps != null ? Math.round(r.nps) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Kpi({ l, v, sub }: { l: string; v: string; sub?: string }) {
  return (
    <div className="card kpi">
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}
