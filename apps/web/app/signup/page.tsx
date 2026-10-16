"use client";
import Link from "next/link";
import { LeksyLogo } from "@/components/LeksyLogo";
import { useState } from "react";
import { api, auth } from "@/lib/api";

interface SignupResult {
  token: string;
  apiKey: string;
  signingSecret: string;
  ingestKey: string;
}

export default function Signup() {
  const [form, setForm] = useState({ brandName: "", email: "", password: "", storeCode: "MAIN", storeName: "" });
  const [done, setDone] = useState<SignupResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  if (done)
    return (
      <div className="auth">
        <div className="card stack" style={{ maxWidth: 520 }}>
          <h2>Your brand is ready</h2>
          <p className="muted">Copy your API key now. It is shown only once.</p>
          <label className="f">
            API key
            <input readOnly value={done.apiKey} className="mono" onFocus={(e) => e.target.select()} />
          </label>
          <Link className="btn primary" href="/">
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  return (
    <div className="auth">
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            const r = await api<SignupResult>("/v1/auth/signup", { body: { ...form, storeName: form.storeName || undefined } });
            auth.set(r.token);
            setDone(r);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <div style={{ textAlign: "center" }}>
          <LeksyLogo height={44} />
        </div>
        <h2>Create your Leksy account</h2>
        <label className="f">
          Brand name
          <input value={form.brandName} onChange={set("brandName")} required />
        </label>
        <label className="f">
          Work email
          <input type="email" value={form.email} onChange={set("email")} required />
        </label>
        <label className="f">
          Password (10+ characters)
          <input type="password" minLength={10} value={form.password} onChange={set("password")} required />
        </label>
        <div className="row">
          <label className="f" style={{ flex: 1 }}>
            First store code
            <input value={form.storeCode} onChange={set("storeCode")} required />
          </label>
          <label className="f" style={{ flex: 2 }}>
            Store name
            <input value={form.storeName} onChange={set("storeName")} />
          </label>
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary">Create account</button>
      </form>
    </div>
  );
}
