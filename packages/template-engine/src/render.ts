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
  if (style.bleed) out.push("margin-left:calc(-1 * var(--lx-pad));margin-right:calc(-1 * var(--lx-pad))");
  return out.join(";");
}

function hasCertificates(ctx: Ctx): boolean {
  const items = (getPath(ctx, "items") as { certificates?: unknown[] }[] | undefined) ?? [];
  return items.some((it) => (it.certificates?.length ?? 0) > 0);
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
      if (block.props.style === "ornament")
        return wrap(block, `<div class="lx-ornament" aria-hidden="true"><i></i><svg viewBox="0 0 40 40" width="34" height="34"><g fill="none" stroke="currentColor" stroke-width="1.4"><path d="M20 4c3 6 3 10 0 16-3-6-3-10 0-16zM20 36c-3-6-3-10 0-16 3 6 3 10 0 16zM4 20c6-3 10-3 16 0-6 3-10 3-16 0zM36 20c-6 3-10 3-16 0 6-3 10-3 16 0z"/><circle cx="20" cy="20" r="2.2" fill="currentColor"/></g></svg><i></i></div>`, opts);
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
      return wrap(block, `<div class="lx-sub" id="lx-certificates">${esc(block.props.title)}</div>${list}`, opts);
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
      const labels = { pdf: block.props.pdfLabel || "Download PDF", share: "Share", certificates: "View certificates", image: "Save as image", json: "Download data" } as const;
      const links = block.props.formats
        .map((f) => {
          // Jumps to the certificates on the page; shown only when the bill has some.
          if (f === "certificates") return hasCertificates(ctx) ? `<a class="lx-button lx-share" href="#lx-certificates">${labels.certificates}</a>` : "";
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
      const title = block.props.title ? `<div class="lx-social-title">${text(block.props.title, ctx)}</div>` : "";
      if (block.props.style === "text") {
        const links = block.props.links
          .map((l) => {
            const href = safeUrl(l.href);
            return href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(l.label)}</a>` : "";
          })
          .join(" · ");
        return wrap(block, title + links, opts);
      }
      const icons = block.props.links
        .map((l) => {
          const href = safeUrl(l.href);
          if (!href) return "";
          const net = socialNetwork(href, l.label);
          return `<a class="lx-soc lx-soc-${net}" href="${esc(href)}" target="_blank" rel="noopener" aria-label="${esc(l.label)}" title="${esc(l.label)}">${SOCIAL_ICONS[net]}</a>`;
        })
        .join("");
      return wrap(block, `${title}<div class="lx-socials">${icons}</div>`, opts);
    }
    case "banner_carousel": {
      const slides = block.props.slides
        .map((sl, i) => {
          const href = sl.href ? safeUrl(interpolate(sl.href, ctx)) : undefined;
          const img = sl.image ? safeUrl(interpolate(sl.image, ctx)) : undefined;
          const tag = href ? "a" : "div";
          const linkAttrs = href ? ` href="${esc(href)}" target="_blank" rel="noopener"` : "";
          const label = ` aria-label="${esc(interpolate(sl.title, ctx) || `Slide ${i + 1}`)}"`;
          if (img) return `<${tag} class="lx-slide lx-slide-img"${linkAttrs}${label}><img src="${esc(img)}" alt="${esc(interpolate(sl.title, ctx))}"></${tag}>`;
          const bg = safeColor(sl.background) ?? "#2b2b33";
          const bg2 = safeColor(sl.background2) ?? bg;
          const color = safeColor(sl.color) ?? "#ffffff";
          const accent = safeColor(sl.accent) ?? "#c9a46a";
          const art = sl.art === "none" ? "" : `<div class="lx-slide-art" style="color:${accent}">${SLIDE_ART[sl.art]}</div>`;
          return `<${tag} class="lx-slide" style="background:linear-gradient(120deg,${bg},${bg2});color:${color}"${linkAttrs}${label}>${art}<div class="lx-slide-text">${sl.kicker ? `<span class="lx-slide-kicker" style="color:${accent}">${text(sl.kicker, ctx)}</span>` : ""}<b>${text(sl.title, ctx)}</b>${sl.subtitle ? `<span>${text(sl.subtitle, ctx)}</span>` : ""}${sl.cta ? `<em style="border-color:${accent};color:${accent}">${text(sl.cta, ctx)} →</em>` : ""}</div></${tag}>`;
        })
        .join("");
      const dots = block.props.slides.length > 1 ? `<div class="lx-dots">${block.props.slides.map((_, i) => `<i${i ? "" : ' class="on"'}></i>`).join("")}</div>` : "";
      return wrap(block, `<div class="lx-car" data-autoplay="${block.props.autoplay}"><div class="lx-car-track">${slides}</div>${dots}</div>`, opts);
    }
    case "video_card": {
      const href = safeUrl(interpolate(block.props.href, ctx)) ?? "#";
      const thumb = block.props.thumbnail ? safeUrl(interpolate(block.props.thumbnail, ctx)) : undefined;
      const bg = safeColor(block.props.background) ?? "#1f1f24";
      const yt = /youtu\.?be/i.test(href);
      return wrap(
        block,
        `<a class="lx-video" href="${esc(href)}" target="_blank" rel="noopener" style="background:${thumb ? `#000 url('${thumb}') center/cover` : `radial-gradient(circle at 70% 30%,${bg}aa,${bg})`}"><span class="lx-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M8 5v14l11-7z" fill="#fff"/></svg></span><span class="lx-video-text">${yt ? `<span class="lx-video-src">${SOCIAL_ICONS.youtube} YouTube</span>` : ""}<b>${text(block.props.title, ctx)}</b>${block.props.subtitle ? `<span>${text(block.props.subtitle, ctx)}</span>` : ""}</span></a>`,
        opts,
      );
    }
    case "accordion": {
      const items = block.props.items.map((it) => `<details class="lx-acc"><summary>${text(it.title, ctx)}</summary><div>${text(it.body, ctx)}</div></details>`).join("");
      return wrap(block, items, opts);
    }
    case "contact_bar": {
      const phone = interpolate(block.props.phone, ctx).replace(/[^\d+]/g, "");
      const verify = safeUrl(stringOrEmpty(getPath(ctx, "links.verify")));
      return wrap(
        block,
        `<div class="lx-contact-bar">${phone ? `<a class="lx-cb-call" href="tel:${esc(phone)}"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.6a1 1 0 01-.25 1z" fill="currentColor"/></svg>${text(block.props.label, ctx)}</a>` : ""}<a class="lx-cb-seal" href="${esc(verify ?? "#")}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12l2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>${text(block.props.seal, ctx)}</a></div>`,
        opts,
      );
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
.lx-page{position:relative;--lx-accent:${accent};--lx-pad:${p.padding}px}
.lx-ornament{display:flex;align-items:center;gap:10px;color:${accent}}
.lx-ornament i{flex:1;height:1px;background:currentColor;opacity:.6}
.lx-social-title{text-align:center;font-size:15px;margin-bottom:12px;color:${muted}}
.lx-socials{display:flex;justify-content:center;gap:14px;flex-wrap:wrap}
.lx-soc{width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.12);transition:transform .15s}
.lx-socials a.lx-soc{color:#fff}
.lx-soc:active{transform:scale(.92)}
.lx-soc svg{width:22px;height:22px}
.lx-soc-instagram{background:radial-gradient(circle at 30% 107%,#fdf497 0%,#fd5949 45%,#d6249f 60%,#285AEB 90%)}
.lx-soc-facebook{background:#1877F2}.lx-soc-youtube{background:#FF0000}.lx-soc-x{background:#000}.lx-soc-linkedin{background:#0A66C2}.lx-soc-whatsapp{background:#25D366}.lx-soc-pinterest{background:#E60023}.lx-soc-web{background:${accent}}
.lx-car{position:relative}
.lx-car-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;border-radius:16px;-webkit-overflow-scrolling:touch}
.lx-car-track::-webkit-scrollbar{display:none}
.lx-slide{position:relative;flex:0 0 100%;scroll-snap-align:center;min-height:168px;border-radius:16px;overflow:hidden;display:flex;align-items:center;text-decoration:none;box-sizing:border-box;padding:20px 22px}
.lx-slide-img{padding:0;min-height:0}
.lx-slide-img img{width:100%;display:block}
.lx-slide-art{position:absolute;right:-6px;top:50%;transform:translateY(-50%);width:46%;opacity:.95;pointer-events:none}
.lx-slide-art svg{width:100%;height:auto;display:block}
.lx-slide-text{position:relative;max-width:62%;display:flex;flex-direction:column;gap:5px}
.lx-slide-kicker{font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:700}
.lx-slide-text b{font-family:'${heading}',serif;font-weight:500;font-size:23px;line-height:1.15}
.lx-slide-text span{font-size:12.5px;opacity:.85;line-height:1.4}
.lx-slide-text em{font-style:normal;font-size:12px;font-weight:700;border:1px solid;border-radius:999px;padding:5px 12px;align-self:flex-start;margin-top:4px}
.lx-dots{display:flex;justify-content:center;gap:6px;margin-top:10px}
.lx-dots i{width:7px;height:7px;border-radius:50%;background:${muted};opacity:.35;transition:all .3s}
.lx-dots i.on{width:20px;border-radius:4px;background:${accent};opacity:1}
.lx-video{position:relative;display:flex;align-items:flex-end;min-height:210px;border-radius:16px;overflow:hidden;text-decoration:none;color:#fff;padding:16px}
.lx-video::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.65),transparent 60%)}
.lx-play{position:absolute;left:50%;top:36%;transform:translate(-50%,-50%);width:58px;height:58px;border-radius:50%;background:#FF0000;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.35);z-index:1}
.lx-video-text{position:relative;z-index:1;display:flex;flex-direction:column;gap:3px}
.lx-video-text b{font-family:'${heading}',serif;font-weight:500;font-size:20px}
.lx-video-text span{font-size:12px;opacity:.85}
.lx-video-src{display:inline-flex;align-items:center;gap:5px;font-weight:700;letter-spacing:.5px}
.lx-video-src svg{width:16px;height:16px}
.lx-acc{border-top:1px solid rgba(0,0,0,.08)}
.lx-acc:last-child{border-bottom:1px solid rgba(0,0,0,.08)}
.lx-acc summary{list-style:none;cursor:pointer;padding:14px 2px;font-size:15px;display:flex;justify-content:space-between;align-items:center}
.lx-acc summary::-webkit-details-marker{display:none}
.lx-acc summary::after{content:"";width:8px;height:8px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);transition:transform .2s;margin-right:4px}
.lx-acc[open] summary::after{transform:rotate(-135deg)}
.lx-acc>div{padding:0 2px 14px;font-size:13px;color:${muted};white-space:pre-line;line-height:1.55}
.lx-contact_bar{position:sticky;bottom:0;z-index:5;margin:18px calc(-1 * var(--lx-pad)) 0;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:10px var(--lx-pad) calc(10px + env(safe-area-inset-bottom));box-shadow:0 -6px 20px rgba(0,0,0,.06)}
.lx-contact-bar{display:flex;gap:10px}
.lx-contact-bar a{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:46px;border-radius:999px;border:1.5px solid ${accent};color:${accent};text-decoration:none;font-weight:600;font-size:14px}
.lx-contact-bar .lx-cb-seal{border-color:#1BAF7A;color:#0E7A52}
.lx-buttons .lx-button{flex:1;text-align:center}
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
.lx-col:has(>.lx-qr:only-child){flex:0 0 auto}
.lx-col>.lx-block:last-child{margin-bottom:0}
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

type Network = "instagram" | "facebook" | "youtube" | "x" | "linkedin" | "whatsapp" | "pinterest" | "web";
function socialNetwork(href: string, label: string): Network {
  const h = `${href} ${label}`.toLowerCase();
  if (h.includes("instagram")) return "instagram";
  if (h.includes("facebook") || h.includes("fb.com")) return "facebook";
  if (h.includes("youtu")) return "youtube";
  if (h.includes("twitter") || h.includes("x.com") || /\bx\b/.test(label.toLowerCase())) return "x";
  if (h.includes("linkedin")) return "linkedin";
  if (h.includes("whatsapp") || h.includes("wa.me")) return "whatsapp";
  if (h.includes("pinterest")) return "pinterest";
  return "web";
}

/** White glyphs on the network's own colour (drawn here: no external icon fonts). */
const SOCIAL_ICONS: Record<Network, string> = {
  instagram: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.3" fill="currentColor"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 21v-7.5H16l.4-3H13.5V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21z" fill="currentColor"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="currentColor"/><path d="M10 9.2v5.6l5-2.8z" fill="#FF0000"/></svg>`,
  x: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l10 16h-4zM19 4l-6.2 7M5 20l6.2-7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="9.5" width="3" height="9.5" fill="currentColor"/><circle cx="6" cy="6" r="1.8" fill="currentColor"/><path d="M10.5 9.5h2.9v1.4c.5-.9 1.6-1.7 3.2-1.7 2.6 0 3.4 1.6 3.4 4.2V19h-3v-5c0-1.2-.3-2.2-1.6-2.2s-1.9 1-1.9 2.3V19h-3z" fill="currentColor"/></svg>`,
  whatsapp: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.2-4A8 8 0 1112 20a8 8 0 01-3.9-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8.5c.3-.6.8-.6 1 0l.6 1.4c.1.3 0 .6-.2.8l-.5.5a5 5 0 002.9 2.9l.5-.5c.2-.2.5-.3.8-.2l1.4.6c.6.2.6.7 0 1-1.6 1.1-4.3.3-6-1.6S7.9 10.1 9 8.5z" fill="currentColor"/></svg>`,
  pinterest: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 00-3.3 17.4c-.1-.7-.1-1.8 0-2.6l1.1-4.6s-.3-.6-.3-1.4c0-1.3.8-2.3 1.7-2.3.8 0 1.2.6 1.2 1.3 0 .8-.5 2-.8 3.1-.2.9.5 1.7 1.4 1.7 1.7 0 3-1.8 3-4.4 0-2.3-1.6-3.9-4-3.9-2.7 0-4.3 2-4.3 4.1 0 .8.3 1.7.7 2.2.1.1.1.2.1.3l-.3 1c0 .2-.1.2-.3.1-1.2-.6-2-2.3-2-3.7 0-3 2.2-5.8 6.3-5.8 3.3 0 5.9 2.4 5.9 5.5 0 3.3-2.1 6-5 6-1 0-1.9-.5-2.2-1.1l-.6 2.3c-.2.8-.8 1.9-1.2 2.5A9 9 0 1012 3z" fill="currentColor"/></svg>`,
  web: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 12h17M12 3.5c2.5 2.5 2.5 14.5 0 17M12 3.5c-2.5 2.5-2.5 14.5 0 17" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
};

/** Line art for designed promotion slides, drawn in the slide's accent colour. */
const SLIDE_ART: Record<"diamond" | "ring" | "gift" | "star" | "coin", string> = {
  diamond: `<svg viewBox="0 0 200 160" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M60 40h80l30 30-70 80-70-80z"/><path d="M30 70h140M60 40l20 30 20-30 20 30 20-30M80 70l20 80 20-80"/></g><g fill="currentColor" opacity=".7"><circle cx="40" cy="30" r="2.5"/><circle cx="176" cy="40" r="2"/><circle cx="165" cy="120" r="2.5"/></g></svg>`,
  ring: `<svg viewBox="0 0 200 160" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="100" cy="100" rx="52" ry="48"/><ellipse cx="100" cy="100" rx="42" ry="38"/><path d="M80 52l20-30 20 30-20 12z"/><path d="M80 52h40"/></g><g fill="currentColor" opacity=".7"><circle cx="150" cy="40" r="2.5"/><circle cx="45" cy="45" r="2"/></g></svg>`,
  gift: `<svg viewBox="0 0 200 160" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><rect x="50" y="70" width="100" height="70" rx="4"/><rect x="42" y="52" width="116" height="20" rx="3"/><path d="M100 52v88M100 52c-10-24-40-24-36-6 3 10 26 8 36 6zM100 52c10-24 40-24 36-6-3 10-26 8-36 6z"/></g><g fill="currentColor" opacity=".7"><circle cx="170" cy="40" r="2.5"/><circle cx="35" cy="120" r="2"/></g></svg>`,
  star: `<svg viewBox="0 0 200 160" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M100 18l14 46 48 0-39 28 15 46-38-28-38 28 15-46-39-28 48 0z"/><circle cx="100" cy="82" r="18"/></g><g fill="currentColor" opacity=".7"><circle cx="40" cy="40" r="2.5"/><circle cx="170" cy="130" r="2"/></g></svg>`,
  coin: `<svg viewBox="0 0 200 160" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><circle cx="90" cy="85" r="48"/><circle cx="90" cy="85" r="38"/><circle cx="135" cy="60" r="30"/><circle cx="135" cy="60" r="22"/></g><text x="90" y="95" text-anchor="middle" font-size="30" fill="currentColor" font-family="serif">₹</text></svg>`,
};

/** Carousel: auto-advance, pause while the customer swipes, keep the dots in step. */
export const CAROUSEL_JS = `document.querySelectorAll('.lx-car').forEach(function(c){var t=c.querySelector('.lx-car-track'),d=c.querySelectorAll('.lx-dots i'),n=t.children.length,s=Number(c.getAttribute('data-autoplay'))||0,hold=0;
function cur(){return Math.round(t.scrollLeft/Math.max(1,t.clientWidth));}
t.addEventListener('scroll',function(){var i=cur();d.forEach(function(x,j){x.classList.toggle('on',j===i);});},{passive:true});
['touchstart','pointerdown','wheel'].forEach(function(e){t.addEventListener(e,function(){hold=Date.now();},{passive:true});});
d.forEach(function(x,j){x.addEventListener('click',function(){t.scrollTo({left:j*t.clientWidth,behavior:'smooth'});hold=Date.now();});});
if(s&&n>1)setInterval(function(){if(Date.now()-hold<s*1500||document.hidden)return;t.scrollTo({left:((cur()+1)%n)*t.clientWidth,behavior:'smooth'});},s*1000);});`;
