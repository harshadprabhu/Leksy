import { billLinks, ingestBill, IngestError, ingestRawBatch, type IngestResult } from "@leksy/core";
import { connectors } from "@leksy/core/db";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { Deps } from "../app.js";
import { anyAuth, apiKeyAuth, brandOf } from "../auth.js";

export const ingestRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  const enqueue = async (r: IngestResult) => {
    // Never-processed bills (including retries of one whose first enqueue failed) go out as
    // "created"; the fixed job id makes repeats a no-op.
    if (r.pending) await d.queues.process.add("bill.created", { billId: r.id, event: "bill.created" }, { jobId: `${r.id}-c` });
    else if (r.changed) await d.queues.process.add("bill.updated", { billId: r.id, event: "bill.updated" }, { jobId: `${r.id}-u-${Date.now()}` });
  };
  const view = (r: IngestResult) => ({
    id: r.id,
    created: r.created,
    changed: r.changed,
    status: r.changed || r.pending ? "queued" : "unchanged",
    url: billLinks(d.cfg.PUBLIC_BASE_URL, r.token).page,
    issues: r.issues,
  });
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof IngestError) return reply.code(422).send({ error: "validation_failed", message: e.message, details: e.details });
    throw e;
  };

  /**
   * Our API, consumed by the brand: send one canonical bill.
   * Idempotent on (store_code, invoice_no); safe to retry.
   */
  app.post("/v1/bills", { preHandler: anyAuth(d.db), config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
    try {
      const r = await ingestBill(d.db, brandOf(req), req.body, { source: "api", raw: req.body });
      await enqueue(r);
      return reply.code(r.created ? 201 : 200).send(view(r));
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/v1/bills/batch", { preHandler: apiKeyAuth(d.db) }, async (req, reply) => {
    const list = Array.isArray(req.body) ? req.body : (req.body as { bills?: unknown[] })?.bills;
    if (!Array.isArray(list) || list.length === 0 || list.length > 100) return reply.code(400).send({ error: "send 1–100 bills as an array" });
    const out = [];
    for (const [i, b] of list.entries()) {
      try {
        const r = await ingestBill(d.db, brandOf(req), b, { source: "api", raw: b });
        await enqueue(r);
        out.push({ index: i, ok: true, ...view(r) });
      } catch (e) {
        if (!(e instanceof IngestError)) throw e;
        out.push({ index: i, ok: false, error: e.message, details: e.details });
      }
    }
    return reply.code(207).send({ results: out });
  });

  /**
   * Plug-and-play push: the brand posts its OWN JSON (one bill or an array) to a
   * per-connector URL. The connector's no-code mapping converts it. Until a mapping
   * exists, the payload is captured as a sample for the mapper screen.
   */
  app.post<{ Params: { key: string } }>("/v1/ingest/:key", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
    const connector = await d.db.query.connectors.findFirst({ where: eq(connectors.ingestKey, req.params.key) });
    if (!connector || !connector.enabled) return reply.code(404).send({ error: "unknown_connector" });
    if (connector.kind === "pull") {
      // For pull connectors this URL is the "ping": the brand says "new bills ready", we fetch.
      await d.queues.pull.add("ping", { connectorId: connector.id }, { jobId: `ping-${connector.id}-${Math.floor(Date.now() / 5000)}` });
      return reply.code(202).send({ status: "pull_scheduled" });
    }
    const payload = req.body;
    const raws = Array.isArray(payload) ? payload : [payload];
    if (!connector.mapping) {
      await d.db.update(connectors).set({ sample: raws[0] ?? null }).where(eq(connectors.id, connector.id));
      return reply.code(202).send({ status: "sample_captured", message: "Payload saved. Finish the field mapping in the Leksy dashboard to start sending bills." });
    }
    const { results, errors } = await ingestRawBatch(d.db, connector, raws, "push");
    for (const r of results) await enqueue(r);
    if (raws.length === 1) {
      if (errors[0]) return reply.code(422).send({ error: "validation_failed", ...errors[0] });
      return reply.code(results[0]!.created ? 201 : 200).send(view(results[0]!));
    }
    return reply.code(207).send({ results: results.map(view), errors });
  });
};
