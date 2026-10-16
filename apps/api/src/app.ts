import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import type { ChannelEnv, Queues } from "@leksy/core";
import type { Db } from "@leksy/core/db";
import Fastify, { type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { Config } from "./config.js";
import type { PdfRenderer } from "./pdf.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { billRoutes } from "./routes/bills.js";
import { connectorRoutes } from "./routes/connectors.js";
import { ingestRoutes } from "./routes/ingest.js";
import { insightsRoutes } from "./routes/insights.js";
import { providerRoutes } from "./routes/providers.js";
import { publicRoutes } from "./routes/public.js";
import { templateRoutes } from "./routes/templates.js";

export interface Deps {
  cfg: Config;
  db: Db;
  queues: Queues;
  redis: Redis;
  pdf: PdfRenderer;
  channels: ChannelEnv;
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.cfg.NODE_ENV === "test" ? false : { level: "info", redact: ["req.headers.authorization", "req.headers.cookie"] },
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
  });

  // Keep the raw body for HMAC signature checks.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = new Error("Body is not valid JSON") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  await app.register(cors, { origin: [deps.cfg.WEB_ORIGIN], credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"], maxAge: 600 });
  await app.register(cookie, { secret: deps.cfg.COOKIE_SECRET });
  await app.register(jwt, { secret: deps.cfg.JWT_SECRET, sign: { expiresIn: "12h" } });
  await app.register(rateLimit, { global: false, redis: deps.cfg.NODE_ENV === "test" ? undefined : deps.redis });

  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? "internal_error" : (err as Error).message });
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/favicon.ico", async (_req, reply) => reply.code(204).send());

  await app.register(authRoutes(deps));
  await app.register(ingestRoutes(deps));
  await app.register(billRoutes(deps));
  await app.register(templateRoutes(deps));
  await app.register(connectorRoutes(deps));
  await app.register(adminRoutes(deps));
  await app.register(insightsRoutes(deps));
  await app.register(publicRoutes(deps));
  await app.register(providerRoutes(deps));
  return app;
}
