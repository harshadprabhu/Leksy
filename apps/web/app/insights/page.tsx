"use client";
import { ask, buildBrief, COPILOTS, findPersonalData, forecast, inr, SUGGESTIONS, toWeekly, type Answer, type CopilotId, type Dataset, type ForecastResult, type Metric } from "@leksy/insights";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarChart, LineChart } from "@/components/insights/Chart";
import { Shell } from "@/components/Shell";
import { contextSummary, localFreeAnswer, localNarrative, readAi, readDeck, type AiSettings, type DeckTheme } from "@/lib/ai";
import { api } from "@/lib/api";
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
      <div className="head">
        <div>
          <h1>Insights</h1>
          <div className="muted">Ask about your business, see what&apos;s coming, and take a ready deck to your next review.</div>
        </div>
        <div className="row">
          <span className="badge good" title="Answers are computed in this browser from your own data">
            {ai.engine === "ollama" ? `Local engine + ${ai.ollamaModel} on your computer` : "Local engine · data stays on this device"}
          </span>
          <Link className="btn sm" href="/settings#ai">
            AI settings
          </Link>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(320px,1fr)", alignItems: "start" }}>
        <div className="stack">
          <form
            className="card stack"
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
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => void run(s)}>
                  {s}
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

        <div className="stack" style={{ position: "sticky", top: 16 }}>
          <div className="card stack">
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

          <div className="card stack">
            <h2 style={{ margin: 0 }}>PowerPoint deck</h2>
            <div className="small muted">
              In {deck.company}&apos;s colours, fonts and logo: cover, pre-read, forecast, {deckAnswers.length} answer slide{deckAnswers.length === 1 ? "" : "s"}, method. Built on this computer.
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
                  await buildDeck(ds, deck, deckAnswers, fc && metric === "revenue" && !store ? fc : (() => {
                    try {
                      return forecast(toWeekly(ds.days, "revenue", ds.asOf), 8, "revenue");
                    } catch {
                      return null;
                    }
                  })());
                } finally {
                  setDeckBusy(false);
                }
              }}
            >
              {deckBusy ? "Building…" : "Download PowerPoint"}
            </button>
          </div>

          <div className="card stack">
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
