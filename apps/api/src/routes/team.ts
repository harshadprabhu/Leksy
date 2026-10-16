import { hashPassword, randomToken, sendAlert, sha256 } from "@leksy/core";
import { brands, invites, stores, users } from "@leksy/core/db";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { brandOf, userAuth } from "../auth.js";

const INVITE_DAYS = 7;

const Invite = z.object({
  email: z.email().max(200),
  name: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "manager", "viewer"]),
  /** Managers must have stores; viewers may be limited to some. Empty = every store. */
  storeCodes: z.array(z.string().min(1).max(64)).max(500).optional(),
});

const Change = z.object({
  name: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "manager", "viewer"]).optional(),
  storeCodes: z.array(z.string().min(1).max(64)).max(500).nullable().optional(),
});

type Role = "owner" | "admin" | "manager" | "viewer";

/**
 * The brand's team: owners and admins invite managers and viewers by link, change
 * their role or stores, and remove them. Only the owner can make or remove admins.
 */
export const teamRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  const admin = userAuth(["owner", "admin"]);
  const inviteLink = (token: string) => `${d.cfg.WEB_ORIGIN.replace(/\/$/, "")}/accept-invite?token=${token}`;

  /** Stores must exist in the brand; managers need at least one. */
  const checkStores = async (req: FastifyRequest, reply: FastifyReply, role: Role, codes: string[] | null | undefined) => {
    const list = codes?.length ? [...new Set(codes)] : null;
    if (role === "manager" && !list) {
      reply.code(400).send({ error: "stores_required", message: "Choose at least one store for a manager." });
      return undefined;
    }
    if (role === "admin" || !list) return null;
    const known = new Set((await d.db.select({ code: stores.code }).from(stores).where(eq(stores.brandId, brandOf(req)))).map((s) => s.code));
    const unknown = list.filter((c) => !known.has(c));
    if (unknown.length) {
      reply.code(400).send({ error: "unknown_store", message: `No store with code ${unknown.join(", ")}` });
      return undefined;
    }
    return list;
  };

  app.get("/v1/team", { preHandler: admin }, async (req) => {
    const brandId = brandOf(req);
    const [members, pending] = await Promise.all([
      d.db.select({ id: users.id, email: users.email, name: users.name, role: users.role, storeCodes: users.storeCodes, createdAt: users.createdAt }).from(users).where(eq(users.brandId, brandId)).orderBy(asc(users.createdAt)),
      d.db
        .select({ id: invites.id, email: invites.email, name: invites.name, role: invites.role, storeCodes: invites.storeCodes, expiresAt: invites.expiresAt, createdAt: invites.createdAt })
        .from(invites)
        .where(and(eq(invites.brandId, brandId), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
        .orderBy(desc(invites.createdAt)),
    ]);
    return { members: members.map((m) => ({ ...m, you: m.id === req.principal?.userId })), invites: pending };
  });

  app.post("/v1/team/invites", { preHandler: admin, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = Invite.parse(req.body);
    const brandId = brandOf(req);
    if (body.role === "admin" && req.principal?.role !== "owner") return reply.code(403).send({ error: "owner_only", message: "Only the owner can invite admins." });
    const email = body.email.toLowerCase();
    if (await d.db.query.users.findFirst({ where: eq(users.email, email), columns: { id: true } })) return reply.code(409).send({ error: "email_in_use", message: "This email already has a Leksy account." });
    const storeCodes = await checkStores(req, reply, body.role, body.storeCodes);
    if (storeCodes === undefined) return reply;
    // A new invite to the same address replaces any earlier one.
    await d.db.delete(invites).where(and(eq(invites.brandId, brandId), eq(invites.email, email), isNull(invites.acceptedAt)));
    const token = randomToken(32);
    const [row] = await d.db
      .insert(invites)
      .values({ brandId, email, name: body.name || null, role: body.role, storeCodes, tokenHash: sha256(token), invitedBy: req.principal?.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5) })
      .returning({ id: invites.id, email: invites.email, name: invites.name, role: invites.role, storeCodes: invites.storeCodes, expiresAt: invites.expiresAt, createdAt: invites.createdAt });
    const link = inviteLink(token);
    const brand = await d.db.query.brands.findFirst({ where: eq(brands.id, brandId), columns: { name: true } });
    await sendAlert({ email }, `You're invited to join ${brand?.name ?? "your team"} on Leksy as a ${body.role}. Accept within ${INVITE_DAYS} days: ${link}`, d.channels).catch(() => {});
    return reply.code(201).send({ invite: row, link, note: "Share this link with the person; it works once." });
  });

  app.delete<{ Params: { id: string } }>("/v1/team/invites/:id", { preHandler: admin }, async (req, reply) => {
    await d.db.delete(invites).where(and(eq(invites.id, req.params.id), eq(invites.brandId, brandOf(req))));
    return reply.code(204).send();
  });

  /** Who may change whom: nobody changes the owner or themselves; only the owner handles admins. */
  const target = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const m = await d.db.query.users.findFirst({ where: and(eq(users.id, req.params.id), eq(users.brandId, brandOf(req))) });
    if (!m) return void reply.code(404).send({ error: "not_found" });
    if (m.role === "owner") return void reply.code(403).send({ error: "owner_locked", message: "The owner cannot be changed or removed." });
    if (m.id === req.principal?.userId) return void reply.code(403).send({ error: "not_yourself", message: "Ask another admin to change your own access." });
    if (m.role === "admin" && req.principal?.role !== "owner") return void reply.code(403).send({ error: "owner_only", message: "Only the owner can change admins." });
    return m;
  };

  app.patch<{ Params: { id: string } }>("/v1/team/members/:id", { preHandler: admin }, async (req, reply) => {
    const body = Change.parse(req.body);
    const m = await target(req, reply);
    if (!m) return reply;
    if (body.role === "admin" && req.principal?.role !== "owner") return reply.code(403).send({ error: "owner_only", message: "Only the owner can make admins." });
    const role = body.role ?? m.role;
    const storeCodes = await checkStores(req, reply, role, body.storeCodes === undefined ? m.storeCodes : body.storeCodes);
    if (storeCodes === undefined) return reply;
    const [row] = await d.db
      .update(users)
      .set({ role, storeCodes, ...(body.name !== undefined ? { name: body.name || null } : {}) })
      .where(eq(users.id, m.id))
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role, storeCodes: users.storeCodes });
    return row;
  });

  app.delete<{ Params: { id: string } }>("/v1/team/members/:id", { preHandler: admin }, async (req, reply) => {
    const m = await target(req, reply);
    if (!m) return reply;
    await d.db.delete(users).where(eq(users.id, m.id));
    return reply.code(204).send();
  });

  // ---- Accepting an invitation (no login: the link is the credential) ----

  const openInvite = async (token: string) => {
    if (!/^[0-9A-Za-z]{32}$/.test(token)) return null;
    const inv = await d.db.query.invites.findFirst({ where: eq(invites.tokenHash, sha256(token)) });
    return inv && !inv.acceptedAt && inv.expiresAt > new Date() ? inv : null;
  };

  app.get<{ Params: { token: string } }>("/v1/invites/:token", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const inv = await openInvite(req.params.token);
    if (!inv) return reply.code(404).send({ error: "invite_not_found", message: "This invitation has expired or was already used." });
    const brand = await d.db.query.brands.findFirst({ where: eq(brands.id, inv.brandId), columns: { name: true, logoUrl: true } });
    return { brand: brand?.name ?? "", logoUrl: brand?.logoUrl ?? null, email: inv.email, name: inv.name, role: inv.role, storeCodes: inv.storeCodes };
  });

  app.post<{ Params: { token: string } }>("/v1/invites/:token/accept", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(120), password: z.string().min(10).max(200) }).parse(req.body);
    const out = await d.db.transaction(async (tx) => {
      // Claim the invite first, so the same link cannot create two accounts.
      const [inv] = await tx
        .update(invites)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invites.tokenHash, sha256(req.params.token)), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
        .returning();
      if (!inv) return { error: 404 as const };
      const [user] = await tx
        .insert(users)
        .values({ brandId: inv.brandId, email: inv.email, name: body.name, passwordHash: hashPassword(body.password), role: inv.role, storeCodes: inv.storeCodes })
        .onConflictDoNothing()
        .returning();
      if (!user) {
        tx.rollback();
        return { error: 409 as const };
      }
      return { user };
    }).catch((e: unknown) => {
      if ((e as Error).name === "TransactionRollbackError") return { error: 409 as const };
      throw e;
    });
    if (!("user" in out) || !out.user) return reply.code(out.error === 404 ? 404 : 409).send(out.error === 404 ? { error: "invite_not_found", message: "This invitation has expired or was already used." } : { error: "email_in_use", message: "This email already has a Leksy account." });
    const token = app.jwt.sign({ sub: out.user.id, brandId: out.user.brandId, role: out.user.role, storeCodes: out.user.storeCodes });
    return reply.code(201).send({ token, user: { id: out.user.id, email: out.user.email, name: out.user.name, role: out.user.role } });
  });
};
