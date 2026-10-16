"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { readDeck } from "@/lib/ai";

type Settings = Record<string, unknown>;

export interface BrandKit {
  name: string;
  logo?: string;
  primary: string;
  accent: string;
  background: string;
  headingFont: string;
  bodyFont: string;
}

const FONTS = ["Cormorant Garamond", "Playfair Display", "Cambria", "Georgia", "Inter", "Calibri", "Arial", "Montserrat", "Lato"];

/**
 * One place for a brand's look: name, logo and colours, applied to every bill
 * template (as a new published version) and to the Insights deck. In the demo it is
 * saved only in this browser, so a pilot brand's assets never reach the public site.
 */
export function BrandKitCard({ brand, settings, onSaved }: { brand: { name: string; logoUrl: string | null }; settings: Settings; onSaved: () => void }) {
  const saved = settings.brandKit as BrandKit | undefined;
  const [k, setK] = useState<BrandKit>(
    saved ?? { name: brand.name, logo: brand.logoUrl ?? undefined, primary: "#1a1a1a", accent: "#b08d57", background: "#ffffff", headingFont: "Cormorant Garamond", bodyFont: "Inter" },
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<BrandKit>) => setK({ ...k, ...p });
  const demo = process.env.NEXT_PUBLIC_DEMO === "1";

  const apply = async () => {
    setBusy(true);
    setMsg("Applying…");
    try {
      // The deck can embed PNG or JPG only; an SVG logo stays on bills.
      const deckLogo = k.logo && /^data:image\/(png|jpeg);base64,/.test(k.logo) ? k.logo : undefined;
      const deck = { ...readDeck(settings, k.name), company: k.name, primary: k.primary, accent: k.accent, headingFont: k.headingFont, bodyFont: k.bodyFont, logo: deckLogo };
      await api("/v1/brand", { method: "PUT", body: { name: k.name, logoUrl: k.logo ?? null, settings: { ...settings, brandKit: k, deck } } });
      const { templates } = await api<{ templates: { id: string; name: string }[] }>("/v1/templates");
      for (const t of templates) {
        const full = await api<{ draft: { page: Record<string, unknown> } & Record<string, unknown> }>(`/v1/templates/${t.id}`);
        const page = { ...full.draft.page, accentColor: k.accent, textColor: k.primary, background: k.background, headingFontFamily: k.headingFont, fontFamily: k.bodyFont };
        await api(`/v1/templates/${t.id}`, { method: "PUT", body: { draft: { ...full.draft, page } } });
        await api(`/v1/templates/${t.id}/publish`, { method: "POST", body: {} });
      }
      setMsg(`Brand kit applied to ${templates.length} bill templates and the Insights deck.`);
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack" id="brand-kit">
      <h2 style={{ margin: 0 }}>Brand kit</h2>
      <div className="small muted">
        Name, logo and colours for bills and decks. Use only the logo files and colour codes the brand has supplied.
        {demo && " In this demo the kit is saved only in this browser and is never published."}
      </div>
      <label className="f">
        Brand name
        <input value={k.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="row">
        <label className="f">
          Logo (PNG, JPG or SVG, up to 300 KB)
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
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
        {k.logo && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={k.logo} alt="Logo" style={{ height: 44, maxWidth: 160, objectFit: "contain", background: k.background, padding: 4, borderRadius: 6, border: "1px solid #e5e7eb" }} />
            <button className="btn sm" onClick={() => set({ logo: undefined })}>
              Remove
            </button>
          </>
        )}
      </div>
      <div className="row">
        {(
          [
            ["primary", "Text & headings"],
            ["accent", "Accent"],
            ["background", "Bill background"],
          ] as const
        ).map(([key, l]) => (
          <label key={key} className="f">
            {l}
            <input type="color" value={k[key]} onChange={(e) => set({ [key]: e.target.value })} />
          </label>
        ))}
        <label className="f">
          Heading font
          <select value={k.headingFont} onChange={(e) => set({ headingFont: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Body font
          <select value={k.bodyFont} onChange={(e) => set({ bodyFont: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ background: k.background, border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, textAlign: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {k.logo && <img src={k.logo} alt="" style={{ height: 40, maxWidth: 180, objectFit: "contain" }} />}
        <div style={{ fontFamily: k.headingFont, color: k.primary, fontSize: 22, letterSpacing: 2 }}>{k.name}</div>
        <div style={{ fontFamily: k.bodyFont, color: k.accent, fontSize: 12 }}>Tax invoice · thank you for shopping with us</div>
      </div>
      {msg && <div className="small">{msg}</div>}
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => void apply()}>
        Apply to bills and deck
      </button>
    </div>
  );
}
