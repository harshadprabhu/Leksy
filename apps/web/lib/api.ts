"use client";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${status}`);
  }
}

export const auth = {
  get token() {
    try {
      return localStorage.getItem("lx_token");
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem("lx_token", token);
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem("lx_token");
    } catch {}
  },
};

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/v1/auth")) {
    auth.clear();
    window.location.href = "/login";
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const inr = (n: number | string | null | undefined) =>
  n == null ? "–" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(n));

export const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");
