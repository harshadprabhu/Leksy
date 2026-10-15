"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, auth } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth">
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const r = await api<{ token: string }>("/v1/auth/login", { body: { email, password } });
            auth.set(r.token);
            router.replace("/");
          } catch (e) {
            setErr((e as Error).message === "invalid_credentials" ? "Email or password is wrong." : (e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="logo" style={{ padding: 0, textAlign: "center" }}>
          LEKSY<small>sign in</small>
        </div>
        <label className="f">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="f">
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" disabled={busy}>
          Sign in
        </button>
        <div className="small muted" style={{ textAlign: "center" }}>
          New brand? <Link href="/signup">Create an account</Link>
        </div>
      </form>
    </div>
  );
}
