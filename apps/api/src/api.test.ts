/**
 * End-to-end API tests against real PostgreSQL and Redis.
 * Set TEST_DATABASE_URL and TEST_REDIS_URL (CI does); otherwise they are skipped.
 * The test database's public schema is wiped on every run.
 */
import { createBrand, createQueues, redisConnection, runMigrations, type Queues } from "@leksy/core";
import { createDb, feedback, type Db } from "@leksy/core/db";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const DB_URL = process.env.TEST_DATABASE_URL;
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";

const bill = (invoice: string, extra: Record<string, unknown> = {}) => ({
  invoice_no: invoice,
  store_code: "BLR-01",
  issued_at: "2026-10-15T14:32:00+05:30",
  customer: { name: "Ananya", phone: "+919812345678" },
  items: [{ name: "Necklace", qty: 1, unit_price: 100000 }],
  taxes: [
    { type: "CGST", rate: 1.5, amount: 1500 },
    { type: "SGST", rate: 1.5, amount: 1500 },
  ],
  total: 103000,
  ...extra,
});

describe.skipIf(!DB_URL)("Leksy API", () => {
  let app: FastifyInstance;
  let db: Db;
  let pool: { end: () => Promise<void> };
  let redis: Redis;
  let queues: Queues;
  let apiKey = "";
  let ingestKey = "";
  let jwt = "";

  beforeAll(async () => {
    ({ db, pool } = createDb(DB_URL!, 4));
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await runMigrations(db);
    const out = await createBrand(db, {
      name: "Test Jewels",
      slug: "test-jewels",
      ownerEmail: "owner@test.in",
      ownerPassword: "a-long-password",
      store: { code: "BLR-01", name: "Test Jewels Bengaluru", managerPhone: "+919800000001" },
    });
    apiKey = out.apiKey;
    ingestKey = out.ingestKey;
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
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "owner@test.in", password: "a-long-password" } });
    jwt = login.json().token;
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all(Object.values(queues ?? {}).map((q) => q.close()));
    redis?.disconnect();
    await pool?.end();
  });

  const post = (url: string, payload: unknown, auth = apiKey) => app.inject({ method: "POST", url, payload: payload as object, headers: { authorization: `Bearer ${auth}` } });

  it("rejects requests without a valid key", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/bills", payload: bill("X-1") });
    expect(r.statusCode).toBe(401);
  });

  it("accepts a bill once and is idempotent on retry", async () => {
    const first = await post("/v1/bills", bill("INV-1"));
    expect(first.statusCode).toBe(201);
    expect(first.json().url).toMatch(/^https:\/\/bills\.test\/b\/[0-9A-Za-z]{22}$/);
    const again = await post("/v1/bills", bill("INV-1"));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: first.json().id, created: false, changed: false });
    const changed = await post("/v1/bills", bill("INV-1", { notes: "gift wrap" }));
    expect(changed.json()).toMatchObject({ created: false, changed: true });
  });

  it("explains validation failures", async () => {
    const r = await post("/v1/bills", { ...bill("INV-2"), customer: { phone: "12345" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().details[0].path).toBe("customer.phone");
  });

  it("captures a raw push payload, then maps it once a mapping exists", async () => {
    const raw = { BillNo: "T-9", Branch: "BLR-01", Date: "15/10/2026 18:05", Mobile: "9812345678", Amount: "500", Lines: [{ Item: "Coin", Qty: "1", Rate: "500" }] };
    const captured = await app.inject({ method: "POST", url: `/v1/ingest/${ingestKey}`, payload: raw });
    expect(captured.json().status).toBe("sample_captured");

    const list = await app.inject({ method: "GET", url: "/v1/connectors", headers: { authorization: `Bearer ${jwt}` } });
    const connector = list.json().connectors[0];
    const sample = await post(`/v1/connectors/${connector.id}/sample`, {}, jwt);
    const suggestion = sample.json().suggestion;
    expect(suggestion.invoice_no).toBe("BillNo");
    suggestion.total = { from: "Amount", transform: [{ fn: "number" }] };
    suggestion.items.each.fields = { name: "Item", qty: { from: "Qty", transform: [{ fn: "number" }] }, unit_price: { from: "Rate", transform: [{ fn: "number" }] } };
    const saved = await app.inject({ method: "PUT", url: `/v1/connectors/${connector.id}`, payload: { mapping: suggestion }, headers: { authorization: `Bearer ${jwt}` } });
    expect(saved.statusCode).toBe(200);

    const ingested = await app.inject({ method: "POST", url: `/v1/ingest/${ingestKey}`, payload: raw });
    expect(ingested.statusCode).toBe(201);
  });

  it("serves the bill page and turns a low score into a ticket", async () => {
    const created = await post("/v1/bills", bill("INV-3"));
    const token = created.json().url.split("/").pop();
    const page = await app.inject({ method: "GET", url: `/b/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("INV-3");
    expect(page.headers["content-security-policy"]).toContain("script-src 'nonce-");

    const fb = await app.inject({ method: "POST", url: `/b/${token}/feedback`, payload: { answers: { overall: 1, improve: ["Waiting time"] } } });
    expect(fb.statusCode).toBe(200);
    const row = await db.query.feedback.findFirst({ where: eq(feedback.rating, 1) });
    expect(row?.ticketStatus).toBe("open");
    const dup = await app.inject({ method: "POST", url: `/b/${token}/feedback`, payload: { answers: { overall: 5 } } });
    expect(dup.statusCode).toBe(409);

    const pdf = await app.inject({ method: "GET", url: `/b/${token}/pdf` });
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const verify = await app.inject({ method: "GET", url: `/v/${token}` });
    expect(verify.body).toContain("Genuine bill");
  });

  it("asks Project WOW once, at a tap, with no code needed to open the bill", async () => {
    const created = await post("/v1/bills", bill("INV-WOW"));
    const token = created.json().url.split("/").pop();
    const page = await app.inject({ method: "GET", url: `/b/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('id="lx-wow"');
    expect(page.body).not.toContain('id="lx-survey"');
    const fb = await app.inject({ method: "POST", url: `/b/${token}/feedback`, payload: { answers: { overall: 5 } } });
    expect(fb.statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: `/b/${token}/feedback`, payload: { answers: { overall: 1 } } });
    expect(again.statusCode).toBe(409);
    const reopened = await app.inject({ method: "GET", url: `/b/${token}` });
    expect(reopened.body).not.toContain('id="lx-wow"');
    expect((await app.inject({ method: "GET", url: `/b/${token}/json` })).statusCode).toBe(200);
  });

  it("uses a survey edited in the dashboard, with its own alert threshold", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/surveys", headers: { authorization: `Bearer ${jwt}` } });
    const mh = list.json().surveys.find((x: { key: string }) => x.key === "project-wow");
    // A full survey this time: the extra question is asked under the faces.
    const body = { ...mh.body, oneTap: false, questions: [...mh.body.questions, { id: "occasion", type: "choice", label: "What was the occasion?", options: ["Wedding", "Gift"] }] };
    const saved = await app.inject({ method: "PUT", url: "/v1/surveys/project-wow", headers: { authorization: `Bearer ${jwt}` }, payload: { name: "Project WOW", body, alertThreshold: 3, reviewThreshold: 5, slaMinutes: 60 } });
    expect(saved.statusCode).toBe(200);

    const created = await post("/v1/bills", bill("INV-SV"));
    const token = created.json().url.split("/").pop();
    const page = await app.inject({ method: "GET", url: `/b/${token}` });
    expect(page.body).toContain("What was the occasion?");
    const fb = await app.inject({ method: "POST", url: `/b/${token}/feedback`, payload: { answers: { overall: 3, occasion: "Wedding" } } });
    expect(fb.statusCode).toBe(200);
    const row = await db.query.feedback.findFirst({ where: eq(feedback.rating, 3) });
    expect(row?.ticketStatus).toBe("open");
    expect(row?.answers).toMatchObject({ occasion: "Wedding" });
  });

  it("renders template previews for the studio", async () => {
    const presets = await app.inject({ method: "GET", url: "/v1/templates/presets", headers: { authorization: `Bearer ${jwt}` } });
    const template = presets.json().presets[0].template;
    const r = await post("/v1/templates/preview", { template }, jwt);
    expect(r.statusCode).toBe(200);
    expect(r.json().html).toContain("Test Jewels");
  });

  it("counts feedback by rating, 1 to 5", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/feedback?limit=1", headers: { authorization: `Bearer ${jwt}` } });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.dist).toHaveLength(5);
    expect(j.total).toBe(j.dist.reduce((a: number, b: number) => a + b, 0));
    expect(j.feedback.length).toBeLessThanOrEqual(1);
  });

  it("serves Insights aggregates without customer fields", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/insights/dataset", headers: { authorization: `Bearer ${jwt}` } });
    expect(r.statusCode).toBe(200);
    const ds = r.json();
    expect(ds.days.length).toBeGreaterThan(0);
    expect(ds.days[0]).toHaveProperty("revenue");
    expect(JSON.stringify(ds)).not.toContain("+9198");
    // Every breakdown reconciles with the daily rows and with the dashboard summary.
    const from = ds.days.map((x: { date: string }) => x.date).sort()[0];
    const sum = (xs: { revenue: number }[]) => xs.reduce((a, x) => a + x.revenue, 0);
    const recent = ds.days.filter((x: { date: string }) => x.date >= new Date(Date.parse(`${ds.asOf}T00:00:00Z`) - 29 * 864e5).toISOString().slice(0, 10));
    expect(sum(ds.categories)).toBeCloseTo(sum(recent), 2);
    expect(ds.categories.every((c: { store?: string }) => c.store)).toBe(true);
    const s = await app.inject({ method: "GET", url: `/v1/analytics/summary?from=${from}&to=${ds.asOf}`, headers: { authorization: `Bearer ${jwt}` } });
    const summary = s.json();
    expect(summary.bills).toBe(ds.days.reduce((a: number, x: { bills: number }) => a + x.bills, 0));
    expect(Number(summary.revenue)).toBeCloseTo(sum(ds.days), 2);
    expect(summary.opened).toBe(ds.days.reduce((a: number, x: { opened: number }) => a + x.opened, 0));
  });

  it("keeps tenants apart", async () => {
    const other = await createBrand(db, { name: "Other", slug: "other", ownerEmail: "o@other.in", ownerPassword: "another-long-password" });
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "o@other.in", password: "another-long-password" } });
    const bills = await app.inject({ method: "GET", url: "/v1/bills", headers: { authorization: `Bearer ${login.json().token}` } });
    expect(bills.json().bills).toEqual([]);
    expect(other.brand.id).not.toBe(undefined);
  });
});
