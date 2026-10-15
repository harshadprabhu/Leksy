import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivate(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Guard outbound calls to brand-supplied URLs (pull connectors, webhooks)
 * against SSRF: https only (http allowed in dev) and no private addresses.
 */
export async function assertPublicUrl(raw: string, allowPrivate = false): Promise<URL> {
  const url = new URL(raw);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("URL must be http(s)");
  if (allowPrivate) return url;
  if (url.protocol !== "https:") throw new Error("URL must use https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivate(a.address))) throw new Error("URL resolves to a private address");
  return url;
}
