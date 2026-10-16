"use client";
import { useMemo, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { Shell } from "@/components/Shell";
import { api, auth, DEMO, dt } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Role = "owner" | "admin" | "manager" | "viewer";
interface Member {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  storeCodes: string[] | null;
  createdAt: string;
  you?: boolean;
}
interface Invite {
  id: string;
  email: string;
  name: string | null;
  role: Exclude<Role, "owner">;
  storeCodes: string[] | null;
  expiresAt: string;
  createdAt: string;
}
interface Store {
  code: string;
  name: string;
  city: string | null;
}

const ROLES: Record<Exclude<Role, "owner">, { label: string; what: string }> = {
  manager: { label: "Store manager", what: "Bills, Project WOW tickets, the dashboard and Insights for their stores. Can send bills for those stores." },
  viewer: { label: "Viewer", what: "Read-only dashboard, Insights, bills and feedback, for every store or the ones you choose." },
  admin: { label: "Admin", what: "Everything: templates, surveys, integrations, triggers, settings and the team (except other admins)." },
};
const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", manager: "Store manager", viewer: "Viewer" };

/** Pick stores from a long list: search, tick, and see the choice as chips. */
function StorePicker({ stores, value, onChange, allowAll }: { stores: Store[]; value: string[]; onChange: (v: string[]) => void; allowAll: boolean }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? stores.filter((x) => `${x.code} ${x.name} ${x.city ?? ""}`.toLowerCase().includes(s)) : stores;
  }, [q, stores]);
  const set = new Set(value);
  const toggle = (code: string) => onChange(set.has(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <div className="store-pick">
      <div className="spread small">
        <span className="muted">{value.length ? `${value.length} of ${stores.length} stores` : allowAll ? "All stores" : "Choose at least one store"}</span>
        {value.length > 0 && (
          <button type="button" className="btn sm" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
      <input placeholder="Search stores or cities" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stores" />
      <div className="store-pick-list" role="group" aria-label="Stores">
        {shown.map((s) => (
          <label key={s.code} className="store-pick-row">
            <input type="checkbox" checked={set.has(s.code)} onChange={() => toggle(s.code)} />
            <span>{s.name}</span>
            <span className="muted small mono">{s.code}</span>
          </label>
        ))}
        {!shown.length && <div className="small muted">No store matches “{q}”.</div>}
      </div>
    </div>
  );
}

function storesText(codes: string[] | null, byCode: Map<string, Store>) {
  if (!codes?.length) return "All stores";
  const names = codes.map((c) => byCode.get(c)?.name ?? c);
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3} more` : names.join(", ");
}

export default function Team() {
  const team = useApi<{ members: Member[]; invites: Invite[] }>("/v1/team");
  const storeList = useApi<{ stores: Store[] }>("/v1/stores");
  const stores = storeList.data?.stores ?? [];
  const byCode = useMemo(() => new Map(stores.map((s) => [s.code, s])), [stores]);
  const isOwner = auth.role === "owner";
  const [form, setForm] = useState<{ email: string; name: string; role: Exclude<Role, "owner">; storeCodes: string[] }>({ email: "", name: "", role: "manager", storeCodes: [] });
  const [created, setCreated] = useState<{ email: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; role: Exclude<Role, "owner">; storeCodes: string[] } | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);

  const members = team.data?.members ?? [];
  const pending = team.data?.invites ?? [];
  const canEdit = (m: Member) => m.role !== "owner" && !m.you && (m.role !== "admin" || isOwner);
  const message = (e: unknown) => ((e as { body?: { message?: string } }).body?.message ?? (e as Error).message).replace(/_/g, " ");

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ link: string }>("/v1/team/invites", { body: { email: form.email.trim(), name: form.name.trim() || undefined, role: form.role, storeCodes: form.role === "admin" ? undefined : form.storeCodes } });
      setCreated({ email: form.email.trim().toLowerCase(), link: r.link });
      setCopied(false);
      setForm({ email: "", name: "", role: form.role, storeCodes: [] });
      await team.reload();
    } catch (er) {
      setErr(message(er));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Shell>
      <PageHero
        kicker="Team"
        title="Who works in Leksy"
        sub="Invite store managers and viewers by link. Managers see only their stores; changes take effect at once."
        stats={[
          { value: String(members.length), label: "members" },
          { value: String(members.filter((m) => m.role === "manager").length), label: "store managers" },
          { value: String(pending.length), label: "invites waiting" },
        ]}
      />

      <div className="grid two team-grid">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Members</h2>
          {team.error && <div className="err">{team.error}</div>}
          <table className="t stack">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Stores</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) =>
                editing?.id === m.id ? (
                  <tr key={m.id}>
                    <td colSpan={4}>
                      <div className="stack">
                        <b>{m.name ?? m.email}</b>
                        <div className="seg" role="radiogroup" aria-label="Role">
                          {(["manager", "viewer", ...(isOwner ? (["admin"] as const) : [])] as const).map((r) => (
                            <button key={r} type="button" className={editing.role === r ? "on" : ""} onClick={() => setEditing({ ...editing, role: r })}>
                              {ROLES[r].label}
                            </button>
                          ))}
                        </div>
                        {editing.role !== "admin" && <StorePicker stores={stores} value={editing.storeCodes} onChange={(v) => setEditing({ ...editing, storeCodes: v })} allowAll={editing.role === "viewer"} />}
                        {rowErr && <div className="err">{rowErr}</div>}
                        <div className="row">
                          <button
                            className="btn primary sm"
                            onClick={async () => {
                              setRowErr(null);
                              try {
                                await api(`/v1/team/members/${m.id}`, { method: "PATCH", body: { role: editing.role, storeCodes: editing.role === "admin" || !editing.storeCodes.length ? null : editing.storeCodes } });
                                setEditing(null);
                                await team.reload();
                              } catch (er) {
                                setRowErr(message(er));
                              }
                            }}
                          >
                            Save
                          </button>
                          <button className="btn sm" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={m.id}>
                    <td>
                      <b>{m.name ?? m.email.split("@")[0]}</b>
                      {m.you && <span className="badge" style={{ marginLeft: 6 }}>you</span>}
                      <div className="small muted">{m.email}</div>
                    </td>
                    <td>
                      <span className={`badge role-${m.role}`}>{ROLE_LABEL[m.role]}</span>
                    </td>
                    <td className="small">{m.role === "owner" || m.role === "admin" ? "All stores" : storesText(m.storeCodes, byCode)}</td>
                    <td className="nowrap">
                      {canEdit(m) && (
                        <>
                          <button
                            className="btn sm"
                            onClick={() => {
                              setRowErr(null);
                              setEditing({ id: m.id, role: m.role as Exclude<Role, "owner">, storeCodes: m.storeCodes ?? [] });
                            }}
                          >
                            Change
                          </button>{" "}
                          <button
                            className="btn sm danger"
                            onClick={async () => {
                              if (!confirm(`Remove ${m.name ?? m.email}? They lose access straight away.`)) return;
                              try {
                                await api(`/v1/team/members/${m.id}`, { method: "DELETE" });
                                await team.reload();
                              } catch (er) {
                                alert(message(er));
                              }
                            }}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>

          {pending.length > 0 && (
            <>
              <h3 style={{ margin: "8px 0 0" }}>Waiting to join</h3>
              <table className="t stack">
                <tbody>
                  {pending.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <b>{i.name ?? i.email}</b>
                        <div className="small muted">{i.email}</div>
                      </td>
                      <td>
                        <span className={`badge role-${i.role}`}>{ROLE_LABEL[i.role]}</span>
                      </td>
                      <td className="small">
                        {i.role === "admin" ? "All stores" : storesText(i.storeCodes, byCode)}
                        <div className="muted">Link expires {dt(i.expiresAt)}</div>
                      </td>
                      <td className="nowrap">
                        <button
                          className="btn sm"
                          title="Make a fresh link (the old one stops working)"
                          onClick={async () => {
                            try {
                              const r = await api<{ link: string }>("/v1/team/invites", { body: { email: i.email, name: i.name ?? undefined, role: i.role, storeCodes: i.storeCodes ?? undefined } });
                              setCreated({ email: i.email, link: r.link });
                              setCopied(false);
                              await team.reload();
                            } catch (er) {
                              alert(message(er));
                            }
                          }}
                        >
                          New link
                        </button>{" "}
                        <button
                          className="btn sm danger"
                          onClick={async () => {
                            await api(`/v1/team/invites/${i.id}`, { method: "DELETE" });
                            await team.reload();
                          }}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="stack">
          <form className="card stack" onSubmit={sendInvite}>
            <h2 style={{ margin: 0 }}>Invite someone</h2>
            <label className="f">
              Work email
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="priya@yourbrand.in" />
            </label>
            <label className="f">
              Name (optional)
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Priya Sharma" />
            </label>
            <div className="team-field">
              <span className="team-label">Role</span>
              <div className="seg" role="radiogroup" aria-label="Role">
                {(["manager", "viewer", ...(isOwner ? (["admin"] as const) : [])] as const).map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={form.role === r} className={form.role === r ? "on" : ""} onClick={() => setForm({ ...form, role: r })}>
                    {ROLES[r].label}
                  </button>
                ))}
              </div>
              <span className="small muted">{ROLES[form.role].what}</span>
            </div>
            {form.role !== "admin" && (
              <div className="team-field">
                <span className="team-label">{form.role === "manager" ? "Their stores" : "Limit to stores (optional)"}</span>
                <StorePicker stores={stores} value={form.storeCodes} onChange={(v) => setForm({ ...form, storeCodes: v })} allowAll={form.role === "viewer"} />
              </div>
            )}
            {err && <div className="err">{err}</div>}
            <button className="btn primary" disabled={busy || !form.email || (form.role === "manager" && !form.storeCodes.length)}>
              {busy ? "Creating…" : "Create invite link"}
            </button>
          </form>

          {created && (
            <div className="card stack invite-ready" role="status">
              <h3 style={{ margin: 0 }}>Invite ready for {created.email}</h3>
              <div className="small muted">{DEMO ? "In this demo nothing is emailed: open or share the link yourself." : "We have emailed it. You can also send the link yourself."} It works once and expires in 7 days.</div>
              <input readOnly className="mono" value={created.link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
              <div className="row">
                <button className="btn primary sm" onClick={() => void copy(created.link)}>
                  {copied ? "Copied" : "Copy link"}
                </button>
                <a className="btn sm" href={`https://wa.me/?text=${encodeURIComponent(`Join our team on Leksy: ${created.link}`)}`} target="_blank" rel="noopener noreferrer">
                  Send on WhatsApp
                </a>
              </div>
            </div>
          )}

          <div className="card stack">
            <h3 style={{ margin: 0 }}>What each role can do</h3>
            {(["admin", "manager", "viewer"] as const).map((r) => (
              <div key={r} className="small">
                <span className={`badge role-${r}`}>{ROLES[r].label}</span> <span className="muted">{ROLES[r].what}</span>
              </div>
            ))}
            <div className="small muted">Only the owner can add or remove admins. Nobody can change their own access.</div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
