import { runMigrations } from "@leksy/core";
import { createDb } from "@leksy/core/db";
import { loadConfig } from "../config.js";

const { db, pool } = createDb(loadConfig().DATABASE_URL, 1);
await db.execute("create extension if not exists pgcrypto");
await runMigrations(db);
await pool.end();
console.log("migrations applied");
