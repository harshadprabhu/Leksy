import { parseApiKey, sha256, safeEqual, verifySignature } from "@leksy/core";
import { apiKeys, type Db } from "@leksy/core/db";

import { eq, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface Principal {
  brandId: string;
  kind: "api_key" | "user";
  userId?: string;
  role?: "owner" | "admin" | "manager" | "viewer";
  storeCodes?: string[] | null;
}

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
    rawBody?: string;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; brandId: string; role: Principal["role"]; storeCodes?: string[] | null };
    user: { sub: string; brandId: string; role: Principal["role"]; storeCodes?: string[] | null };
  }
}

/**
 * Integrations authenticate with `Authorization: Bearer lk_live_...`.
 * If the key requires it, the body must be signed: `X-Leksy-Signature: t=..,v1=..`.
 */
export function apiKeyAuth(db: Db) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? "";
    const parsed = parseApiKey(header.replace(/^Bearer\s+/i, ""));
    if (!parsed) return reply.code(401).send({ error: "invalid_api_key" });
    const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.prefix, parsed.prefix) });
    if (!key || key.revokedAt || !safeEqual(key.secretHash, sha256(parsed.secret))) return reply.code(401).send({ error: "invalid_api_key" });
    if (key.requireSignature && !verifySignature(key.signingSecret, req.rawBody ?? "", req.headers["x-leksy-signature"] as string | undefined)) {
      return reply.code(401).send({ error: "invalid_signature" });
    }
    req.principal = { brandId: key.brandId, kind: "api_key" };
    void db.update(apiKeys).set({ lastUsedAt: sql`now()` }).where(eq(apiKeys.id, key.id)).catch(() => {});
  };
}

/** Dashboard users: JWT issued by /v1/auth/login. */
export function userAuth(roles?: Principal["role"][]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const u = await req.jwtVerify<{ sub: string; brandId: string; role: Principal["role"]; storeCodes?: string[] | null }>();
      if (roles && !roles.includes(u.role)) return reply.code(403).send({ error: "forbidden" });
      req.principal = { brandId: u.brandId, kind: "user", userId: u.sub, role: u.role, storeCodes: u.storeCodes };
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
}

/** Accept either a dashboard JWT or an API key (for endpoints both can use). */
export function anyAuth(db: Db) {
  const key = apiKeyAuth(db);
  const user = userAuth();
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const h = req.headers.authorization ?? "";
    return /^Bearer\s+lk_/i.test(h) ? key(req, reply) : user(req, reply);
  };
}

export const brandOf = (req: FastifyRequest) => {
  if (!req.principal) throw new Error("no principal");
  return req.principal.brandId;
};
