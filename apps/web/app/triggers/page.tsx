"use client";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Channel = "whatsapp" | "sms" | "email";
interface Cond {
  field: string;
  op: string;
  value?: string | number | boolean;
}
interface Trigger {
  id?: string;
  name: string;
  event: "bill.created" | "bill.updated";
  conditions: Cond[];
  actions: { templateKey: string; surveyKey?: string; channels: Channel[]; delaySeconds?: number; otpLock?: boolean };
  priority: number;
  enabled: boolean;
}

const FIELDS = ["total", "store_code", "customer.consent", "customer.language", "type", "items[].category", "items[].jewellery.metal", "staff.id", "loyalty.tier"];
const OPS = [
  ["gt", "more than"],
  ["lt", "less than"],
  ["eq", "equals"],
  ["neq", "is not"],
  ["contains", "contains"],
  ["exists", "has a value"],
];
const BLANK: Trigger = { name: "", event: "bill.created", conditions: [], actions: { templateKey: "luxe-gold", surveyKey: "mission-happiness", channels: ["whatsapp", "sms", "email"] }, priority: 100, enabled: true };

/** Rules that decide which template, survey and channels a bill gets. First match wins. */
export default function Triggers() {
  const { data, reload } = useApi<{ triggers: Trigger[] }>("/v1/triggers");
  const { data: tpls } = useApi<{ templates: { key: string; name: string }[] }>("/v1/templates");
  const { data: surveys } = useApi<{ surveys: { key: string; name: string }[] }>("/v1/surveys");
  const [edit, setEdit] = useState<Trigger | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!edit) return;
    setErr(null);
    try {
      const { id, ...body } = edit;
      await api(id ? `/v1/triggers/${id}` : "/v1/triggers", { method: id ? "PUT" : "POST", body: { ...body, conditions: body.conditions.map((c) => ({ ...c, value: c.value === "" ? undefined : isNaN(Number(c.value)) ? c.value : Number(c.value) })) } });
      setEdit(null);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Shell>
      <div className="head">
        <div>
          <h1>Triggers</h1>
          <div className="muted">When a bill arrives, the first matching rule (lowest priority number) decides what is sent.</div>
        </div>
        <button className="btn primary" onClick={() => setEdit(structuredClone(BLANK))}>
          New trigger
        </button>
      </div>
      <div className="grid two">
        <div className="card">
          <table className="t">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>When</th>
                <th>Send</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.triggers.map((t) => (
                <tr key={t.id} className="click" onClick={() => setEdit(structuredClone(t))}>
                  <td>{t.priority}</td>
                  <td>
                    {t.name} {!t.enabled && <span className="badge">off</span>}
                  </td>
                  <td className="small">
                    {t.event}
                    {t.conditions.map((c, i) => (
                      <div key={i} className="muted">
                        {c.field} {c.op} {String(c.value ?? "")}
                      </div>
                    ))}
                  </td>
                  <td className="small">
                    <span className="mono">{t.actions.templateKey}</span> via {t.actions.channels.join(" → ")}
                    {t.actions.otpLock && <span className="badge warn">OTP</span>}
                    {t.actions.delaySeconds ? <span className="muted"> after {t.actions.delaySeconds}s</span> : null}
                  </td>
                  <td>
                    <button
                      className="btn sm danger"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${t.name}"?`)) {
                          await api(`/v1/triggers/${t.id}`, { method: "DELETE" });
                          await reload();
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {edit && (
          <div className="card stack">
            <h2>{edit.id ? "Edit trigger" : "New trigger"}</h2>
            <label className="f">
              Name
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="High-value jewellery" />
            </label>
            <div className="row">
              <label className="f">
                Event
                <select value={edit.event} onChange={(e) => setEdit({ ...edit, event: e.target.value as Trigger["event"] })}>
                  <option value="bill.created">New bill</option>
                  <option value="bill.updated">Bill changed</option>
                </select>
              </label>
              <label className="f">
                Priority
                <input type="number" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) })} style={{ width: 90 }} />
              </label>
              <label className="row small">
                <input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> Enabled
              </label>
            </div>
            <h3>Only if (all must match)</h3>
            {edit.conditions.map((c, i) => (
              <div key={i} className="row">
                <select value={c.field} onChange={(e) => setEdit({ ...edit, conditions: edit.conditions.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}>
                  {!FIELDS.includes(c.field) && <option>{c.field}</option>}
                  {FIELDS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                <select value={c.op} onChange={(e) => setEdit({ ...edit, conditions: edit.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) })}>
                  {OPS.map(([o, l]) => (
                    <option key={o} value={o}>
                      {l}
                    </option>
                  ))}
                </select>
                {c.op !== "exists" && <input style={{ width: 120 }} value={String(c.value ?? "")} onChange={(e) => setEdit({ ...edit, conditions: edit.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />}
                <button className="btn sm" onClick={() => setEdit({ ...edit, conditions: edit.conditions.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
            ))}
            <button className="btn sm" onClick={() => setEdit({ ...edit, conditions: [...edit.conditions, { field: "total", op: "gt", value: 50000 }] })}>
              + Add condition
            </button>
            <h3>Then</h3>
            <label className="f">
              Template
              <select value={edit.actions.templateKey} onChange={(e) => setEdit({ ...edit, actions: { ...edit.actions, templateKey: e.target.value } })}>
                {tpls?.templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="f">
              Survey on the bill
              <select value={edit.actions.surveyKey ?? ""} onChange={(e) => setEdit({ ...edit, actions: { ...edit.actions, surveyKey: e.target.value || undefined } })}>
                <option value="">No survey</option>
                {surveys?.surveys.map((sv) => (
                  <option key={sv.key} value={sv.key}>
                    {sv.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="stack" style={{ gap: 4 }}>
              <span className="small muted">Channels, tried in this order until one works</span>
              <div className="row">
                {(["whatsapp", "sms", "email"] as Channel[]).map((ch) => (
                  <label key={ch} className="row small">
                    <input
                      type="checkbox"
                      checked={edit.actions.channels.includes(ch)}
                      onChange={(e) =>
                        setEdit({ ...edit, actions: { ...edit.actions, channels: e.target.checked ? [...edit.actions.channels, ch] : edit.actions.channels.filter((x) => x !== ch) } })
                      }
                    />
                    {ch}
                  </label>
                ))}
              </div>
            </div>
            <div className="row">
              <label className="f">
                Delay (seconds)
                <input type="number" min={0} value={edit.actions.delaySeconds ?? 0} onChange={(e) => setEdit({ ...edit, actions: { ...edit.actions, delaySeconds: Number(e.target.value) || undefined } })} style={{ width: 110 }} />
              </label>
              <label className="row small">
                <input type="checkbox" checked={!!edit.actions.otpLock} onChange={(e) => setEdit({ ...edit, actions: { ...edit.actions, otpLock: e.target.checked || undefined } })} /> Ask for OTP before showing the bill
              </label>
            </div>
            {err && <div className="err">{err}</div>}
            <div className="row">
              <button className="btn primary" onClick={() => void save()} disabled={!edit.name || !edit.actions.channels.length}>
                Save
              </button>
              <button className="btn" onClick={() => setEdit(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
