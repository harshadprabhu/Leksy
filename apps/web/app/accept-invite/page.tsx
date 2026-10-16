"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LeksyLogo } from "@/components/LeksyLogo";
import { api, auth, DEMO } from "@/lib/api";

interface InviteInfo {
  brand: string;
  logoUrl: string | null;
  email: string;
  name: string | null;
  role: "admin" | "manager" | "viewer";
  storeCodes: string[] | null;
}

const ROLE_TEXT = { admin: "an admin", manager: "a store manager", viewer: "a viewer" } as const;

/** Where an invitation link lands: choose a name and password, and you're in. */
function Accept() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return setErr("This invitation link is incomplete. Ask for a new one.");
    api<InviteInfo>(`/v1/invites/${encodeURIComponent(token)}`)
      .then((i) => {
        setInfo(i);
        setName(i.name ?? "");
      })
      .catch(() => setErr("This invitation has expired or was already used. Ask your admin for a new link."));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setErr("The two passwords are different.");
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ token: string }>(`/v1/invites/${encodeURIComponent(token)}/accept`, { body: { name: name.trim(), password } });
      if (!DEMO) auth.set(r.token);
      router.replace("/");
    } catch (er) {
      setErr((er as { body?: { message?: string } }).body?.message ?? "Could not join. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <div style={{ textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {info?.logoUrl ? <img src={info.logoUrl} alt={info.brand} style={{ maxHeight: 64, maxWidth: 200, objectFit: "contain" }} /> : <LeksyLogo height={40} />}
        </div>
        {info ? (
          <>
            <h2 style={{ margin: 0, textAlign: "center" }}>Join {info.brand}</h2>
            <p className="small muted" style={{ margin: 0, textAlign: "center" }}>
              You&apos;ve been invited as {ROLE_TEXT[info.role]}
              {info.role !== "admin" && info.storeCodes?.length ? ` for ${info.storeCodes.length === 1 ? "1 store" : `${info.storeCodes.length} stores`}` : ""}.
            </p>
            <label className="f">
              Email
              <input value={info.email} readOnly />
            </label>
            <label className="f">
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </label>
            <label className="f">
              Choose a password (10+ characters)
              <input type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
            </label>
            <label className="f">
              Type it again
              <input type="password" minLength={10} value={again} onChange={(e) => setAgain(e.target.value)} required autoComplete="new-password" />
            </label>
            {err && <div className="err">{err}</div>}
            <button className="btn primary" disabled={busy}>
              {busy ? "Joining…" : "Join the team"}
            </button>
          </>
        ) : (
          <div className={err ? "err" : "muted"} style={{ textAlign: "center" }}>
            {err ?? "Checking your invitation…"}
          </div>
        )}
        <div className="small muted" style={{ textAlign: "center" }}>
          Powered by <LeksyLogo height={14} />
        </div>
      </form>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}
