import { parseApiKey, sha256, safeEqual, verifySignature } from "@leksy/core";
import { apiKeys, users, type Db } from "@leksy/core/db";

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

let usersDb: Db | null = null;
/** Lets user checks read the team table (set once by buildApp). */
export const setAuthDb = (db: Db) => {
  usersDb = db;
};

/**
 * Dashboard users: JWT issued by /v1/auth/login. The role and stores come from the
 * team table on every request, so removing someone or changing their role takes
 * effect at once rather than when their token expires.
 */
export function userAuth(roles?: Principal["role"][]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    let u: { sub: string; brandId: string; role: Principal["role"]; storeCodes?: string[] | null };
    try {
      u = await req.jwtVerify<typeof u>();
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (usersDb) {
      const row = await usersDb.query.users.findFirst({ where: eq(users.id, u.sub), columns: { brandId: true, role: true, storeCodes: true } });
      if (!row || row.brandId !== u.brandId) return reply.code(401).send({ error: "unauthorized" });
      u = { ...u, role: row.role, storeCodes: row.storeCodes };
    }
    if (roles && !roles.includes(u.role)) return reply.code(403).send({ error: "forbidden" });
    req.principal = { brandId: u.brandId, kind: "user", userId: u.sub, role: u.role, storeCodes: u.storeCodes };
  };
}

/** Accept either a dashboard JWT or an API key (for endpoints both can use). */
export function anyAuth(db: Db, roles?: Principal["role"][]) {
  const key = apiKeyAuth(db);
  const user = userAuth(roles);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const h = req.headers.authorization ?? "";
    return /^Bearer\s+lk_/i.test(h) ? key(req, reply) : user(req, reply);
  };
}

/** A user limited to some stores may only touch those stores; API keys and unscoped users see all. */
export const inScope = (req: FastifyRequest, storeCode: string) => {
  const scope = req.principal?.storeCodes;
  return !scope?.length || scope.includes(storeCode);
};

export const brandOf = (req: FastifyRequest) => {
  if (!req.principal) throw new Error("no principal");
  return req.principal.brandId;
};
