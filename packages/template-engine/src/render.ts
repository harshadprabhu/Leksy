import { allBindingsEmpty, evaluate, getAll, getPath, interpolate, type Ctx } from "./expr.js";
import type { Block, Condition, Style, Template } from "./schema.js";

export interface RenderOptions {
  /** Returns an SVG string for a QR value. Without it a placeholder box is drawn. */
  qr?: (value: string, size: number) => string;
  /** Survey markup to place where the survey block sits (the bill page hydrates it). */
  surveySlot?: (title: string) => string;
  /** Mark blocks with data-block-id so the studio can select them on the canvas. */
  editor?: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Colours: hex, rgb()/rgba() or a CSS keyword. Anything else is dropped. */
export function safeColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const v = c.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  if (/^rgba?\(\s*[\d.\s,%]+\)$/.test(v)) return v;
  if (/^[a-zA-Z]{3,20}$/.test(v)) return v;
  return undefined;
}

export function safeUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  const v = u.trim();
  if (/^https:\/\//i.test(v)) return v;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v)) return v;
  if (/^\/[^/]/.test(v)) return v; // same-origin path
  if (/^(mailto:|tel:)/i.test(v)) return v;
  return undefined;
}

const safeFont = (f: string | undefined) => (f && /^[\w\s-]{1,80}$/.test(f) ? f : undefined);

function css(style: Style | undefined): string {
  if (!style) return "";
  const out: string[] = [];
  if (style.align) out.push(`text-align:${style.align}`);
  const color = safeColor(style.color);
  if (color) out.push(`color:${color}`);
  const bg = safeColor(style.background);
  if (bg) out.push(`background:${bg}`);
  if (style.fontSize) out.push(`font-size:${style.fontSize}px`);
  if (style.fontWeight) out.push(`font-weight:${style.fontWeight}`);
  const ff = safeFont(style.fontFamily);
  if (ff) out.push(`font-family:'${ff}',serif`);
  if (style.italic) out.push("font-style:italic");
  if (style.letterSpacing !== undefined) out.push(`letter-spacing:${style.letterSpacing}px`);
  if (style.uppercase) out.push("text-transform:uppercase");
  if (style.paddingY !== undefined || style.paddingX !== undefined)
    out.push(`padding:${style.paddingY ?? 0}px ${style.paddingX ?? 0}px`);
  if (style.marginTop !== undefined) out.push(`margin-top:${style.marginTop}px`);
  if (style.radius !== undefined) out.push(`border-radius:${style.radius}px`);
  const border = safeColor(style.border);
  if (border) out.push(`border:1px solid ${border}`);
  return out.join(";");
}

export function checkCondition(cond: Condition | undefined, ctx: Ctx): boolean {
  if (!cond) return true;
  const values = cond.field.includes("[]") ? getAll(ctx, cond.field) : [getPath(ctx, cond.field)];
  const present = values.filter((v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
  const cmp = (fn: (v: unknown) => boolean) => present.some(fn);
  switch (cond.op) {
    case "exists":
      return present.length > 0;
    case "not_exists":
      return present.length === 0;
    case "eq":
      return cmp((v) => String(v) === String(cond.value));
    case "neq":
      return !cmp((v) => String(v) === String(cond.value));
    case "gt":
      return cmp((v) => Number(v) > Number(cond.value));
    case "gte":
      return cmp((v) => Number(v) >= Number(cond.value));
    case "lt":
      return cmp((v) => Number(v) < Number(cond.value));
    case "lte":
      return cmp((v) => Number(v) <= Number(cond.value));
    case "contains":
      return cmp((v) => (Array.isArray(v) ? v.map(String).includes(String(cond.value)) : String(v).toLowerCase().includes(String(cond.value).toLowerCase())));
  }
}

/** Interpolate, drop lines left empty by missing data, escape, then turn newlines into <br>. */
const text = (tpl: string, ctx: Ctx) =>
  esc(
    interpolate(tpl, ctx)
      .split("\n")
      .filter((line, i, all) => line.trim() !== "" || all.length === 1)
      .join("\n"),
  ).replace(/\n/g, "<br>");

function wrap(block: Block, inner: string, opts: RenderOptions, cls = ""): string {
  const id = opts.editor ? ` data-block-id="${esc(block.id)}"` : "";
  const style = css(block.style);
  return `<div class="lx-block lx-${block.type}${cls ? " " + cls : ""}"${id}${style ? ` style="${style}"` : ""}>${inner}</div>`;
}

function itemsCtx(ctx: Ctx, item: unknown, index: number): Ctx {
  return { ...ctx, ...(item as Record<string, unknown>), item, index: index + 1 };
}

function renderBlock(block: Block, ctx: Ctx, opts: RenderOptions): string {
  if (!checkCondition(block.visibleIf, ctx)) return opts.editor ? wrap(block, "", opts, "lx-hidden") : "";
  switch (block.type) {
    case "heading": {
      const tag = `h${block.props.level}`;
      return wrap(block, `<${tag}>${text(block.props.text, ctx)}</${tag}>`, opts);
    }
    case "text":
      return wrap(block, `<p>${text(block.props.text, ctx)}</p>`, opts);
    case "image": {
      const src = safeUrl(interpolate(block.props.src, ctx));
      if (!src) return opts.editor ? wrap(block, `<div class="lx-placeholder">Image</div>`, opts) : "";
      return wrap(block, `<img src="${esc(src)}" alt="${esc(interpolate(block.props.alt, ctx))}" style="width:${block.props.width}%">`, opts);
    }
    case "divider":
      return wrap(block, `<hr style="border:0;border-top:${block.props.thickness}px ${block.props.style} currentColor;opacity:.35">`, opts);
    case "spacer":
      return wrap(block, `<div style="height:${block.props.height}px"></div>`, opts);
    case "items_table": {
      const rows = getPath(ctx, block.props.source);
      const items = Array.isArray(rows) ? rows : [];
      const cols = block.props.columns;
      const head = block.props.showHeader
        ? `<thead><tr>${cols.map((c) => `<th style="text-align:${c.align}${c.width ? `;width:${c.width}%` : ""}">${esc(c.label)}</th>`).join("")}</tr></thead>`
        : "";
      const body = items
        .map((it, i) => {
          const ic = itemsCtx(ctx, it, i);
          const main = `<tr>${cols.map((c) => `<td style="text-align:${c.align}">${text(c.value, ic)}</td>`).join("")}</tr>`;
          const detail = block.props.detailLine ? interpolate(block.props.detailLine, ic).trim() : "";
          return detail ? `${main}<tr class="lx-detail"><td colspan="${cols.length}">${esc(detail)}</td></tr>` : main;
        })
        .join("");
      return wrap(block, `<table class="lx-table">${head}<tbody>${body}</tbody></table>`, opts);
    }
    case "item_cards": {
      const rows = getPath(ctx, block.props.source);
      const items = Array.isArray(rows) ? rows : [];
      const cards = items
        .map((it, i) => {
          const ic = itemsCtx(ctx, it, i);
          const img = block.props.showImage ? safeUrl(stringOrEmpty(getPath(ic, "image_url"))) : undefined;
          const details = block.props.details
            .filter((r) => checkCondition(r.visibleIf, ic))
            .map((r) => [r.label, interpolate(r.value, ic).trim()] as const)
            .filter(([, v]) => v !== "")
            .map(([l, v]) => `<div class="lx-kv"><span>${esc(l)}</span><span>${esc(v)}</span></div>`)
            .join("");
          return `<div class="lx-card">${img ? `<img class="lx-card-img" src="${esc(img)}" alt="">` : ""}<div class="lx-card-body"><div class="lx-card-head"><div><div class="lx-card-title">${text(block.props.title, ic)}</div>${block.props.subtitle ? `<div class="lx-muted">${text(block.props.subtitle, ic)}</div>` : ""}</div><div class="lx-card-price">${text(block.props.price, ic)}</div></div>${details}</div></div>`;
        })
        .join("");
      return wrap(block, cards, opts);
    }
    case "kv_list": {
      const rows = block.props.rows
        .filter((r) => checkCondition(r.visibleIf, ctx) && !allBindingsEmpty(r.value, ctx))
        .map((r, i, all) => {
          const strong = block.props.emphasizeLast && i === all.length - 1 ? " lx-strong" : "";
          return `<div class="lx-kv${strong}"><span>${text(r.label, ctx)}</span><span>${text(r.value, ctx)}</span></div>`;
        })
        .join("");
      return wrap(block, rows, opts);
    }
    case "totals": {
      const kv = (l: string, v: unknown, strong = false) =>
        `<div class="lx-kv${strong ? " lx-strong" : ""}"><span>${esc(l)}</span><span>${esc(String(evaluate("v | inr", { v })))}</span></div>`;
      const t = (getPath(ctx, "totals") ?? {}) as Record<string, number>;
      // Gross subtotal, then the discount, so the lines add up to the total.
      const parts: string[] = [kv("Subtotal", t.discount ? t.subtotal : t.taxable)];
      if (t.discount) parts.push(kv("Discount", -t.discount));
      if (block.props.showTaxBreakup) {
        const taxes = (getPath(ctx, "taxes") as { type: string; rate?: number; amount: number }[] | undefined) ?? [];
        for (const tx of taxes) parts.push(kv(tx.rate !== undefined ? `${tx.type} @ ${tx.rate}%` : tx.type, tx.amount));
      } else if (t.tax) parts.push(kv("Tax", t.tax));
      const charges = (getPath(ctx, "charges") as { label: string; amount: number }[] | undefined) ?? [];
      for (const c of charges) parts.push(kv(c.label, c.amount));
      const ro = Number(getPath(ctx, "round_off") ?? 0);
      if (ro) parts.push(kv("Round off", ro));
      parts.push(kv(block.props.grandTotalLabel, getPath(ctx, "total"), true));
      if (block.props.showPayments) {
        const pays = (getPath(ctx, "payments") as { mode: string; amount: number }[] | undefined) ?? [];
        if (pays.length) parts.push(`<div class="lx-sub">Paid by</div>` + pays.map((p) => kv(p.mode, p.amount)).join(""));
      }
      return wrap(block, parts.join(""), opts);
    }
    case "certificates": {
      const items = (getPath(ctx, "items") as { name: string; certificates?: { type: string; number?: string; url?: string; issuer?: string }[] }[] | undefined) ?? [];
      const certs = items.flatMap((it) => (it.certificates ?? []).map((c) => ({ ...c, item: it.name })));
      if (!certs.length) return opts.editor ? wrap(block, `<div class="lx-placeholder">Certificates appear when an item has one</div>`, opts) : "";
      const list = certs
        .map((c) => {
          const url = safeUrl(c.url);
          const label = `${c.type.replace(/_/g, " ")}${c.number ? ` · ${c.number}` : ""}`;
          return `<div class="lx-cert"><div><div class="lx-card-title">${esc(label)}</div><div class="lx-muted">${esc(c.item)}${c.issuer ? ` · ${esc(c.issuer)}` : ""}</div></div>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">View</a>` : ""}</div>`;
        })
        .join("");
      return wrap(block, `<div class="lx-sub">${esc(block.props.title)}</div>${list}`, opts);
    }
    case "qr": {
      const value = interpolate(block.props.value, ctx);
      const svg = value && opts.qr ? opts.qr(value, block.props.size) : `<div class="lx-placeholder" style="width:${block.props.size}px;height:${block.props.size}px;margin:auto">QR</div>`;
      const cap = block.props.caption ? `<div class="lx-muted">${text(block.props.caption, ctx)}</div>` : "";
      return wrap(block, `<div class="lx-qr">${svg}${cap}</div>`, opts);
    }
    case "button": {
      const href = safeUrl(interpolate(block.props.href, ctx)) ?? "#";
      return wrap(block, `<a class="lx-button" href="${esc(href)}" target="_blank" rel="noopener">${text(block.props.label, ctx)}</a>`, opts);
    }
    case "download_buttons": {
      const labels = { pdf: "Download PDF", share: "Share", image: "Save as image", json: "Download data" } as const;
      const links = block.props.formats
        .map((f) => {
          // Share sends the PDF through the phone's share sheet (WhatsApp, Mail…).
          if (f === "share") return `<a class="lx-button lx-share" href="${esc(safeUrl(stringOrEmpty(getPath(ctx, "links.pdf"))) ?? "#")}" data-lx-share>${labels.share}</a>`;
          const href = safeUrl(stringOrEmpty(getPath(ctx, `links.${f}`))) ?? "#";
          return `<a class="lx-button" href="${esc(href)}" download>${labels[f]}</a>`;
        })
        .join("");
      return wrap(block, `<div class="lx-buttons">${links}</div>`, opts);
    }
    case "survey": {
      const inner = opts.surveySlot ? opts.surveySlot(interpolate(block.props.title, ctx)) : `<div class="lx-placeholder">${text(block.props.title, ctx)} · ★★★★★</div>`;
      return wrap(block, inner, opts);
    }
    case "social_links": {
      const links = block.props.links
        .map((l) => {
          const href = safeUrl(l.href);
          return href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(l.label)}</a>` : "";
        })
        .join(" · ");
      return wrap(block, links, opts);
    }
    case "columns": {
      const cols = block.props.columns
        .map((col) => `<div class="lx-col">${col.map((b) => renderBlock(b, ctx, opts)).join("")}</div>`)
        .join("");
      return wrap(block, `<div class="lx-cols" style="gap:${block.props.gap}px">${cols}</div>`, opts);
    }
  }
}

function stringOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function templateCss(t: Template): string {
  const p = t.page;
  const width = p.format === "a4" ? "794px" : p.format === "thermal" ? "302px" : "480px";
  const bgImg = safeUrl(p.backgroundImage);
  const font = safeFont(p.fontFamily) ?? "Inter";
  const heading = safeFont(p.headingFontFamily) ?? font;
  const accent = safeColor(p.accentColor) ?? "#b08d57";
  const muted = safeColor(p.mutedColor) ?? "#6b6b6b";
  return `
.lx-page{box-sizing:border-box;max-width:${width};margin:0 auto;padding:${p.padding}px;background:${safeColor(p.background) ?? "#fff"}${bgImg ? ` url('${bgImg}') center/cover` : ""};color:${safeColor(p.textColor) ?? "#1a1a1a"};font-family:'${font}',system-ui,sans-serif;font-size:14px;line-height:1.5}
.lx-page *{box-sizing:border-box}
.lx-page{position:relative;--lx-accent:${accent}}
.lx-wm{position:absolute;inset:0;pointer-events:none;background-repeat:no-repeat;background-position:center 38%;z-index:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lx-page>.lx-block{position:relative;z-index:1}
.lx-page h1,.lx-page h2,.lx-page h3{font-family:'${heading}',serif;margin:0;font-weight:500;line-height:1.2}
.lx-page h1{font-size:28px}.lx-page h2{font-size:22px}.lx-page h3{font-size:17px}
.lx-page p{margin:0}
.lx-block{margin:0 0 12px}
.lx-block img{max-width:100%;display:inline-block}
.lx-muted{color:${muted};font-size:12px}
.lx-sub{color:${muted};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin:12px 0 6px}
.lx-table{width:100%;border-collapse:collapse;font-size:13px}
.lx-table th{font-weight:500;color:${muted};font-size:11px;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid ${accent};padding:6px 4px}
.lx-table td{padding:8px 4px;border-bottom:1px solid rgba(0,0,0,.06);vertical-align:top}
.lx-table .lx-detail td{color:${muted};font-size:12px;padding-top:0}
.lx-kv{display:flex;justify-content:space-between;gap:12px;padding:3px 0}
.lx-kv span:last-child{text-align:right;font-variant-numeric:tabular-nums}
.lx-strong{font-weight:600;font-size:16px;border-top:1px solid ${accent};margin-top:6px;padding-top:8px}
.lx-card{display:flex;gap:12px;padding:12px;border:1px solid rgba(0,0,0,.08);border-radius:12px;margin-bottom:10px;background:rgba(255,255,255,.6)}
.lx-card-img{width:72px;height:72px;object-fit:cover;border-radius:8px}
.lx-card-body{flex:1;min-width:0}
.lx-card-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px}
.lx-card-title{font-weight:600}
.lx-card-price{font-weight:600;white-space:nowrap}
.lx-card .lx-kv{font-size:12px;padding:1px 0}
.lx-cert{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid ${accent};border-radius:10px;margin-bottom:8px}
.lx-cert a{color:${accent};font-weight:600;text-decoration:none}
.lx-qr{display:flex;flex-direction:column;align-items:center;gap:6px}
.lx-qr svg{display:block}
.lx-buttons{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.lx-button{display:inline-block;padding:12px 20px;border-radius:999px;background:${accent};color:#fff;text-decoration:none;font-weight:600;font-size:14px;min-height:44px;line-height:20px}
.lx-button.lx-share{background:transparent;color:${accent};box-shadow:inset 0 0 0 1.5px ${accent}}
.lx-cols{display:flex}
.lx-col{flex:1;min-width:0}
.lx-placeholder{border:1px dashed ${muted};color:${muted};padding:12px;text-align:center;border-radius:8px;font-size:12px;display:flex;align-items:center;justify-content:center}
.lx-hidden{opacity:.35;outline:1px dashed ${muted};min-height:12px}
.lx-social_links a{color:${accent}}
`;
}

/** Render the body fragment (`<div class="lx-page">…</div>`) for a template + context. */
export function renderTemplate(t: Template, ctx: Ctx, opts: RenderOptions = {}): string {
  const wm = t.page.watermark;
  const src = wm ? safeUrl(interpolate(wm.src, ctx)) : undefined;
  const mark = wm && src ? `<div class="lx-wm" aria-hidden="true" style="background-image:url('${src}');background-size:${wm.size}% auto;opacity:${wm.opacity}"></div>` : "";
  return `<div class="lx-page">${mark}${t.blocks.map((b) => renderBlock(b, ctx, opts)).join("")}</div>`;
}

const GOOGLE_FONTS = new Set(["Inter", "Cormorant Garamond", "Playfair Display", "Lora", "Montserrat", "Poppins", "Marcellus", "Cinzel", "DM Serif Display", "Noto Sans", "Noto Serif Devanagari", "Red Hat Display", "Nunito", "Figtree"]);

/** A complete standalone HTML document (used by the bill page and the PDF renderer). */
export function renderDocument(t: Template, ctx: Ctx, opts: RenderOptions & { title?: string; head?: string; bodyEnd?: string } = {}): string {
  const fonts = [t.page.fontFamily, t.page.headingFontFamily].filter((f) => GOOGLE_FONTS.has(f));
  const fontLink = fonts.length
    ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700`).join("&")}&display=swap">`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title ?? t.name)}</title>${fontLink}<style>body{margin:0;background:${safeColor(t.page.background) ?? "#fff"}}${templateCss(t)}</style>${opts.head ?? ""}</head><body>${renderTemplate(t, ctx, opts)}${opts.bodyEnd ?? ""}</body></html>`;
}

/**
 * Share button for the bill page: sends the PDF itself through the phone's share
 * sheet where the browser supports sharing files, otherwise shares the bill link,
 * and as a last resort downloads the PDF.
 */
export const SHARE_JS = `document.addEventListener('click',function(e){var a=e.target.closest('[data-lx-share]');if(!a)return;e.preventDefault();
var title=document.title;
fetch(a.href).then(function(r){return r.blob();}).then(function(b){var f=new File([b],(title.split(' ').pop()||'bill')+'.pdf',{type:'application/pdf'});
 if(navigator.canShare&&navigator.canShare({files:[f]}))return navigator.share({files:[f],title:title});
 if(navigator.share)return navigator.share({title:title,url:location.href});
 var u=URL.createObjectURL(b),d=document.createElement('a');d.href=u;d.download=f.name;d.click();setTimeout(function(){URL.revokeObjectURL(u)},4000);})
.catch(function(){});});`;
