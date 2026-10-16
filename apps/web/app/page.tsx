"use client";
import { categoriesFor, themesFor, type Dataset } from "@leksy/insights";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Shell } from "@/components/Shell";
import { change, crunch, fmt, fmtInr, group, inScope, METRICS, PALETTE, REGION_COLORS, storeMeta, value, weekdayHeat, type Acc, type Filter, type MetricKey, type StoreMeta } from "@/lib/analytics";
import { api } from "@/lib/api";

const PRESETS = [
  ["7", "7 days"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["mtd", "Month to date"],
  ["ytd", "Year to date"],
] as const;
type Preset = (typeof PRESETS)[number][0];
const KPI_ORDER: MetricKey[] = ["revenue", "bills", "abv", "rating", "nps", "openRate", "responseRate"];
const TICK = { fill: "#8a8178", fontSize: 11 };
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ticketRows, setTicketRows] = useState<{ storeCode: string; createdAt: string }[] | null>(null);
  const [preset, setPreset] = useState<Preset>("30");
  const [metric, setMetric] = useState<MetricKey>("revenue");
  // The drill-down lives in the address (?region=West&city=Mumbai…): every step is a
  // history entry, so the phone's back gesture and the browser's back button step
  // out one level, and a drilled view can be shared as a link.
  const sp = useSearchParams();
  const lastCard = useRef<Element | null>(null);
  const f = useMemo<Filter>(() => {
    const tier = Number(sp.get("tier"));
    return {
      ...(sp.get("region") ? { region: sp.get("region") as Filter["region"] } : {}),
      ...(tier === 1 || tier === 2 ? { tier } : {}),
      ...(sp.get("city") ? { city: sp.get("city")! } : {}),
      ...(sp.get("store") ? { store: sp.get("store")! } : {}),
    };
  }, [sp]);
  // Whatever chart or table was tapped stays at the same place on screen while
  // the rest of the page updates around it.
  const anchor = useRef<{ el: Element; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a || !a.el.isConnected) return;
    const keep = () => window.scrollBy(0, a.el.getBoundingClientRect().top - a.top);
    keep();
    // Charts settle their size a moment later; hold the position until they have.
    let n = 0;
    const tick = () => {
      keep();
      if (++n < 12) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [f]);
  const setF = (next: Filter) => {
    const el = (document.activeElement as Element | null)?.closest?.(".card") ?? lastCard.current;
    if (el) anchor.current = { el, top: el.getBoundingClientRect().top };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
    // The page stays where it is: the chart you tapped simply shows the next level.
    window.history.pushState(null, "", qs ? `?${qs}` : window.location.pathname);
  };
  const [sort, setSort] = useState<{ key: MetricKey; desc: boolean }>({ key: "revenue", desc: true });
  const [allRows, setAllRows] = useState(false);

  useEffect(() => {
    api<Dataset>("/v1/insights/dataset").then(setDs, (e: Error) => setErr(e.message));
  }, []);

  const range = useMemo(() => {
    if (!ds) return null;
    const to = ds.asOf;
    const from = preset === "mtd" ? `${to.slice(0, 8)}01` : preset === "ytd" ? `${to.slice(0, 4)}-01-01` : addDays(to, -(Number(preset) - 1));
    return { from, to };
  }, [ds, preset]);

  // Unresolved tickets (open or in progress), so the tile can follow the drill-down.
  useEffect(() => {
    type Row = { storeCode: string; createdAt: string };
    Promise.all(["open", "in_progress"].map((t) => api<{ feedback: Row[] }>(`/v1/feedback?ticket=${t}&limit=200`))).then(
      (rs) => setTicketRows(rs.flatMap((r) => r.feedback)),
      () => setTicketRows(null),
    );
  }, []);

  const meta = useMemo(() => (ds ? storeMeta(ds) : []), [ds]);
  const scope = useMemo(() => inScope(meta, f), [meta, f]);
  const tickets = useMemo(() => {
    if (!ticketRows || !range) return null;
    const ist = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
    return ticketRows.filter((r) => scope.has(r.storeCode) && ist(r.createdAt) >= range.from && ist(r.createdAt) <= range.to).length;
  }, [ticketRows, scope, range]);
  const c = useMemo(() => (ds && range ? crunch(ds, scope, range) : null), [ds, range, scope]);

  if (err) return <Shell><div className="err">{err}</div></Shell>;
  if (!ds || !range || !c) return <Shell><div className="empty">Loading your network…</div></Shell>;

  // The next drill level below the current filter.
  const level: "region" | "city" | "store" = f.city || f.store ? "store" : f.region ? "city" : "region";
  const levelKey = (s: StoreMeta) => (level === "region" ? s.region : level === "city" ? s.city : s.code);
  const nameOf = new Map(meta.map((s) => [s.code, s]));
  const label = (k: string) => (level === "store" ? (nameOf.get(k)?.name ?? k) : k);
  const groups = group(c.byStore, meta, levelKey);
  const groupsPrev = group(c.byStorePrev, meta, levelKey);
  const drill = (k: string) => {
    if (level === "region") setF({ ...f, region: k as Filter["region"] });
    else if (level === "city") setF({ ...f, city: k });
    else setF({ ...f, store: k });
  };
  const colorFor = (k: string, i: number) => (level === "region" ? (REGION_COLORS[k] ?? PALETTE[i % PALETTE.length]!) : PALETTE[i % PALETTE.length]!);

  const share = [...groups].map(([k, a]) => ({ k, name: label(k), value: a.revenue })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const bars = [...groups]
    .map(([k, a]) => ({ k, name: label(k), value: value(a, metric), prev: value(groupsPrev.get(k) ?? ({} as Acc), metric) }))
    .filter((x) => x.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 12);
  const tiers = group(c.byStore, meta, (s) => (s.tier ? `Tier ${s.tier}` : "Untiered"));
  const tiersPrev = group(c.byStorePrev, meta, (s) => (s.tier ? `Tier ${s.tier}` : "Untiered"));

  // Daily trend, current period against the one before (aligned by day number).
  const days: string[] = [];
  for (let t = Date.parse(`${range.from}T00:00:00Z`); t <= Date.parse(`${range.to}T00:00:00Z`); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  // Today is still trading, so the daily chart stops at yesterday and shows today apart.
  const today = range.to === ds.asOf ? c.byDay.get(range.to) : undefined;
  const series = (today && days.length > 1 ? days.slice(0, -1) : days).map((d, i) => {
    const a = c.byDay.get(d);
    const p = c.byDayPrev.get(addDays(c.prev.from, i));
    return { date: d, label: day(d), cur: a ? value(a, metric) : null, prev: p ? value(p, metric) : null };
  });
  const spark = (m: MetricKey) => days.map((d) => ({ v: c.byDay.get(d) ? value(c.byDay.get(d)!, m) : null }));

  const rows = [...c.byStore]
    .map(([code, a]) => ({ code, s: nameOf.get(code)!, a, p: c.byStorePrev.get(code) }))
    .filter((r) => r.s && r.a.bills > 0)
    .sort((x, y) => ((value(y.a, sort.key) ?? -1e18) - (value(x.a, sort.key) ?? -1e18)) * (sort.desc ? 1 : -1));
  const scopeCodes = f.region || f.tier || f.city || f.store ? [...scope] : undefined;
  const cats = categoriesFor(ds, scopeCodes);
  const catTotal = cats.reduce((s, x) => s + x.revenue, 0);
  const themes = themesFor(ds, scopeCodes).slice(0, 6);
  const heat = weekdayHeat(c.byDay, range, metric);
  const heatVals = [...heat.cells.values()].filter((v): v is number => v != null);
  const [hMin, hMax] = [Math.min(...heatVals), Math.max(...heatVals)];
  const funnel = [
    { name: "Bills issued", v: c.total.bills, color: PALETTE[0]! },
    { name: "Sent on WhatsApp", v: c.total.sent, color: PALETTE[8]! },
    { name: "Opened", v: c.total.opened, color: PALETTE[3]! },
    { name: "Rated", v: c.total.ratingCount, color: PALETTE[2]! },
    { name: "Promoters (9–10)", v: c.total.promoters, color: PALETTE[5]! },
  ];
  const staff = f.store ? ds.staff.filter((s) => s.store === f.store).sort((a, b) => b.revenue - a.revenue) : [];
  const where = f.store ? nameOf.get(f.store)?.name : f.city ?? f.region ?? "All India";
  const cities = [...new Set(meta.filter((s) => (!f.region || s.region === f.region) && (!f.tier || s.tier === f.tier)).map((s) => s.city))].sort();
  const storesInCity = f.city ? meta.filter((s) => s.city === f.city && (!f.tier || s.tier === f.tier)) : [];
  const M = METRICS[metric];
  // A way back on every chart: one level up, or straight to All India.
  const drilled = !!(f.region || f.tier || f.city || f.store);
  const parent: Filter = f.store ? { region: f.region, tier: f.tier, city: f.city } : f.city ? { region: f.region, tier: f.tier } : f.region ? { tier: f.tier } : {};
  const parentName = f.store ? f.city : f.city ? f.region ?? (f.tier ? `Tier ${f.tier}` : "All India") : f.region && f.tier ? `Tier ${f.tier}` : "All India";
  const here = [f.region, f.tier ? `Tier ${f.tier}` : null, f.city, f.store ? nameOf.get(f.store)?.name : null].filter(Boolean).join(" › ");
  const cardNav = drilled ? (
    <div className="card-nav">
      <button onClick={() => setF(parent)} title={`Back to ${parentName}`}>
        ← {parentName}
      </button>
      <span className="card-nav-here" title={here}>
        {here}
      </span>
      {Object.keys(parent).filter((k) => parent[k as keyof Filter] !== undefined).length > 0 && (
        <button onClick={() => setF({})} title="Back to the full view">
          ⌂ All India
        </button>
      )}
    </div>
  ) : null;

  return (
    <Shell>
      <div className="head">
        <div>
          <h1>Business command centre</h1>
          <div className="muted">
            {where} · {scope.size} store{scope.size === 1 ? "" : "s"} · {day(range.from)} – {day(range.to)} vs {day(c.prev.from)} – {day(c.prev.to)}
          </div>
        </div>
        <div className="seg">
          {PRESETS.map(([k, l]) => (
            <button key={k} className={preset === k ? "on" : ""} onClick={() => setPreset(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="card filters">
        <nav className="crumbs" aria-label="Drill path">
          <button onClick={() => setF({ tier: f.tier })}>All India</button>
          {f.region && (
            <>
              › <button onClick={() => setF({ region: f.region, tier: f.tier })}>{f.region}</button>
            </>
          )}
          {f.city && (
            <>
              › <button onClick={() => setF({ region: f.region, tier: f.tier, city: f.city })}>{f.city}</button>
            </>
          )}
          {f.store && <> › <b>{nameOf.get(f.store)?.name}</b></>}
        </nav>
        <div className="chips">
          {(["North", "South", "East", "West"] as const).filter((r) => meta.some((s) => s.region === r)).map((r) => (
            <button key={r} className={`chip ${f.region === r ? "on" : ""}`} style={{ "--c": REGION_COLORS[r] } as React.CSSProperties} onClick={() => setF(f.region === r ? { tier: f.tier } : { region: r, tier: f.tier })}>
              <i /> {r}
            </button>
          ))}
          <span className="sep" />
          {([1, 2] as const).filter((t) => meta.some((s) => s.tier === t)).map((t) => (
            <button key={t} className={`chip ${f.tier === t ? "on" : ""}`} style={{ "--c": t === 1 ? "#6250D6" : "#E87BA4" } as React.CSSProperties} onClick={() => setF({ ...f, tier: f.tier === t ? undefined : t, city: undefined, store: undefined })}>
              <i /> Tier {t}
            </button>
          ))}
          <span className="sep" />
          <select aria-label="City" value={f.city ?? ""} onChange={(e) => setF({ region: f.region, tier: f.tier, city: e.target.value || undefined })}>
            <option value="">All cities ({cities.length})</option>
            {cities.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          {f.city && (
            <select aria-label="Store" value={f.store ?? ""} onChange={(e) => setF({ ...f, store: e.target.value || undefined })}>
              <option value="">All stores in {f.city} ({storesInCity.length})</option>
              {storesInCity.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="kpi-grid">
        {KPI_ORDER.map((m) => {
          const v = value(c.total, m);
          const ch = change(v, value(c.before, m), m);
          return (
            <button key={m} className={`kpi-tile ${metric === m ? "on" : ""}`} style={{ "--c": METRICS[m].color } as React.CSSProperties} onClick={() => setMetric(m)} title={`Show ${METRICS[m].label} in every chart`}>
              <div className="l">{METRICS[m].label}</div>
              <div className="v">{fmt(v, m)}</div>
              <div className={`d ${ch.good == null ? "" : ch.good ? "up" : "down"}`}>{ch.text} <span className="muted">vs prior</span></div>
              <div className="spark">
                <ResponsiveContainer width="100%" height={34}>
                  <LineChart data={spark(m)}>
                    <Line type="monotone" dataKey="v" stroke={METRICS[m].color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </button>
          );
        })}
        <Link href="/feedback" className="kpi-tile" style={{ "--c": "#E34948" } as React.CSSProperties}>
          <div className="l">Open tickets</div>
          <div className="v">{tickets ?? "–"}</div>
          <div className="d muted">Unhappy customers waiting · open inbox →</div>
        </Link>
      </div>

      <div className="dash-grid" onPointerDownCapture={(e) => (lastCard.current = (e.target as Element).closest(".card"))}>
        <div className="card span2">
          {cardNav}
          <div className="spread">
            <h2 style={{ margin: 0 }}>
              <span className="dot" style={{ background: M.color }} /> {M.label} by day
            </h2>
            <span className="small muted">
              {today && (
                <>
                  <b style={{ color: M.color }}>Today so far: {fmt(value(today, metric), metric)}</b> ·{" "}
                </>
              )}
              Solid: this period · dashed: the period before · click a tile above to switch metric
            </span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={series} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="gcur" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={M.color} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={M.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#8a817822" vertical={false} />
              <XAxis dataKey="label" tick={TICK} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={TICK} width={70} tickFormatter={(v: number) => fmt(v, metric)} />
              <Tooltip formatter={(v: number, n: string) => [fmt(v, metric), n === "cur" ? "This period" : "Period before"]} labelStyle={{ color: "#333" }} />
              <Area type="monotone" dataKey="prev" stroke="#9CA3AF" strokeDasharray="4 4" fill="none" strokeWidth={1.5} dot={false} connectNulls />
              <Area type="monotone" dataKey="cur" stroke={M.color} fill="url(#gcur)" strokeWidth={2.5} dot={false} connectNulls activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">

          {cardNav}
          <h2>Share of revenue by {level}</h2>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={share.slice(0, 10)} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2} onClick={(d: { k?: string; payload?: { k: string } }) => drill(d.payload?.k ?? d.k ?? "")} cursor="pointer">
                {share.slice(0, 10).map((x, i) => (
                  <Cell key={x.k} fill={colorFor(x.k, i)} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => [`${fmtInr(v)} · ${((100 * v) / Math.max(1, c.total.revenue)).toFixed(1)}%`, "Revenue"]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="legend">
            {share.slice(0, 10).map((x, i) => (
              <button key={x.k} onClick={() => drill(x.k)}>
                <i style={{ background: colorFor(x.k, i) }} /> {x.name} <b>{((100 * x.value) / Math.max(1, c.total.revenue)).toFixed(1)}%</b>
              </button>
            ))}
          </div>
        </div>

        <div className="card">

          {cardNav}
          <h2>
            {M.label} by {level} {level !== "store" && <span className="small muted">· click a bar to drill in</span>}
          </h2>
          <ResponsiveContainer width="100%" height={Math.max(160, bars.length * 28)}>
            <BarChart data={bars} layout="vertical" margin={{ left: 4, right: 64 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={TICK} width={level === "store" ? 130 : 84} />
              <Tooltip formatter={(v: number) => [fmt(v, metric), M.label]} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d: { k: string }) => drill(d.k)} label={{ position: "right", fill: "#8a8178", fontSize: 11, formatter: (v: number) => fmt(v, metric) }}>
                {bars.map((x, i) => (
                  <Cell key={x.k} fill={colorFor(x.k, i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">

          {cardNav}
          <h2>Tier 1 vs Tier 2</h2>
          <div className="tier-cards">
            {[...tiers].sort().map(([k, a], i) => {
              const ch = change(value(a, metric), value(tiersPrev.get(k) ?? ({} as Acc), metric), metric);
              return (
                <button key={k} className="tier-card" style={{ "--c": i === 0 ? "#6250D6" : "#E87BA4" } as React.CSSProperties} onClick={() => k.startsWith("Tier") && setF({ ...f, tier: Number(k.slice(5)) as 1 | 2, city: undefined, store: undefined })}>
                  <div className="l">{k}</div>
                  <div className="v">{fmt(value(a, metric), metric)}</div>
                  <div className={`d ${ch.good == null ? "" : ch.good ? "up" : "down"}`}>{ch.text}</div>
                  <div className="small muted">
                    {fmtInr(a.revenue)} · {a.bills.toLocaleString("en-IN")} bills
                  </div>
                </button>
              );
            })}
          </div>
          <h2 style={{ marginTop: 16 }}>Customer journey</h2>
          <div className="funnel">
            {funnel.map((x, i) => (
              <div key={x.name} className="frow">
                <span className="small">{x.name}</span>
                <div className="fbar">
                  <i style={{ width: `${(100 * x.v) / Math.max(1, funnel[0]!.v)}%`, background: x.color }} />
                </div>
                <b className="small">
                  {x.v.toLocaleString("en-IN")}
                  {i > 0 && <span className="muted"> · {((100 * x.v) / Math.max(1, funnel[i - 1]!.v)).toFixed(0)}%</span>}
                </b>
              </div>
            ))}
          </div>
        </div>

        <div className="card">

          {cardNav}
          <div className="spread">
            <h2 style={{ margin: 0 }}>Category mix</h2>
            <span className="badge">last {ds.detailDays} days</span>
          </div>
          <div className="stackbar">
            {cats.map((x, i) => (
              <i key={x.category} style={{ width: `${(100 * x.revenue) / Math.max(1, catTotal)}%`, background: PALETTE[i % PALETTE.length] }} title={`${x.category}: ${fmtInr(x.revenue)}`} />
            ))}
          </div>
          <div className="legend cols">
            {cats.map((x, i) => (
              <span key={x.category}>
                <i style={{ background: PALETTE[i % PALETTE.length] }} /> {x.category} <b>{((100 * x.revenue) / Math.max(1, catTotal)).toFixed(1)}%</b> <span className="muted">{fmtInr(x.revenue)}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="card">

          {cardNav}
          <div className="spread">
            <h2 style={{ margin: 0 }}>What customers want fixed</h2>
            <span className="badge">last {ds.detailDays} days</span>
          </div>
          {themes.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={themes} layout="vertical" margin={{ left: 8, right: 30 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="option" tick={TICK} width={110} />
                <Tooltip formatter={(v: number) => [v, "Mentions"]} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} label={{ position: "right", fill: "#8a8178", fontSize: 11 }}>
                  {themes.map((t, i) => (
                    <Cell key={t.option} fill={["#E34948", "#EB6834", "#EDA100", "#E87BA4", "#6250D6", "#0EA5E9"][i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty">No complaints in these stores. 🎉</div>
          )}
        </div>

        <div className="card span2">

          {cardNav}
          <div className="spread">
            <h2 style={{ margin: 0 }}>{M.label} by weekday</h2>
            <span className="small muted">Darker = higher. Hover a cell for the exact figure.</span>
          </div>
          <div className="heat" style={{ gridTemplateColumns: `40px repeat(${heat.weeks.length}, minmax(14px, 1fr))` }}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((dn, r) => (
              <div key={dn} style={{ display: "contents" }}>
                <span className="small muted">{dn}</span>
                {heat.weeks.map((w) => {
                  const v = heat.cells.get(`${w}|${r}`);
                  const t = v == null || hMax === hMin ? 0 : (v - hMin) / (hMax - hMin);
                  return <i key={w} title={v == null ? `${day(addDays(w, r))}: –` : `${day(addDays(w, r))}: ${fmt(v, metric)}`} style={{ background: v == null ? "transparent" : M.color, opacity: v == null ? 1 : 0.12 + 0.88 * t }} />;
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="card span3">

          {cardNav}
          <div className="spread">
            <h2 style={{ margin: 0 }}>
              Store league · {rows.length} store{rows.length === 1 ? "" : "s"}
            </h2>
            <span className="small muted">Click a column to sort, a store to open it.</span>
          </div>
          <div style={{ overflow: "auto" }}>
            <table className="t league">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Store</th>
                  <th className="hide-sm">City</th>
                  {(["revenue", "bills", "abv", "rating", "nps", "openRate"] as MetricKey[]).map((k) => (
                    <th key={k} className={`num sortable ${["abv", "nps", "openRate"].includes(k) ? "hide-sm" : ""}`} onClick={() => setSort({ key: k, desc: sort.key === k ? !sort.desc : true })}>
                      {METRICS[k].label}
                      {sort.key === k ? (sort.desc ? " ▼" : " ▲") : ""}
                    </th>
                  ))}
                  <th className="num">vs prior</th>
                </tr>
              </thead>
              <tbody>
                {(allRows ? rows : rows.slice(0, 15)).map((r, i) => {
                  const ch = change(r.a.revenue, r.p?.revenue ?? null, "revenue");
                  const rt = value(r.a, "rating");
                  return (
                    <tr key={r.code} className="click" onClick={() => setF({ region: r.s.region as Filter["region"], city: r.s.city, store: r.code })}>
                      <td className="muted">{i + 1}</td>
                      <td>
                        <span className="dot" style={{ background: REGION_COLORS[r.s.region] }} /> {r.s.name}
                      </td>
                      <td className="muted hide-sm">
                        {r.s.city}
                        {r.s.tier ? ` · T${r.s.tier}` : ""}
                      </td>
                      <td className="num">{fmtInr(r.a.revenue)}</td>
                      <td className="num">{r.a.bills.toLocaleString("en-IN")}</td>
                      <td className="num hide-sm">{fmt(value(r.a, "abv"), "abv")}</td>
                      <td className="num">{rt == null ? "–" : <span className={`badge ${rt < 3.5 ? "bad" : rt < 4 ? "warn" : "good"}`}>{rt.toFixed(2)}</span>}</td>
                      <td className="num hide-sm">{fmt(value(r.a, "nps"), "nps")}</td>
                      <td className="num hide-sm">{fmt(value(r.a, "openRate"), "openRate")}</td>
                      <td className={`num ${ch.good == null ? "" : ch.good ? "up" : "down"}`}>{ch.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 15 && (
            <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setAllRows(!allRows)}>
              {allRows ? "Show top 15" : `Show all ${rows.length} stores`}
            </button>
          )}
        </div>

        {f.store && (
          <div className="card span3">
            {cardNav}
            <div className="spread">
              <h2 style={{ margin: 0 }}>Team at {nameOf.get(f.store)?.name}</h2>
              <span className="row">
                <span className="badge">last {ds.detailDays} days</span>
                <Link className="btn sm" href={`/bills?q=${encodeURIComponent(f.store)}`}>
                  View this store&apos;s bills →
                </Link>
              </span>
            </div>
            <table className="t stack">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th className="num">Revenue</th>
                  <th className="num">Bills</th>
                  <th className="num">Avg bill</th>
                  <th className="num">Rating</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s, i) => (
                  <tr key={s.id}>
                    <td>
                      <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} /> {s.name}
                    </td>
                    <td className="num">{fmtInr(s.revenue)}</td>
                    <td className="num">{s.bills}</td>
                    <td className="num">{s.bills ? fmtInr(s.revenue / s.bills) : "–"}</td>
                    <td className="num">{s.ratingCount ? `${(s.ratingSum / s.ratingCount).toFixed(2)} (${s.ratingCount})` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
