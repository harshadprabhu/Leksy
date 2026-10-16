/**
 * Security tests: tenant isolation, roles and store scopes, input handling,
 * XSS on the public bill page, token and key checks, SSRF and rate limits.
 * Real PostgreSQL and Redis, like api.test.ts (skipped without TEST_DATABASE_URL).
 */
import { assertPublicUrl, createBrand, createQueues, hashPassword, redisConnection, runMigrations, signPayload, type Queues } from "@leksy/core";
import { apiKeys, bills, connectors, createDb, feedback, templates, users, type Db } from "@leksy/core/db";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const DB_URL = process.env.TEST_DATABASE_URL;
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";

const bill = (invoice: string, store = "BLR-01", extra: Record<string, unknown> = {}) => ({
  invoice_no: invoice,
  store_code: store,
  issued_at: "2026-10-15T14:32:00+05:30",
  customer: { name: "Ananya", phone: "+919812345678" },
  items: [{ name: "Necklace", qty: 1, unit_price: 100000 }],
  total: 100000,
  ...extra,
});

describe.skipIf(!DB_URL)("Leksy API security", () => {
  let app: FastifyInstance;
  let db: Db;
  let pool: { end: () => Promise<void> };
  let redis: Redis;
  let queues: Queues;
  const A = { apiKey: "", ingestKey: "", owner: "", manager: "", viewer: "", brandId: "", signingKey: "", signingSecret: "" };
  const B = { apiKey: "", owner: "", brandId: "" };
  const ids = { billA1: "", billA2: "", tokenA1: "", tplA: "", connA: "", fbA2: "" };

  const req = (method: string, url: string, auth?: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: method as "GET", url, payload: payload as object, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers }, remoteAddress: "203.0.113.10" });
  const login = async (email: string) => (await req("POST", "/v1/auth/login", undefined, { email, password: "a-long-password" })).json().token as string;

  beforeAll(async () => {
    ({ db, pool } = createDb(DB_URL!, 4));
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await runMigrations(db);
    const a = await createBrand(db, { name: "Brand A", slug: "brand-a", ownerEmail: "owner@a.in", ownerPassword: "a-long-password", store: { code: "BLR-01", name: "A Bengaluru" } });
    const b = await createBrand(db, { name: "Brand B", slug: "brand-b", ownerEmail: "owner@b.in", ownerPassword: "a-long-password", store: { code: "BLR-01", name: "B Bengaluru" } });
    Object.assign(A, { apiKey: a.apiKey, ingestKey: a.ingestKey, brandId: a.brand.id });
    Object.assign(B, { apiKey: b.apiKey, brandId: b.brand.id });
    await db.insert(users).values([
      { brandId: a.brand.id, email: "manager@a.in", passwordHash: hashPassword("a-long-password"), role: "manager", storeCodes: ["BLR-01"] },
      { brandId: a.brand.id, email: "viewer@a.in", passwordHash: hashPassword("a-long-password"), role: "viewer" },
    ]);
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    await redis.flushdb();
    queues = createQueues(redisConnection(REDIS_URL));
    const cfg = loadConfig({ NODE_ENV: "test", DATABASE_URL: DB_URL, REDIS_URL, PUBLIC_BASE_URL: "https://bills.test" } as NodeJS.ProcessEnv);
    app = await buildApp({
      cfg,
      db,
      queues,
      redis,
      pdf: { render: async () => Buffer.from("%PDF-1.4 test"), close: async () => {} },
      channels: { whatsappApiVersion: "v21.0", emailFrom: "t@test", dryRun: true, log: () => {} },
    });
    A.owner = await login("owner@a.in");
    A.manager = await login("manager@a.in");
    A.viewer = await login("viewer@a.in");
    B.owner = await login("owner@b.in");

    // Brand A: a second store, a bill in each, feedback on the second.
    expect((await req("POST", "/v1/stores", A.owner, { code: "MUM-01", name: "A Mumbai" })).statusCode).toBe(201);
    const r1 = (await req("POST", "/v1/bills", A.apiKey, bill("A-1"))).json();
    const r2 = (await req("POST", "/v1/bills", A.apiKey, bill("A-2", "MUM-01"))).json();
    ids.billA1 = r1.id;
    ids.billA2 = r2.id;
    ids.tokenA1 = r1.url.split("/").pop();
    const t2 = r2.url.split("/").pop();
    expect((await req("POST", `/b/${t2}/feedback`, undefined, { answers: { overall: 1 } })).statusCode).toBe(200);
    ids.fbA2 = (await db.query.feedback.findFirst({ where: eq(feedback.billId, r2.id) }))!.id;
    ids.tplA = (await db.query.templates.findFirst({ where: eq(templates.brandId, a.brand.id) }))!.id;
    ids.connA = (await db.query.connectors.findFirst({ where: eq(connectors.brandId, a.brand.id) }))!.id;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all(Object.values(queues ?? {}).map((q) => q.close()));
    redis?.disconnect();
    await pool?.end();
  });

  describe("tenant isolation", () => {
    it("brand B cannot read or change brand A's records", async () => {
      expect((await req("GET", `/v1/bills/${ids.billA1}`, B.owner)).statusCode).toBe(404);
      expect((await req("POST", `/v1/bills/${ids.billA1}/resend`, B.owner, {})).statusCode).toBe(404);
      expect((await req("GET", `/v1/templates/${ids.tplA}`, B.owner)).statusCode).toBe(404);
      expect((await req("PUT", `/v1/templates/${ids.tplA}`, B.owner, { draft: { blocks: [] } })).statusCode).toBe(404);
      expect((await req("POST", `/v1/templates/${ids.tplA}/publish`, B.owner, {})).statusCode).toBe(404);
      expect((await req("PATCH", `/v1/feedback/${ids.fbA2}`, B.owner, { ticketStatus: "resolved" })).statusCode).toBe(404);
      expect((await req("POST", `/v1/connectors/${ids.connA}/sample`, B.owner, {})).statusCode).toBe(404);
      await req("DELETE", `/v1/connectors/${ids.connA}`, B.owner);
      expect(await db.query.connectors.findFirst({ where: eq(connectors.id, ids.connA) })).toBeTruthy();
      const list = (await req("GET", "/v1/bills", B.owner)).json().bills;
      expect(list.some((x: { id: string }) => x.id === ids.billA1)).toBe(false);
      const fb = (await req("GET", "/v1/feedback", B.owner)).json();
      expect(fb.total).toBe(0);
    });

    it("brand B's API key writes only into brand B, even for the same store code and invoice", async () => {
      const r = await req("POST", "/v1/bills", B.apiKey, bill("A-1"));
      expect(r.statusCode).toBe(201);
      expect(r.json().id).not.toBe(ids.billA1);
      const a1 = await db.query.bills.findFirst({ where: eq(bills.id, ids.billA1) });
      expect(a1!.brandId).toBe(A.brandId);
    });

    it("a template preview cannot render another brand's bill", async () => {
      const r = await req("POST", "/v1/templates/preview", B.owner, { template: { blocks: [{ id: "t", type: "text", props: { text: "{{store.name}}" } }] }, billId: ids.billA1 });
      expect(r.statusCode).toBe(200);
      expect(r.json().html).not.toContain("A Bengaluru");
    });
  });

  describe("roles and store scopes", () => {
    it("a store manager sees only their stores' bills, analytics and tickets", async () => {
      expect((await req("GET", `/v1/bills/${ids.billA1}`, A.manager)).statusCode).toBe(200);
      expect((await req("GET", `/v1/bills/${ids.billA2}`, A.manager)).statusCode).toBe(404);
      expect((await req("POST", `/v1/bills/${ids.billA2}/resend`, A.manager, {})).statusCode).toBe(404);
      expect((await req("PATCH", `/v1/feedback/${ids.fbA2}`, A.manager, { ticketStatus: "resolved" })).statusCode).toBe(404);
      const list = (await req("GET", "/v1/bills?store=MUM-01", A.manager)).json().bills;
      expect(list).toHaveLength(0);
      const otherRes = await req("GET", "/v1/analytics/summary?store=MUM-01", A.manager);
      expect(otherRes.statusCode).toBe(200);
      const other = otherRes.json();
      expect(JSON.stringify(other)).not.toMatch(/MUM-01/);
      expect(other.totals?.bills ?? other.bills ?? 0).toBe(0);
      // Their own figures work (one store or several).
      const own = await req("GET", "/v1/analytics/summary", A.manager);
      expect(own.statusCode).toBe(200);
      expect(own.json().bills).toBeGreaterThan(0);
      expect((await req("GET", "/v1/insights/dataset", A.manager)).statusCode).toBe(200);
      const fields = (await req("GET", `/v1/templates/fields?billId=${ids.billA2}`, A.manager)).json();
      expect(JSON.stringify(fields.context)).not.toContain("A-2");
    });

    it("a store manager cannot send bills for another store", async () => {
      expect((await req("POST", "/v1/bills", A.manager, bill("A-3", "MUM-01"))).statusCode).toBe(403);
      expect((await req("POST", "/v1/bills", A.manager, bill("A-4"))).statusCode).toBe(201);
    });

    it("a viewer can read but not write, and never sees integration secrets", async () => {
      expect((await req("GET", "/v1/bills", A.viewer)).statusCode).toBe(200);
      expect((await req("POST", "/v1/bills", A.viewer, bill("V-1"))).statusCode).toBe(403);
      expect((await req("PUT", "/v1/brand", A.viewer, { name: "x" })).statusCode).toBe(403);
      expect((await req("POST", "/v1/api-keys", A.viewer, { name: "x" })).statusCode).toBe(403);
      expect((await req("POST", "/v1/webhooks", A.viewer, { url: "https://example.com/h" })).statusCode).toBe(403);
      expect((await req("PUT", `/v1/templates/${ids.tplA}`, A.viewer, { draft: { blocks: [] } })).statusCode).toBe(403);
      const c = await req("GET", "/v1/connectors", A.viewer);
      expect(c.statusCode).toBe(403);
      expect(c.body).not.toContain(A.ingestKey);
      expect((await req("GET", "/v1/connectors", A.manager)).statusCode).toBe(403);
    });
  });

  describe("tokens and keys", () => {
    it("rejects forged, unsigned and foreign JWTs", async () => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const payload = { sub: "x", brandId: A.brandId, role: "owner", iat: Math.floor(Date.now() / 1000) };
      const none = `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`;
      expect((await req("GET", "/v1/bills", none)).statusCode).toBe(401);
      const head = b64({ alg: "HS256", typ: "JWT" });
      const sig = createHmac("sha256", "not-the-server-secret-not-the-server-secret").update(`${head}.${b64(payload)}`).digest("base64url");
      expect((await req("GET", "/v1/bills", `${head}.${b64(payload)}.${sig}`)).statusCode).toBe(401);
      // A real token with its payload swapped to another brand fails its signature.
      const [h, , s] = A.owner.split(".");
      expect((await req("GET", "/v1/bills", `${h}.${b64({ ...payload, brandId: B.brandId })}.${s}`)).statusCode).toBe(401);
    });

    it("rejects revoked API keys and bad or replayed signatures", async () => {
      const k = (await req("POST", "/v1/api-keys", A.owner, { name: "signed", requireSignature: true })).json();
      const body = JSON.stringify(bill("S-1"));
      const send = (sig?: string) => app.inject({ method: "POST", url: "/v1/bills", payload: body, headers: { "content-type": "application/json", authorization: `Bearer ${k.key}`, ...(sig ? { "x-leksy-signature": sig } : {}) } });
      expect((await send()).statusCode).toBe(401);
      expect((await send(signPayload("whsec_wrong", body))).statusCode).toBe(401);
      expect((await send(signPayload(k.signingSecret, body, Math.floor(Date.now() / 1000) - 3600))).statusCode).toBe(401);
      expect((await send(signPayload(k.signingSecret, body))).statusCode).toBe(201);
      const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.name, "signed") });
      await req("DELETE", `/v1/api-keys/${row!.id}`, A.owner);
      expect((await send(signPayload(k.signingSecret, body))).statusCode).toBe(401);
    });

    it("stores passwords and API key secrets only as hashes", async () => {
      const u = await db.query.users.findFirst({ where: eq(users.email, "owner@a.in") });
      expect(u!.passwordHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      expect(u!.passwordHash).not.toContain("a-long-password");
      const k = await db.query.apiKeys.findFirst({ where: eq(apiKeys.brandId, A.brandId) });
      expect(A.apiKey).not.toContain(k!.secretHash);
      expect(k!.secretHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("gives the same answer for an unknown email and a wrong password", async () => {
      const a = await req("POST", "/v1/auth/login", undefined, { email: "nobody@a.in", password: "a-long-password" });
      const b = await req("POST", "/v1/auth/login", undefined, { email: "owner@a.in", password: "wrong-password!" });
      expect(a.statusCode).toBe(401);
      expect(a.body).toBe(b.body);
    });
  });

  describe("input handling", () => {
    it("answers 404, not 500, for malformed ids", async () => {
      for (const url of ["/v1/bills/not-a-uuid", "/v1/templates/1'or'1'='1", `/v1/templates/fields?billId=zzz`]) {
        const r = await req("GET", url, A.owner);
        expect(r.statusCode, url).toBeLessThan(500);
      }
      expect((await req("PATCH", "/v1/feedback/xyz", A.owner, { ticketStatus: "resolved" })).statusCode).toBe(404);
      expect((await req("GET", "/b/%27%20or%201%3D1--")).statusCode).toBe(404);
    });

    it("treats SQL in search and bill fields as plain text", async () => {
      const r = await req("GET", `/v1/bills?q=${encodeURIComponent("' or 1=1 --")}&store=${encodeURIComponent("x' or '1'='1")}`, A.owner);
      expect(r.statusCode).toBe(200);
      expect(r.json().bills).toHaveLength(0);
      const evil = await req("POST", "/v1/bills", A.apiKey, bill("X'); drop table bills; --"));
      expect(evil.statusCode).toBe(201);
      expect((await db.execute(sql`select count(*)::int as n from bills`)).rows[0]!.n).toBeGreaterThan(0);
    });

    it("only accepts web links for brand URLs and webhooks", async () => {
      for (const field of ["googleReviewUrl", "website", "logoUrl"]) {
        expect((await req("PUT", "/v1/brand", A.owner, { [field]: "javascript:alert(document.cookie)" })).statusCode, field).toBe(400);
      }
      expect((await req("PUT", "/v1/brand", A.owner, { googleReviewUrl: "https://g.page/r/abc/review" })).statusCode).toBe(200);
      expect((await req("POST", "/v1/webhooks", A.owner, { url: "http://169.254.169.254/latest/meta-data" })).statusCode).toBe(400);
      expect((await req("POST", "/v1/webhooks", A.owner, { url: "https://127.0.0.1/hook" })).statusCode).toBe(400);
      const pull = { name: "p", kind: "pull", pull: { url: "https://10.0.0.5/bills" } };
      expect((await req("POST", "/v1/connectors", A.owner, pull)).statusCode).toBe(400);
    });

    it("stores a brand API's credentials encrypted", async () => {
      process.env.LEKSY_SECRETS_KEY = "b".repeat(64);
      const r = await req("POST", "/v1/connectors", A.owner, { name: "POS pull", kind: "pull", pull: { url: "https://93.184.215.14/bills", auth: { type: "bearer", token: "super-secret-pos-token" } } });
      expect(r.statusCode).toBe(201);
      expect(r.body).not.toContain("super-secret-pos-token");
      const row = await db.query.connectors.findFirst({ where: eq(connectors.id, r.json().id) });
      expect(JSON.stringify(row!.pull)).not.toContain("super-secret-pos-token");
      expect((row!.pull!.auth as { token: string }).token).toMatch(/^enc:v1:/);
      delete process.env.LEKSY_SECRETS_KEY;
    });

    it("rejects survey keys that are not simple slugs", async () => {
      const r = await req("PUT", "/v1/surveys/..%2F..%2Fx", A.owner, { name: "x", body: { questions: [{ id: "overall", type: "rating", label: "?" }] } });
      expect(r.statusCode).toBe(400);
    });
  });

  describe("public bill page", () => {
    it("escapes hostile bill data and template text", async () => {
      const xss = "<img src=x onerror=alert(1)>";
      const r = (await req("POST", "/v1/bills", A.apiKey, bill("XSS-1", "BLR-01", { customer: { name: `${xss}"'`, phone: "+919800000009" }, items: [{ name: `<script>alert(2)</script>`, qty: 1, unit_price: 10 }], total: 10 }))).json();
      const tpl = await req("PUT", `/v1/templates/${ids.tplA}`, A.owner, {
        draft: {
          page: { watermark: { src: "x');}</style><script>alert(3)</script>" } },
          blocks: [
            { id: "h", type: "heading", props: { text: "Hi {{customer.name}} <script>alert(4)</script>" }, style: { color: "red;x:url(javascript:a)", fontFamily: "x'}</style><script>alert(6)</script>" } },
            { id: "i", type: "image", props: { src: "javascript:alert(7)", alt: "\" onerror=\"alert(8)" } },
            { id: "b", type: "button", props: { label: "Go", href: "javascript:alert(9)" } },
            { id: "items", type: "items_table", props: { source: "items", columns: [{ label: "Item", value: "{{name}}" }] } },
          ],
        },
      });
      expect(tpl.statusCode).toBe(200);
      await req("POST", `/v1/templates/${ids.tplA}/publish`, A.owner, {});
      const token = r.url.split("/").pop();
      const page = await req("GET", `/b/${token}`);
      expect(page.statusCode).toBe(200);
      const html = page.body;
      expect(html).not.toContain(xss);
      expect(html).not.toMatch(/<script>alert/);
      expect(html).not.toMatch(/javascript:/i);
      expect(html).not.toContain('onerror="alert');
      expect(html).not.toContain("red;x:");
      // Every script on the page carries the response's CSP nonce.
      const nonce = /'nonce-([^']+)'/.exec(String(page.headers["content-security-policy"]))![1];
      for (const tag of html.match(/<script[^>]*>/g) ?? []) expect(tag).toContain(`nonce="${nonce}"`);
      expect(page.headers["x-frame-options"] ?? page.headers["content-security-policy"]).toMatch(/frame-ancestors 'none'|DENY/);
      expect(page.headers["x-content-type-options"]).toBe("nosniff");
      expect(page.headers["referrer-policy"]).toBe("no-referrer");
    });

    it("never lets a customer answer twice or post junk", async () => {
      const t = (await req("POST", "/v1/bills", A.apiKey, bill("FB-1"))).json().url.split("/").pop();
      expect((await req("POST", `/b/${t}/feedback`, undefined, { answers: { overall: 9 } })).statusCode).toBe(400);
      expect((await req("POST", `/b/${t}/feedback`, undefined, { answers: { overall: 5, comment: "x".repeat(5000), evil: { $gt: 1 } } })).statusCode).toBe(200);
      expect((await req("POST", `/b/${t}/feedback`, undefined, { answers: { overall: 1 } })).statusCode).toBe(409);
      const row = await db.execute(sql`select answers from feedback f join bills b on b.id = f.bill_id where b.token = ${t}`);
      expect(JSON.stringify(row.rows[0])).not.toContain("evil");
    });
  });

  describe("abuse limits", () => {
    it("limits login attempts per client, and a spoofed X-Forwarded-For does not reset the count", async () => {
      let last = 0;
      for (let i = 0; i < 12; i++) {
        last = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "owner@a.in", password: "wrong-password!" }, headers: { "x-forwarded-for": `198.51.100.${i}` }, remoteAddress: "203.0.113.77" })).statusCode;
      }
      expect(last).toBe(429);
    });

    it("refuses WhatsApp receipts that are not signed by Meta when an app secret is set", async () => {
      const cfg = loadConfig({ NODE_ENV: "test", DATABASE_URL: DB_URL, REDIS_URL, WHATSAPP_APP_SECRET: "meta-secret" } as NodeJS.ProcessEnv);
      const app2 = await buildApp({ cfg, db, queues, redis, pdf: { render: async () => Buffer.from(""), close: async () => {} }, channels: { whatsappApiVersion: "v21.0", emailFrom: "t@test", dryRun: true, log: () => {} } });
      const r = await app2.inject({ method: "POST", url: "/hooks/whatsapp", payload: { entry: [] }, headers: { "x-hub-signature-256": "sha256=00" } });
      expect(r.statusCode).toBe(401);
      await app2.close();
    });

    it("refuses unsigned WhatsApp receipts in production when no app secret is set", async () => {
      const cfg = { ...loadConfig({ NODE_ENV: "test", DATABASE_URL: DB_URL, REDIS_URL } as NodeJS.ProcessEnv), NODE_ENV: "production" as const };
      const app2 = await buildApp({ cfg, db, queues, redis, pdf: { render: async () => Buffer.from(""), close: async () => {} }, channels: { whatsappApiVersion: "v21.0", emailFrom: "t@test", dryRun: true, log: () => {} } });
      const r = await app2.inject({ method: "POST", url: "/hooks/whatsapp", payload: { entry: [] } });
      expect(r.statusCode).toBe(401);
      await app2.close();
    });
  });
});

describe("SSRF guard for brand-supplied URLs", () => {
  const blocked = [
    "http://example.com/",
    "ftp://example.com/",
    "https://127.0.0.1/",
    "https://localhost/",
    "https://0x7f000001/",
    "https://2130706433/",
    "https://10.1.2.3/",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/",
    "https://198.18.0.1/",
    "https://224.0.0.1/",
    "https://255.255.255.255/",
    "https://0.0.0.0/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://[0:0:0:0:0:ffff:7f00:1]/",
    "https://[64:ff9b::a00:1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
  ];
  for (const u of blocked) it(`blocks ${u}`, async () => expect(assertPublicUrl(u)).rejects.toThrow());
  it("allows a public https address", async () => expect((await assertPublicUrl("https://93.184.215.14/x")).hostname).toBe("93.184.215.14"));
});
