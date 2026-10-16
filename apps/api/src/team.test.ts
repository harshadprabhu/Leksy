/** Team members and invitations (real PostgreSQL and Redis, like api.test.ts). */
import { createBrand, createQueues, redisConnection, runMigrations, type Queues } from "@leksy/core";
import { createDb, invites, users, type Db } from "@leksy/core/db";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const DB_URL = process.env.TEST_DATABASE_URL;
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";

describe.skipIf(!DB_URL)("team members and invitations", () => {
  let app: FastifyInstance;
  let db: Db;
  let pool: { end: () => Promise<void> };
  let redis: Redis;
  let queues: Queues;
  let owner = "";
  let ownerB = "";
  const req = (method: string, url: string, auth?: string, payload?: unknown) =>
    app.inject({ method: method as "GET", url, payload: payload as object, headers: auth ? { authorization: `Bearer ${auth}` } : {}, remoteAddress: "203.0.113.20" });
  const invite = async (by: string, body: Record<string, unknown>) => req("POST", "/v1/team/invites", by, body);
  // Each person accepts from their own device (accepting is rate limited per address).
  let device = 0;
  const accept = async (link: string, name = "New Person") =>
    app.inject({ method: "POST", url: `/v1/invites/${new URL(link).searchParams.get("token")}/accept`, payload: { name, password: "a-long-password" }, remoteAddress: `198.51.100.${++device}` });
  /** Invite and accept in one go; returns the new member's token and id. */
  const join = async (by: string, body: Record<string, unknown>) => {
    const r = await invite(by, body);
    expect(r.statusCode).toBe(201);
    const a = await accept(r.json().link);
    expect(a.statusCode).toBe(201);
    return { token: a.json().token as string, id: a.json().user.id as string };
  };

  beforeAll(async () => {
    ({ db, pool } = createDb(DB_URL!, 4));
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await runMigrations(db);
    await createBrand(db, { name: "Team Brand", slug: "team-brand", ownerEmail: "owner@team.in", ownerPassword: "a-long-password", store: { code: "BLR-01", name: "Bengaluru" } });
    await createBrand(db, { name: "Other Brand", slug: "other-brand", ownerEmail: "owner@other.in", ownerPassword: "a-long-password", store: { code: "BLR-01", name: "Other" } });
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    await redis.flushdb();
    queues = createQueues(redisConnection(REDIS_URL));
    const cfg = loadConfig({ NODE_ENV: "test", DATABASE_URL: DB_URL, REDIS_URL, WEB_ORIGIN: "https://app.test" } as NodeJS.ProcessEnv);
    app = await buildApp({ cfg, db, queues, redis, pdf: { render: async () => Buffer.from(""), close: async () => {} }, channels: { whatsappApiVersion: "v21.0", emailFrom: "t@test", dryRun: true, log: () => {} } });
    owner = (await req("POST", "/v1/auth/login", undefined, { email: "owner@team.in", password: "a-long-password" })).json().token;
    ownerB = (await req("POST", "/v1/auth/login", undefined, { email: "owner@other.in", password: "a-long-password" })).json().token;
    expect((await req("POST", "/v1/stores", owner, { code: "MUM-01", name: "Mumbai" })).statusCode).toBe(201);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all(Object.values(queues ?? {}).map((q) => q.close()));
    redis?.disconnect();
    await pool?.end();
  });

  it("invites a manager by link, who joins with only their stores", async () => {
    const r = await invite(owner, { email: "Priya@Team.in", name: "Priya", role: "manager", storeCodes: ["MUM-01"] });
    expect(r.statusCode).toBe(201);
    expect(r.json().link).toMatch(/^https:\/\/app\.test\/accept-invite\?token=[0-9A-Za-z]{32}$/);
    const token = new URL(r.json().link).searchParams.get("token")!;
    // Only a hash of the link's token is stored.
    const row = await db.query.invites.findFirst({ where: eq(invites.email, "priya@team.in") });
    expect(row!.tokenHash).not.toBe(token);
    const info = await req("GET", `/v1/invites/${token}`);
    expect(info.json()).toMatchObject({ brand: "Team Brand", email: "priya@team.in", role: "manager", storeCodes: ["MUM-01"] });
    const list = (await req("GET", "/v1/team", owner)).json();
    expect(list.invites.map((i: { email: string }) => i.email)).toContain("priya@team.in");
    const a = await accept(r.json().link, "Priya S");
    expect(a.statusCode).toBe(201);
    expect(a.json().user).toMatchObject({ email: "priya@team.in", role: "manager", name: "Priya S" });
    const login = await req("POST", "/v1/auth/login", undefined, { email: "priya@team.in", password: "a-long-password" });
    expect(login.statusCode).toBe(200);
    const after = (await req("GET", "/v1/team", owner)).json();
    expect(after.invites).toHaveLength(0);
    expect(after.members.find((m: { email: string }) => m.email === "priya@team.in")).toMatchObject({ role: "manager", storeCodes: ["MUM-01"] });
    // A manager cannot send bills for a store they were not given.
    const bill = { invoice_no: "T-1", store_code: "BLR-01", issued_at: "2026-10-15T14:32:00+05:30", customer: { name: "A" }, items: [{ name: "Ring", qty: 1, unit_price: 10 }], total: 10 };
    expect((await req("POST", "/v1/bills", a.json().token, bill)).statusCode).toBe(403);
  });

  it("a link works once, and not after it expires or is revoked", async () => {
    const r = await invite(owner, { email: "once@team.in", role: "viewer" });
    expect((await accept(r.json().link)).statusCode).toBe(201);
    expect((await accept(r.json().link)).statusCode).toBe(404);
    const late = await invite(owner, { email: "late@team.in", role: "viewer" });
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.email, "late@team.in"));
    expect((await req("GET", `/v1/invites/${new URL(late.json().link).searchParams.get("token")}`)).statusCode).toBe(404);
    expect((await accept(late.json().link)).statusCode).toBe(404);
    const gone = await invite(owner, { email: "gone@team.in", role: "viewer" });
    expect((await req("DELETE", `/v1/team/invites/${gone.json().invite.id}`, owner)).statusCode).toBe(204);
    expect((await accept(gone.json().link)).statusCode).toBe(404);
    expect((await req("GET", "/v1/invites/not-a-token")).statusCode).toBe(404);
  });

  it("checks roles, stores and addresses when inviting", async () => {
    expect((await invite(owner, { email: "m@team.in", role: "manager" })).statusCode).toBe(400);
    expect((await invite(owner, { email: "m@team.in", role: "manager", storeCodes: ["NOPE-9"] })).statusCode).toBe(400);
    expect((await invite(owner, { email: "owner@other.in", role: "viewer" })).statusCode).toBe(409);
    expect((await invite(owner, { email: "x@team.in", role: "owner" })).statusCode).toBe(400);
    expect((await invite(owner, { email: "not-an-email", role: "viewer" })).statusCode).toBe(400);
  });

  it("only the owner makes, changes or removes admins", async () => {
    const adm = await join(owner, { email: "admin1@team.in", role: "admin" });
    expect((await invite(adm.token, { email: "admin2@team.in", role: "admin" })).statusCode).toBe(403);
    const view = await join(adm.token, { email: "viewer2@team.in", role: "viewer" });
    expect((await req("PATCH", `/v1/team/members/${view.id}`, adm.token, { role: "admin" })).statusCode).toBe(403);
    expect((await req("PATCH", `/v1/team/members/${view.id}`, adm.token, { role: "manager", storeCodes: ["BLR-01"] })).statusCode).toBe(200);
    const adm2 = await join(owner, { email: "admin3@team.in", role: "admin" });
    expect((await req("DELETE", `/v1/team/members/${adm2.id}`, adm.token)).statusCode).toBe(403);
    expect((await req("DELETE", `/v1/team/members/${adm2.id}`, owner)).statusCode).toBe(204);
  });

  it("nobody changes the owner or their own access", async () => {
    const me = (await req("GET", "/v1/team", owner)).json().members;
    const ownerRow = me.find((m: { role: string }) => m.role === "owner");
    expect(ownerRow.you).toBe(true);
    const adm = await join(owner, { email: "admin4@team.in", role: "admin" });
    expect((await req("PATCH", `/v1/team/members/${ownerRow.id}`, adm.token, { role: "viewer" })).statusCode).toBe(403);
    expect((await req("DELETE", `/v1/team/members/${ownerRow.id}`, adm.token)).statusCode).toBe(403);
    expect((await req("PATCH", `/v1/team/members/${adm.id}`, adm.token, { role: "viewer" })).statusCode).toBe(403);
  });

  it("removing someone or lowering their role takes effect at once", async () => {
    const m = await join(owner, { email: "temp@team.in", role: "admin" });
    expect((await req("GET", "/v1/api-keys", m.token)).statusCode).toBe(200);
    expect((await req("PATCH", `/v1/team/members/${m.id}`, owner, { role: "viewer" })).statusCode).toBe(200);
    expect((await req("GET", "/v1/api-keys", m.token)).statusCode).toBe(403);
    expect((await req("DELETE", `/v1/team/members/${m.id}`, owner)).statusCode).toBe(204);
    expect((await req("GET", "/v1/bills", m.token)).statusCode).toBe(401);
    expect(await db.query.users.findFirst({ where: eq(users.email, "temp@team.in") })).toBeUndefined();
  });

  it("managers, viewers and other brands cannot manage the team", async () => {
    const v = await join(owner, { email: "viewer9@team.in", role: "viewer" });
    expect((await req("GET", "/v1/team", v.token)).statusCode).toBe(403);
    expect((await invite(v.token, { email: "z@team.in", role: "viewer" })).statusCode).toBe(403);
    expect((await req("PATCH", `/v1/team/members/${v.id}`, ownerB, { role: "manager", storeCodes: ["BLR-01"] })).statusCode).toBe(404);
    expect((await req("DELETE", `/v1/team/members/${v.id}`, ownerB)).statusCode).toBe(404);
    const other = (await req("GET", "/v1/team", ownerB)).json();
    expect(other.members.map((x: { email: string }) => x.email)).toEqual(["owner@other.in"]);
  });
});
