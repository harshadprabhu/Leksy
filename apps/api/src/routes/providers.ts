import { safeEqual } from "@leksy/core";
import { bills, deliveries, events } from "@leksy/core/db";
import { eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { createHmac } from "node:crypto";
import type { Deps } from "../app.js";

interface WaStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  errors?: { code: number; title: string }[];
}

/** Delivery receipts from Meta's WhatsApp Cloud API. */
export const providerRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.get<{ Querystring: Record<string, string> }>("/hooks/whatsapp", async (req, reply) => {
    const q = req.query;
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === d.cfg.WHATSAPP_VERIFY_TOKEN) return reply.type("text/plain").send(q["hub.challenge"]);
    return reply.code(403).send();
  });

  app.post("/hooks/whatsapp", async (req, reply) => {
    if (d.cfg.WHATSAPP_APP_SECRET) {
      const sig = String(req.headers["x-hub-signature-256"] ?? "");
      const expected = `sha256=${createHmac("sha256", d.cfg.WHATSAPP_APP_SECRET).update(req.rawBody ?? "").digest("hex")}`;
      if (!safeEqual(sig, expected)) return reply.code(401).send();
    }
    const body = req.body as { entry?: { changes?: { value?: { statuses?: WaStatus[] } }[] }[] };
    const statuses = body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.statuses ?? []) ?? []) ?? [];
    for (const s of statuses) {
      const [row] = await d.db
        .update(deliveries)
        .set({ status: s.status, error: s.errors?.[0]?.title ?? null, updatedAt: sql`now()` })
        .where(eq(deliveries.providerMessageId, s.id))
        .returning();
      if (!row) continue;
      if (s.status === "delivered" || s.status === "read") {
        await d.db.update(bills).set({ status: "delivered" }).where(eq(bills.id, row.billId));
      }
      if (s.status === "failed") {
        // Fall through to the next channel (SMS/email).
        await d.queues.deliver.add("fallback", { billId: row.billId, channels: ["sms", "email"] });
      }
      await d.db.insert(events).values({ brandId: row.brandId, billId: row.billId, type: `delivery.${s.status}`, data: { channel: "whatsapp" } });
    }
    return { ok: true };
  });
};
