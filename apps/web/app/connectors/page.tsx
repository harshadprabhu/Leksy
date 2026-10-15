"use client";
import Link from "next/link";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { api, API_URL, dt } from "@/lib/api";
import { useApi } from "@/lib/useApi";

interface Connector {
  id: string;
  name: string;
  kind: "push" | "pull";
  ingestUrl: string;
  mapping: unknown;
  enabled: boolean;
  intervalSeconds: number | null;
  lastRunAt: string | null;
  lastError: string | null;
  pull: { url: string } | null;
}

export default function Connectors() {
  const { data, reload } = useApi<{ connectors: Connector[] }>("/v1/connectors");
  const [kind, setKind] = useState<"push" | "pull">("push");
  const [form, setForm] = useState({ name: "", url: "", authType: "none", token: "", billsPath: "", cursorParam: "", cursorField: "", interval: 300 });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Shell>
      <div className="head">
        <div>
          <h1>Integrations</h1>
          <div className="muted">Bills reach Leksy either way: the store system calls us, or we call the store system.</div>
        </div>
      </div>
      <div className="grid two">
        <div className="stack">
          <div className="card">
            <h2>Connected sources</h2>
            <table className="t">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Direction</th>
                  <th>Mapping</th>
                  <th>Last run</th>
                </tr>
              </thead>
              <tbody>
                {data?.connectors.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/connectors/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>
                      <span className="badge">{c.kind === "push" ? "They push to us" : `We pull every ${Math.round((c.intervalSeconds ?? 0) / 60)} min`}</span>
                    </td>
                    <td>{c.mapping ? <span className="badge good">mapped</span> : <span className="badge warn">needs mapping</span>}</td>
                    <td className="small">
                      {c.lastRunAt ? dt(c.lastRunAt) : "–"}
                      {c.lastError && <div className="err small">{c.lastError}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card stack">
            <h2>Option A: send canonical bills to our API</h2>
            <p className="small muted">Best for new integrations. One call per bill; safe to retry. Get a key in Settings.</p>
            <pre className="code">{`curl -X POST ${API_URL}/v1/bills \\
  -H "Authorization: Bearer lk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "invoice_no": "INV-1001",
    "store_code": "BLR-01",
    "issued_at": "2026-10-15T14:32:00+05:30",
    "customer": { "name": "Ananya", "phone": "+919812345678" },
    "items": [{ "name": "Necklace", "qty": 1, "unit_price": 100000 }],
    "taxes": [{ "type": "CGST", "rate": 1.5, "amount": 1500 },
              { "type": "SGST", "rate": 1.5, "amount": 1500 }],
    "total": 103000
  }'`}</pre>
            <h2>Option B: send your own JSON (plug and play)</h2>
            <p className="small muted">Create a push source, point your POS/ERP at its URL, send one bill as-is, then map the fields here. No code changes on your side.</p>
          </div>
        </div>
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              const body =
                kind === "push"
                  ? { name: form.name, kind }
                  : {
                      name: form.name,
                      kind,
                      intervalSeconds: Number(form.interval),
                      pull: {
                        url: form.url,
                        auth: form.authType === "bearer" ? { type: "bearer", token: form.token } : form.authType === "header" ? { type: "header", name: "x-api-key", value: form.token } : { type: "none" },
                        billsPath: form.billsPath || undefined,
                        cursorParam: form.cursorParam || undefined,
                        cursorField: form.cursorField || undefined,
                      },
                    };
              const r = await api<Connector>("/v1/connectors", { body });
              await reload();
              window.location.href = `/connectors/${r.id}`;
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          <h2>Add a source</h2>
          <div className="seg">
            <button type="button" className={kind === "push" ? "on" : ""} onClick={() => setKind("push")}>
              They push to Leksy
            </button>
            <button type="button" className={kind === "pull" ? "on" : ""} onClick={() => setKind("pull")}>
              Leksy pulls from their API
            </button>
          </div>
          <label className="f">
            Name
            <input value={form.name} onChange={set("name")} placeholder={kind === "push" ? "Ginesys POS" : "SAP B1 invoices"} required />
          </label>
          {kind === "pull" && (
            <>
              <label className="f">
                Their API URL (returns a list of bills)
                <input type="url" value={form.url} onChange={set("url")} placeholder="https://erp.brand.com/api/invoices" required />
              </label>
              <div className="row">
                <label className="f">
                  Auth
                  <select value={form.authType} onChange={set("authType")}>
                    <option value="none">None</option>
                    <option value="bearer">Bearer token</option>
                    <option value="header">x-api-key header</option>
                  </select>
                </label>
                {form.authType !== "none" && (
                  <label className="f" style={{ flex: 1 }}>
                    Token
                    <input value={form.token} onChange={set("token")} />
                  </label>
                )}
              </div>
              <label className="f">
                Where the list sits in the response (e.g. data.invoices; blank = whole response)
                <input value={form.billsPath} onChange={set("billsPath")} />
              </label>
              <div className="row">
                <label className="f" style={{ flex: 1 }}>
                  &quot;Since&quot; query parameter
                  <input value={form.cursorParam} onChange={set("cursorParam")} placeholder="updated_since" />
                </label>
                <label className="f" style={{ flex: 1 }}>
                  Field that holds the update time
                  <input value={form.cursorField} onChange={set("cursorField")} placeholder="UpdatedAt" />
                </label>
              </div>
              <label className="f">
                Check every
                <select value={form.interval} onChange={set("interval")}>
                  <option value={60}>1 minute</option>
                  <option value={300}>5 minutes</option>
                  <option value={900}>15 minutes</option>
                  <option value={3600}>1 hour</option>
                </select>
              </label>
              <div className="small muted">Their system can also ping the source&apos;s URL to make Leksy fetch right away.</div>
            </>
          )}
          {err && <div className="err">{err}</div>}
          <button className="btn primary">Create and map fields</button>
        </form>
      </div>
    </Shell>
  );
}
