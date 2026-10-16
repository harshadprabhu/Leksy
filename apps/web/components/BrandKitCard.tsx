"use client";
import { useState } from "react";
import { api, DEMO } from "@/lib/api";
import { BrandKitSchema, clearPack, deckFromKit, parsePack, savePack, type BrandKit } from "@/lib/brandpack";
import { resetDemo } from "@/lib/demo";

type Settings = Record<string, unknown>;

const FONTS = ["Cormorant Garamond", "Playfair Display", "Cinzel", "Marcellus", "Cambria", "Georgia", "Red Hat Display", "Nunito", "Inter", "Montserrat", "Calibri", "Arial"];

const readImage = (file: File, max = 400_000) =>
  new Promise<string>((ok, bad) => {
    if (file.size > max) return bad(new Error(`That image is larger than ${Math.round(max / 1000)} KB.`));
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => bad(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });

/**
 * One place for a brand's look: name, logos, watermark and colours, applied to
 * every bill template (as a new published version), the app and the Insights deck.
 * A brand pack sets all of it at once, plus stores and bespoke templates.
 */
export function BrandKitCard({ brand, settings, onSaved }: { brand: { name: string; logoUrl: string | null }; settings: Settings; onSaved: () => void }) {
  const saved = BrandKitSchema.safeParse(settings.brandKit);
  const [k, setK] = useState<BrandKit>(
    saved.success ? saved.data : { name: brand.name, logo: brand.logoUrl?.startsWith("data:") ? brand.logoUrl : undefined, watermark: false, primary: "#1a1a1a", accent: "#b08d57", background: "#ffffff", headingFont: "Cormorant Garamond", bodyFont: "Inter" },
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<BrandKit>) => setK({ ...k, ...p });
  const hasPack = !!settings.pack;

  const apply = async () => {
    setBusy(true);
    setMsg("Applying…");
    try {
      await api("/v1/brand", { method: "PUT", body: { name: k.name, logoUrl: k.logo ?? null, settings: { ...settings, brandKit: k, deck: { ...deckFromKit(k), ...((settings.deck as object) ?? {}), ...deckFromKit(k) } } } });
      const { templates } = await api<{ templates: { id: string; key: string }[] }>("/v1/templates");
      for (const t of templates) {
        const full = await api<{ draft: { page: Record<string, unknown> } & Record<string, unknown> }>(`/v1/templates/${t.id}`);
        const page = { ...full.draft.page, accentColor: k.accent, textColor: k.primary, background: k.background, headingFontFamily: k.headingFont, fontFamily: k.bodyFont, watermark: full.draft.page.watermark ?? { src: "{{brand.watermark_url}}", opacity: 0.05, size: 55 } };
        await api(`/v1/templates/${t.id}`, { method: "PUT", body: { draft: { ...full.draft, page } } });
        await api(`/v1/templates/${t.id}/publish`, { method: "POST", body: {} });
      }
      setMsg(`Brand kit applied to ${templates.length} bill templates, the app and the Insights deck.`);
      window.dispatchEvent(new Event("lx-brand"));
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importPack = async (file: File) => {
    setMsg("Reading pack…");
    try {
      const pack = parsePack(JSON.parse(await file.text()));
      if (DEMO) {
        // The demo rebuilds itself around the pack: brand, stores, templates and history.
        savePack(pack);
        resetDemo();
        window.location.reload();
        return;
      }
      await api("/v1/brand", { method: "PUT", body: { name: pack.brand.name, logoUrl: pack.kit.logo ?? null, website: pack.brand.website ?? null, supportPhone: pack.brand.supportPhone ?? null, googleReviewUrl: pack.brand.googleReviewUrl ?? null } });
      await api("/v1/brand", { method: "PUT", body: { settings: { ...settings, brandKit: pack.kit, deck: deckFromKit(pack.kit, pack.deck?.footer), ...(pack.pdfTemplate ? { pdfTemplate: pack.pdfTemplate } : {}) } } });
      const { templates } = await api<{ templates: { id: string; key: string }[] }>("/v1/templates");
      for (const t of pack.templates ?? []) {
        const existing = templates.find((x) => x.key === t.key);
        const id = existing?.id ?? (await api<{ id: string }>("/v1/templates", { body: { key: t.key, name: t.name, from: "luxe-gold" } })).id;
        await api(`/v1/templates/${id}`, { method: "PUT", body: { name: t.name, draft: t.body } });
        await api(`/v1/templates/${id}/publish`, { method: "POST", body: {} });
      }
      const { stores } = await api<{ stores: { code: string }[] }>("/v1/stores");
      const have = new Set(stores.map((s) => s.code));
      let added = 0;
      for (const st of pack.stores ?? []) {
        if (have.has(st.code)) continue;
        await api("/v1/stores", { body: { code: st.code, name: st.name, city: st.city, address: st.address ?? null, region: st.region ?? null } });
        added++;
      }
      setMsg(`Imported ${pack.brand.name}: ${pack.templates?.length ?? 0} templates, ${added} new stores.`);
      window.dispatchEvent(new Event("lx-brand"));
      onSaved();
    } catch (e) {
      setMsg(`This is not a valid brand pack: ${(e as Error).message}`);
    }
  };

  const image = (key: "logo" | "logoLight" | "mark", label: string, dark = false) => (
    <div className="row" style={{ alignItems: "flex-end" }}>
      <label className="f">
        {label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              set({ [key]: await readImage(file) } as Partial<BrandKit>);
            } catch (er) {
              setMsg((er as Error).message);
            }
          }}
        />
      </label>
      {k[key] && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={k[key]} alt={label} style={{ height: 44, maxWidth: 160, objectFit: "contain", background: dark ? (k.ui ?? "#222") : k.background, padding: 4, borderRadius: 6, border: "1px solid var(--line)" }} />
          <button className="btn sm" onClick={() => set({ [key]: undefined } as Partial<BrandKit>)}>
            Remove
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="card stack" id="brand-kit">
      <h2 style={{ margin: 0 }}>Brand kit</h2>
      <div className="small muted">
        Name, logos, watermark and colours for bills, PDFs, this dashboard and decks. Use only the logo files and colour codes the brand has supplied.
        {DEMO && " In this demo the kit is saved only in this browser and is never published."}
      </div>

      <div className="pack-box">
        <div>
          <b>Brand pack</b>
          <div className="small muted">One file with the brand&apos;s logos, colours, stores and bill designs. {DEMO ? "Importing rebuilds the demo around that brand." : "Importing adds its templates and stores."}</div>
        </div>
        <div className="row">
          <label className="btn primary sm">
            Import brand pack…
            <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && void importPack(e.target.files[0])} />
          </label>
          {DEMO && hasPack && (
            <button
              className="btn sm"
              onClick={() => {
                if (!confirm("Remove the brand pack and go back to the sample brand?")) return;
                clearPack();
                resetDemo();
                window.location.reload();
              }}
            >
              Remove pack
            </button>
          )}
        </div>
      </div>

      <label className="f">
        Brand name
        <input value={k.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      {image("logo", "Logo for light backgrounds")}
      {image("logoLight", "Logo for dark backgrounds (optional)", true)}
      {image("mark", "Watermark mark (optional, defaults to the logo)")}
      <label className="row small">
        <input type="checkbox" checked={k.watermark} onChange={(e) => set({ watermark: e.target.checked })} /> Show a faint watermark on bills, PDFs, the dashboard and slides
      </label>
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
          App &amp; deck colour
          <input type="color" value={k.ui ?? k.accent} onChange={(e) => set({ ui: e.target.value })} />
        </label>
        <label className="f">
          Heading font
          <select value={k.headingFont} onChange={(e) => set({ headingFont: e.target.value })}>
            {[...new Set([k.headingFont, ...FONTS])].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Body font
          <select value={k.bodyFont} onChange={(e) => set({ bodyFont: e.target.value })}>
            {[...new Set([k.bodyFont, ...FONTS])].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ background: k.background, border: "1px solid var(--line)", borderRadius: 10, padding: 16, textAlign: "center", position: "relative", overflow: "hidden" }}>
        {k.watermark && (k.mark ?? k.logo) && <div style={{ position: "absolute", inset: 0, background: `url(${k.mark ?? k.logo}) center / 60% auto no-repeat`, opacity: 0.06 }} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {k.logo && <img src={k.logo} alt="" style={{ height: 56, maxWidth: 200, objectFit: "contain", position: "relative" }} />}
        <div style={{ fontFamily: k.headingFont, color: k.primary, fontSize: 22, letterSpacing: 2, position: "relative" }}>{k.name}</div>
        <div style={{ fontFamily: k.bodyFont, color: k.accent, fontSize: 12, position: "relative" }}>{k.tagline ?? "Tax invoice · thank you for shopping with us"}</div>
      </div>
      {msg && <div className="small">{msg}</div>}
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => void apply()}>
        Apply to bills, app and deck
      </button>
    </div>
  );
}
