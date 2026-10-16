"use client";
import type { Block, Condition, Style, Template } from "@leksy/template-engine";
import { BoundInput } from "./binding";
import type { FieldInfo } from "./FieldPicker";

type Props = {
  block: Block;
  fields: FieldInfo[];
  onChange: (b: Block) => void;
};

const OPS: [Condition["op"], string][] = [
  ["exists", "has a value"],
  ["not_exists", "is empty"],
  ["eq", "equals"],
  ["neq", "is not"],
  ["gt", "is more than"],
  ["lt", "is less than"],
  ["contains", "contains"],
];

/** Edit everything about one block: its content, its look, and when it shows. */
export function Inspector({ block, fields, onChange }: Props) {
  const setProps = (patch: Record<string, unknown>) => onChange({ ...block, props: { ...block.props, ...patch } } as Block);
  const setStyle = (patch: Partial<Style>) => onChange({ ...block, style: clean({ ...block.style, ...patch }) } as Block);
  return (
    <div className="stack">
      <PropsEditor block={block} setProps={setProps} />
      <div className="sect stack">
        <h3>Look</h3>
        <StyleEditor style={block.style} setStyle={setStyle} />
      </div>
      <div className="sect stack">
        <h3>Show this block</h3>
        <VisibilityEditor cond={block.visibleIf} fields={fields} onChange={(c) => onChange({ ...block, visibleIf: c } as Block)} />
      </div>
    </div>
  );
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="f">
      {label}
      {children}
    </label>
  );
}

function PropsEditor({ block, setProps }: { block: Block; setProps: (p: Record<string, unknown>) => void }) {
  switch (block.type) {
    case "heading":
      return (
        <div className="stack">
          <F label="Heading text">
            <BoundInput value={block.props.text} onChange={(text) => setProps({ text })} />
          </F>
          <F label="Size">
            <select value={block.props.level} onChange={(e) => setProps({ level: Number(e.target.value) })}>
              <option value={1}>Large</option>
              <option value={2}>Medium</option>
              <option value={3}>Small</option>
            </select>
          </F>
        </div>
      );
    case "text":
      return (
        <F label="Text (fields allowed; empty lines are hidden)">
          <BoundInput multiline value={block.props.text} onChange={(text) => setProps({ text })} />
        </F>
      );
    case "image":
      return (
        <div className="stack">
          <F label="Image URL or field">
            <BoundInput value={block.props.src} onChange={(src) => setProps({ src })} placeholder="https://… or {{brand.logo_url}}" />
          </F>
          <F label={`Width ${block.props.width}%`}>
            <input type="range" min={10} max={100} value={block.props.width} onChange={(e) => setProps({ width: Number(e.target.value) })} />
          </F>
        </div>
      );
    case "kv_list":
      return (
        <div className="stack">
          <h3>Rows</h3>
          {block.props.rows.map((r, i) => (
            <div key={i} className="kvrow">
              <input value={r.label} onChange={(e) => setProps({ rows: block.props.rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <BoundInput value={r.value} onChange={(value) => setProps({ rows: block.props.rows.map((x, j) => (j === i ? { ...x, value } : x)) })} />
              <button className="btn sm" title="Remove row" onClick={() => setProps({ rows: block.props.rows.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setProps({ rows: [...block.props.rows, { label: "Label", value: "" }] })}>
            + Add row
          </button>
          <label className="row small">
            <input type="checkbox" checked={block.props.emphasizeLast} onChange={(e) => setProps({ emphasizeLast: e.target.checked })} /> Emphasise last row
          </label>
          <div className="small muted">Rows whose fields are all empty are hidden automatically.</div>
        </div>
      );
    case "items_table":
      return (
        <div className="stack">
          <h3>Columns (one row per item)</h3>
          {block.props.columns.map((c, i) => (
            <div key={i} className="card stack" style={{ padding: 10, gap: 6 }}>
              <div className="row">
                <input style={{ flex: 1 }} value={c.label} onChange={(e) => setProps({ columns: block.props.columns.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <select value={c.align} onChange={(e) => setProps({ columns: block.props.columns.map((x, j) => (j === i ? { ...x, align: e.target.value } : x)) })}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
                <button className="btn sm" onClick={() => setProps({ columns: block.props.columns.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
              <BoundInput scope="items" value={c.value} onChange={(value) => setProps({ columns: block.props.columns.map((x, j) => (j === i ? { ...x, value } : x)) })} />
            </div>
          ))}
          <button className="btn sm" onClick={() => setProps({ columns: [...block.props.columns, { label: "Column", value: "", align: "left" }] })}>
            + Add column
          </button>
          <F label="Detail line under each item (optional)">
            <BoundInput scope="items" value={block.props.detailLine ?? ""} onChange={(detailLine) => setProps({ detailLine: detailLine || undefined })} placeholder="HUID {{jewellery.huid}}" />
          </F>
          <label className="row small">
            <input type="checkbox" checked={block.props.showHeader} onChange={(e) => setProps({ showHeader: e.target.checked })} /> Show header row
          </label>
        </div>
      );
    case "item_cards":
      return (
        <div className="stack">
          <F label="Title">
            <BoundInput scope="items" value={block.props.title} onChange={(title) => setProps({ title })} />
          </F>
          <F label="Subtitle">
            <BoundInput scope="items" value={block.props.subtitle ?? ""} onChange={(subtitle) => setProps({ subtitle })} />
          </F>
          <F label="Price">
            <BoundInput scope="items" value={block.props.price} onChange={(price) => setProps({ price })} />
          </F>
          <h3>Details on each card</h3>
          {block.props.details.map((r, i) => (
            <div key={i} className="kvrow">
              <input value={r.label} onChange={(e) => setProps({ details: block.props.details.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <BoundInput scope="items" value={r.value} onChange={(value) => setProps({ details: block.props.details.map((x, j) => (j === i ? { ...x, value } : x)) })} />
              <button className="btn sm" onClick={() => setProps({ details: block.props.details.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setProps({ details: [...block.props.details, { label: "Label", value: "" }] })}>
            + Add detail
          </button>
          <label className="row small">
            <input type="checkbox" checked={block.props.showImage} onChange={(e) => setProps({ showImage: e.target.checked })} /> Show product image
          </label>
        </div>
      );
    case "totals":
      return (
        <div className="stack">
          <F label="Grand total label">
            <input value={block.props.grandTotalLabel} onChange={(e) => setProps({ grandTotalLabel: e.target.value })} />
          </F>
          <label className="row small">
            <input type="checkbox" checked={block.props.showTaxBreakup} onChange={(e) => setProps({ showTaxBreakup: e.target.checked })} /> Show each tax (CGST, SGST…)
          </label>
          <label className="row small">
            <input type="checkbox" checked={block.props.showPayments} onChange={(e) => setProps({ showPayments: e.target.checked })} /> Show payment modes
          </label>
        </div>
      );
    case "certificates":
      return (
        <F label="Section title">
          <input value={block.props.title} onChange={(e) => setProps({ title: e.target.value })} />
        </F>
      );
    case "qr":
      return (
        <div className="stack">
          <F label="QR content">
            <BoundInput value={block.props.value} onChange={(value) => setProps({ value })} />
          </F>
          <F label="Caption">
            <BoundInput value={block.props.caption ?? ""} onChange={(caption) => setProps({ caption })} />
          </F>
          <F label={`Size ${block.props.size}px`}>
            <input type="range" min={48} max={240} value={block.props.size} onChange={(e) => setProps({ size: Number(e.target.value) })} />
          </F>
        </div>
      );
    case "button":
      return (
        <div className="stack">
          <F label="Label">
            <BoundInput value={block.props.label} onChange={(label) => setProps({ label })} />
          </F>
          <F label="Link">
            <BoundInput value={block.props.href} onChange={(href) => setProps({ href })} />
          </F>
        </div>
      );
    case "download_buttons":
      return (
        <div className="stack">
          <F label="Download button label">
            <input value={block.props.pdfLabel ?? ""} placeholder="Download PDF" onChange={(e) => setProps({ pdfLabel: e.target.value || undefined })} />
          </F>
          {(["pdf", "share", "certificates", "json"] as const).map((f) => (
            <label key={f} className="row small">
              <input
                type="checkbox"
                checked={block.props.formats.includes(f)}
                onChange={(e) => setProps({ formats: e.target.checked ? [...block.props.formats, f] : block.props.formats.filter((x) => x !== f) })}
              />
              {f === "pdf" ? "Download PDF" : f === "share" ? "Share (WhatsApp, Mail…)" : f === "certificates" ? "View certificates (when the bill has some)" : "Data (JSON)"}
            </label>
          ))}
        </div>
      );
    case "survey":
      return (
        <div className="stack">
          <F label="Survey title">
            <BoundInput value={block.props.title} onChange={(title) => setProps({ title })} />
          </F>
          <div className="small muted">Questions come from the survey chosen in the trigger (Project WOW by default).</div>
        </div>
      );
    case "social_links":
      return (
        <div className="stack">
          <div className="row">
            <F label="Title">
              <BoundInput value={block.props.title ?? ""} onChange={(title) => setProps({ title: title || undefined })} />
            </F>
            <F label="Show as">
              <select value={block.props.style} onChange={(e) => setProps({ style: e.target.value })}>
                <option value="icons">Icons</option>
                <option value="text">Text links</option>
              </select>
            </F>
          </div>
          {block.props.links.map((l, i) => (
            <div key={i} className="kvrow">
              <input value={l.label} onChange={(e) => setProps({ links: block.props.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <input value={l.href} onChange={(e) => setProps({ links: block.props.links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)) })} />
              <button className="btn sm" onClick={() => setProps({ links: block.props.links.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setProps({ links: [...block.props.links, { label: "Link", href: "https://" }] })}>
            + Add link
          </button>
        </div>
      );
    case "divider":
      return (
        <div className="row">
          <F label="Line">
            <select value={block.props.style} onChange={(e) => setProps({ style: e.target.value })}>
              {["solid", "dashed", "dotted", "double", "ornament"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </F>
          <F label="Thickness">
            <input type="number" min={0.5} max={8} step={0.5} value={block.props.thickness} onChange={(e) => setProps({ thickness: Number(e.target.value) })} />
          </F>
        </div>
      );
    case "banner_carousel": {
      const slides = block.props.slides;
      const setSlide = (i: number, patch: Record<string, unknown>) => setProps({ slides: slides.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
      return (
        <div className="stack">
          <F label={`Autoplay ${block.props.autoplay ? `${block.props.autoplay}s` : "off"}`}>
            <input type="range" min={0} max={15} value={block.props.autoplay} onChange={(e) => setProps({ autoplay: Number(e.target.value) })} />
          </F>
          {slides.map((sl, i) => (
            <div key={i} className="sect stack">
              <div className="spread small">
                <b>Banner {i + 1}</b>
                <button className="btn sm" disabled={slides.length < 2} onClick={() => setProps({ slides: slides.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </div>
              <F label="Image (optional — replaces the designed banner)">
                <BoundInput value={sl.image ?? ""} onChange={(image) => setSlide(i, { image: image || undefined })} />
              </F>
              <F label="Small line">
                <BoundInput value={sl.kicker ?? ""} onChange={(kicker) => setSlide(i, { kicker: kicker || undefined })} />
              </F>
              <F label="Title">
                <BoundInput value={sl.title} onChange={(title) => setSlide(i, { title })} />
              </F>
              <F label="Subtitle">
                <BoundInput value={sl.subtitle ?? ""} onChange={(subtitle) => setSlide(i, { subtitle: subtitle || undefined })} />
              </F>
              <div className="row">
                <F label="Button">
                  <BoundInput value={sl.cta ?? ""} onChange={(cta) => setSlide(i, { cta: cta || undefined })} />
                </F>
                <F label="Link">
                  <BoundInput value={sl.href ?? ""} onChange={(href) => setSlide(i, { href: href || undefined })} />
                </F>
              </div>
              <div className="row">
                <F label="Colour">
                  <ColorInput value={sl.background} onChange={(background) => setSlide(i, { background })} />
                </F>
                <F label="Fade to">
                  <ColorInput value={sl.background2} onChange={(background2) => setSlide(i, { background2 })} />
                </F>
                <F label="Text">
                  <ColorInput value={sl.color} onChange={(color) => setSlide(i, { color })} />
                </F>
                <F label="Art">
                  <select value={sl.art} onChange={(e) => setSlide(i, { art: e.target.value })}>
                    {["diamond", "ring", "gift", "star", "coin", "none"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </F>
              </div>
            </div>
          ))}
          <button className="btn sm" disabled={slides.length >= 8} onClick={() => setProps({ slides: [...slides, { title: "New offer", art: "star" }] })}>
            + Add banner
          </button>
        </div>
      );
    }
    case "video_card":
      return (
        <div className="stack">
          <F label="Title">
            <BoundInput value={block.props.title} onChange={(title) => setProps({ title })} />
          </F>
          <F label="Subtitle">
            <BoundInput value={block.props.subtitle ?? ""} onChange={(subtitle) => setProps({ subtitle: subtitle || undefined })} />
          </F>
          <F label="Video or channel link">
            <BoundInput value={block.props.href} onChange={(href) => setProps({ href })} />
          </F>
          <F label="Thumbnail image (optional)">
            <BoundInput value={block.props.thumbnail ?? ""} onChange={(thumbnail) => setProps({ thumbnail: thumbnail || undefined })} />
          </F>
        </div>
      );
    case "accordion":
      return (
        <div className="stack">
          {block.props.items.map((it, i) => (
            <div key={i} className="sect stack">
              <div className="spread">
                <input value={it.title} onChange={(e) => setProps({ items: block.props.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                <button className="btn sm" disabled={block.props.items.length < 2} onClick={() => setProps({ items: block.props.items.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
              <textarea rows={4} value={it.body} onChange={(e) => setProps({ items: block.props.items.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
            </div>
          ))}
          <button className="btn sm" disabled={block.props.items.length >= 12} onClick={() => setProps({ items: [...block.props.items, { title: "Section", body: "" }] })}>
            + Add section
          </button>
        </div>
      );
    case "contact_bar":
      return (
        <div className="stack">
          <F label="Phone">
            <BoundInput value={block.props.phone} onChange={(phone) => setProps({ phone })} />
          </F>
          <div className="row">
            <F label="Button">
              <input value={block.props.label} onChange={(e) => setProps({ label: e.target.value })} />
            </F>
            <F label="Seal">
              <input value={block.props.seal} onChange={(e) => setProps({ seal: e.target.value })} />
            </F>
          </div>
          <div className="small muted">Stays at the bottom of the customer&apos;s phone screen.</div>
        </div>
      );
    case "spacer":
      return (
        <F label={`Height ${block.props.height}px`}>
          <input type="range" min={0} max={160} value={block.props.height} onChange={(e) => setProps({ height: Number(e.target.value) })} />
        </F>
      );
    case "columns":
      return (
        <div className="stack">
          <F label="Columns">
            <select
              value={block.props.columns.length}
              onChange={(e) => {
                const n = Number(e.target.value);
                const cols = block.props.columns.slice(0, n);
                while (cols.length < n) cols.push([]);
                // Blocks in removed columns move into the last remaining one.
                const dropped = block.props.columns.slice(n).flat();
                cols[n - 1] = [...cols[n - 1]!, ...dropped];
                setProps({ columns: cols });
              }}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </F>
          <F label={`Gap ${block.props.gap}px`}>
            <input type="range" min={0} max={48} value={block.props.gap} onChange={(e) => setProps({ gap: Number(e.target.value) })} />
          </F>
          <div className="small muted">Select a column in Layers, then add blocks to place them inside it.</div>
        </div>
      );
  }
}

function StyleEditor({ style, setStyle }: { style: Style; setStyle: (s: Partial<Style>) => void }) {
  return (
    <div className="stack">
      <div className="spread">
        <span className="small muted">Align</span>
        <div className="seg">
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} className={style.align === a ? "on" : ""} onClick={() => setStyle({ align: style.align === a ? undefined : a })}>
              {a === "left" ? "⟸" : a === "center" ? "≡" : "⟹"}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <F label="Text colour">
          <ColorInput value={style.color} onChange={(color) => setStyle({ color })} />
        </F>
        <F label="Background">
          <ColorInput value={style.background} onChange={(background) => setStyle({ background })} />
        </F>
        <F label="Border">
          <ColorInput value={style.border} onChange={(border) => setStyle({ border })} />
        </F>
      </div>
      <div className="row">
        <F label="Font size">
          <input type="number" min={6} max={96} style={{ width: 70 }} value={style.fontSize ?? ""} onChange={(e) => setStyle({ fontSize: e.target.value ? Number(e.target.value) : undefined })} />
        </F>
        <F label="Weight">
          <select value={style.fontWeight ?? ""} onChange={(e) => setStyle({ fontWeight: (e.target.value || undefined) as Style["fontWeight"] })}>
            <option value="">Default</option>
            <option value="300">Light</option>
            <option value="400">Regular</option>
            <option value="500">Medium</option>
            <option value="600">Semibold</option>
            <option value="700">Bold</option>
          </select>
        </F>
        <F label="Font">
          <select value={style.fontFamily ?? ""} onChange={(e) => setStyle({ fontFamily: e.target.value || undefined })}>
            <option value="">Page font</option>
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </F>
      </div>
      <div className="row">
        <F label="Padding Y">
          <input type="number" min={0} max={120} style={{ width: 64 }} value={style.paddingY ?? ""} onChange={(e) => setStyle({ paddingY: e.target.value ? Number(e.target.value) : undefined })} />
        </F>
        <F label="Padding X">
          <input type="number" min={0} max={120} style={{ width: 64 }} value={style.paddingX ?? ""} onChange={(e) => setStyle({ paddingX: e.target.value ? Number(e.target.value) : undefined })} />
        </F>
        <F label="Space above">
          <input type="number" min={0} max={200} style={{ width: 64 }} value={style.marginTop ?? ""} onChange={(e) => setStyle({ marginTop: e.target.value ? Number(e.target.value) : undefined })} />
        </F>
        <F label="Corners">
          <input type="number" min={0} max={48} style={{ width: 64 }} value={style.radius ?? ""} onChange={(e) => setStyle({ radius: e.target.value ? Number(e.target.value) : undefined })} />
        </F>
      </div>
      <div className="row small">
        <label className="row">
          <input type="checkbox" checked={!!style.bleed} onChange={(e) => setStyle({ bleed: e.target.checked || undefined })} /> Edge to edge
        </label>
        <label className="row">
          <input type="checkbox" checked={!!style.italic} onChange={(e) => setStyle({ italic: e.target.checked || undefined })} /> Italic
        </label>
        <label className="row">
          <input type="checkbox" checked={!!style.uppercase} onChange={(e) => setStyle({ uppercase: e.target.checked || undefined })} /> Uppercase
        </label>
        <F label="Letter spacing">
          <input type="number" min={-2} max={20} step={0.5} style={{ width: 64 }} value={style.letterSpacing ?? ""} onChange={(e) => setStyle({ letterSpacing: e.target.value ? Number(e.target.value) : undefined })} />
        </F>
      </div>
    </div>
  );
}

export const FONTS = ["Inter", "Cormorant Garamond", "Playfair Display", "Lora", "Montserrat", "Poppins", "Marcellus", "Cinzel", "DM Serif Display", "Noto Sans", "Noto Serif Devanagari"];

function ColorInput({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  if (!value)
    return (
      <button className="btn sm" style={{ height: 34 }} onClick={() => onChange("#9c7a45")} title="Set a colour">
        None
      </button>
    );
  return (
    <span className="row" style={{ gap: 4 }}>
      <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button className="btn sm" title="Clear" onClick={() => onChange(undefined)}>
          ×
        </button>
      )}
    </span>
  );
}

function VisibilityEditor({ cond, fields, onChange }: { cond?: Condition; fields: FieldInfo[]; onChange: (c: Condition | undefined) => void }) {
  if (!cond)
    return (
      <div className="spread">
        <span className="small muted">Always</span>
        <button className="btn sm" onClick={() => onChange({ field: fields[0]?.path ?? "customer.name", op: "exists" })}>
          Add a rule
        </button>
      </div>
    );
  const needsValue = !["exists", "not_exists"].includes(cond.op);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="small muted">Only when</span>
      <select value={cond.field} onChange={(e) => onChange({ ...cond, field: e.target.value })}>
        {!fields.some((f) => f.path === cond.field) && <option value={cond.field}>{cond.field}</option>}
        {fields.map((f) => (
          <option key={f.path} value={f.path}>
            {f.path}
          </option>
        ))}
      </select>
      <div className="row">
        <select value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as Condition["op"] })}>
          {OPS.map(([op, l]) => (
            <option key={op} value={op}>
              {l}
            </option>
          ))}
        </select>
        {needsValue && <input style={{ flex: 1 }} value={String(cond.value ?? "")} onChange={(e) => onChange({ ...cond, value: isNaN(Number(e.target.value)) || e.target.value === "" ? e.target.value : Number(e.target.value) })} />}
      </div>
      <button className="btn sm" onClick={() => onChange(undefined)}>
        Remove rule (always show)
      </button>
    </div>
  );
}

export function PageEditor({ page, onChange }: { page: Template["page"]; onChange: (p: Template["page"]) => void }) {
  const set = (patch: Partial<Template["page"]>) => onChange({ ...page, ...patch });
  return (
    <div className="stack">
      <F label="Format">
        <select value={page.format} onChange={(e) => set({ format: e.target.value as Template["page"]["format"] })}>
          <option value="mobile">Mobile (WhatsApp link)</option>
          <option value="a4">A4 invoice</option>
          <option value="thermal">Thermal 80mm</option>
        </select>
      </F>
      <div className="row">
        <F label="Background">
          <input type="color" value={page.background} onChange={(e) => set({ background: e.target.value })} />
        </F>
        <F label="Text">
          <input type="color" value={page.textColor} onChange={(e) => set({ textColor: e.target.value })} />
        </F>
        <F label="Muted">
          <input type="color" value={page.mutedColor} onChange={(e) => set({ mutedColor: e.target.value })} />
        </F>
        <F label="Accent">
          <input type="color" value={page.accentColor} onChange={(e) => set({ accentColor: e.target.value })} />
        </F>
      </div>
      <F label="Body font">
        <select value={page.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </F>
      <F label="Heading font">
        <select value={page.headingFontFamily} onChange={(e) => set({ headingFontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </F>
      <F label="Background image (https URL, optional)">
        <input value={page.backgroundImage ?? ""} onChange={(e) => set({ backgroundImage: e.target.value || undefined })} />
      </F>
      <F label={`Page padding ${page.padding}px`}>
        <input type="range" min={0} max={64} value={page.padding} onChange={(e) => set({ padding: Number(e.target.value) })} />
      </F>
    </div>
  );
}
