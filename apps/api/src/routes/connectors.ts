import { BillSchema, validateBill } from "@leksy/bill-schema";
import { fetchFromBrand, randomToken } from "@leksy/core";
import { connectors, type PullConfig } from "@leksy/core/db";
import { applyMapping, MappingSchema, samplePaths, suggestMapping, type Mapping } from "@leksy/mapper";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { brandOf, userAuth } from "../auth.js";

const PullSchema = z.object({
  url: z.url(),
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  auth: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("none") }),
      z.object({ type: z.literal("bearer"), token: z.string() }),
      z.object({ type: z.literal("basic"), username: z.string(), password: z.string() }),
      z.object({ type: z.literal("header"), name: z.string(), value: z.string() }),
    ])
    .optional(),
  body: z.unknown().optional(),
  billsPath: z.string().max(200).optional(),
  cursorParam: z.string().max(64).optional(),
  cursorField: z.string().max(200).optional(),
});

const Upsert = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["push", "pull"]),
  pull: PullSchema.optional(),
  intervalSeconds: z.number().int().min(60).max(86_400).optional(),
  mapping: MappingSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});

/** Never echo stored credentials back to the browser. */
function redact(c: typeof connectors.$inferSelect) {
  const pull = c.pull ? { ...c.pull, auth: c.pull.auth && c.pull.auth.type !== "none" ? { type: c.pull.auth.type, redacted: true } : c.pull.auth } : null;
  return { ...c, pull };
}

export function previewMapping(mapping: Mapping | null, sample: unknown) {
  const mapped = mapping ? applyMapping(mapping, sample) : sample;
  const parsed = BillSchema.safeParse(mapped);
  return {
    mapped,
    valid: parsed.success,
    errors: parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    warnings: parsed.success ? validateBill(parsed.data) : [],
  };
}

export const connectorRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  const admin = userAuth(["owner", "admin"]);
  const ingestUrl = (key: string) => `${d.cfg.PUBLIC_BASE_URL.replace(/\/$/, "")}/v1/ingest/${key}`;

  app.get("/v1/connectors", { preHandler: userAuth() }, async (req) => {
    const rows = await d.db.query.connectors.findMany({ where: eq(connectors.brandId, brandOf(req)), orderBy: asc(connectors.createdAt) });
    return { connectors: rows.map((c) => ({ ...redact(c), ingestUrl: ingestUrl(c.ingestKey) })) };
  });

  app.post("/v1/connectors", { preHandler: admin }, async (req, reply) => {
    const body = Upsert.parse(req.body);
    if (body.kind === "pull" && !body.pull) return reply.code(400).send({ error: "pull config required" });
    const [row] = await d.db
      .insert(connectors)
      .values({ brandId: brandOf(req), name: body.name, kind: body.kind, pull: (body.pull as PullConfig) ?? null, intervalSeconds: body.intervalSeconds ?? null, mapping: body.mapping ?? null, ingestKey: randomToken(24) })
      .returning();
    return reply.code(201).send({ ...redact(row!), ingestUrl: ingestUrl(row!.ingestKey) });
  });

  app.put<{ Params: { id: string } }>("/v1/connectors/:id", { preHandler: admin }, async (req, reply) => {
    const body = Upsert.partial().parse(req.body);
    const existing = await d.db.query.connectors.findFirst({ where: and(eq(connectors.id, req.params.id), eq(connectors.brandId, brandOf(req))) });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    // Keep stored credentials when the UI sends back a redacted auth block.
    let pull = body.pull as PullConfig | undefined;
    if (pull && (pull.auth as { redacted?: boolean } | undefined)?.redacted) pull = { ...pull, auth: existing.pull?.auth };
    const [row] = await d.db
      .update(connectors)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(pull !== undefined && { pull }),
        ...(body.intervalSeconds !== undefined && { intervalSeconds: body.intervalSeconds }),
        ...(body.mapping !== undefined && { mapping: body.mapping }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      })
      .where(eq(connectors.id, existing.id))
      .returning();
    return { ...redact(row!), ingestUrl: ingestUrl(row!.ingestKey) };
  });

  app.delete<{ Params: { id: string } }>("/v1/connectors/:id", { preHandler: admin }, async (req, reply) => {
    await d.db.delete(connectors).where(and(eq(connectors.id, req.params.id), eq(connectors.brandId, brandOf(req))));
    return reply.code(204).send();
  });

  /** Get a sample payload (fetch from the brand's API, or the last pushed one) plus a suggested mapping. */
  app.post<{ Params: { id: string } }>("/v1/connectors/:id/sample", { preHandler: admin }, async (req, reply) => {
    const c = await d.db.query.connectors.findFirst({ where: and(eq(connectors.id, req.params.id), eq(connectors.brandId, brandOf(req))) });
    if (!c) return reply.code(404).send({ error: "not_found" });
    let sample = c.sample;
    if (c.kind === "pull" && c.pull) {
      try {
        const list = await fetchFromBrand(c.pull, c.cursor, d.cfg.ALLOW_PRIVATE_URLS);
        sample = list[0] ?? null;
        if (sample) await d.db.update(connectors).set({ sample }).where(eq(connectors.id, c.id));
      } catch (e) {
        return reply.code(502).send({ error: "fetch_failed", message: (e as Error).message });
      }
    }
    if (!sample) return { sample: null, paths: [], suggestion: null, message: c.kind === "push" ? `POST any bill JSON to ${ingestUrl(c.ingestKey)} to capture a sample.` : "The API returned no bills." };
    const suggestion = sample && typeof sample === "object" && !Array.isArray(sample) ? suggestMapping(sample as Record<string, unknown>) : null;
    return { sample, paths: samplePaths(sample), suggestion, preview: previewMapping((c.mapping as Mapping) ?? suggestion, sample) };
  });

  app.post<{ Params: { id: string } }>("/v1/connectors/:id/run", { preHandler: admin }, async (req, reply) => {
    const c = await d.db.query.connectors.findFirst({ where: and(eq(connectors.id, req.params.id), eq(connectors.brandId, brandOf(req))) });
    if (!c || c.kind !== "pull") return reply.code(404).send({ error: "not_a_pull_connector" });
    await d.queues.pull.add("manual", { connectorId: c.id });
    return reply.code(202).send({ status: "queued" });
  });

  /** Try a mapping on a sample without saving it. */
  app.post("/v1/mapping/preview", { preHandler: userAuth() }, async (req) => {
    const body = z.object({ mapping: MappingSchema.nullable(), sample: z.unknown() }).parse(req.body);
    return previewMapping(body.mapping, body.sample);
  });

  app.post("/v1/mapping/suggest", { preHandler: userAuth() }, async (req) => {
    const body = z.object({ sample: z.record(z.string(), z.unknown()) }).parse(req.body);
    return { suggestion: suggestMapping(body.sample), paths: samplePaths(body.sample) };
  });
};
