import type { Bill } from "@leksy/bill-schema";
import {
  billLinks,
  ChannelError,
  contentHash,
  contextFor,
  DEFAULT_ACTIONS,
  deliverWebhook,
  emitWebhook,
  matchTrigger,
  resolveTemplate,
  runPull,
  send,
  sendAlert,
  type AlertJob,
  type Channel,
  type ChannelEnv,
  type ChannelSettings,
  type DeliverJob,
  type ProcessJob,
  type PullJob,
  type Queues,
  type WebhookJob,
} from "@leksy/core";
import { bills, brands, deliveries, events, feedback, stores, type Db } from "@leksy/core/db";
import { and, eq, lt, sql } from "drizzle-orm";

export interface WorkerDeps {
  db: Db;
  queues: Queues;
  channels: ChannelEnv;
  publicBaseUrl: string;
  allowPrivateUrls: boolean;
}

/** bill.created / bill.updated → pick a trigger, pin the template version, schedule delivery. */
export async function processBill(d: WorkerDeps, job: ProcessJob) {
  const bill = await d.db.query.bills.findFirst({ where: eq(bills.id, job.billId) });
  if (!bill) return;
  const data = bill.data as Bill;
  await emitWebhook(d.db, d.queues, bill.brandId, job.event === "bill.created" ? "bill.received" : "bill.updated", { bill_id: bill.id, invoice_no: bill.invoiceNo, store_code: bill.storeCode });

  const trigger = await matchTrigger(d.db, bill.brandId, job.event, data as unknown as Record<string, unknown>);
  if (!trigger && job.event === "bill.updated") {
    // Updates re-render with the pinned template but are not re-sent unless a rule says so.
    await d.db.update(bills).set({ contentHash: contentHash(data) }).where(eq(bills.id, bill.id));
    return;
  }
  const actions = trigger?.actions ?? DEFAULT_ACTIONS;
  const { versionId } = await resolveTemplate(d.db, bill.brandId, data.template ?? actions.templateKey);
  const skip = data.customer.consent === false || (!data.customer.phone && !data.customer.email);
  await d.db
    .update(bills)
    .set({
      triggerId: trigger?.id ?? null,
      templateVersionId: versionId,
      surveyKey: data.survey ?? actions.surveyKey ?? null,
      otpLock: actions.otpLock ?? false,
      contentHash: contentHash(data),
      status: skip ? "skipped" : "queued",
      updatedAt: sql`now()`,
    })
    .where(eq(bills.id, bill.id));
  if (skip) {
    await d.db.insert(events).values({ brandId: bill.brandId, billId: bill.id, type: "bill.skipped", data: { reason: data.customer.consent === false ? "no_consent" : "no_contact" } });
    return;
  }
  await d.queues.deliver.add("send", { billId: bill.id, channels: actions.channels }, { delay: (actions.delaySeconds ?? 0) * 1000, jobId: `send-${bill.id}-${job.event.replace(".", "-")}` });
}

/** Try each channel in order until one accepts the message. */
export async function deliverBill(d: WorkerDeps, job: DeliverJob) {
  const bill = await d.db.query.bills.findFirst({ where: eq(bills.id, job.billId) });
  if (!bill) return;
  const data = bill.data as Bill;
  const brand = await d.db.query.brands.findFirst({ where: eq(brands.id, bill.brandId) });
  const links = billLinks(d.publicBaseUrl, bill.token);
  const ctx = await contextFor(d.db, bill.brandId, data, links);
  const settings = ((brand?.settings as { channels?: ChannelSettings } | undefined)?.channels ?? {}) as ChannelSettings;
  let lastError: Error | null = null;

  for (const channel of job.channels as Channel[]) {
    const to = channel === "email" ? data.customer.email : data.customer.phone;
    if (!to) continue;
    const already = await d.db.query.deliveries.findFirst({ where: and(eq(deliveries.billId, bill.id), eq(deliveries.channel, channel), sql`${deliveries.status} in ('sent','delivered','read')`) });
    if (already) return; // retry after a crash: never double-send
    const [row] = await d.db.insert(deliveries).values({ billId: bill.id, brandId: bill.brandId, channel, to, status: "queued" }).returning();
    try {
      const res = await send(channel, { to, ctx, pageUrl: links.page!, pdfUrl: links.pdf, token: bill.token, settings }, d.channels);
      await d.db.update(deliveries).set({ status: "sent", providerMessageId: res.providerMessageId, updatedAt: sql`now()` }).where(eq(deliveries.id, row!.id));
      await d.db.update(bills).set({ status: "sent", updatedAt: sql`now()` }).where(eq(bills.id, bill.id));
      await d.db.insert(events).values({ brandId: bill.brandId, billId: bill.id, type: "delivery.sent", data: { channel, simulated: !!res.simulated } });
      await emitWebhook(d.db, d.queues, bill.brandId, "bill.sent", { bill_id: bill.id, invoice_no: bill.invoiceNo, channel });
      return;
    } catch (e) {
      lastError = e as Error;
      await d.db.update(deliveries).set({ status: "failed", error: lastError.message.slice(0, 500), updatedAt: sql`now()` }).where(eq(deliveries.id, row!.id));
      if (!(e instanceof ChannelError && e.permanent)) throw e; // transient: let BullMQ retry
    }
  }
  await d.db.update(bills).set({ status: "failed", updatedAt: sql`now()` }).where(eq(bills.id, bill.id));
  await d.db.insert(events).values({ brandId: bill.brandId, billId: bill.id, type: "delivery.failed", data: { error: lastError?.message ?? "no reachable channel" } });
}

export async function pullConnector(d: WorkerDeps, job: PullJob) {
  const out = await runPull(d.db, job.connectorId, d.allowPrivateUrls);
  for (const r of out.results) {
    if (r.changed) await d.queues.process.add(r.created ? "bill.created" : "bill.updated", { billId: r.id, event: r.created ? "bill.created" : "bill.updated" });
  }
  return { fetched: out.fetched, ingested: out.results.length, errors: out.errors.length };
}

/** Low score → tell the store manager right away. */
export async function alertLowScore(d: WorkerDeps, job: AlertJob) {
  const fb = await d.db.query.feedback.findFirst({ where: eq(feedback.id, job.feedbackId) });
  if (!fb) return;
  const bill = await d.db.query.bills.findFirst({ where: eq(bills.id, fb.billId) });
  const store = await d.db.query.stores.findFirst({ where: and(eq(stores.brandId, fb.brandId), eq(stores.code, fb.storeCode)) });
  const data = bill?.data as Bill | undefined;
  const improve = Array.isArray(fb.answers.improve) ? ` Issues: ${(fb.answers.improve as string[]).join(", ")}.` : "";
  const text = `Leksy alert — ${store?.name ?? fb.storeCode}: ${data?.customer.name ?? "A customer"} rated ${fb.rating}/5 (invoice ${bill?.invoiceNo}).${improve}${fb.comment ? ` "${fb.comment.slice(0, 200)}"` : ""} Call ${data?.customer.phone ?? "-"} within ${fb.slaDueAt ? Math.round((fb.slaDueAt.getTime() - Date.now()) / 60000) : 240} min.`;
  await sendAlert({ phone: store?.managerPhone, email: store?.managerEmail }, text, d.channels);
  await d.db.insert(events).values({ brandId: fb.brandId, billId: fb.billId, type: "alert.sent", data: { rating: fb.rating } });
}

/** Tickets past their SLA are escalated once and logged. */
export async function checkSla(d: WorkerDeps) {
  const late = await d.db.query.feedback.findMany({ where: and(eq(feedback.ticketStatus, "open"), lt(feedback.slaDueAt, new Date())), limit: 500 });
  for (const fb of late) {
    const escalated = await d.db.query.events.findFirst({ where: and(eq(events.billId, fb.billId), eq(events.type, "alert.sla_breached")) });
    if (escalated) continue;
    await d.db.insert(events).values({ brandId: fb.brandId, billId: fb.billId, type: "alert.sla_breached", data: { rating: fb.rating } });
    await emitWebhook(d.db, d.queues, fb.brandId, "ticket.sla_breached", { feedback_id: fb.id, store_code: fb.storeCode, rating: fb.rating });
  }
  return { breached: late.length };
}

export async function sendWebhook(d: WorkerDeps, job: WebhookJob) {
  await deliverWebhook(d.db, job.endpointId, job.event, job.payload, d.allowPrivateUrls);
}
