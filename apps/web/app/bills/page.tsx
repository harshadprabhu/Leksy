"use client";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { api, dt, inr } from "@/lib/api";
import { useApi } from "@/lib/useApi";

interface Row {
  id: string;
  invoiceNo: string;
  storeCode: string;
  total: string;
  issuedAt: string;
  status: string;
  source: string;
  customerPhone: string | null;
  openedAt: string | null;
  rating: number | null;
  url: string;
}

interface Detail {
  bill: { id: string; invoiceNo: string; data: Record<string, unknown>; issues: { code: string; message: string }[]; links: Record<string, string>; status: string };
  deliveries: { id: string; channel: string; to: string; status: string; error: string | null; createdAt: string }[];
  feedback: { rating: number; answers: Record<string, unknown>; comment: string | null } | null;
  events: { id: number; type: string; at: string }[];
}

const STATUS: Record<string, string> = { sent: "good", delivered: "good", failed: "bad", skipped: "warn", queued: "", received: "" };

export default function Bills() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, reload } = useApi<{ bills: Row[] }>(`/v1/bills?limit=100${query ? `&q=${encodeURIComponent(query)}` : ""}`);
  const [open, setOpen] = useState<Detail | null>(null);
  return (
    <Shell>
      <div className="head">
        <div>
          <h1>Bills</h1>
          <div className="muted">Every bill received, how it was delivered, and what the customer said.</div>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q);
          }}
        >
          <input placeholder="Invoice no. or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn">Search</button>
          <button type="button" className="btn" onClick={() => void reload()}>
            Refresh
          </button>
        </form>
      </div>
      {error && <div className="err">{error}</div>}
      <div className="grid two" style={{ gridTemplateColumns: open ? "1.3fr 1fr" : "1fr" }}>
        <div className="card" style={{ overflow: "auto" }}>
          <table className="t">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Store</th>
                <th>Issued</th>
                <th className="num">Total</th>
                <th>Source</th>
                <th>Status</th>
                <th>Opened</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {data?.bills.map((b) => (
                <tr key={b.id} className="click" onClick={async () => setOpen(await api<Detail>(`/v1/bills/${b.id}`))}>
                  <td>{b.invoiceNo}</td>
                  <td>{b.storeCode}</td>
                  <td className="muted">{dt(b.issuedAt)}</td>
                  <td className="num">{inr(b.total)}</td>
                  <td>
                    <span className="badge">{b.source}</span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS[b.status] ?? ""}`}>{b.status}</span>
                  </td>
                  <td className="muted">{b.openedAt ? dt(b.openedAt) : "–"}</td>
                  <td>{b.rating ? <span className={`badge ${b.rating <= 2 ? "bad" : b.rating >= 4 ? "good" : "warn"}`}>{b.rating}★</span> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.bills.length && <div className="empty">No bills yet. Send one through the API or an integration.</div>}
        </div>
        {open && (
          <div className="card stack">
            <div className="spread">
              <h2 style={{ margin: 0 }}>{open.bill.invoiceNo}</h2>
              <div className="row">
                <a className="btn sm" href={open.bill.links.page} target="_blank" rel="noreferrer">
                  Open bill
                </a>
                <a className="btn sm" href={open.bill.links.pdf} target="_blank" rel="noreferrer">
                  PDF
                </a>
                <button
                  className="btn sm"
                  onClick={async () => {
                    await api(`/v1/bills/${open.bill.id}/resend`, { body: {} });
                    alert("Resend queued");
                  }}
                >
                  Resend
                </button>
                <button className="btn sm" onClick={() => setOpen(null)}>
                  ×
                </button>
              </div>
            </div>
            {open.bill.issues.length > 0 && (
              <div>
                <h3>Data warnings</h3>
                {open.bill.issues.map((i) => (
                  <div key={i.code} className="small">
                    <span className="badge warn">{i.code}</span> {i.message}
                  </div>
                ))}
              </div>
            )}
            <div>
              <h3>Deliveries</h3>
              {open.deliveries.map((d) => (
                <div key={d.id} className="spread small">
                  <span>
                    {d.channel} → {d.to}
                  </span>
                  <span className={`badge ${d.status === "failed" ? "bad" : "good"}`} title={d.error ?? ""}>
                    {d.status}
                  </span>
                </div>
              ))}
              {!open.deliveries.length && <div className="small muted">Not sent yet.</div>}
            </div>
            {open.feedback && (
              <div>
                <h3>Feedback</h3>
                <div>{"★".repeat(open.feedback.rating)}{"☆".repeat(5 - open.feedback.rating)}</div>
                <pre className="code">{JSON.stringify(open.feedback.answers, null, 2)}</pre>
              </div>
            )}
            <div>
              <h3>Timeline</h3>
              {open.events.map((e) => (
                <div key={e.id} className="spread small">
                  <span className="mono">{e.type}</span>
                  <span className="muted">{dt(e.at)}</span>
                </div>
              ))}
            </div>
            <details>
              <summary className="small muted">Bill data (canonical JSON)</summary>
              <pre className="code">{JSON.stringify(open.bill.data, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>
    </Shell>
  );
}
