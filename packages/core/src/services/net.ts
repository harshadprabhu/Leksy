import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit } from "undici";

/** Addresses a brand-supplied URL must never reach: private, local, reserved and special-use ranges. */
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  BLOCKED_V4.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 96], // unspecified, loopback and IPv4-compatible
  ["::ffff:0:0", 96], // IPv4-mapped (::ffff:127.0.0.1 and its hex spellings)
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link local
  ["ff00::", 8], // multicast
] as const)
  BLOCKED_V6.addSubnet(net, prefix, "ipv6");

export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 0) return true;
  // Two lists: Node matches IPv4 addresses against IPv4-mapped IPv6 rules too.
  return v === 6 ? BLOCKED_V6.check(ip, "ipv6") : BLOCKED_V4.check(ip, "ipv4");
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
  if (url.username || url.password) throw new Error("URL must not carry credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) throw new Error("URL resolves to a private address");
  return url;
}

/**
 * Connections made for brand-supplied URLs re-check every address DNS returns at
 * connect time, so a name cannot pass the check and then point somewhere private
 * (DNS rebinding).
 */
const guarded = new Agent({
  connect: {
    lookup: (hostname, options, cb) =>
      dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err) return cb(err, "", 4);
        const list = addrs as unknown as LookupAddress[];
        if (!list.length || list.some((a) => isBlockedAddress(a.address))) return cb(new Error("URL resolves to a private address"), "", 4);
        if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
        cb(null, list[0]!.address, list[0]!.family);
      }),
  },
});

/** fetch() for brand-supplied URLs: validated, no redirects, and pinned to public addresses. */
export async function fetchBrandUrl(raw: string | URL, init: RequestInit, allowPrivate = false) {
  const url = await assertPublicUrl(String(raw), allowPrivate);
  return undiciFetch(url, { ...init, redirect: "error", ...(allowPrivate ? {} : { dispatcher: guarded }) });
}
