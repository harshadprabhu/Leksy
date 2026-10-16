"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DEMO } from "@/lib/api";
import { findBillByToken, load } from "@/lib/demo";

/** Behind the QR on every bill: proves the bill is genuine (demo build). */
function Verify() {
  const t = useSearchParams().get("t") ?? "";
  if (!DEMO) return <div className="empty">Verification is served by the Leksy API at /v/&lt;token&gt;.</div>;
  const bill = findBillByToken(t);
  const s = load();
  return (
    <div className="auth">
      <div className="card stack">
        {bill ? (
          <>
            <h2>✅ Genuine bill</h2>
            <div>
              <b>{s.brand.name}</b>
              <br />
              Invoice {bill.invoiceNo} · {bill.storeCode}
              <br />
              Issued {new Date(bill.issuedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
              <br />
              Total ₹{Number(bill.total).toLocaleString("en-IN")}
            </div>
            <p className="small muted">Issued through Leksy. The bill&apos;s contents match what the store sent.</p>
          </>
        ) : (
          <h2>Not a valid Leksy bill</h2>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
