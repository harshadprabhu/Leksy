import { generateApiKey, randomToken, summary, SurveySchema } from "@leksy/core";
import { apiKeys, brands, feedback, stores, surveys, triggers, webhookEndpoints } from "@leksy/core/db";
import { ConditionSchema } from "@leksy/template-engine";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { brandOf, userAuth } from "../auth.js";

const StoreBody = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  region: z.string().max(100).nullish(),
  address: z.string().max(500).nullish(),
  city: z.string().max(100).nullish(),
  phone: z.string().max(32).nullish(),
  gstin: z.string().max(15).nullish(),
  managerName: z.string().max(200).nullish(),
  managerPhone: z.string().max(32).nullish(),
  managerEmail: z.email().nullish(),
  mapsUrl: z.url().nullish(),
  active: z.boolean().optional(),
});

const TriggerBody = z.object({
  name: z.string().min(1).max(120),
  event: z.enum(["bill.created", "bill.updated"]).default("bill.created"),
  conditions: z.array(ConditionSchema).max(20).default([]),
  actions: z.object({
    templateKey: z.string().min(1).max(64),
    surveyKey: z.string().max(64).optional(),
    channels: z.array(z.enum(["whatsapp", "sms", "email"])).min(1),
    delaySeconds: z.number().int().min(0).max(86_400).optional(),
    otpLock: z.boolean().optional(),
  }),
  priority: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true),
});

export const adminRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  const admin = userAuth(["owner", "admin"]);
  const anyUser = userAuth();

  // Brand settings (logo, review link, channel settings).
  app.put("/v1/brand", { preHandler: admin }, async (req) => {
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        logoUrl: z.url().nullish(),
        website: z.url().nullish(),
        supportPhone: z.string().max(32).nullish(),
        googleReviewUrl: z.url().nullish(),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body);
    const [row] = await d.db.update(brands).set(body).where(eq(brands.id, brandOf(req))).returning();
    return row;
  });

  // Stores
  app.get("/v1/stores", { preHandler: anyUser }, async (req) => ({ stores: await d.db.query.stores.findMany({ where: eq(stores.brandId, brandOf(req)), orderBy: asc(stores.code) }) }));
  app.post("/v1/stores", { preHandler: admin }, async (req, reply) => {
    const [row] = await d.db.insert(stores).values({ ...StoreBody.parse(req.body), brandId: brandOf(req) }).onConflictDoNothing().returning();
    return row ? reply.code(201).send(row) : reply.code(409).send({ error: "code_in_use" });
  });
  app.put<{ Params: { id: string } }>("/v1/stores/:id", { preHandler: admin }, async (req, reply) => {
    const [row] = await d.db.update(stores).set(StoreBody.partial().parse(req.body)).where(and(eq(stores.id, req.params.id), eq(stores.brandId, brandOf(req)))).returning();
    return row ?? reply.code(404).send({ error: "not_found" });
  });

  // Triggers: when to send what, through which channels.
  app.get("/v1/triggers", { preHandler: anyUser }, async (req) => ({ triggers: await d.db.query.triggers.findMany({ where: eq(triggers.brandId, brandOf(req)), orderBy: [asc(triggers.priority), asc(triggers.createdAt)] }) }));
  app.post("/v1/triggers", { preHandler: admin }, async (req, reply) => {
    const [row] = await d.db.insert(triggers).values({ ...TriggerBody.parse(req.body), brandId: brandOf(req) }).returning();
    return reply.code(201).send(row);
  });
  app.put<{ Params: { id: string } }>("/v1/triggers/:id", { preHandler: admin }, async (req, reply) => {
    const [row] = await d.db.update(triggers).set(TriggerBody.partial().parse(req.body)).where(and(eq(triggers.id, req.params.id), eq(triggers.brandId, brandOf(req)))).returning();
    return row ?? reply.code(404).send({ error: "not_found" });
  });
  app.delete<{ Params: { id: string } }>("/v1/triggers/:id", { preHandler: admin }, async (req, reply) => {
    await d.db.delete(triggers).where(and(eq(triggers.id, req.params.id), eq(triggers.brandId, brandOf(req))));
    return reply.code(204).send();
  });

  // Surveys
  app.get("/v1/surveys", { preHandler: anyUser }, async (req) => ({ surveys: await d.db.query.surveys.findMany({ where: eq(surveys.brandId, brandOf(req)) }) }));
  app.put<{ Params: { key: string } }>("/v1/surveys/:key", { preHandler: admin }, async (req) => {
    const body = z
      .object({ name: z.string().min(1).max(120), body: SurveySchema, alertThreshold: z.number().int().min(0).max(5).default(2), reviewThreshold: z.number().int().min(1).max(6).default(4), slaMinutes: z.number().int().min(5).max(10_080).default(240) })
      .parse(req.body);
    const [row] = await d.db
      .insert(surveys)
      .values({ ...body, key: req.params.key, brandId: brandOf(req) })
      .onConflictDoUpdate({ target: [surveys.brandId, surveys.key], set: body })
      .returning();
    return row;
  });

  // Feedback inbox and tickets
  app.get("/v1/feedback", { preHandler: anyUser }, async (req) => {
    const q = z.object({ ticket: z.enum(["open", "in_progress", "resolved"]).optional(), store: z.string().optional(), maxRating: z.coerce.number().optional(), limit: z.coerce.number().min(1).max(200).default(50) }).parse(req.query);
    const where: SQL[] = [eq(feedback.brandId, brandOf(req))];
    if (req.principal?.storeCodes?.length) where.push(inArray(feedback.storeCode, req.principal.storeCodes));
    if (q.ticket) where.push(eq(feedback.ticketStatus, q.ticket));
    if (q.store) where.push(eq(feedback.storeCode, q.store));
    if (q.maxRating) where.push(sql`${feedback.rating} <= ${q.maxRating}`);
    const [rows, counts] = await Promise.all([
      d.db.query.feedback.findMany({ where: and(...where), orderBy: desc(feedback.createdAt), limit: q.limit }),
      d.db.select({ rating: feedback.rating, n: sql<number>`count(*)::int` }).from(feedback).where(and(...where)).groupBy(feedback.rating),
    ]);
    // How many responses gave each rating, 1 to 5, across everything matched (not just this page).
    const dist = [1, 2, 3, 4, 5].map((r) => counts.find((c) => c.rating === r)?.n ?? 0);
    return { total: dist.reduce((a, b) => a + b, 0), dist, feedback: rows };
  });
  app.patch<{ Params: { id: string } }>("/v1/feedback/:id", { preHandler: userAuth(["owner", "admin", "manager"]) }, async (req, reply) => {
    const body = z.object({ ticketStatus: z.enum(["open", "in_progress", "resolved"]), resolutionNote: z.string().max(2000).optional() }).parse(req.body);
    const [row] = await d.db
      .update(feedback)
      .set({ ...body, resolvedAt: body.ticketStatus === "resolved" ? sql`now()` : null })
      .where(and(eq(feedback.id, req.params.id), eq(feedback.brandId, brandOf(req))))
      .returning();
    return row ?? reply.code(404).send({ error: "not_found" });
  });

  // Analytics
  app.get("/v1/analytics/summary", { preHandler: anyUser }, async (req) => {
    const q = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), store: z.string().optional() }).parse(req.query);
    const to = q.to ? new Date(`${q.to}T23:59:59.999+05:30`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00+05:30`) : new Date(to.getTime() - 30 * 864e5);
    const scope = q.store ? [q.store] : (req.principal?.storeCodes ?? undefined);
    return summary(d.db, brandOf(req), from, to, scope ?? undefined);
  });

  // API keys
  app.get("/v1/api-keys", { preHandler: admin }, async (req) => ({
    keys: await d.db
      .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, requireSignature: apiKeys.requireSignature, lastUsedAt: apiKeys.lastUsedAt, createdAt: apiKeys.createdAt })
      .from(apiKeys)
      .where(and(eq(apiKeys.brandId, brandOf(req)), isNull(apiKeys.revokedAt))),
  }));
  app.post("/v1/api-keys", { preHandler: admin }, async (req, reply) => {
    const body = z.object({ name: z.string().min(1).max(80), requireSignature: z.boolean().default(false) }).parse(req.body);
    const k = generateApiKey("live");
    await d.db.insert(apiKeys).values({ brandId: brandOf(req), name: body.name, prefix: k.prefix, secretHash: k.secretHash, signingSecret: k.signingSecret, requireSignature: body.requireSignature });
    return reply.code(201).send({ key: k.key, signingSecret: k.signingSecret, note: "Store this key now; it is shown only once." });
  });
  app.delete<{ Params: { id: string } }>("/v1/api-keys/:id", { preHandler: admin }, async (req, reply) => {
    await d.db.update(apiKeys).set({ revokedAt: sql`now()` }).where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.brandId, brandOf(req))));
    return reply.code(204).send();
  });

  // Outbound webhooks
  app.get("/v1/webhooks", { preHandler: admin }, async (req) => ({
    webhooks: (await d.db.query.webhookEndpoints.findMany({ where: eq(webhookEndpoints.brandId, brandOf(req)) })).map(({ secret: _s, ...w }) => w),
  }));
  app.post("/v1/webhooks", { preHandler: admin }, async (req, reply) => {
    const body = z.object({ url: z.url(), events: z.array(z.string()).min(1).default(["*"]) }).parse(req.body);
    const secret = `whsec_${randomToken(32)}`;
    const [row] = await d.db.insert(webhookEndpoints).values({ ...body, secret, brandId: brandOf(req) }).returning();
    return reply.code(201).send({ ...row, secret, note: "Verify X-Leksy-Signature with this secret." });
  });
  app.delete<{ Params: { id: string } }>("/v1/webhooks/:id", { preHandler: admin }, async (req, reply) => {
    await d.db.delete(webhookEndpoints).where(and(eq(webhookEndpoints.id, req.params.id), eq(webhookEndpoints.brandId, brandOf(req))));
    return reply.code(204).send();
  });
};
