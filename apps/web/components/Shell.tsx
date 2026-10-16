"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, auth, DEMO } from "@/lib/api";
import { resetDemo } from "@/lib/demo";

const NAV = [
  ["/", "Dashboard"],
  ["/bills", "Bills"],
  ["/feedback", "Mission Happiness"],
  ["/studio", "Template Studio"],
  ["/connectors", "Integrations"],
  ["/triggers", "Triggers"],
  ["/settings", "Settings"],
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!auth.token) router.replace("/login");
    else setReady(true);
  }, [router]);
  if (!ready) return null;
  return (
    <div className="shell">
      <aside className="side">
        <div className="logo">
          LEKSY<small>e-bills · happiness</small>
        </div>
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
      <main className="main">
        {DEMO && <DemoBar />}
        {children}
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
        <b>Demo mode.</b> <span className="muted">Sample data for &ldquo;Aurum &amp; Co.&rdquo;, kept in your browser. Nothing is sent.</span>
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
