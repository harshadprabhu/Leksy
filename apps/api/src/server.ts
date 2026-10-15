import { createQueues, redisConnection } from "@leksy/core";
import { createDb } from "@leksy/core/db";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { channelEnv, loadConfig } from "./config.js";
import { chromiumPdf } from "./pdf.js";

const cfg = loadConfig();
const { db, pool } = createDb(cfg.DATABASE_URL);
const redis = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
const queues = createQueues(redisConnection(cfg.REDIS_URL));
const pdf = chromiumPdf(cfg.CHROMIUM_PATH);
const app = await buildApp({ cfg, db, queues, redis, pdf, channels: channelEnv(cfg, (m, data) => console.log(`[channel] ${m}`, JSON.stringify(data))) });

const shutdown = async () => {
  await app.close();
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await pdf.close();
  redis.disconnect();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: cfg.PORT, host: cfg.HOST });
