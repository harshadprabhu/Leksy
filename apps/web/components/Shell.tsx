"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api, auth, DEMO } from "@/lib/api";
import { applyAppTheme, packFromHash, savePack, type BrandKit } from "@/lib/brandpack";
import { load, resetDemo } from "@/lib/demo";

const BrandContext = createContext<BrandKit | null>(null);
/** The brand kit for pages inside the shell (null when the brand has none). */
export const useBrand = () => useContext(BrandContext);

/** The kit known without waiting for the network: the demo's own, or the one remembered from the last visit. */
function knownKit(): BrandKit | null {
  try {
    if (DEMO) return (load().brand.settings?.brandKit as BrandKit | undefined) ?? null;
    const raw = localStorage.getItem(KIT_KEY);
    return raw ? (JSON.parse(raw) as BrandKit) : null;
  } catch {
    return null;
  }
}
const KIT_KEY = "lx_kit";

/**
 * The brand's kit (logo, colours, watermark). It is read before the shell first
 * draws, so the app never shows another look first; then refreshed from the
 * server, and again whenever Settings changes it.
 */
function useBrandKit(ready: boolean) {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [known, setKnown] = useState(false);
  useEffect(() => {
    const k = knownKit();
    setKit(k);
    if (k) applyAppTheme(k);
    setKnown(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const read = () =>
      api<{ brand: { settings?: { brandKit?: BrandKit } } }>("/v1/me").then(
        (m) => {
          const k = m.brand.settings?.brandKit ?? null;
          setKit(k);
          applyAppTheme(k);
          try {
            if (k) localStorage.setItem(KIT_KEY, JSON.stringify(k));
            else localStorage.removeItem(KIT_KEY);
          } catch {}
        },
        () => undefined,
      );
    void read();
    window.addEventListener("lx-brand", read);
    return () => window.removeEventListener("lx-brand", read);
  }, [ready]);
  return { kit, known };
}

/**
 * Tables marked "stack" become cards on phones; each cell shows its column's
 * heading as a label, taken from the table header so pages need no extra markup.
 */
function useStackLabels(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const label = () => {
      document.querySelectorAll<HTMLTableElement>("table.stack").forEach((t) => {
        const heads = [...t.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").replace(/[▲▼]/g, "").trim());
        t.querySelectorAll("tbody tr").forEach((tr) =>
          [...tr.children].forEach((td, i) => {
            const l = heads[i] ?? "";
            if (td.getAttribute("data-label") !== l) td.setAttribute("data-label", l);
          }),
        );
      });
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [on]);
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
  const { kit, known } = useBrandKit(ready);
  useStackLabels(ready && known);
  if (opening) return <div className="empty">Opening the brand demo…</div>;
  // Draw nothing until the brand is known, so no other logo or colour flashes first.
  if (!ready || !known) return null;
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
        <div className="side-spacer" />
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
  return (
    <div className="card demo-bar">
      <div>
        <b>Demo mode.</b> <span className="muted">Sample data for &ldquo;{load().brand.name}&rdquo; ({load().stores.length} stores), kept in your browser. Nothing is sent.</span>
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
