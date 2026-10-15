"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { api, dt } from "@/lib/api";
import { useApi } from "@/lib/useApi";

interface Row {
  id: string;
  key: string;
  name: string;
  publishedVersion: number | null;
  updatedAt: string;
}

export default function Templates() {
  const router = useRouter();
  const { data, error } = useApi<{ templates: Row[] }>("/v1/templates");
  const { data: presets } = useApi<{ presets: { key: string; name: string }[] }>("/v1/templates/presets");
  const [name, setName] = useState("");
  const [from, setFrom] = useState("luxe-gold");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Shell>
      <div className="head">
        <div>
          <h1>Template Studio</h1>
          <div className="muted">Design how your bills look. No code: drag blocks, pick fields, publish.</div>
        </div>
      </div>
      <div className="grid two">
        <div className="card">
          <h2>Your templates</h2>
          {error && <div className="err">{error}</div>}
          <table className="t">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key (used in triggers)</th>
                <th>Live version</th>
                <th>Edited</th>
              </tr>
            </thead>
            <tbody>
              {data?.templates.map((t) => (
                <tr key={t.id} className="click" onClick={() => router.push(`/studio/${t.id}`)}>
                  <td>
                    <Link href={`/studio/${t.id}`}>{t.name}</Link>
                  </td>
                  <td className="mono">{t.key}</td>
                  <td>{t.publishedVersion ? <span className="badge good">v{t.publishedVersion}</span> : <span className="badge">draft</span>}</td>
                  <td className="muted">{dt(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "template";
            try {
              const r = await api<{ id: string }>("/v1/templates", { body: { key, name, from } });
              router.push(`/studio/${r.id}`);
            } catch (e) {
              setErr((e as Error).message === "key_in_use" ? "A template with this name already exists." : (e as Error).message);
            }
          }}
        >
          <h2>New template</h2>
          <label className="f">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali 2026 luxe" required />
          </label>
          <label className="f">
            Start from
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {presets?.presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {err && <div className="err">{err}</div>}
          <button className="btn primary">Create and open</button>
        </form>
      </div>
    </Shell>
  );
}
