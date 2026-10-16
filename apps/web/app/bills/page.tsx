"use client";
import { useEffect, useState } from "react";
import { Face, FACE_LABELS, PageHero } from "@/components/PageHero";
import { Shell } from "@/components/Shell";
import { api, dt, inr } from "@/lib/api";
import { useApi } from "@/lib/useApi";

interface Row {
  id: string;
  invoiceNo: string;
  storeCode: string;
  storeName?: string;
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
  const { data, error, reload } = useApi<{ bills: Row[]; total?: number }>(`/v1/bills?limit=100${query ? `&q=${encodeURIComponent(query)}` : ""}`);
  const [open, setOpen] = useState<Detail | null>(null);
  const kpi = useApi<{ bills: number; sent: number; opened: number; responses: number; avgRating: number | null; revenue: number }>("/v1/analytics/summary");
  // Opened from the dashboard with ?q=STORE: start with that search.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("q");
    if (v) {
      setQ(v);
      setQuery(v);
    }
  }, []);
  return (
    <Shell>
      <PageHero
        kicker="Bills"
        title="Every bill, beautifully delivered"
        sub="Sent on WhatsApp the moment it's billed: opened, verified and rated by your customers."
        stats={
          kpi.data
            ? [
                { value: kpi.data.bills.toLocaleString("en-IN"), label: "bills, last 30 days" },
                { value: kpi.data.sent ? `${Math.round((100 * kpi.data.opened) / kpi.data.sent)}%` : "–", label: "opened by customers" },
                { value: kpi.data.avgRating != null ? `${kpi.data.avgRating.toFixed(2)} ★` : "–", label: "customer happiness" },
              ]
            : []
        }
      >
        <form
          className="row hero-search"
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
      </PageHero>
      {error && <div className="err">{error}</div>}
      <div className="grid two" style={{ gridTemplateColumns: open ? "1.3fr 1fr" : "1fr" }}>
        <div className="card" style={{ overflow: "auto" }}>
          <table className="t branded">
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
                  <td className="nowrap mono">{b.invoiceNo}</td>
                  <td>
                    {b.storeName ?? b.storeCode} <span className="muted small mono">{b.storeCode}</span>
                  </td>
                  <td className="muted nowrap">{dt(b.issuedAt)}</td>
                  <td className="num nowrap">{inr(b.total)}</td>
                  <td>
                    <span className="badge">{b.source}</span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS[b.status] ?? ""}`}>{b.status}</span>
                  </td>
                  <td className="muted nowrap">{b.openedAt ? dt(b.openedAt) : "–"}</td>
                  <td>{b.rating ? <span className="face-cell"><Face rating={b.rating} /> {b.rating}</span> : <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.bills.length && <div className="empty">No bills yet. Send one through the API or an integration.</div>}
          {data?.total != null && data.total > data.bills.length && (
            <div className="small muted" style={{ marginTop: 8 }}>
              Showing the latest {data.bills.length} of {data.total.toLocaleString("en-IN")} itemised bills. Search by invoice, phone or store to find others.
            </div>
          )}
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
                <div className="fb-big">
                  <Face rating={open.feedback.rating} size={52} />
                  <div>
                    <b>{FACE_LABELS[open.feedback.rating - 1]}</b>
                    <div className="small muted">{open.feedback.rating} of 5</div>
                  </div>
                </div>
                <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                  {Object.entries(open.feedback.answers)
                    .filter(([k]) => k !== "overall")
                    .map(([k, v]) => (
                      <div key={k} className="spread small">
                        <span className="muted">{k.replace(/_/g, " ")}</span>
                        <span>{Array.isArray(v) ? v.join(", ") : String(v)}</span>
                      </div>
                    ))}
                </div>
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
