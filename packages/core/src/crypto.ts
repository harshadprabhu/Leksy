import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** URL-safe random string from a base-62 alphabet (no modulo bias). */
export function randomToken(length = 22): string {
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 248 && out.length < length) out += B62[b % 62];
    }
  }
  return out;
}

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** API keys look like lk_live_<prefix>_<secret>; we store sha256(secret). */
export function generateApiKey(env: "live" | "test" = "live") {
  const prefix = randomToken(10);
  const secret = randomToken(32);
  return { key: `lk_${env}_${prefix}_${secret}`, prefix, secretHash: sha256(secret), signingSecret: `whsec_${randomToken(32)}` };
}

export function parseApiKey(key: string): { prefix: string; secret: string } | null {
  const m = key.match(/^lk_(live|test)_([0-9A-Za-z]{10})_([0-9A-Za-z]{32})$/);
  return m ? { prefix: m[2]!, secret: m[3]! } : null;
}

/** Signature header: "t=<unix>,v1=<hex hmac of `${t}.${body}`>". */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

export function verifySignature(secret: string, body: string, header: string | undefined, toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return safeEqual(expected, parts.v1);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
  return safeEqual(actual, hash);
}

/** Canonical JSON (sorted keys) so the same bill always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Secrets the app must read back (a brand API's token or password) are sealed with
 * AES-256-GCM under LEKSY_SECRETS_KEY (32 bytes, base64 or hex) before they reach
 * the database. Values stored before encryption existed are read as they are.
 */
const SEALED = "enc:v1:";

function secretsKey(): Buffer | null {
  const raw = process.env.LEKSY_SECRETS_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error("Set LEKSY_SECRETS_KEY in production");
    return null;
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("LEKSY_SECRETS_KEY must be 32 bytes (64 hex or 44 base64 characters)");
  return key;
}

export function sealSecret(plain: string): string {
  const key = secretsKey();
  if (!key || plain.startsWith(SEALED)) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${SEALED}${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function openSecret(stored: string): string {
  if (!stored.startsWith(SEALED)) return stored;
  const key = secretsKey();
  if (!key) throw new Error("LEKSY_SECRETS_KEY is needed to read stored credentials");
  const [iv, tag, ct] = stored.slice(SEALED.length).split(":");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv!, "base64"));
  d.setAuthTag(Buffer.from(tag!, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct!, "base64")), d.final()]).toString("utf8");
}
