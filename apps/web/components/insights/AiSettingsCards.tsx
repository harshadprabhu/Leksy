"use client";
import { COPILOTS, type CopilotId } from "@leksy/insights";
import { useState } from "react";
import { ollamaModels, readAi, readDeck, type AiSettings, type DeckTheme } from "@/lib/ai";
import { api } from "@/lib/api";

type Settings = Record<string, unknown>;

async function saveSettings(current: Settings, patch: Settings) {
  // brand.settings is replaced as a whole, so merge before saving.
  await api("/v1/brand", { method: "PUT", body: { settings: { ...current, ...patch } } });
}

/** Admin controls: which AI may be used, and what may ever leave the company. */
export function AiSettingsCard({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [ai, setAi] = useState<AiSettings>(readAi(settings));
  const [msg, setMsg] = useState<string | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const set = (p: Partial<AiSettings>) => setAi({ ...ai, ...p });
  const setShare = (p: Partial<AiSettings["share"]>) => setAi({ ...ai, share: { ...ai.share, ...p } });
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="card stack" id="ai">
      <h2 style={{ margin: 0 }}>AI &amp; Insights</h2>

      <h3>Local analysis (always on, free)</h3>
      <div className="small muted">Leksy&apos;s engine answers questions and forecasts inside the browser from your own data. Nothing is sent anywhere.</div>

      <h3>Local language model (optional, free)</h3>
      <label className="row small">
        <input type="checkbox" checked={ai.engine === "ollama"} onChange={(e) => set({ engine: e.target.checked ? "ollama" : "builtin" })} />
        Also use a language model running on our own computer or server (Ollama)
      </label>
      {ai.engine === "ollama" && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <label className="f" style={{ flex: 2 }}>
              Ollama address
              <input value={ai.ollamaUrl} onChange={(e) => set({ ollamaUrl: e.target.value })} />
            </label>
            <label className="f" style={{ flex: 1 }}>
              Model
              {models?.length ? (
                <select value={ai.ollamaModel} onChange={(e) => set({ ollamaModel: e.target.value })}>
                  {!models.includes(ai.ollamaModel) && <option>{ai.ollamaModel}</option>}
                  {models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input value={ai.ollamaModel} onChange={(e) => set({ ollamaModel: e.target.value })} />
              )}
            </label>
            <button
              className="btn"
              style={{ alignSelf: "flex-end" }}
              onClick={async () => {
                setMsg("Checking…");
                try {
                  const m = await ollamaModels(ai.ollamaUrl);
                  setModels(m);
                  setMsg(m.length ? `Connected. ${m.length} model${m.length > 1 ? "s" : ""} installed.` : "Connected, but no models are installed yet (run: ollama pull qwen2.5:7b).");
                } catch (e) {
                  setMsg((e as Error).message);
                }
              }}
            >
              Test connection
            </button>
          </div>
          <details className="small">
            <summary className="muted">How to set it up (10 minutes, free)</summary>
            <ol style={{ margin: "6px 0", paddingLeft: 18 }}>
              <li>Install Ollama from ollama.com on a company computer or server.</li>
              <li>
                Download a model: <span className="mono">ollama pull qwen2.5:7b</span> (or llama3.1:8b, mistral, gemma2).
              </li>
              <li>
                Start it so this dashboard may call it: <span className="mono">OLLAMA_ORIGINS={origin} ollama serve</span>
              </li>
              <li>Click Test connection, pick the model, save.</li>
            </ol>
            The model only receives the totals Leksy already computed, and it runs on your machine.
          </details>
        </div>
      )}

      <h3>External copilots (optional, off by default)</h3>
      <label className="row small">
        <input type="checkbox" checked={ai.share.allowExternal} onChange={(e) => setShare({ allowExternal: e.target.checked })} />
        Let users share summarised results with an external copilot when they choose to
      </label>
      {ai.share.allowExternal && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row small">
            {(Object.keys(COPILOTS) as CopilotId[]).map((c) => (
              <label key={c} className="row">
                <input type="checkbox" checked={ai.share.copilots.includes(c)} onChange={(e) => setShare({ copilots: e.target.checked ? [...ai.share.copilots, c] : ai.share.copilots.filter((x) => x !== c) })} />
                {COPILOTS[c].name}
              </label>
            ))}
          </div>
          <label className="row small">
            <input type="checkbox" checked={ai.share.maskStores} onChange={(e) => setShare({ maskStores: e.target.checked })} /> Hide store and brand names (Store A, Store B…)
          </label>
          <label className="row small">
            <input type="checkbox" checked={ai.share.indexMoney} onChange={(e) => setShare({ indexMoney: e.target.checked })} /> Turn rupee amounts into an index (keeps real sales private)
          </label>
          <div className="small muted">Never shared, whatever the settings: customer names, phone numbers, emails, invoice numbers and comments. Users see the exact text and copy it themselves.</div>
        </div>
      )}
      {msg && <div className="small">{msg}</div>}
      <button
        className="btn primary"
        style={{ alignSelf: "flex-start" }}
        onClick={async () => {
          await saveSettings(settings, { ai });
          setMsg("AI settings saved.");
          onSaved();
        }}
      >
        Save AI settings
      </button>
    </div>
  );
}

const FONTS = ["Calibri", "Arial", "Georgia", "Garamond", "Segoe UI", "Helvetica", "Times New Roman", "Trebuchet MS", "Verdana", "Cambria"];

/** The company look used for generated PowerPoint decks. */
export function DeckSettingsCard({ settings, company, onSaved }: { settings: Settings; company: string; onSaved: () => void }) {
  const [d, setD] = useState<DeckTheme>(readDeck(settings, company));
  const [msg, setMsg] = useState<string | null>(null);
  const set = (p: Partial<DeckTheme>) => setD({ ...d, ...p });
  return (
    <div className="card stack" id="deck">
      <h2 style={{ margin: 0 }}>Deck template</h2>
      <div className="small muted">Insights decks use these colours, fonts and logo, so they match your company&apos;s own slides.</div>
      <div className="row">
        <label className="f" style={{ flex: 1 }}>
          Company name on slides
          <input value={d.company} onChange={(e) => set({ company: e.target.value })} />
        </label>
        <label className="f" style={{ flex: 2 }}>
          Footer
          <input value={d.footer} onChange={(e) => set({ footer: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <label className="f">
          Main colour
          <input type="color" value={d.primary} onChange={(e) => set({ primary: e.target.value })} />
        </label>
        <label className="f">
          Accent
          <input type="color" value={d.accent} onChange={(e) => set({ accent: e.target.value })} />
        </label>
        <label className="f">
          Text
          <input type="color" value={d.text} onChange={(e) => set({ text: e.target.value })} />
        </label>
        <label className="f">
          Heading font
          <select value={d.headingFont} onChange={(e) => set({ headingFont: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Body font
          <select value={d.bodyFont} onChange={(e) => set({ bodyFont: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="f">
          Logo (PNG or JPG, up to 300 KB)
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 300_000) return setMsg("That logo is larger than 300 KB.");
              const r = new FileReader();
              r.onload = () => set({ logo: String(r.result) });
              r.readAsDataURL(file);
            }}
          />
        </label>
        {d.logo && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.logo} alt="Logo" style={{ height: 40, maxWidth: 140, objectFit: "contain", background: d.primary, padding: 4, borderRadius: 6 }} />
            <button className="btn sm" onClick={() => set({ logo: undefined })}>
              Remove
            </button>
          </>
        )}
      </div>
      <div className="deck-preview" style={{ background: d.primary }}>
        <div style={{ fontFamily: d.headingFont, color: "#fff", fontSize: 20 }}>{d.company}</div>
        <div style={{ fontFamily: d.bodyFont, color: d.accent, fontSize: 12 }}>Business review, customer happiness and outlook</div>
      </div>
      {msg && <div className="small">{msg}</div>}
      <button
        className="btn primary"
        style={{ alignSelf: "flex-start" }}
        onClick={async () => {
          await saveSettings(settings, { deck: d });
          setMsg("Deck template saved.");
          onSaved();
        }}
      >
        Save deck template
      </button>
    </div>
  );
}
