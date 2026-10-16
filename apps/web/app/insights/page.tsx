"use client";
import { addDays, ask, buildBrief, inRange, totals, COPILOTS, findPersonalData, forecast, inr, nextWeekByRegion, SUGGESTIONS, toWeekly, upcomingMoments, type Answer, type CopilotId, type Dataset, type ForecastResult, type Metric } from "@leksy/insights";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarChart, LineChart } from "@/components/insights/Chart";
import { PALETTE } from "@/lib/analytics";
import { Shell } from "@/components/Shell";
import { contextSummary, localFreeAnswer, localNarrative, readAi, readDeck, type AiSettings, type DeckTheme } from "@/lib/ai";
import { api } from "@/lib/api";
import type { BrandKit } from "@/lib/brandpack";
import { buildDeck } from "@/lib/deck";

interface Item {
  answer: Answer;
  narrative?: string;
  narrativeError?: string;
  inDeck: boolean;
  showTable: boolean;
}

/**
 * The power user's analysis desk. Questions are answered by Leksy's local engine
 * from the company's own data; forecasts use statistical models fitted in the
 * browser. Optional: a language model on the company's own machine (Ollama), or,
 * if an admin allows it, a privacy-checked brief for an external copilot.
 */
export default function Insights() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [deck, setDeck] = useState<DeckTheme | null>(null);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [metric, setMetric] = useState<Metric>("revenue");
  const [store, setStore] = useState("");
  const [horizon, setHorizon] = useState(8);
  const [deckBusy, setDeckBusy] = useState(false);
  const [share, setShare] = useState<{ text: string; copilot: CopilotId; blocked: string[] } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [d, me] = await Promise.all([api<Dataset>("/v1/insights/dataset"), api<{ brand: { name: string; settings?: Record<string, unknown> } }>("/v1/me")]);
        setDs(d);
        setAi(readAi(me.brand.settings));
        setDeck(readDeck(me.brand.settings, me.brand.name));
        setKit((me.brand.settings?.brandKit as BrandKit | undefined) ?? null);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, []);

  const fc: ForecastResult | null = useMemo(() => {
    if (!ds) return null;
    try {
      return forecast(toWeekly(ds.days.filter((d) => !store || d.store === store), metric, ds.asOf), horizon, metric);
    } catch {
      return null;
    }
  }, [ds, metric, store, horizon]);

  const nextWeek = useMemo(() => (ds ? nextWeekByRegion(ds) : []), [ds]);
  const last30 = useMemo(() => (ds ? totals(inRange(ds, { from: addDays(ds.asOf, -29), to: ds.asOf, label: "last 30 days" })) : null), [ds]);
  const moments = useMemo(() => (ds ? upcomingMoments(ds, 45) : []), [ds]);

  const run = async (question: string) => {
    if (!ds || !ai || !question.trim()) return;
    setBusy(true);
    const answer = ask(question, ds, { horizonWeeks: horizon });
    const item: Item = { answer, inDeck: answer.intent !== "help", showTable: false };
    setItems((xs) => [item, ...xs]);
    setQ("");
    if (ai.engine === "ollama") {
      try {
        const text = answer.intent === "help" ? await localFreeAnswer(ai, question, contextSummary(ds, items.map((i) => i.answer))) : await localNarrative(ai, answer);
        setItems((xs) => xs.map((x) => (x.answer.id === answer.id ? { ...x, narrative: text } : x)));
      } catch (e) {
        setItems((xs) => xs.map((x) => (x.answer.id === answer.id ? { ...x, narrativeError: (e as Error).message } : x)));
      }
    }
    setBusy(false);
  };

  const openShare = (answers: Answer[], copilot: CopilotId) => {
    if (!ds || !ai) return;
    const text = buildBrief(answers, ds, ai.share);
    setShare({ text, copilot, blocked: findPersonalData(text) });
  };

  if (err) return <Shell><div className="err">{err}</div></Shell>;
  if (!ds || !ai || !deck) return <Shell><div className="empty">Loading your data…</div></Shell>;
  const deckAnswers = items.filter((i) => i.inDeck).map((i) => i.answer);
  const copilots = ai.share.allowExternal ? ai.share.copilots : [];
  const fTotal = fc ? fc.forecast.reduce((s, p) => s + p.value, 0) : 0;
  const fmtF = (n: number) => (metric === "revenue" ? inr(n) : Math.round(n).toLocaleString("en-IN"));

  return (
    <Shell>
      <section className="ins-hero">
        {kit?.watermark && (kit.mark ?? kit.logo) && <div className="ins-hero-wm" style={{ backgroundImage: `url(${kit.logoLight ?? kit.mark ?? kit.logo})` }} aria-hidden="true" />}
        <div className="ins-hero-main">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {(kit?.logoLight ?? kit?.logo) && <img className="ins-hero-logo" src={kit!.logoLight ?? kit!.logo} alt={kit!.name} />}
          <div>
            <div className="ins-kicker">Insights · {deck.company}</div>
            <h1>Ask your business anything</h1>
            <div className="ins-sub">
              {ds.stores.length} stores · {new Set(ds.stores.map((x) => x.city)).size} cities · data to {new Date(`${ds.asOf}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
            </div>
          </div>
        </div>
        <div className="ins-stats">
          {last30 && (
            <div>
              <b>{inr(last30.revenue)}</b>
              <span>revenue, last 30 days</span>
            </div>
          )}
          {nextWeek[0] && (
            <div>
              <b>{inr(nextWeek[0].value)}</b>
              <span>forecast, next week</span>
            </div>
          )}
          {last30?.rating != null && (
            <div>
              <b>{last30.rating.toFixed(2)} ★</b>
              <span>customer happiness</span>
            </div>
          )}
        </div>
        <div className="ins-hero-foot">
          <span className="ins-pill" title="Answers are computed in this browser from your own data">
            {ai.engine === "ollama" ? `Local engine + ${ai.ollamaModel} on your computer` : "Local engine · data stays on this device"}
          </span>
          <Link className="ins-pill link" href="/settings#ai">
            AI settings →
          </Link>
        </div>
      </section>

      <div className="grid ins-grid">
        <div className="stack">
          <form
            className="card stack ask-card"
            onSubmit={(e) => {
              e.preventDefault();
              void run(q);
            }}
          >
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input style={{ flex: 1, fontSize: 15, padding: "10px 12px" }} placeholder="Ask anything, e.g. “Why are customers unhappy in Mumbai?”" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ask a question" />
              <button className="btn primary" disabled={busy || !q.trim()}>
                Ask
              </button>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={s} type="button" className="chip" style={{ "--c": PALETTE[i % PALETTE.length] } as React.CSSProperties} onClick={() => void run(s)}>
                  <i /> {s}
                </button>
              ))}
            </div>
          </form>

          {items.length === 0 && (
            <div className="card empty">
              Answers appear here. Each one can go into your PowerPoint deck{copilots.length ? " or be shared with a copilot you choose" : ""}.
            </div>
          )}

          {items.map((it) => {
            const a = it.answer;
            return (
              <div key={a.id} className="card stack answer">
                <div className="spread" style={{ alignItems: "flex-start" }}>
                  <div>
                    <div className="small muted">“{a.question}”</div>
                    <h2 style={{ margin: "2px 0 0" }}>{a.title}</h2>
                  </div>
                  {a.intent !== "help" && (
                    <label className="row small" title="Include this answer as a slide in the deck">
                      <input type="checkbox" checked={it.inDeck} onChange={(e) => setItems((xs) => xs.map((x) => (x.answer.id === a.id ? { ...x, inDeck: e.target.checked } : x)))} /> In deck
                    </label>
                  )}
                </div>
                <ul className="answer-points">
                  {a.summary.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                {it.narrative && (
                  <div className="narrative">
                    <div className="small muted">Explained by {ai.ollamaModel} on your computer (numbers above are the source of truth)</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{it.narrative}</div>
                  </div>
                )}
                {it.narrativeError && <div className="small err">Local model unavailable: {it.narrativeError}</div>}
                {a.chart && a.chart.points.length > 0 && (a.chart.kind === "line" ? <LineChart points={a.chart.points} unit={a.chart.unit} /> : <BarChart points={a.chart.points} unit={a.chart.unit} />)}
                <div className="row">
                  {a.table && (
                    <button className="btn sm" onClick={() => setItems((xs) => xs.map((x) => (x.answer.id === a.id ? { ...x, showTable: !x.showTable } : x)))}>
                      {it.showTable ? "Hide table" : "Show table"}
                    </button>
                  )}
                  {copilots.map((c) => (
                    <button key={c} className="btn sm" onClick={() => openShare([a], c)}>
                      Ask {COPILOTS[c].name}…
                    </button>
                  ))}
                </div>
                {it.showTable && a.table && (
                  <div style={{ overflow: "auto", maxHeight: 320 }}>
                    <table className="t">
                      <thead>
                        <tr>
                          {a.table.columns.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {a.table.rows.map((r, i) => (
                          <tr key={i}>
                            {r.map((c, j) => (
                              <td key={j}>{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="stack ins-side">
          {nextWeek.length > 0 && (
            <div className="card stack nw-card">
              {(() => {
                const india = nextWeek.find((r) => r.region === "All India")!;
                const regs = nextWeek.filter((r) => r.region !== "All India");
                const delta = (n: number | null) => (n == null ? "–" : `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(1)}%`);
                return (
                  <>
                    <div className="spread">
                      <h2 style={{ margin: 0 }}>Next week</h2>
                      <span className="small muted">w/c {new Date(`${india.week}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                    </div>
                    <div className="row" style={{ alignItems: "baseline" }}>
                      <span className="kpi"><span className="v">{inr(india.value)}</span></span>
                      <span className={`badge ${india.wowPct != null && india.wowPct >= 0 ? "good" : "bad"}`}>{delta(india.wowPct)} vs wk of {new Date(`${india.lastWeekOf}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                      <span className={`badge ${india.yoyPct != null && india.yoyPct >= 0 ? "good" : "bad"}`}>{delta(india.yoyPct)} vs last year</span>
                    </div>
                    <table className="t">
                      <tbody>
                        {regs.map((r) => (
                          <tr key={r.region}>
                            <td>
                              <span className={`region-dot r-${String(r.region).toLowerCase()}`} /> {r.region}
                            </td>
                            <td className="num">{inr(r.value)}</td>
                            <td className="num" style={{ color: r.wowPct != null && r.wowPct >= 0 ? "var(--good)" : "var(--bad)" }}>{delta(r.wowPct)}</td>
                            <td className="small muted">{r.festival ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {moments.length > 0 && (
                      <div className="stack" style={{ gap: 4 }}>
                        <span className="small muted">Coming up</span>
                        {moments.slice(0, 4).map((m) => (
                          <div key={`${m.name}${m.date}`} className="spread small">
                            <span>
                              <b>{m.name}</b> · {m.scope === "National" ? "All India" : m.scope.join("/")}
                            </span>
                            <span className="muted">
                              {m.daysTo}d{m.lastLift != null ? ` · last ${m.lastLift >= 1 ? "+" : ""}${Math.round((m.lastLift - 1) * 100)}%` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
          <div className="card stack fc-card">
            <div className="spread">
              <h2 style={{ margin: 0 }}>Forecast</h2>
              <span className="small muted">Learns from {Math.round(ds.days.length / Math.max(1, ds.stores.length) / 7)} weeks of history</span>
            </div>
            <div className="row">
              <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} aria-label="Metric">
                <option value="revenue">Revenue</option>
                <option value="bills">Bills</option>
              </select>
              <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="Store">
                <option value="">All stores</option>
                {ds.stores.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} aria-label="Horizon">
                {[4, 8, 12, 26].map((n) => (
                  <option key={n} value={n}>
                    {n} weeks
                  </option>
                ))}
              </select>
            </div>
            {fc ? (
              <>
                <div>
                  <div className="kpi">
                    <div className="v">{fmtF(fTotal)}</div>
                  </div>
                  <div className="small muted">
                    expected in the next {horizon} weeks · 80% range {fmtF(fc.forecast.reduce((s, p) => s + p.low, 0))} – {fmtF(fc.forecast.reduce((s, p) => s + p.high, 0))}
                  </div>
                </div>
                <LineChart
                  height={230}
                  width={400}
                  unit={metric === "revenue" ? "inr" : "count"}
                  points={[...fc.history.slice(-16).map((p) => ({ label: p.week, value: p.value })), ...fc.forecast.map((p) => ({ label: p.week, value: p.value, low: p.low, high: p.high, forecast: true, note: p.festival }))]}
                />
                <ul className="answer-points small">
                  {fc.drivers.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <details className="small">
                  <summary className="muted">
                    Model: {fc.modelLabel} · backtest error {fc.mape.toFixed(1)}%
                  </summary>
                  <div className="stack" style={{ gap: 2, marginTop: 6 }}>
                    <span className="muted">Tested on the last {fc.holdoutWeeks} weeks before choosing (lower error is better):</span>
                    {fc.candidates.map((c) => (
                      <div key={c.model} className="spread">
                        <span>{c.model.replace(/_/g, " ")}</span>
                        <span>{Number.isFinite(c.mape) ? `${c.mape.toFixed(1)}%` : "–"}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            ) : (
              <div className="small muted">Not enough history yet (needs 6+ weeks).</div>
            )}
          </div>

          <div className="card stack deck-card">
            <div className="deck-cover" style={{ background: deck.primary }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {(kit?.logoLight ?? deck.logo) && <img src={kit?.logoLight ?? deck.logo} alt="" />}
              <div style={{ fontFamily: "var(--brand-head)" }}>{deck.company}</div>
              <span style={{ color: deck.accent }}>Leadership pack · {new Date(`${ds.asOf}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
            </div>
            <h2 style={{ margin: 0 }}>PowerPoint deck</h2>
            <div className="small muted">
              Leadership pack in {deck.company}&apos;s colours, fonts and logo: scorecard, next-week forecast by region, trend, regional season radar, national festivals, stores, happiness, category mix, decisions{deckAnswers.length ? ` + ${deckAnswers.length} of your answers` : ""}. Built on this computer.
            </div>
            <div className="row">
              <span className="swatch" style={{ background: deck.primary }} />
              <span className="swatch" style={{ background: deck.accent }} />
              <span className="small">
                {deck.headingFont} / {deck.bodyFont}
              </span>
              <Link className="small" href="/settings#deck">
                Change look
              </Link>
            </div>
            <button
              className="btn primary"
              disabled={deckBusy}
              onClick={async () => {
                setDeckBusy(true);
                try {
                  await buildDeck(ds, deck, deckAnswers);
                } finally {
                  setDeckBusy(false);
                }
              }}
            >
              {deckBusy ? "Building…" : "Download PowerPoint"}
            </button>
          </div>

          <div className="card stack cp-card">
            <h2 style={{ margin: 0 }}>Extra help from a copilot</h2>
            {copilots.length ? (
              <>
                <div className="small muted">
                  Optional. Leksy prepares a summary of totals only{ai.share.maskStores ? ", with store names hidden" : ""}{ai.share.indexMoney ? " and rupee values turned into an index" : ""}. You see it before anything leaves this page.
                </div>
                <div className="row">
                  {copilots.map((c) => (
                    <button key={c} className="btn sm" onClick={() => openShare(deckAnswers.length ? deckAnswers : items.map((i) => i.answer), c)} disabled={!items.length}>
                      {COPILOTS[c].name}
                    </button>
                  ))}
                </div>
                {!items.length && <div className="small muted">Ask a question first.</div>}
              </>
            ) : (
              <div className="small muted">
                Switched off. Your company&apos;s data stays inside Leksy. An admin can allow Microsoft Copilot, ChatGPT, Claude or Gemini in <Link href="/settings#ai">AI settings</Link>; even then each user decides, and only summarised totals can be shared.
              </div>
            )}
          </div>
        </div>
      </div>

      {share && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Share with a copilot">
          <div className="card stack" style={{ maxWidth: 760, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
            <div className="spread">
              <h2 style={{ margin: 0 }}>Share with {COPILOTS[share.copilot].name}?</h2>
              <button className="btn sm" onClick={() => setShare(null)}>
                ×
              </button>
            </div>
            <div className="small muted">
              This is exactly what will be copied. Nothing is sent by Leksy. You paste it into {COPILOTS[share.copilot].name} yourself. {COPILOTS[share.copilot].note}
            </div>
            <textarea className="mono" rows={16} value={share.text} onChange={(e) => setShare({ ...share, text: e.target.value, blocked: findPersonalData(e.target.value) })} />
            {share.blocked.length > 0 && <div className="err small">This text looks like it contains {share.blocked.join(" and ")}. Remove it before sharing.</div>}
            <div className="row">
              <button
                className="btn primary"
                disabled={share.blocked.length > 0}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(share.text);
                  } catch {
                    /* the text box stays selectable for manual copy */
                  }
                  window.open(COPILOTS[share.copilot].url, "_blank", "noopener,noreferrer");
                  setShare(null);
                }}
              >
                Copy and open {COPILOTS[share.copilot].name}
              </button>
              <button className="btn" onClick={() => setShare(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
