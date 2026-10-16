"use client";
import type { Bill } from "@leksy/bill-schema";
import { SURVEY_CSS, SURVEY_JS, surveyHtml } from "@leksy/survey";
import { CAROUSEL_JS, renderDocument, type Block, type Template } from "@leksy/template-engine";
import QRCode from "qrcode";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { DEMO } from "@/lib/api";
import { billContext, billTemplate, findBillByToken, hasFeedback, liveTemplate, load, markOpened, submitDemoFeedback, surveyFor } from "@/lib/demo";
import { htmlToPdf, saveBlob, sharePdf } from "@/lib/pdf";

/**
 * What the customer sees after tapping the WhatsApp link (demo build): the bill as
 * a phone page, a sticky bar to call the store, download the PDF or share it, and
 * the happiness survey. The production page is served by the API at /b/:token with
 * the same template, survey, banners and contact bar.
 */
const BRIDGE = `<script>
window.LX_SUBMIT=function(a){return new Promise(function(res){
  function on(e){if(e.data&&e.data.lxFeedbackResult){removeEventListener('message',on);res(e.data.lxFeedbackResult);}}
  addEventListener('message',on);parent.postMessage({lxFeedback:a},'*');});};
document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;
  if(a.href.indexOf('print=1')>=0){e.preventDefault();parent.postMessage({lxDownload:1},'*');}
  else if(a.href.indexOf('/verify/')>=0){e.preventDefault();parent.postMessage({lxOpen:a.href},'*');}
  else if(a.getAttribute('href').charAt(0)==='#'){var el=document.getElementById(a.getAttribute('href').slice(1));e.preventDefault();
    if(el)parent.postMessage({lxScroll:el.getBoundingClientRect().top},'*');}},true);
// The page grows with its content, so the phone scrolls it like any web page.
function h(){parent.postMessage({lxHeight:document.documentElement.scrollHeight},'*');}
addEventListener('load',h);new ResizeObserver(h).observe(document.documentElement);
</script>`;

async function withQr(render: (qr: (value: string, size: number) => string) => string) {
  const qr: { value: string; size: number }[] = [];
  const doc = render((value, size) => {
    qr.push({ value, size });
    return `<!--lx-qr-${qr.length - 1}-->`;
  });
  const svgs = await Promise.all(qr.map((q) => QRCode.toString(q.value, { type: "svg", margin: 0, width: q.size })));
  return doc.replace(/<!--lx-qr-(\d+)-->/g, (_, i: string) => svgs[Number(i)] ?? "");
}

function BillView() {
  const params = useSearchParams();
  const t = params.get("t") ?? "";
  const wantsPdf = params.get("print") === "1"; // old PDF links: open the bill and download at once
  const [html, setHtml] = useState<string | null>(null);
  const [height, setHeight] = useState(900);
  const [look, setLook] = useState<{ bg: string; accent: string; font: string }>({ bg: "#fff", accent: "#2a2118", font: "inherit" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const pdf = useRef<{ name: string; title: string; blob: Promise<Blob> } | null>(null);

  useEffect(() => {
    if (!DEMO) return;
    const bill = findBillByToken(t);
    if (!bill) {
      setErr("Bill not found");
      return;
    }
    void (async () => {
      const s = load();
      const invoice = (bill.data as Bill).invoice_no;
      const title = `${s.brand.name} bill ${invoice}`;
      const tpl = billTemplate(s, bill);
      const ctx = billContext(s, bill);
      const answered = hasFeedback(bill);
      const sv = surveyFor(bill);
      setLook({ bg: tpl.page.background, accent: tpl.page.accentColor, font: tpl.page.fontFamily });
      // The phone page. The bill sits in a sandboxed frame, which cannot open the
      // share sheet or keep a bar on screen, so Share and the contact bar move to the
      // sticky bar below; the in-page Download and Certificates buttons stay.
      const phoneBlocks: Block[] = tpl.blocks
        .filter((b) => b.type !== "contact_bar")
        .map((b) => (b.type === "download_buttons" ? { ...b, props: { ...b.props, formats: b.props.formats.filter((f) => f !== "share") } } : b))
        .filter((b) => b.type !== "download_buttons" || b.props.formats.length > 0);
      setPhone(tpl.blocks.some((b) => b.type === "contact_bar") ? (s.brand.supportPhone ?? null) : null);
      const page = await withQr((qr) =>
        renderDocument({ ...tpl, blocks: phoneBlocks }, ctx, {
          title,
          head: `<style>${SURVEY_CSS}html,body{overflow:hidden}</style>${BRIDGE}`,
          surveySlot: (st) => (sv ? surveyHtml(sv.body, st, answered) : ""),
          bodyEnd: `<script>${CAROUSEL_JS}${answered || !sv ? "" : SURVEY_JS}</script>`,
          qr,
        }),
      );
      setHtml(page);
      markOpened(bill);
      // The PDF uses the brand's printable design (e.g. an A4 tax invoice); it is
      // prepared in the background so Download and Share respond at once.
      const pdfKey = s.brand.settings?.pdfTemplate as string | undefined;
      const printTpl: Template = (pdfKey && liveTemplate(s, pdfKey)) || tpl;
      const printable = await withQr((qr) => renderDocument({ ...printTpl, blocks: printTpl.blocks.filter((b) => !["survey", "download_buttons", "contact_bar"].includes(b.type)) }, ctx, { title, qr }));
      pdf.current = { name: `${invoice}.pdf`, title, blob: new Promise((r) => setTimeout(r, 600)).then(() => htmlToPdf(printable)) };
      if (wantsPdf) void download();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const download = async () => {
    if (!pdf.current) return;
    setBusy("download");
    try {
      saveBlob(await pdf.current.blob, pdf.current.name);
      setNote("Saved to your downloads");
    } catch {
      setNote("Could not create the PDF. Please try again.");
    } finally {
      setBusy(null);
    }
  };
  const share = async () => {
    if (!pdf.current) return;
    setBusy("share");
    try {
      const r = await sharePdf(await pdf.current.blob, pdf.current.name, pdf.current.title);
      setNote(r === "downloaded" ? "Sharing isn't available here, so the PDF was saved to your downloads" : null);
    } catch {
      setNote("Could not share the PDF. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  // Survey answers, size changes and link taps come up from the sandboxed bill.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.lxFeedback) {
        const bill = findBillByToken(t);
        const result = bill ? submitDemoFeedback(bill, e.data.lxFeedback) : { ok: false, j: { error: "not found" } };
        frame.current?.contentWindow?.postMessage({ lxFeedbackResult: result }, "*");
      }
      if (typeof e.data?.lxHeight === "number") setHeight(Math.ceil(e.data.lxHeight));
      if (e.data?.lxDownload) void download();
      if (typeof e.data?.lxOpen === "string") window.open(e.data.lxOpen, "_blank", "noopener");
      if (typeof e.data?.lxScroll === "number" && frame.current) window.scrollTo({ top: frame.current.getBoundingClientRect().top + window.scrollY + e.data.lxScroll - 16, behavior: "smooth" });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    document.body.style.background = look.bg;
    return () => {
      document.body.style.background = "";
    };
  }, [look.bg]);

  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 3500);
    return () => clearTimeout(id);
  }, [note]);

  if (!DEMO) return <div className="empty">Bills are served by the Leksy API at /b/&lt;token&gt;.</div>;
  if (err) return <div className="empty">{err}</div>;
  if (!html) return <div className="empty">Loading your bill…</div>;
  return (
    <div className="ebill" style={{ "--eb-accent": look.accent, "--eb-bg": look.bg, fontFamily: `'${look.font}', var(--app-font)` } as React.CSSProperties}>
      <iframe ref={frame} title="Your bill" scrolling="no" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox" srcDoc={html} style={{ height }} />
      <div className="ebill-bar" role="toolbar" aria-label="Bill actions">
        {note && <div className="ebill-note">{note}</div>}
        {phone && (
          <a className="eb-call" href={`tel:${phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${phone}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.6a1 1 0 01-.25 1z" fill="currentColor" />
            </svg>
            <span>Contact</span>
          </a>
        )}
        <button className="eb-primary" onClick={() => void download()} disabled={busy !== null}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12 3v12m0 0l-5-5m5 5l5-5M5 21h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {busy === "download" ? "Preparing…" : "Download PDF"}
        </button>
        <button className="eb-secondary" onClick={() => void share()} disabled={busy !== null}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12 15V3m0 0L7 8m5-5l5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {busy === "share" ? "Preparing…" : "Share"}
        </button>
      </div>
    </div>
  );
}

export default function BillPage() {
  return (
    <Suspense>
      <BillView />
    </Suspense>
  );
}
