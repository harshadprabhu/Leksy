"use client";

import { BASE_PATH, demoApi, DemoError } from "./demo";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
/** Demo mode: no server; a browser-only backend with sample data (GitHub Pages POC). */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
export { BASE_PATH };

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${status}`);
  }
}

export const auth = {
  get token() {
    if (DEMO) return "demo";
    try {
      return localStorage.getItem("lx_token");
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem("lx_token", token);
      localStorage.removeItem("lx_role");
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem("lx_token");
      localStorage.removeItem("lx_role");
    } catch {}
  },
  /** The role the server last reported (it can change after sign-in). */
  rememberRole(role: string) {
    try {
      localStorage.setItem("lx_role", role);
    } catch {}
  },
  /** The signed-in user's role, read from the token (the API still checks every request). */
  get role(): "owner" | "admin" | "manager" | "viewer" | null {
    if (DEMO) return "owner";
    const t = this.token;
    if (!t) return null;
    try {
      const known = localStorage.getItem("lx_role");
      if (known) return known as "owner" | "admin" | "manager" | "viewer";
      const b64 = t.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
      return (JSON.parse(atob(b64)) as { role?: "owner" | "admin" | "manager" | "viewer" }).role ?? null;
    } catch {
      return null;
    }
  },
};

/** Owners and admins set the brand up; managers and viewers work with bills and feedback. */
export const isAdmin = () => ["owner", "admin"].includes(auth.role ?? "");

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (DEMO) {
    try {
      return await demoApi<T>(path, init.method ?? (init.body !== undefined ? "POST" : "GET"), init.body);
    } catch (e) {
      if (e instanceof DemoError) throw new ApiError(e.status, { error: e.message, message: e.message });
      throw e;
    }
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/v1/auth")) {
    auth.clear();
    window.location.href = `${BASE_PATH}/login/`;
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const inr = (n: number | string | null | undefined) =>
  n == null ? "–" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(n));

export const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");
