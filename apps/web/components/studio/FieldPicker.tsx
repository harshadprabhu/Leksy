"use client";
import { useMemo, useState } from "react";
import { useBinding } from "./binding";

export interface FieldInfo {
  path: string;
  type: string;
  sample: string;
}

const FORMATTERS = [
  ["inr", "₹ amount"],
  ["date", "date"],
  ["datetime", "date & time"],
  ["grams", "weight in g"],
  ["upper", "UPPERCASE"],
  ["title", "Title Case"],
  ["default:'-'", "fallback"],
  ["prefix:'GSTIN '", "prefix if present"],
];

/** Searchable list of the bill's fields; click inserts {{field}} where the cursor is. */
export function FieldPicker({ fields }: { fields: FieldInfo[] }) {
  const target = useBinding();
  const [q, setQ] = useState("");
  const list = useMemo(() => fields.filter((f) => f.type !== "array" && f.path.toLowerCase().includes(q.toLowerCase())), [fields, q]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input placeholder="Search fields (e.g. huid, total)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="fields">
        {list.map((f) => (
          <button key={f.path} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => target.current?.insert(f.path)} title={`Insert {{${f.path}}}`}>
            <span className="mono">{f.path}</span>
            <span>{f.sample}</span>
          </button>
        ))}
        {!list.length && <div className="empty small">No matching fields</div>}
      </div>
      <details className="small">
        <summary className="muted">Formatting: add after a field with |</summary>
        <div className="stack" style={{ gap: 2, marginTop: 6 }}>
          {FORMATTERS.map(([f, l]) => (
            <div key={f} className="spread">
              <span className="mono">{`{{total | ${f}}}`}</span>
              <span className="muted">{l}</span>
            </div>
          ))}
        </div>
      </details>
      <div className="small muted">Click a text box in the inspector, then click a field to insert it.</div>
    </div>
  );
}
