import { and, eq } from "drizzle-orm";
import { signPayload } from "../crypto.js";
import { webhookEndpoints, type Db } from "../db/index.js";
import type { Queues } from "../queues.js";
import { assertPublicUrl } from "./net.js";

/** Fan an event out to every subscribed endpoint of the brand (sent by the worker). */
export async function emitWebhook(db: Db, queues: Queues, brandId: string, event: string, payload: Record<string, unknown>) {
  const endpoints = await db.query.webhookEndpoints.findMany({ where: and(eq(webhookEndpoints.brandId, brandId), eq(webhookEndpoints.enabled, true)) });
  for (const ep of endpoints) {
    if (ep.events.includes("*") || ep.events.includes(event)) {
      await queues.webhook.add(event, { endpointId: ep.id, event, payload });
    }
  }
}

export async function deliverWebhook(db: Db, endpointId: string, event: string, payload: Record<string, unknown>, allowPrivate = false) {
  const ep = await db.query.webhookEndpoints.findFirst({ where: eq(webhookEndpoints.id, endpointId) });
  if (!ep || !ep.enabled) return;
  const url = await assertPublicUrl(ep.url, allowPrivate);
  const body = JSON.stringify({ event, created_at: new Date().toISOString(), data: payload });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-leksy-event": event, "x-leksy-signature": signPayload(ep.secret, body) },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`webhook ${ep.url} returned ${res.status}`);
}
