import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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
