"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, dt } from "@/lib/api";
import { useApi } from "@/lib/useApi";

interface Brand {
  name: string;
  logoUrl: string | null;
  website: string | null;
  supportPhone: string | null;
  googleReviewUrl: string | null;
}
interface Store {
  id: string;
  code: string;
  name: string;
  city: string | null;
  managerPhone: string | null;
  managerEmail: string | null;
}

export default function Settings() {
  const me = useApi<{ brand: Brand }>("/v1/me");
  const keys = useApi<{ keys: { id: string; name: string; prefix: string; requireSignature: boolean; lastUsedAt: string | null }[] }>("/v1/api-keys");
  const hooks = useApi<{ webhooks: { id: string; url: string; events: string[] }[] }>("/v1/webhooks");
  const stores = useApi<{ stores: Store[] }>("/v1/stores");
  const [brand, setBrand] = useState<Brand | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [store, setStore] = useState({ code: "", name: "", city: "", managerPhone: "", managerEmail: "" });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (me.data) setBrand(me.data.brand);
  }, [me.data]);

  return (
    <Shell>
      <div className="head">
        <h1>Settings</h1>
      </div>
      {msg && <div className="card small" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="grid two">
        {brand && (
          <form
            className="card stack"
            onSubmit={async (e) => {
              e.preventDefault();
              await api("/v1/brand", { method: "PUT", body: { name: brand.name, logoUrl: brand.logoUrl || null, website: brand.website || null, supportPhone: brand.supportPhone || null, googleReviewUrl: brand.googleReviewUrl || null } });
              setMsg("Brand saved");
            }}
          >
            <h2>Brand</h2>
            {(
              [
                ["name", "Brand name"],
                ["logoUrl", "Logo URL (https)"],
                ["website", "Website"],
                ["supportPhone", "Support phone"],
                ["googleReviewUrl", "Google review link (shown to happy customers)"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="f">
                {l}
                <input value={brand[k] ?? ""} onChange={(e) => setBrand({ ...brand, [k]: e.target.value })} />
              </label>
            ))}
            <button className="btn primary">Save brand</button>
          </form>
        )}
        <div className="card stack">
          <h2>API keys</h2>
          {keys.data?.keys.map((k) => (
            <div key={k.id} className="spread small">
              <span>
                {k.name} <span className="mono muted">lk_live_{k.prefix}_…</span> {k.requireSignature && <span className="badge">signed</span>}
              </span>
              <span className="row">
                <span className="muted">{k.lastUsedAt ? `used ${dt(k.lastUsedAt)}` : "never used"}</span>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (confirm("Revoke this key? Systems using it will stop sending bills.")) {
                      await api(`/v1/api-keys/${k.id}`, { method: "DELETE" });
                      await keys.reload();
                    }
                  }}
                >
                  Revoke
                </button>
              </span>
            </div>
          ))}
          <button
            className="btn"
            onClick={async () => {
              const name = prompt("Name this key (e.g. POS Bengaluru)");
              if (!name) return;
              const r = await api<{ key: string }>("/v1/api-keys", { body: { name } });
              setNewKey(r.key);
              await keys.reload();
            }}
          >
            Create API key
          </button>
          {newKey && (
            <label className="f">
              Copy now; it is shown only once
              <input readOnly className="mono" value={newKey} onFocus={(e) => e.target.select()} />
            </label>
          )}
          <h2 style={{ marginTop: 12 }}>Webhooks to your systems</h2>
          <div className="small muted">We POST bill.received, bill.sent, bill.opened, feedback.submitted and ticket.sla_breached, signed with X-Leksy-Signature.</div>
          {hooks.data?.webhooks.map((h) => (
            <div key={h.id} className="spread small">
              <span className="mono">{h.url}</span>
              <button
                className="btn sm danger"
                onClick={async () => {
                  await api(`/v1/webhooks/${h.id}`, { method: "DELETE" });
                  await hooks.reload();
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await api<{ secret: string }>("/v1/webhooks", { body: { url: hookUrl } });
              setMsg(`Webhook added. Signing secret: ${r.secret}`);
              setHookUrl("");
              await hooks.reload();
            }}
          >
            <input style={{ flex: 1 }} type="url" placeholder="https://your-system.com/leksy" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} required />
            <button className="btn">Add</button>
          </form>
        </div>
      </div>
      <div className="card stack" style={{ marginTop: 14 }}>
        <h2>Stores</h2>
        <table className="t">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>City</th>
              <th>Manager mobile (gets low-score alerts)</th>
              <th>Manager email</th>
            </tr>
          </thead>
          <tbody>
            {stores.data?.stores.map((s) => (
              <tr key={s.id}>
                <td className="mono">{s.code}</td>
                <td>{s.name}</td>
                <td>{s.city ?? "–"}</td>
                <td>{s.managerPhone ?? "–"}</td>
                <td>{s.managerEmail ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            await api("/v1/stores", { body: { ...store, city: store.city || null, managerPhone: store.managerPhone || null, managerEmail: store.managerEmail || null } });
            setStore({ code: "", name: "", city: "", managerPhone: "", managerEmail: "" });
            await stores.reload();
          }}
        >
          {(
            [
              ["code", "Code"],
              ["name", "Name"],
              ["city", "City"],
              ["managerPhone", "+91…"],
              ["managerEmail", "manager@…"],
            ] as const
          ).map(([k, p]) => (
            <input key={k} placeholder={p} value={store[k]} onChange={(e) => setStore({ ...store, [k]: e.target.value })} required={k === "code" || k === "name"} />
          ))}
          <button className="btn">Add store</button>
        </form>
      </div>
    </Shell>
  );
}
