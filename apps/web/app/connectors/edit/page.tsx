"use client";
import type { Mapping, Rule } from "@leksy/mapper";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";

interface Connector {
  id: string;
  name: string;
  kind: "push" | "pull";
  ingestUrl: string;
  mapping: Mapping | null;
}

interface SampleResp {
  sample: unknown;
  paths: string[];
  suggestion: Mapping | null;
  message?: string;
}

interface Preview {
  mapped: unknown;
  valid: boolean;
  errors: { path: string; message: string }[];
  warnings: { code: string; message: string }[];
}

const BILL_FIELDS: [string, string, boolean][] = [
  ["invoice_no", "Invoice number", true],
  ["store_code", "Store code", true],
  ["issued_at", "Bill date & time", true],
  ["total", "Grand total", true],
  ["round_off", "Round off", false],
  ["customer.name", "Customer name", false],
  ["customer.phone", "Customer mobile", false],
  ["customer.email", "Customer email", false],
  ["staff.id", "Staff ID", false],
  ["staff.name", "Staff name", false],
  ["notes", "Notes", false],
];

const ITEM_FIELDS: [string, string, boolean][] = [
  ["name", "Item name", true],
  ["qty", "Quantity", true],
  ["unit_price", "Unit price", true],
  ["sku", "SKU / code", false],
  ["discount", "Discount", false],
  ["amount", "Line amount", false],
  ["hsn", "HSN", false],
  ["category", "Category", false],
  ["image_url", "Image URL", false],
  ["jewellery.purity", "Purity (22K…)", false],
  ["jewellery.huid", "HUID", false],
  ["jewellery.gross_wt_g", "Gross weight (g)", false],
  ["jewellery.net_wt_g", "Net weight (g)", false],
  ["jewellery.making_charges", "Making charges", false],
];

const TRANSFORMS = [
  ["", "as is"],
  ["number", "number"],
  ["phone", "mobile → +91…"],
  ["date", "date (auto)"],
  ["upper", "UPPERCASE"],
  ["trim", "trim spaces"],
] as const;

type Simple = { from: string; fn: string; constant?: string };

function toSimple(rule: Rule | undefined): Simple {
  if (!rule) return { from: "", fn: "" };
  if (typeof rule === "string") return { from: rule, fn: "" };
  if (rule.value !== undefined) return { from: "", fn: "", constant: String(rule.value) };
  return { from: rule.from ?? "", fn: rule.transform?.[0]?.fn ?? "" };
}

function fromSimple(s: Simple): Rule | undefined {
  if (s.constant !== undefined) return { value: isNaN(Number(s.constant)) || s.constant === "" ? s.constant : Number(s.constant) };
  if (!s.from) return undefined;
  if (!s.fn) return s.from;
  return { from: s.from, transform: [{ fn: s.fn as "number", ...(s.fn === "phone" ? { arg: "91" } : s.fn === "date" ? { arg: "auto" } : {}) }] };
}

/** Map any JSON a store system sends onto Leksy's bill, with a live check. */
export default function MapperPage() {
  return (
    <Suspense>
      <Mapper />
    </Suspense>
  );
}

function Mapper() {
  const id = useSearchParams().get("id") ?? "";
  const [c, setC] = useState<Connector | null>(null);
  const [sample, setSample] = useState<SampleResp | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [raw, setRaw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const loadSample = async () => {
    setMsg("Fetching a sample…");
    try {
      const s = await api<SampleResp>(`/v1/connectors/${id}/sample`, { body: {} });
      setSample(s);
      setMsg(s.message ?? null);
      return s;
    } catch (e) {
      setMsg((e as Error).message);
      return null;
    }
  };

  useEffect(() => {
    void (async () => {
      const list = await api<{ connectors: Connector[] }>("/v1/connectors");
      const conn = list.connectors.find((x) => x.id === id) ?? null;
      setC(conn);
      const s = await loadSample();
      setMapping(conn?.mapping ?? s?.suggestion ?? {});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!sample?.sample) return;
    const t = setTimeout(() => {
      void api<Preview>("/v1/mapping/preview", { body: { mapping, sample: sample.sample } }).then(setPreview).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [mapping, sample]);

  const itemsRule = mapping.items && typeof mapping.items === "object" && "each" in mapping.items ? mapping.items.each : undefined;
  const topPaths = useMemo(() => (sample?.paths ?? []).filter((p) => !p.includes("[0]")), [sample]);
  const arrays = useMemo(() => {
    const s = sample?.sample as Record<string, unknown> | undefined;
    return s ? Object.keys(s).filter((k) => Array.isArray(s[k])) : [];
  }, [sample]);
  const itemPaths = useMemo(() => {
    if (!itemsRule) return [];
    const prefix = `${itemsRule.from}[0].`;
    return (sample?.paths ?? []).filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
  }, [sample, itemsRule]);

  const setTop = (target: string, s: Simple) => {
    const next = { ...mapping };
    const r = fromSimple(s);
    if (r === undefined) delete next[target];
    else next[target] = r;
    setMapping(next);
  };
  const setItem = (target: string, s: Simple) => {
    if (!itemsRule) return;
    const fields = { ...itemsRule.fields };
    const r = fromSimple(s);
    if (r === undefined) delete fields[target];
    else fields[target] = r;
    setMapping({ ...mapping, items: { each: { ...itemsRule, fields } } });
  };

  const save = async () => {
    let m = mapping;
    if (advanced) {
      try {
        m = JSON.parse(raw) as Mapping;
        setMapping(m);
      } catch {
        setMsg("Advanced mapping is not valid JSON");
        return;
      }
    }
    await api(`/v1/connectors/${id}`, { method: "PUT", body: { mapping: m } });
    setMsg("Mapping saved. New bills from this source will now be sent.");
  };

  if (!c) return <Shell>{msg ?? "Loading…"}</Shell>;

  return (
    <Shell>
      <div className="head">
        <div>
          <Link href="/connectors" className="small muted">
            ← Integrations
          </Link>
          <h1>{c.name}: field mapping</h1>
          <div className="muted">Match each Leksy field to a field from your system. The check on the right updates as you go.</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void loadSample()}>
            {c.kind === "pull" ? "Fetch a fresh sample" : "Reload sample"}
          </button>
          {sample?.suggestion && (
            <button className="btn" onClick={() => setMapping(sample.suggestion!)}>
              Use suggested mapping
            </button>
          )}
          <button className="btn primary" onClick={() => void save()} disabled={!preview?.valid && !advanced}>
            Save mapping
          </button>
        </div>
      </div>
      {msg && <div className="card small" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="card small" style={{ marginBottom: 12 }}>
        {c.kind === "push" ? "Your system sends bills to " : "Your system can ping "}
        <span className="mono">{c.ingestUrl}</span>
        {c.kind === "push" ? " (POST, any JSON: one bill or an array)." : " to make Leksy fetch now."}
      </div>
      {!sample?.sample ? (
        <div className="card empty">No sample yet. {c.kind === "push" ? "Send one bill from your system to the URL above, then reload." : "Check the API URL and auth."}</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
          <div className="card stack">
            <div className="spread">
              <h2 style={{ margin: 0 }}>Bill fields</h2>
              <label className="row small">
                <input
                  type="checkbox"
                  checked={advanced}
                  onChange={(e) => {
                    setAdvanced(e.target.checked);
                    setRaw(JSON.stringify(mapping, null, 2));
                  }}
                />
                Advanced (JSON)
              </label>
            </div>
            {advanced ? (
              <textarea className="mono" rows={28} value={raw} onChange={(e) => setRaw(e.target.value)} />
            ) : (
              <>
                {BILL_FIELDS.map(([target, label, req]) => (
                  <MapRow key={target} label={label} required={req} paths={topPaths} value={toSimple(mapping[target])} onChange={(s) => setTop(target, s)} />
                ))}
                <div className="sect stack">
                  <div className="spread">
                    <h3>Items</h3>
                    <label className="f" style={{ flexDirection: "row", alignItems: "center" }}>
                      List in your data:&nbsp;
                      <select
                        value={itemsRule?.from ?? ""}
                        onChange={(e) => setMapping({ ...mapping, items: { each: { from: e.target.value, fields: itemsRule?.fields ?? {} } } })}
                      >
                        <option value="">choose…</option>
                        {arrays.map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {itemsRule &&
                    ITEM_FIELDS.map(([target, label, req]) => (
                      <MapRow key={target} label={label} required={req} paths={itemPaths} value={toSimple(itemsRule.fields[target])} onChange={(s) => setItem(target, s)} />
                    ))}
                </div>
                {mapping.taxes !== undefined && <div className="small muted">Tax lines are mapped too (edit them under Advanced).</div>}
              </>
            )}
          </div>
          <div className="stack">
            <div className="card">
              <h2>Check</h2>
              {preview ? (
                preview.valid ? (
                  <div className="stack">
                    <span className="badge good">Ready: this sample makes a valid bill</span>
                    {preview.warnings.map((w) => (
                      <div key={w.code} className="small">
                        <span className="badge warn">{w.code}</span> {w.message}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="stack">
                    <span className="badge bad">Not ready yet</span>
                    {preview.errors.slice(0, 10).map((e, i) => (
                      <div key={i} className="small">
                        <span className="mono">{e.path || "(bill)"}</span>: {e.message}
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <span className="muted">…</span>
              )}
            </div>
            <div className="card">
              <h3>Your sample</h3>
              <pre className="code" style={{ maxHeight: 260 }}>{JSON.stringify(sample.sample, null, 2)}</pre>
            </div>
            <div className="card">
              <h3>As a Leksy bill</h3>
              <pre className="code" style={{ maxHeight: 260 }}>{JSON.stringify(preview?.mapped ?? {}, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function MapRow({ label, required, paths, value, onChange }: { label: string; required: boolean; paths: string[]; value: Simple; onChange: (s: Simple) => void }) {
  const isConst = value.constant !== undefined;
  return (
    <div className="row" style={{ display: "grid", gridTemplateColumns: "150px 1fr 130px", gap: 8 }}>
      <span className="small">
        {label}
        {required && <span style={{ color: "var(--bad)" }}> *</span>}
      </span>
      {isConst ? (
        <input value={value.constant} onChange={(e) => onChange({ ...value, constant: e.target.value })} placeholder="Fixed value" />
      ) : (
        <select value={value.from} onChange={(e) => (e.target.value === "__const" ? onChange({ from: "", fn: "", constant: "" }) : onChange({ ...value, from: e.target.value }))}>
          <option value="">not mapped</option>
          {value.from && !paths.includes(value.from) && <option value={value.from}>{value.from}</option>}
          {paths.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="__const">Fixed value…</option>
        </select>
      )}
      {isConst ? (
        <button className="btn sm" onClick={() => onChange({ from: "", fn: "" })}>
          Use a field
        </button>
      ) : (
        <select value={value.fn} onChange={(e) => onChange({ ...value, fn: e.target.value })} disabled={!value.from}>
          {TRANSFORMS.map(([fn, l]) => (
            <option key={fn} value={fn}>
              {l}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
