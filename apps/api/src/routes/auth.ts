import { createBrand, hashPassword, verifyPassword } from "@leksy/core";
import { users } from "@leksy/core/db";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { userAuth } from "../auth.js";

// Checked against when the email is unknown, so both cases take the same time.
const DUMMY_HASH = hashPassword("leksy-timing-equaliser");

const Login = z.object({ email: z.email(), password: z.string().min(1) });
const Signup = z.object({
  brandName: z.string().min(2).max(120),
  email: z.email(),
  password: z.string().min(10).max(200),
  storeCode: z.string().min(1).max(64).default("MAIN"),
  storeName: z.string().max(200).optional(),
});

export const authRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.post("/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = Login.parse(req.body);
    const user = await d.db.query.users.findFirst({ where: eq(users.email, body.email.toLowerCase()) });
    const ok = verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) return reply.code(401).send({ error: "invalid_credentials" });
    const token = app.jwt.sign({ sub: user.id, brandId: user.brandId, role: user.role, storeCodes: user.storeCodes });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  /** Self-serve signup: a brand with a store, starter templates and an API key. */
  app.post("/v1/auth/signup", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = Signup.parse(req.body);
    const existing = await d.db.query.users.findFirst({ where: eq(users.email, body.email.toLowerCase()) });
    if (existing) return reply.code(409).send({ error: "email_in_use" });
    const slug = `${body.brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
    const out = await createBrand(d.db, {
      name: body.brandName,
      slug,
      ownerEmail: body.email,
      ownerPassword: body.password,
      store: { code: body.storeCode, name: body.storeName ?? body.brandName },
    });
    const user = await d.db.query.users.findFirst({ where: eq(users.email, body.email.toLowerCase()) });
    const token = app.jwt.sign({ sub: user!.id, brandId: out.brand.id, role: "owner" });
    return reply.code(201).send({ token, brand: out.brand, apiKey: out.apiKey, signingSecret: out.signingSecret, ingestKey: out.ingestKey });
  });

  app.get("/v1/me", { preHandler: userAuth() }, async (req) => {
    const user = await d.db.query.users.findFirst({ where: eq(users.id, req.principal!.userId!), with: undefined });
    const brand = await d.db.query.brands.findFirst({ where: (b, { eq }) => eq(b.id, req.principal!.brandId) });
    return { user: user && { id: user.id, email: user.email, name: user.name, role: user.role }, brand };
  });

  app.post("/v1/auth/password", { preHandler: userAuth() }, async (req, reply) => {
    const body = z.object({ current: z.string(), next: z.string().min(10) }).parse(req.body);
    const user = await d.db.query.users.findFirst({ where: eq(users.id, req.principal!.userId!) });
    if (!user || !verifyPassword(body.current, user.passwordHash)) return reply.code(400).send({ error: "wrong_password" });
    await d.db.update(users).set({ passwordHash: hashPassword(body.next) }).where(eq(users.id, user.id));
    return { ok: true };
  });
};
