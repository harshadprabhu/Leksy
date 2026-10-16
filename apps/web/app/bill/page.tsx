"use client";
import type { Bill } from "@leksy/bill-schema";
import { SURVEY_CSS, SURVEY_JS, surveyHtml } from "@leksy/survey";
import { renderDocument } from "@leksy/template-engine";
import QRCode from "qrcode";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { DEMO } from "@/lib/api";
import { billContext, billTemplate, findBillByToken, hasFeedback, liveTemplate, load, markOpened, submitDemoFeedback, surveyFor } from "@/lib/demo";

/**
 * What the customer sees after tapping the WhatsApp link (demo build).
 * The production page is served by the API at /b/:token with the same template and survey.
 */
const BRIDGE = `<script>
window.LX_SUBMIT=function(a){return new Promise(function(res){
  function on(e){if(e.data&&e.data.lxFeedbackResult){removeEventListener('message',on);res(e.data.lxFeedbackResult);}}
  addEventListener('message',on);parent.postMessage({lxFeedback:a},'*');});};
document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;
  if(a.href.indexOf('print=1')>=0||a.href.indexOf('/verify/')>=0){e.preventDefault();parent.postMessage({lxOpen:a.href},'*');}},true);
</script>`;

function BillView() {
  const params = useSearchParams();
  const t = params.get("t") ?? "";
  const printing = params.get("print") === "1";
  const [html, setHtml] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!DEMO) return;
    const bill = findBillByToken(t);
    if (!bill) {
      setErr("Bill not found");
      return;
    }
    let unlocked = true;
    try {
      unlocked = !bill.otpLock || printing || sessionStorage.getItem(`lx_otp_${t}`) === "ok";
    } catch {}
    if (!unlocked) {
      setLocked(true);
      return;
    }
    void (async () => {
      const s = load();
      // Downloads use the brand's printable design when it has one (e.g. an A4 tax invoice).
      const pdfKey = printing ? (s.brand.settings?.pdfTemplate as string | undefined) : undefined;
      const tpl = (pdfKey && liveTemplate(s, pdfKey)) || billTemplate(s, bill);
      const ctx = billContext(s, bill);
      const answered = hasFeedback(bill);
      const sv = surveyFor(bill);
      const qr: { value: string; size: number }[] = [];
      const blocks = printing ? tpl.blocks.filter((b) => b.type !== "survey" && b.type !== "download_buttons") : tpl.blocks;
      let doc = renderDocument({ ...tpl, blocks }, ctx, {
        title: `${s.brand.name} bill ${(bill.data as Bill).invoice_no}`,
        head: `<style>${SURVEY_CSS}</style>${BRIDGE}`,
        surveySlot: (title) => (sv ? surveyHtml(sv.body, title, answered) : ""),
        bodyEnd: printing ? `<script>addEventListener('load',function(){setTimeout(function(){print()},700)})</script>` : answered || !sv ? "" : `<script>${SURVEY_JS}</script>`,
        qr: (value, size) => {
          qr.push({ value, size });
          return `<!--lx-qr-${qr.length - 1}-->`;
        },
      });
      const svgs = await Promise.all(qr.map((q) => QRCode.toString(q.value, { type: "svg", margin: 0, width: q.size })));
      doc = doc.replace(/<!--lx-qr-(\d+)-->/g, (_, i: string) => svgs[Number(i)] ?? "");
      setHtml(doc);
      if (!printing) markOpened(bill);
    })();
  }, [t, printing, locked]);

  // Survey answers and link clicks come up from the sandboxed bill.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.lxFeedback) {
        const bill = findBillByToken(t);
        const result = bill ? submitDemoFeedback(bill, e.data.lxFeedback) : { ok: false, j: { error: "not found" } };
        frame.current?.contentWindow?.postMessage({ lxFeedbackResult: result }, "*");
      }
      if (typeof e.data?.lxOpen === "string") window.open(e.data.lxOpen, "_blank", "noopener");
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [t]);

  if (!DEMO) return <div className="empty">Bills are served by the Leksy API at /b/&lt;token&gt;.</div>;
  if (err) return <div className="empty">{err}</div>;
  if (locked)
    return (
      <div className="auth">
        <div className="card stack" style={{ textAlign: "center" }}>
          <h2>This bill is protected</h2>
          <p className="muted small">High-value bills ask for a one-time code sent to the customer&apos;s phone. In this demo the code is 123456.</p>
          <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} style={{ fontSize: 22, letterSpacing: 8, textAlign: "center" }} />
          <button
            className="btn primary"
            onClick={() => {
              if (code === "123456") {
                try {
                  sessionStorage.setItem(`lx_otp_${t}`, "ok");
                } catch {}
                setLocked(false);
              } else alert("That code did not match.");
            }}
          >
            Open bill
          </button>
        </div>
      </div>
    );
  if (!html) return <div className="empty">Loading your bill…</div>;
  return <iframe ref={frame} title="Your bill" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox" srcDoc={html} style={{ border: 0, width: "100%", height: "100vh", display: "block" }} />;
}

export default function BillPage() {
  return (
    <Suspense>
      <BillView />
    </Suspense>
  );
}
