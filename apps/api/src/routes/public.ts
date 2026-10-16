import type { Bill } from "@leksy/bill-schema";
import { billLinks, contentHash, contextFor, emitWebhook, FeedbackError, randomToken, renderHtml, resolveSurvey, resolveTemplate, submitFeedback, templateByVersionId } from "@leksy/core";
import { CAROUSEL_JS, SHARE_JS } from "@leksy/template-engine";
import { bills, brands, events, feedback } from "@leksy/core/db";
import { eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { SURVEY_CSS, SURVEY_JS, surveyHtml } from "@leksy/survey";

const TOKEN = /^[0-9A-Za-z]{22}$/;

export const publicRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  const limit = { rateLimit: { max: 120, timeWindow: "1 minute" } };

  const load = async (token: string) => (TOKEN.test(token) ? d.db.query.bills.findFirst({ where: eq(bills.token, token) }) : undefined);

  const template = async (bill: typeof bills.$inferSelect) =>
    (bill.templateVersionId && (await templateByVersionId(d.db, bill.templateVersionId))) || (await resolveTemplate(d.db, bill.brandId, (bill.data as Bill).template ?? "luxe-gold")).template;

  const securityHeaders = (reply: FastifyReply, nonce: string) =>
    reply
      .header("content-security-policy", `default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`)
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer")
      .header("x-robots-tag", "noindex, nofollow")
      .header("cache-control", "private, no-store");

  /** The customer's bill page: branded bill + Project WOW survey. */
  app.get<{ Params: { token: string } }>("/b/:token", { config: limit }, async (req, reply) => {
    const bill = await load(req.params.token);
    if (!bill) return reply.code(404).type("text/html").send("<h1>Bill not found</h1>");
    const nonce = randomToken(16);
    securityHeaders(reply, nonce);
    const brand = await d.db.query.brands.findFirst({ where: eq(brands.id, bill.brandId) });
    const data = bill.data as Bill;
    const links = billLinks(d.cfg.PUBLIC_BASE_URL, bill.token);
    const ctx = await contextFor(d.db, bill.brandId, data, links);
    const s = await resolveSurvey(d.db, bill.brandId, bill.surveyKey ?? data.survey ?? "project-wow");
    const answered = s ? !!(await d.db.query.feedback.findFirst({ where: eq(feedback.billId, bill.id), columns: { id: true } })) : false;
    const html = await renderHtml(await template(bill), ctx, {
      title: `${brand?.name ?? "Your"} bill ${data.invoice_no}`,
      head: `<style>${SURVEY_CSS}</style>`,
      surveyHtml: s ? (title) => surveyHtml(s.survey, title, answered) : () => "",
      bodyEnd: `<script nonce="${nonce}">${SHARE_JS}${CAROUSEL_JS}${s && !answered ? SURVEY_JS : ""}</script>`,
    });
    // Count opens (first open drives the "opened" metric).
    await d.db.update(bills).set({ openCount: sql`${bills.openCount} + 1`, openedAt: sql`coalesce(${bills.openedAt}, now())` }).where(eq(bills.id, bill.id));
    if (!bill.openedAt) {
      await d.db.insert(events).values({ brandId: bill.brandId, billId: bill.id, type: "bill.opened", data: {} });
      await emitWebhook(d.db, d.queues, bill.brandId, "bill.opened", { bill_id: bill.id, invoice_no: bill.invoiceNo, store_code: bill.storeCode });
    }
    return reply.type("text/html").send(html);
  });

  app.post<{ Params: { token: string } }>("/b/:token/feedback", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const bill = await load(req.params.token);
    if (!bill) return reply.code(404).send({ error: "not_found" });
    const s = await resolveSurvey(d.db, bill.brandId, bill.surveyKey ?? (bill.data as Bill).survey ?? "project-wow");
    if (!s) return reply.code(400).send({ error: "no_survey" });
    const body = z.object({ answers: z.record(z.string(), z.unknown()) }).parse(req.body);
    try {
      const out = await submitFeedback(
        d.db,
        bill,
        s.survey,
        { alert: s.row?.alertThreshold ?? 2, review: s.row?.reviewThreshold ?? 4, slaMinutes: s.row?.slaMinutes ?? 240 },
        body.answers,
      );
      if (out.alert) await d.queues.alert.add("low-score", { feedbackId: out.id });
      await emitWebhook(d.db, d.queues, bill.brandId, "feedback.submitted", { bill_id: bill.id, invoice_no: bill.invoiceNo, store_code: bill.storeCode, rating: out.rating, alert: out.alert });
      const brand = out.askReview ? await d.db.query.brands.findFirst({ where: eq(brands.id, bill.brandId) }) : null;
      return { ok: true, reviewUrl: brand?.googleReviewUrl ?? null };
    } catch (e) {
      if (e instanceof FeedbackError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  /** PDF download, rendered from the same template as the page (without the survey). */
  app.get<{ Params: { token: string } }>("/b/:token/pdf", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const bill = await load(req.params.token);
    if (!bill) return reply.code(404).send({ error: "not_found" });
    const data = bill.data as Bill;
    // A brand may keep a separate printable design (e.g. an A4 tax invoice) for downloads.
    const brand = await d.db.query.brands.findFirst({ where: (b, { eq: e }) => e(b.id, bill.brandId) });
    const pdfKey = (brand?.settings as { pdfTemplate?: string } | null)?.pdfTemplate;
    const tpl = pdfKey ? (await resolveTemplate(d.db, bill.brandId, pdfKey)).template : await template(bill);
    const ctx = await contextFor(d.db, bill.brandId, data, billLinks(d.cfg.PUBLIC_BASE_URL, bill.token));
    const html = await renderHtml({ ...tpl, blocks: tpl.blocks.filter((b) => b.type !== "survey" && b.type !== "download_buttons") }, ctx, { title: data.invoice_no });
    const cacheKey = `pdf:${bill.id}:${bill.contentHash ?? contentHash(data)}:${pdfKey ?? bill.templateVersionId ?? "preset"}`;
    let pdf = await d.redis.getBuffer(cacheKey);
    if (!pdf) {
      pdf = await d.pdf.render(html, tpl.page.format);
      await d.redis.set(cacheKey, pdf, "EX", 86400);
    }
    await d.db.insert(events).values({ brandId: bill.brandId, billId: bill.id, type: "bill.downloaded", data: { format: "pdf" } });
    return reply
      .type("application/pdf")
      .header("content-disposition", `attachment; filename="${data.invoice_no.replace(/[^\w.-]/g, "_")}.pdf"`)
      .header("cache-control", "private, max-age=300")
      .send(pdf);
  });

  /** Machine-readable copy of the bill. */
  app.get<{ Params: { token: string } }>("/b/:token/json", { config: limit }, async (req, reply) => {
    const bill = await load(req.params.token);
    if (!bill) return reply.code(404).send({ error: "not_found" });
    return reply.header("content-disposition", `attachment; filename="${bill.invoiceNo.replace(/[^\w.-]/g, "_")}.json"`).send(bill.data);
  });

  /** Verification page behind the QR: proves the bill was issued by the brand and is unchanged. */
  app.get<{ Params: { token: string } }>("/v/:token", { config: limit }, async (req, reply) => {
    const bill = await load(req.params.token);
    reply.type("text/html").header("x-robots-tag", "noindex");
    if (!bill) return reply.code(404).send(`<h1>Not a valid Leksy bill</h1>`);
    const brand = await d.db.query.brands.findFirst({ where: eq(brands.id, bill.brandId) });
    const data = bill.data as Bill;
    const intact = !bill.contentHash || bill.contentHash === contentHash(data);
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    return reply.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px"><h2>${intact ? "✅ Genuine bill" : "⚠️ Bill data changed"}</h2><p><b>${esc(brand?.name ?? "")}</b><br>Invoice ${esc(data.invoice_no)} · ${esc(data.store_code)}<br>Issued ${esc(new Date(data.issued_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}<br>Total ₹${data.total.toLocaleString("en-IN")}</p><p style="color:#666;font-size:12px">Fingerprint ${esc((bill.contentHash ?? "").slice(0, 16))}</p></body>`);
  });

};
