import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

export type Db = NodePgDatabase<typeof schema>;

export function createDb(url: string, max = 10): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max });
  return { db: drizzle(pool, { schema }), pool };
}
