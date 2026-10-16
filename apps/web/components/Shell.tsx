"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api, auth, DEMO } from "@/lib/api";
import { applyAppTheme, clearPack, loadPack, packFromHash, savePack, storePackFile, type BrandKit } from "@/lib/brandpack";
import { load, resetDemo } from "@/lib/demo";

const BrandContext = createContext<BrandKit | null>(null);
/** The brand kit for pages inside the shell (null when the brand has none). */
export const useBrand = () => useContext(BrandContext);

/** The brand's kit (logo, colours, watermark), re-read when Settings changes it. */
function useBrandKit(ready: boolean) {
  const [kit, setKit] = useState<BrandKit | null>(null);
  useEffect(() => {
    if (!ready) return;
    const read = () =>
      api<{ brand: { settings?: { brandKit?: BrandKit } } }>("/v1/me").then(
        (m) => {
          const k = m.brand.settings?.brandKit ?? null;
          setKit(k);
          applyAppTheme(k);
        },
        () => undefined,
      );
    void read();
    window.addEventListener("lx-brand", read);
    return () => window.removeEventListener("lx-brand", read);
  }, [ready]);
  return kit;
}

const NAV = [
  ["/", "Dashboard"],
  ["/insights", "Insights"],
  ["/bills", "Bills"],
  ["/feedback", "Mission Happiness"],
  ["/surveys", "Survey editor"],
  ["/studio", "Template Studio"],
  ["/connectors", "Integrations"],
  ["/triggers", "Triggers"],
  ["/settings", "Settings"],
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  // Demo: a private pack link (…/#pack=…) switches the demo to that brand.
  useEffect(() => {
    if (!DEMO || !window.location.hash.startsWith("#pack=")) return;
    setOpening(true);
    packFromHash(window.location.hash)
      .then((p) => {
        if (p) {
          savePack(p);
          resetDemo();
        }
      })
      .catch(() => alert("This brand link is damaged or incomplete. Ask for the link again, or load the pack file instead."))
      .finally(() => {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        window.location.reload();
      });
  }, []);
  useEffect(() => {
    if (!auth.token) router.replace("/login");
    else setReady(true);
  }, [router]);
  const kit = useBrandKit(ready);
  if (opening) return <div className="empty">Opening the brand demo…</div>;
  if (!ready) return null;
  const sideLogo = kit?.ui ? (kit.logoLight ?? kit.logo) : kit?.logo;
  return (
    <div className="shell">
      <aside className={`side ${kit?.ui ? "branded" : ""}`} style={kit?.ui ? ({ "--side": kit.ui } as React.CSSProperties) : undefined}>
        {sideLogo ? (
          <div className="brand-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sideLogo} alt={kit!.name} />
            <small>powered by Leksy</small>
          </div>
        ) : (
          <div className="logo">
            LEKSY<small>e-bills · happiness</small>
          </div>
        )}
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} className={`nav ${href === "/" ? (path === "/" ? "on" : "") : path.startsWith(href) ? "on" : ""}`}>
            {label}
          </Link>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="nav btn"
          style={{ border: 0, textAlign: "left" }}
          onClick={() => {
            auth.clear();
            router.replace("/login");
          }}
        >
          Sign out
        </button>
      </aside>
      {kit?.watermark && (kit.mark ?? kit.logo) && <div className="app-wm" aria-hidden="true" style={{ backgroundImage: `url(${kit.mark ?? kit.logo})` }} />}
      <main className="main">
        {DEMO && <DemoBar />}
        <BrandContext.Provider value={kit}>{children}</BrandContext.Provider>
      </main>
    </div>
  );
}

/** Demo-only: act as a store's POS, or start over. */
function DemoBar() {
  const [last, setLast] = useState<{ url: string; invoice: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [packErr, setPackErr] = useState<string | null>(null);
  const pack = loadPack();
  const restart = () => {
    resetDemo();
    window.location.reload();
  };
  return (
    <div className="card demo-bar">
      <div>
        <b>Demo mode.</b> <span className="muted">Sample data for &ldquo;{load().brand.name}&rdquo; ({load().stores.length} stores), kept in your browser. Nothing is sent.</span>
        <div className="small" style={{ marginTop: 4 }}>
          {pack ? (
            <>
              Brand pack loaded: <b>{pack.brand.name}</b> · bills, PDFs, dashboard, Insights and decks use its look.{" "}
              <button className="linkish" onClick={() => confirm(`Remove the ${pack.brand.name} pack and go back to the sample brand?`) && (clearPack(), restart())}>
                Remove pack
              </button>
            </>
          ) : (
            <span className="muted">Pitching a client? Load their brand pack to see every page in their logo, colours and stores.</span>
          )}
          {packErr && <span className="err"> {packErr}</span>}
        </div>
        {last && (
          <div className="small" style={{ marginTop: 4 }}>
            Bill {last.invoice} sent on WhatsApp.{" "}
            <a href={last.url} target="_blank" rel="noreferrer">
              <b>Open it as the customer →</b>
            </a>
          </div>
        )}
      </div>
      <div className="row">
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await api<{ url: string; id: string }>("/v1/bills", { body: {} });
            const b = await api<{ bill: { invoiceNo: string } }>(`/v1/bills/${r.id}`);
            setLast({ url: r.url, invoice: b.bill.invoiceNo });
            setBusy(false);
          }}
        >
          Simulate a sale
        </button>
        <label className="btn">
          {pack ? "Change brand pack…" : "Load brand pack…"}
          <input
            type="file"
            accept="application/json,.json,text/plain"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                await storePackFile(f);
                restart();
              } catch (er) {
                setPackErr(`That file is not a valid brand pack: ${(er as Error).message}`);
              }
            }}
          />
        </label>
        <button
          className="btn"
          onClick={() => {
            if (confirm("Reset the demo to its starting data?")) {
              resetDemo();
              window.location.reload();
            }
          }}
        >
          Reset demo
        </button>
      </div>
    </div>
  );
}
