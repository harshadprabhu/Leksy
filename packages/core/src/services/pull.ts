import { applyMapping, getPath, type Mapping } from "@leksy/mapper";
import { eq, sql } from "drizzle-orm";
import { connectors, type Db, type PullConfig } from "../db/index.js";
import { ingestBill, IngestError, type IngestResult } from "./ingest.js";
import { openSecret, sealSecret } from "../crypto.js";
import { assertPublicUrl, fetchBrandUrl } from "./net.js";

type Auth = NonNullable<PullConfig["auth"]>;
const mapAuth = (a: Auth | undefined, f: (s: string) => string): Auth | undefined => {
  if (!a) return a;
  if (a.type === "bearer") return { ...a, token: f(a.token) };
  if (a.type === "basic") return { ...a, password: f(a.password) };
  if (a.type === "header") return { ...a, value: f(a.value) };
  return a;
};
/** Encrypt a pull connector's credentials before saving them. */
export const sealPullAuth = (cfg: PullConfig): PullConfig => ({ ...cfg, auth: mapAuth(cfg.auth, sealSecret) });

export interface PullOutcome {
  fetched: number;
  results: IngestResult[];
  errors: { index: number; message: string; details?: unknown }[];
  cursor: string | null;
}

/** Call the brand's API once and return the raw array of bills it lists. */
export async function fetchFromBrand(cfg: PullConfig, cursor: string | null, allowPrivate = false): Promise<unknown[]> {
  const url = await assertPublicUrl(cfg.url, allowPrivate);
  if (cursor && cfg.cursorParam) url.searchParams.set(cfg.cursorParam, cursor);
  const headers: Record<string, string> = { accept: "application/json", ...(cfg.headers ?? {}) };
  const auth = mapAuth(cfg.auth, openSecret) ?? { type: "none" };
  if (auth.type === "bearer") headers.authorization = `Bearer ${auth.token}`;
  if (auth.type === "basic") headers.authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
  if (auth.type === "header") headers[auth.name.toLowerCase()] = auth.value;
  const method = cfg.method ?? "GET";
  const res = await fetchBrandUrl(
    url,
    {
      method,
      headers: method === "POST" ? { ...headers, "content-type": "application/json" } : headers,
      body: method === "POST" ? JSON.stringify(cfg.body ?? {}) : undefined,
      signal: AbortSignal.timeout(30_000),
    },
    allowPrivate,
  );
  if (!res.ok) throw new Error(`Brand API returned ${res.status}`);
  const json = (await res.json()) as unknown;
  const list = cfg.billsPath ? getPath(json, cfg.billsPath) : json;
  if (Array.isArray(list)) return list;
  if (list && typeof list === "object") return [list];
  throw new Error(`No bills found at "${cfg.billsPath ?? "(root)"}"`);
}

/** Map and ingest a batch of raw bills from one connector. */
export async function ingestRawBatch(db: Db, connector: typeof connectors.$inferSelect, raws: unknown[], source: "push" | "pull") {
  const results: IngestResult[] = [];
  const errors: PullOutcome["errors"] = [];
  for (const [index, raw] of raws.entries()) {
    try {
      const mapped = connector.mapping ? applyMapping(connector.mapping as Mapping, raw) : raw;
      results.push(await ingestBill(db, connector.brandId, mapped, { source, connectorId: connector.id, raw, autoCreateStore: true }));
    } catch (e) {
      errors.push({ index, message: (e as Error).message, details: e instanceof IngestError ? e.details : undefined });
    }
  }
  return { results, errors };
}

export async function runPull(db: Db, connectorId: string, allowPrivate = false): Promise<PullOutcome> {
  const connector = await db.query.connectors.findFirst({ where: eq(connectors.id, connectorId) });
  if (!connector || connector.kind !== "pull" || !connector.pull) throw new Error("Not a pull connector");
  try {
    const raws = await fetchFromBrand(connector.pull, connector.cursor, allowPrivate);
    const { results, errors } = await ingestRawBatch(db, connector, raws, "pull");
    let cursor = connector.cursor;
    if (connector.pull.cursorField) {
      for (const r of raws) {
        const v = getPath(r, connector.pull.cursorField);
        if (v != null && (cursor == null || String(v) > cursor)) cursor = String(v);
      }
    }
    await db.update(connectors).set({ cursor, lastRunAt: sql`now()`, lastError: errors.length ? `${errors.length} bills failed: ${errors[0]!.message}` : null }).where(eq(connectors.id, connector.id));
    return { fetched: raws.length, results, errors, cursor };
  } catch (e) {
    await db.update(connectors).set({ lastRunAt: sql`now()`, lastError: (e as Error).message }).where(eq(connectors.id, connector.id));
    throw e;
  }
}
