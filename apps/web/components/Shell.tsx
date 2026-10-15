"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { auth } from "@/lib/api";

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
      <main className="main">{children}</main>
    </div>
  );
}
