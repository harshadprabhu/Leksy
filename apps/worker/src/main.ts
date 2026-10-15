import { createQueues, QUEUES, redisConnection } from "@leksy/core";
import { connectors, createDb } from "@leksy/core/db";
import { Worker, type Job } from "bullmq";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { alertLowScore, checkSla, deliverBill, processBill, pullConnector, sendWebhook, type WorkerDeps } from "./processors.js";

const env = z
  .object({
    DATABASE_URL: z.string().default("postgres://leksy:leksy@localhost:5432/leksy"),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    PUBLIC_BASE_URL: z.string().default("http://localhost:4000"),
    NODE_ENV: z.string().default("development"),
    ALLOW_PRIVATE_URLS: z.stringbool().default(false),
    CHANNELS_DRY_RUN: z.stringbool().optional(),
    WHATSAPP_API_VERSION: z.string().default("v21.0"),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    SMS_HTTP_URL: z.string().optional(),
    SMS_HTTP_TOKEN: z.string().optional(),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default("Leksy <bills@leksy.in>"),
    WORKER_CONCURRENCY: z.coerce.number().default(10),
  })
  .parse(process.env);

const { db, pool } = createDb(env.DATABASE_URL, env.WORKER_CONCURRENCY + 2);
const connection = redisConnection(env.REDIS_URL);
const queues = createQueues(connection);
const deps: WorkerDeps = {
  db,
  queues,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  allowPrivateUrls: env.ALLOW_PRIVATE_URLS,
  channels: {
    whatsappApiVersion: env.WHATSAPP_API_VERSION,
    whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN,
    smsHttpUrl: env.SMS_HTTP_URL,
    smsHttpToken: env.SMS_HTTP_TOKEN,
    smtpUrl: env.SMTP_URL,
    emailFrom: env.EMAIL_FROM,
    dryRun: env.CHANNELS_DRY_RUN ?? env.NODE_ENV !== "production",
    log: (m, data) => console.log(`[channel] ${m}`, JSON.stringify(data)),
  },
};

const opts = { connection, concurrency: env.WORKER_CONCURRENCY };
const workers = [
  new Worker(QUEUES.process, (j: Job) => processBill(deps, j.data), opts),
  new Worker(QUEUES.deliver, (j: Job) => deliverBill(deps, j.data), opts),
  new Worker(QUEUES.pull, (j: Job) => pullConnector(deps, j.data), { connection, concurrency: 4 }),
  new Worker(QUEUES.alert, (j: Job) => (j.name === "sla-check" ? checkSla(deps) : alertLowScore(deps, j.data)), opts),
  new Worker(QUEUES.webhook, (j: Job) => sendWebhook(deps, j.data), opts),
];
for (const w of workers) {
  w.on("failed", (job, err) => console.error(`[${w.name}] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message));
}

/** Keep one repeatable pull job per enabled pull connector with an interval. */
async function syncSchedules() {
  const rows = await db.query.connectors.findMany({ where: and(eq(connectors.kind, "pull"), eq(connectors.enabled, true), isNotNull(connectors.intervalSeconds)) });
  const wanted = new Set<string>();
  for (const c of rows) {
    const id = `pull:${c.id}`;
    wanted.add(id);
    await queues.pull.upsertJobScheduler(id, { every: c.intervalSeconds! * 1000 }, { name: "scheduled", data: { connectorId: c.id } });
  }
  for (const s of await queues.pull.getJobSchedulers()) {
    if (s.key.startsWith("pull:") && !wanted.has(s.key)) await queues.pull.removeJobScheduler(s.key);
  }
}

await queues.alert.upsertJobScheduler("sla-check", { every: 5 * 60_000 }, { name: "sla-check", data: { feedbackId: "" } });
await syncSchedules();
const timer = setInterval(() => syncSchedules().catch((e) => console.error("schedule sync failed", e)), 60_000);
console.log("Leksy worker running");

const shutdown = async () => {
  clearInterval(timer);
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
