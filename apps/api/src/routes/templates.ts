import type { Bill } from "@leksy/bill-schema";
import { billLinks, contextFor, renderHtml } from "@leksy/core";
import { bills, templates, templateVersions } from "@leksy/core/db";
import { buildContext, listFields, PRESETS, SAMPLE_BILL, SAMPLE_BRAND, SAMPLE_STORE, TemplateSchema } from "@leksy/template-engine";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { brandOf, inScope, userAuth } from "../auth.js";

const Create = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,64}$/),
  name: z.string().min(1).max(120),
  from: z.string().optional(),
  draft: z.unknown().optional(),
});

export const templateRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  const editors = userAuth(["owner", "admin"]);
  const viewers = userAuth();

  /** Data for previews: a real bill of the brand, or the built-in sample. */
  const previewContext = async (req: FastifyRequest, billId?: string) => {
    const brandId = brandOf(req);
    if (billId && /^[0-9a-f-]{36}$/i.test(billId)) {
      const bill = await d.db.query.bills.findFirst({ where: and(eq(bills.id, billId), eq(bills.brandId, brandId)) });
      if (bill && inScope(req, bill.storeCode)) return contextFor(d.db, brandId, bill.data as Bill, billLinks(d.cfg.PUBLIC_BASE_URL, bill.token));
    }
    const scope = req.principal?.storeCodes;
    const latest = await d.db.query.bills.findFirst({ where: and(eq(bills.brandId, brandId), ...(scope?.length ? [inArray(bills.storeCode, scope)] : [])), orderBy: desc(bills.issuedAt) });
    if (latest) return contextFor(d.db, brandId, latest.data as Bill, billLinks(d.cfg.PUBLIC_BASE_URL, latest.token));
    return buildContext(SAMPLE_BILL, { brand: SAMPLE_BRAND, store: SAMPLE_STORE, links: billLinks(d.cfg.PUBLIC_BASE_URL, "SAMPLE") });
  };

  app.get("/v1/templates/presets", { preHandler: viewers }, async () => ({ presets: Object.entries(PRESETS).map(([key, t]) => ({ key, name: t.name, template: t })) }));

  app.get("/v1/templates", { preHandler: viewers }, async (req) => ({
    templates: await d.db
      .select({ id: templates.id, key: templates.key, name: templates.name, publishedVersion: templates.publishedVersion, updatedAt: templates.updatedAt })
      .from(templates)
      .where(eq(templates.brandId, brandOf(req)))
      .orderBy(asc(templates.name)),
  }));

  app.get<{ Params: { id: string } }>("/v1/templates/:id", { preHandler: viewers }, async (req, reply) => {
    const t = await d.db.query.templates.findFirst({ where: and(eq(templates.id, req.params.id), eq(templates.brandId, brandOf(req))) });
    return t ?? reply.code(404).send({ error: "not_found" });
  });

  app.post("/v1/templates", { preHandler: editors }, async (req, reply) => {
    const body = Create.parse(req.body);
    const draft = TemplateSchema.parse(body.draft ?? PRESETS[body.from ?? "luxe-gold"] ?? PRESETS["luxe-gold"]);
    const [row] = await d.db.insert(templates).values({ brandId: brandOf(req), key: body.key, name: body.name, draft: { ...draft, name: body.name } }).onConflictDoNothing().returning();
    if (!row) return reply.code(409).send({ error: "key_in_use" });
    return reply.code(201).send(row);
  });

  app.put<{ Params: { id: string } }>("/v1/templates/:id", { preHandler: editors }, async (req, reply) => {
    const body = z.object({ name: z.string().min(1).max(120).optional(), draft: z.unknown() }).parse(req.body);
    const parsed = TemplateSchema.safeParse(body.draft);
    if (!parsed.success) return reply.code(422).send({ error: "invalid_template", details: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) });
    const [row] = await d.db
      .update(templates)
      .set({ draft: parsed.data, ...(body.name ? { name: body.name } : {}), updatedAt: sql`now()` })
      .where(and(eq(templates.id, req.params.id), eq(templates.brandId, brandOf(req))))
      .returning();
    return row ?? reply.code(404).send({ error: "not_found" });
  });

  /** Freeze the draft as a new immutable version; new bills use it immediately. */
  app.post<{ Params: { id: string } }>("/v1/templates/:id/publish", { preHandler: editors }, async (req, reply) => {
    const brandId = brandOf(req);
    return d.db.transaction(async (tx) => {
      const t = await tx.query.templates.findFirst({ where: and(eq(templates.id, req.params.id), eq(templates.brandId, brandId)) });
      if (!t) return reply.code(404).send({ error: "not_found" });
      const last = await tx.query.templateVersions.findFirst({ where: eq(templateVersions.templateId, t.id), orderBy: desc(templateVersions.version) });
      const version = (last?.version ?? 0) + 1;
      await tx.insert(templateVersions).values({ templateId: t.id, version, body: TemplateSchema.parse(t.draft), publishedBy: req.principal?.userId });
      await tx.update(templates).set({ publishedVersion: version, updatedAt: sql`now()` }).where(eq(templates.id, t.id));
      return { version };
    });
  });

  app.get<{ Params: { id: string } }>("/v1/templates/:id/versions", { preHandler: viewers }, async (req, reply) => {
    const t = await d.db.query.templates.findFirst({ where: and(eq(templates.id, req.params.id), eq(templates.brandId, brandOf(req))) });
    if (!t) return reply.code(404).send({ error: "not_found" });
    const versions = await d.db
      .select({ id: templateVersions.id, version: templateVersions.version, createdAt: templateVersions.createdAt })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, t.id))
      .orderBy(desc(templateVersions.version));
    return { versions };
  });

  /** Render any template JSON against a real or sample bill (the studio's preview). */
  app.post("/v1/templates/preview", { preHandler: viewers }, async (req, reply) => {
    const body = z.object({ template: z.unknown(), billId: z.uuid().optional() }).parse(req.body);
    const parsed = TemplateSchema.safeParse(body.template);
    if (!parsed.success) return reply.code(422).send({ error: "invalid_template", details: parsed.error.issues.slice(0, 20) });
    const ctx = await previewContext(req, body.billId);
    return { html: await renderHtml(parsed.data, ctx, { title: "Preview" }) };
  });

  /** The data the studio's field picker shows, from the brand's latest bill. */
  app.get<{ Querystring: { billId?: string } }>("/v1/templates/fields", { preHandler: viewers }, async (req) => {
    const ctx = await previewContext(req, req.query.billId);
    return { fields: listFields(ctx), context: ctx };
  });
};
