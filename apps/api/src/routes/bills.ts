import { billLinks } from "@leksy/core";
import { bills, deliveries, events, feedback, stores } from "@leksy/core/db";
import { and, desc, eq, ilike, inArray, lt, or, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { brandOf, inScope, userAuth } from "../auth.js";

const ListQuery = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  before: z.iso.datetime({ offset: true }).optional(),
  store: z.string().optional(),
  status: z.string().optional(),
  q: z.string().max(100).optional(),
});

export const billRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/v1/bills") && req.method === "GET") return userAuth()(req, reply);
  });

  app.get("/v1/bills", async (req) => {
    const q = ListQuery.parse(req.query);
    const brandId = brandOf(req);
    const where: SQL[] = [eq(bills.brandId, brandId)];
    const scope = req.principal?.storeCodes;
    if (scope?.length) where.push(inArray(bills.storeCode, scope));
    if (q.store) where.push(eq(bills.storeCode, q.store));
    if (q.status) where.push(eq(bills.status, q.status as typeof bills.$inferSelect.status));
    if (q.before) where.push(lt(bills.issuedAt, new Date(q.before)));
    if (q.q) where.push(or(ilike(bills.invoiceNo, `%${q.q}%`), ilike(bills.customerPhone, `%${q.q}%`))!);
    const rows = await d.db
      .select({
        id: bills.id,
        invoiceNo: bills.invoiceNo,
        storeCode: bills.storeCode,
        storeName: stores.name,
        total: bills.total,
        issuedAt: bills.issuedAt,
        status: bills.status,
        source: bills.source,
        customerPhone: bills.customerPhone,
        openedAt: bills.openedAt,
        token: bills.token,
        rating: feedback.rating,
      })
      .from(bills)
      .leftJoin(feedback, eq(feedback.billId, bills.id))
      .leftJoin(stores, and(eq(stores.brandId, bills.brandId), eq(stores.code, bills.storeCode)))
      .where(and(...where))
      .orderBy(desc(bills.issuedAt))
      .limit(q.limit);
    return { bills: rows.map(({ token, ...r }) => ({ ...r, url: billLinks(d.cfg.PUBLIC_BASE_URL, token).page })) };
  });

  app.get<{ Params: { id: string } }>("/v1/bills/:id", async (req, reply) => {
    const bill = await d.db.query.bills.findFirst({ where: and(eq(bills.id, req.params.id), eq(bills.brandId, brandOf(req))) });
    if (!bill || !inScope(req, bill.storeCode)) return reply.code(404).send({ error: "not_found" });
    const [del, fb, ev] = await Promise.all([
      d.db.query.deliveries.findMany({ where: eq(deliveries.billId, bill.id), orderBy: desc(deliveries.createdAt) }),
      d.db.query.feedback.findFirst({ where: eq(feedback.billId, bill.id) }),
      d.db.query.events.findMany({ where: eq(events.billId, bill.id), orderBy: desc(events.at), limit: 50 }),
    ]);
    const { token, ...rest } = bill;
    return { bill: { ...rest, links: billLinks(d.cfg.PUBLIC_BASE_URL, token) }, deliveries: del, feedback: fb ?? null, events: ev };
  });

  app.post<{ Params: { id: string } }>("/v1/bills/:id/resend", { preHandler: userAuth(["owner", "admin", "manager"]) }, async (req, reply) => {
    const bill = await d.db.query.bills.findFirst({ where: and(eq(bills.id, req.params.id), eq(bills.brandId, brandOf(req))) });
    if (!bill || !inScope(req, bill.storeCode)) return reply.code(404).send({ error: "not_found" });
    const body = z.object({ channels: z.array(z.enum(["whatsapp", "sms", "email"])).min(1).default(["whatsapp", "sms", "email"]) }).parse(req.body ?? {});
    await d.queues.deliver.add("resend", { billId: bill.id, channels: body.channels });
    return reply.code(202).send({ status: "queued" });
  });
};
