"use client";
/**
 * Demo backend: answers the same API calls as the real server, entirely in the
 * browser, with sample data kept in localStorage. Used for the GitHub Pages POC
 * (NEXT_PUBLIC_DEMO=1). It reuses the real packages, so mapping, validation,
 * templates and surveys behave exactly as in production.
 */
import { BillSchema, validateBill, type Bill } from "@leksy/bill-schema";
import { applyMapping, samplePaths, suggestMapping, type Mapping } from "@leksy/mapper";
import { cleanAnswers, MISSION_HAPPINESS } from "@leksy/survey";
import { buildContext, checkCondition, listFields, PRESETS, TemplateSchema, type Condition, type Template } from "@leksy/template-engine";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const KEY = "lx_demo_v1";
const DAY = 864e5;

interface DemoBill {
  id: string;
  token: string;
  invoiceNo: string;
  storeCode: string;
  total: string;
  issuedAt: string;
  status: string;
  source: string;
  customerPhone: string | null;
  openedAt: string | null;
  data: Bill;
  issues: unknown[];
  templateKey: string;
  templateVersion: number;
  otpLock: boolean;
}

interface DemoState {
  brand: any;
  stores: any[];
  templates: { id: string; key: string; name: string; draft: Template; publishedVersion: number | null; updatedAt: string; versions: { version: number; body: Template; createdAt: string }[] }[];
  triggers: any[];
  connectors: any[];
  bills: DemoBill[];
  deliveries: any[];
  feedback: any[];
  events: any[];
  apiKeys: any[];
  webhooks: any[];
  seq: number;
}

// ---------- deterministic sample data ----------

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const id = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const token = () => {
  const a = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return Array.from(crypto.getRandomValues(new Uint8Array(22)), (b) => a[b % 62]).join("");
};
const r2 = (n: number) => Math.round(n * 100) / 100;

const STORES = [
  { code: "BLR-INDIRANAGAR", name: "Aurum & Co. Indiranagar", city: "Bengaluru", address: "100 Feet Road, Indiranagar", managerName: "Priya N", managerPhone: "+919800000001", gstin: "29ABCDE1234F1Z5" },
  { code: "MUM-BANDRA", name: "Aurum & Co. Bandra", city: "Mumbai", address: "Linking Road, Bandra West", managerName: "Arjun S", managerPhone: "+919800000002", gstin: "27ABCDE1234F1Z9" },
  { code: "DEL-KHAN-MARKET", name: "Aurum & Co. Khan Market", city: "New Delhi", address: "Middle Lane, Khan Market", managerName: "Neha K", managerPhone: "+919800000003", gstin: "07ABCDE1234F1Z2" },
  { code: "HYD-JUBILEE", name: "Aurum & Co. Jubilee Hills", city: "Hyderabad", address: "Road No. 36, Jubilee Hills", managerName: "Kiran R", managerPhone: "+919800000004", gstin: "36ABCDE1234F1Z7" },
];
const STAFF = [
  { id: "S-114", name: "Rahul" },
  { id: "S-207", name: "Fatima" },
  { id: "S-311", name: "Vikram" },
  { id: "S-402", name: "Ananya" },
  { id: "S-518", name: "Joseph" },
];
const NAMES = ["Meera Iyer", "Kabir Shah", "Aisha Khan", "Rohan Mehta", "Diya Kapoor", "Arjun Rao", "Sana Ali", "Ishaan Gupta", "Tara Menon", "Dev Patel", "Nisha Reddy", "Aditya Joshi", "Zoya Siddiqui", "Karan Malhotra", "Pooja Nair"];
const CATALOG = [
  { name: "Temple Necklace", category: "Necklace", metal: "Gold", purity: "22K", wt: 24.6, rate: 7120, making: 14220, cert: "BIS_HALLMARK" },
  { name: "Solitaire Studs", category: "Earrings", metal: "Gold", purity: "18K", wt: 3.2, rate: 0, making: 0, price: 96500, stone: 0.5, cert: "IGI" },
  { name: "Kundan Bangles (pair)", category: "Bangles", metal: "Gold", purity: "22K", wt: 32.4, rate: 7120, making: 18900, cert: "BIS_HALLMARK" },
  { name: "Diamond Tennis Bracelet", category: "Bracelet", metal: "Gold", purity: "18K", wt: 9.8, rate: 0, making: 0, price: 245000, stone: 2.1, cert: "GIA" },
  { name: "Gold Coin 10g", category: "Coin", metal: "Gold", purity: "24K", wt: 10, rate: 7768, making: 450, cert: "BIS_HALLMARK" },
  { name: "Mangalsutra", category: "Necklace", metal: "Gold", purity: "22K", wt: 12.2, rate: 7120, making: 8200, cert: "BIS_HALLMARK" },
  { name: "Platinum Band", category: "Ring", metal: "Platinum", purity: "PT950", wt: 6.1, rate: 3350, making: 4100, cert: "WARRANTY" },
];
const HUID = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

function makeBill(rand: () => number, at: Date, storeCode: string, n: number): Bill {
  const count = rand() < 0.65 ? 1 : 2;
  const items = Array.from({ length: count }, () => {
    const p = CATALOG[Math.floor(rand() * CATALOG.length)]!;
    const price = p.price ?? Math.round(p.wt * p.rate + p.making);
    const huid = HUID();
    const discount = rand() < 0.25 ? Math.round(price * 0.05) : 0;
    return {
      name: p.name,
      category: p.category,
      qty: 1,
      unit_price: price,
      discount,
      hsn: "7113",
      tax_rate: 3,
      jewellery: { metal: p.metal, purity: p.purity, gross_wt_g: p.wt, net_wt_g: r2(p.wt * 0.97), ...(p.rate ? { rate_per_g: p.rate, making_charges: p.making } : {}), ...(p.stone ? { stone_wt_ct: p.stone } : {}), huid },
      certificates: [
        p.cert === "IGI"
          ? { type: "IGI", number: `LG6${Math.floor(rand() * 1e8)}`, issuer: "International Gemological Institute", url: "https://www.igi.org/verify-your-report/" }
          : p.cert === "GIA"
            ? { type: "GIA", number: `${Math.floor(rand() * 1e10)}`, issuer: "Gemological Institute of America", url: "https://www.gia.edu/report-check-landing" }
            : p.cert === "WARRANTY"
              ? { type: "WARRANTY", number: `W-${Math.floor(rand() * 1e6)}`, issuer: "Aurum & Co." }
              : { type: "BIS_HALLMARK", number: huid, issuer: "Bureau of Indian Standards" },
      ],
    };
  });
  const taxable = items.reduce((s, i) => s + i.unit_price - i.discount, 0);
  const half = r2(taxable * 0.015);
  const rounded = Math.round(taxable + half * 2);
  const name = NAMES[Math.floor(rand() * NAMES.length)]!;
  const staff = STAFF[Math.floor(rand() * STAFF.length)]!;
  const ist = new Date(at.getTime() + 5.5 * 3600e3).toISOString().slice(0, 19);
  return BillSchema.parse({
    invoice_no: `AUR-${storeCode.slice(0, 3)}-${at.getUTCFullYear()}-${String(n).padStart(5, "0")}`,
    store_code: storeCode,
    issued_at: `${ist}+05:30`,
    customer: { name, phone: `+9198${String(Math.floor(rand() * 1e8)).padStart(8, "0")}` },
    staff,
    items,
    taxes: [
      { type: "CGST", rate: 1.5, amount: half },
      { type: "SGST", rate: 1.5, amount: half },
    ],
    round_off: r2(rounded - (taxable + half * 2)),
    total: rounded,
    payments: rand() < 0.5 ? [{ mode: "UPI", amount: rounded }] : [{ mode: "CARD", amount: rounded }],
    loyalty: { points_earned: Math.round(rounded / 100), points_balance: Math.round(rounded / 100) + Math.floor(rand() * 20000), tier: rand() < 0.3 ? "Platinum" : "Gold" },
    meta: { gold_rate_22k: 7120, gold_rate_24k: 7768 },
  });
}

const PUSH_SAMPLE = {
  InvoiceNumber: "T-1009",
  Branch: "MUM-BANDRA",
  InvDate: "15/10/2026 18:05",
  Mobile: "098123 45679",
  CustomerName: "Kabir Shah",
  GrandTotal: "1,03,000.00",
  CGST: "1500",
  SGST: "1500",
  Lines: [{ ItemName: "Diamond Ring", Qty: "1", Rate: "100000", HUID: "QW12ER", Purity: "18K" }],
};
const PULL_SAMPLE = {
  DocNo: "SAP-88231",
  Outlet: "DEL-KHAN-MARKET",
  TxnDate: "2026-10-15 16:20",
  CustMobile: "9811122233",
  CustName: "Tara Menon",
  NetAmount: "52530",
  UpdatedAt: "2026-10-15T10:50:00Z",
  Items: [{ ProductName: "Gold Coin 10g", Quantity: 1, Price: 52530 }],
};

function seed(): DemoState {
  const rand = rng(42);
  const now = Date.now();
  const state: DemoState = {
    brand: { id: "brand-demo", name: "Aurum & Co.", slug: "aurum-demo", logoUrl: null, website: "https://example.com", supportPhone: "+91 80 4000 1234", googleReviewUrl: "https://www.google.com/maps", settings: {} },
    stores: STORES.map((s) => ({ id: id(), managerEmail: null, ...s })),
    templates: Object.entries(PRESETS).map(([key, body]) => ({ id: `tpl-${key}`, key, name: body.name, draft: body, publishedVersion: 1, updatedAt: new Date(now - 5 * DAY).toISOString(), versions: [{ version: 1, body, createdAt: new Date(now - 5 * DAY).toISOString() }] })),
    triggers: [
      { id: id(), name: "High-value jewellery: protect with OTP", event: "bill.created", conditions: [{ field: "total", op: "gt", value: 200000 }], actions: { templateKey: "luxe-gold", surveyKey: "mission-happiness", channels: ["whatsapp", "sms", "email"], otpLock: true }, priority: 10, enabled: true },
      { id: id(), name: "Send every bill", event: "bill.created", conditions: [{ field: "customer.consent", op: "neq", value: false }], actions: { templateKey: "luxe-gold", surveyKey: "mission-happiness", channels: ["whatsapp", "sms", "email"] }, priority: 100, enabled: true },
    ],
    connectors: [
      { id: "conn-push", name: "Ginesys POS (push)", kind: "push", ingestKey: "demoPushKey0000000000001", mapping: null, sample: PUSH_SAMPLE, pull: null, intervalSeconds: null, enabled: true, lastRunAt: null, lastError: null, cursor: null },
      { id: "conn-pull", name: "SAP B1 invoices (pull)", kind: "pull", ingestKey: "demoPullKey0000000000002", mapping: suggestMapping(PULL_SAMPLE), sample: PULL_SAMPLE, pull: { url: "https://erp.example.com/api/invoices", auth: { type: "bearer", redacted: true }, billsPath: "data", cursorParam: "since", cursorField: "UpdatedAt" }, intervalSeconds: 300, enabled: true, lastRunAt: new Date(now - 4 * 60e3).toISOString(), lastError: null, cursor: "2026-10-15T10:50:00Z" },
    ],
    bills: [],
    deliveries: [],
    feedback: [],
    events: [],
    apiKeys: [{ id: id(), name: "Default", prefix: "demoKey123", requireSignature: false, lastUsedAt: new Date(now - 3600e3).toISOString(), createdAt: new Date(now - 30 * DAY).toISOString() }],
    webhooks: [],
    seq: 1000,
  };
  // ~120 bills over 30 days; Mumbai has slow billing, Delhi shines.
  const mood: Record<string, number> = { "BLR-INDIRANAGAR": 4.2, "MUM-BANDRA": 3.0, "DEL-KHAN-MARKET": 4.6, "HYD-JUBILEE": 3.9 };
  for (let d = 29; d >= 0; d--) {
    const perDay = 2 + Math.floor(rand() * 5);
    for (let k = 0; k < perDay; k++) {
      const store = STORES[Math.floor(rand() * STORES.length)]!.code;
      const at = new Date(now - d * DAY - Math.floor(rand() * 9) * 3600e3);
      if (at.getTime() > now) continue;
      const bill = makeBill(rand, at, store, ++state.seq);
      const row = addBill(state, bill, "api", at);
      if (rand() < 0.74) {
        row.openedAt = new Date(at.getTime() + (5 + rand() * 120) * 60e3).toISOString();
        row.status = "delivered";
        if (rand() < 0.48) {
          const base = mood[store]! + (rand() - 0.5) * 2.2;
          const rating = Math.max(1, Math.min(5, Math.round(base)));
          const improve = rating <= 3 ? pickSome(rand, store === "MUM-BANDRA" ? ["Waiting time", "Waiting time", "Billing", "Staff help"] : ["Store ambience", "Pricing", "Product range", "Staff help"]) : undefined;
          const loved = rating >= 4 ? pickSome(rand, ["Staff help", "Product range", "Store ambience", "Quick billing"]) : undefined;
          const answers: Record<string, unknown> = { overall: rating, nps: Math.max(0, Math.min(10, rating * 2 + Math.round(rand() * 2 - 1))), ...(improve ? { improve } : {}), ...(loved ? { loved } : {}) };
          if (rating <= 2 && rand() < 0.6) answers.comment = store === "MUM-BANDRA" ? "Waited almost 25 minutes at the billing counter." : "The staff seemed busy and didn't explain the making charges.";
          const fb = feedbackRow(state, row, rating, answers, new Date(new Date(row.openedAt).getTime() + 3 * 60e3));
          if (fb.ticketStatus === "open" && d > 2) {
            fb.ticketStatus = rand() < 0.7 ? "resolved" : "open";
            if (fb.ticketStatus === "resolved") fb.resolutionNote = "Called the customer, apologised and offered free cleaning.";
          }
        }
      }
    }
  }
  return state;
}

function pickSome(rand: () => number, opts: string[]) {
  const out = new Set<string>();
  const n = 1 + Math.floor(rand() * 2);
  while (out.size < n) out.add(opts[Math.floor(rand() * opts.length)]!);
  return [...out];
}

function addBill(state: DemoState, bill: Bill, source: string, at = new Date()): DemoBill {
  const trigger = state.triggers.filter((t) => t.enabled && t.event === "bill.created").sort((a, b) => a.priority - b.priority).find((t) => t.conditions.every((c: Condition) => checkCondition(c, bill as any)));
  const actions = trigger?.actions ?? { templateKey: "luxe-gold", channels: ["whatsapp"] };
  const tpl = state.templates.find((t) => t.key === (bill.template ?? actions.templateKey)) ?? state.templates[0]!;
  const row: DemoBill = {
    id: id(),
    token: token(),
    invoiceNo: bill.invoice_no,
    storeCode: bill.store_code,
    total: bill.total.toFixed(2),
    issuedAt: new Date(bill.issued_at).toISOString(),
    status: "sent",
    source,
    customerPhone: bill.customer.phone ?? null,
    openedAt: null,
    data: bill,
    issues: validateBill(bill),
    templateKey: tpl.key,
    templateVersion: tpl.publishedVersion ?? 1,
    otpLock: !!actions.otpLock,
  };
  state.bills.unshift(row);
  const channel = actions.channels[0] ?? "whatsapp";
  state.deliveries.push({ id: id(), billId: row.id, channel, to: bill.customer.phone ?? bill.customer.email ?? "-", status: "delivered", error: null, createdAt: at.toISOString() });
  state.events.push({ id: state.events.length + 1, billId: row.id, type: "bill.received", at: at.toISOString() }, { id: state.events.length + 2, billId: row.id, type: "delivery.sent", at: new Date(at.getTime() + 2000).toISOString() });
  return row;
}

function feedbackRow(state: DemoState, bill: DemoBill, rating: number, answers: Record<string, unknown>, at = new Date()) {
  const alert = rating <= 2;
  const fb = {
    id: id(),
    billId: bill.id,
    storeCode: bill.storeCode,
    staffId: bill.data.staff?.id ?? null,
    rating,
    nps: typeof answers.nps === "number" ? answers.nps : null,
    answers,
    comment: (answers.comment as string) ?? null,
    ticketStatus: alert ? "open" : "none",
    slaDueAt: alert ? new Date(at.getTime() + 240 * 60e3).toISOString() : null,
    resolutionNote: null as string | null,
    createdAt: at.toISOString(),
  };
  state.feedback.unshift(fb);
  state.events.push({ id: state.events.length + 1, billId: bill.id, type: "feedback.submitted", at: at.toISOString() });
  if (alert) state.events.push({ id: state.events.length + 1, billId: bill.id, type: "alert.sent", at: at.toISOString() });
  return fb;
}

// ---------- storage ----------

let cache: DemoState | null = null;
export function load(): DemoState {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return (cache = JSON.parse(raw) as DemoState);
  } catch {}
  cache = seed();
  save();
  return cache;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
}
export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  cache = null;
}

export function linksFor(t: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return { page: `${origin}${BASE_PATH}/bill/?t=${t}`, pdf: `${origin}${BASE_PATH}/bill/?t=${t}&print=1`, verify: `${origin}${BASE_PATH}/verify/?t=${t}` };
}

export function billContext(state: DemoState, bill: DemoBill) {
  const store = state.stores.find((s) => s.code === bill.storeCode);
  return buildContext(bill.data, {
    brand: { name: state.brand.name, logo_url: state.brand.logoUrl ?? undefined, website: state.brand.website ?? undefined, support_phone: state.brand.supportPhone ?? undefined },
    store: { code: bill.storeCode, name: store?.name ?? bill.storeCode, address: store?.address, city: store?.city, phone: store?.phone, gstin: store?.gstin },
    links: linksFor(bill.token),
  });
}

/** The template version a bill was sent with (falls back to the live one). */
export function billTemplate(state: DemoState, bill: DemoBill): Template {
  const t = state.templates.find((x) => x.key === bill.templateKey) ?? state.templates[0]!;
  const live = t.versions.find((v) => v.version === t.publishedVersion) ?? t.versions.at(-1)!;
  return TemplateSchema.parse(live.body);
}

export function findBillByToken(t: string) {
  const s = load();
  return s.bills.find((b) => b.token === t) ?? null;
}

export function markOpened(bill: DemoBill) {
  const s = load();
  if (!bill.openedAt) {
    bill.openedAt = new Date().toISOString();
    bill.status = "delivered";
    s.events.push({ id: s.events.length + 1, billId: bill.id, type: "bill.opened", at: bill.openedAt });
    save();
  }
}

export function submitDemoFeedback(bill: DemoBill, raw: Record<string, unknown>): { ok: boolean; j: any } {
  const s = load();
  if (s.feedback.some((f) => f.billId === bill.id)) return { ok: false, j: { error: "feedback already submitted for this bill" } };
  const { answers, errors } = cleanAnswers(MISSION_HAPPINESS, raw);
  if (errors.length) return { ok: false, j: { error: errors.join("; ") } };
  const fb = feedbackRow(s, bill, Number(answers.overall), answers);
  save();
  return { ok: true, j: { ok: true, reviewUrl: fb.rating >= 4 ? s.brand.googleReviewUrl : null, alert: fb.rating <= 2 } };
}

export function hasFeedback(bill: DemoBill) {
  return load().feedback.some((f) => f.billId === bill.id);
}

/** A new sale, as if a store's POS had just called POST /v1/bills. */
export function simulateSale(storeCode?: string): DemoBill {
  const s = load();
  const rand = rng(Date.now() % 100000);
  const store = storeCode ?? STORES[Math.floor(Math.random() * STORES.length)]!.code;
  const row = addBill(s, makeBill(rand, new Date(), store, ++s.seq), "api");
  save();
  return row;
}

// ---------- analytics (same shape as the server's summary) ----------

function summary(s: DemoState, from: Date, to: Date) {
  const inRange = s.bills.filter((b) => {
    const t = new Date(b.issuedAt).getTime();
    return t >= from.getTime() && t <= to.getTime();
  });
  const fbBy = new Map(s.feedback.map((f) => [f.billId, f]));
  const agg = (bills: DemoBill[]) => {
    const fbs = bills.map((b) => fbBy.get(b.id)).filter(Boolean) as any[];
    const npsList = fbs.filter((f) => f.nps != null).map((f) => f.nps as number);
    return {
      bills: bills.length,
      opened: bills.filter((b) => b.openedAt).length,
      responses: fbs.length,
      avgRating: fbs.length ? r2(fbs.reduce((a, f) => a + f.rating, 0) / fbs.length) : null,
      nps: npsList.length ? Math.round((1000 * (npsList.filter((n) => n >= 9).length - npsList.filter((n) => n <= 6).length)) / npsList.length) / 10 : null,
      fbs,
    };
  };
  const all = agg(inRange);
  const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const group = <K,>(xs: DemoBill[], key: (b: DemoBill) => K) => {
    const m = new Map<K, DemoBill[]>();
    for (const b of xs) m.set(key(b), [...(m.get(key(b)) ?? []), b]);
    return m;
  };
  const themes = new Map<string, number>();
  for (const f of all.fbs) for (const o of (f.answers.improve as string[] | undefined) ?? []) themes.set(o, (themes.get(o) ?? 0) + 1);
  return {
    bills: all.bills,
    sent: inRange.filter((b) => ["sent", "delivered"].includes(b.status)).length,
    opened: all.opened,
    responses: all.responses,
    avgRating: all.avgRating,
    nps: all.nps,
    openTickets: all.fbs.filter((f) => ["open", "in_progress"].includes(f.ticketStatus)).length,
    revenue: inRange.reduce((a, b) => a + Number(b.total), 0),
    byStore: [...group(inRange, (b) => b.storeCode)]
      .map(([store, bs]) => {
        const a = agg(bs);
        return { store, bills: a.bills, opened: a.opened, responses: a.responses, avgRating: a.avgRating, nps: a.nps };
      })
      .sort((x, y) => (x.avgRating ?? 99) - (y.avgRating ?? 99)),
    byDay: [...group(inRange, (b) => istDay(b.issuedAt))]
      .map(([day, bs]) => {
        const a = agg(bs);
        return { day, bills: a.bills, opened: a.opened, responses: a.responses, avgRating: a.avgRating };
      })
      .sort((x, y) => x.day.localeCompare(y.day)),
    themes: [...themes].map(([option, count]) => ({ option, count })).sort((a, b) => b.count - a.count),
  };
}

// ---------- request router ----------

class DemoError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

function previewMapping(mapping: Mapping | null, sample: unknown) {
  const mapped = mapping ? applyMapping(mapping, sample) : sample;
  const parsed = BillSchema.safeParse(mapped);
  return {
    mapped,
    valid: parsed.success,
    errors: parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    warnings: parsed.success ? validateBill(parsed.data) : [],
  };
}

const connView = (c: any) => ({ ...c, ingestUrl: `https://api.leksy.in/v1/ingest/${c.ingestKey}` });

export async function demoApi<T>(path: string, method: string, body: any): Promise<T> {
  await new Promise((r) => setTimeout(r, 60)); // feel like a network call
  const s = load();
  const url = new URL(path, "https://demo.local");
  const p = url.pathname;
  const q = url.searchParams;
  const seg = p.split("/").filter(Boolean); // ["v1", "bills", ":id", ...]
  const out = route(s, method, seg, q, body);
  save();
  return structuredClone(out) as T;
}

function route(s: DemoState, method: string, seg: string[], q: URLSearchParams, body: any): any {
  const [, res, rid, sub] = seg;
  const M = method;
  // auth
  if (res === "auth") return { token: "demo", user: { id: "u-demo", email: "demo@leksy.in", name: "Demo Owner", role: "owner" } };
  if (res === "me") return { user: { id: "u-demo", email: "demo@leksy.in", name: "Demo Owner", role: "owner" }, brand: s.brand };
  if (res === "brand" && M === "PUT") return Object.assign(s.brand, body);

  if (res === "analytics") {
    const to = q.get("to") ? new Date(`${q.get("to")}T23:59:59.999+05:30`) : new Date();
    const from = q.get("from") ? new Date(`${q.get("from")}T00:00:00+05:30`) : new Date(to.getTime() - 30 * DAY);
    return summary(s, from, to);
  }

  if (res === "bills") {
    if (M === "POST" && !rid) {
      const row = simulateSale(body?.store_code);
      return { id: row.id, created: true, status: "queued", url: linksFor(row.token).page };
    }
    if (rid && sub === "resend") return { status: "queued" };
    if (rid) {
      const b = s.bills.find((x) => x.id === rid);
      if (!b) throw new DemoError(404, "not_found");
      return {
        bill: { ...b, links: linksFor(b.token) },
        deliveries: s.deliveries.filter((d) => d.billId === b.id),
        feedback: s.feedback.find((f) => f.billId === b.id) ?? null,
        events: s.events.filter((e) => e.billId === b.id).sort((a, b2) => b2.at.localeCompare(a.at)),
      };
    }
    const term = (q.get("q") ?? "").toLowerCase();
    const fbBy = new Map(s.feedback.map((f) => [f.billId, f]));
    return {
      bills: s.bills
        .filter((b) => !term || b.invoiceNo.toLowerCase().includes(term) || (b.customerPhone ?? "").includes(term))
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
        .slice(0, Number(q.get("limit") ?? 50))
        .map((b) => ({ ...b, data: undefined, rating: fbBy.get(b.id)?.rating ?? null, url: linksFor(b.token).page })),
    };
  }

  if (res === "templates") {
    if (rid === "presets") return { presets: Object.entries(PRESETS).map(([key, t]) => ({ key, name: t.name, template: t })) };
    if (rid === "fields") {
      const bill = (q.get("billId") && s.bills.find((b) => b.id === q.get("billId"))) || s.bills[0]!;
      const context = billContext(s, bill);
      return { fields: listFields(context), context };
    }
    if (!rid && M === "GET") return { templates: s.templates.map(({ draft: _d, versions: _v, ...t }) => t) };
    if (!rid && M === "POST") {
      if (s.templates.some((t) => t.key === body.key)) throw new DemoError(409, "key_in_use");
      const draft = { ...TemplateSchema.parse(PRESETS[body.from] ?? PRESETS["luxe-gold"]), name: body.name };
      const t = { id: `tpl-${id()}`, key: body.key, name: body.name, draft, publishedVersion: null, updatedAt: new Date().toISOString(), versions: [] };
      s.templates.push(t);
      return t;
    }
    const t = s.templates.find((x) => x.id === rid);
    if (!t) throw new DemoError(404, "not_found");
    if (sub === "publish") {
      const version = (t.versions.at(-1)?.version ?? 0) + 1;
      t.versions.push({ version, body: TemplateSchema.parse(t.draft), createdAt: new Date().toISOString() });
      t.publishedVersion = version;
      // In the demo, already-sent bills pick up the new design too, so the change is visible at once.
      for (const b of s.bills) if (b.templateKey === t.key) b.templateVersion = version;
      return { version };
    }
    if (sub === "versions") return { versions: t.versions.map((v) => ({ id: `${t.id}-${v.version}`, version: v.version, createdAt: v.createdAt })).reverse() };
    if (M === "PUT") {
      t.draft = TemplateSchema.parse(body.draft);
      if (body.name) t.name = body.name;
      t.updatedAt = new Date().toISOString();
    }
    const { versions: _v, ...rest } = t;
    return rest;
  }

  if (res === "connectors") {
    if (!rid && M === "GET") return { connectors: s.connectors.map(connView) };
    if (!rid && M === "POST") {
      const c = { id: id(), name: body.name, kind: body.kind, ingestKey: token(), mapping: null, sample: body.kind === "pull" ? PULL_SAMPLE : null, pull: body.pull ? { ...body.pull, auth: { type: body.pull.auth?.type ?? "none", redacted: true } } : null, intervalSeconds: body.intervalSeconds ?? null, enabled: true, lastRunAt: null, lastError: null, cursor: null };
      s.connectors.push(c);
      return connView(c);
    }
    const c = s.connectors.find((x) => x.id === rid);
    if (!c) throw new DemoError(404, "not_found");
    if (sub === "sample") {
      if (!c.sample) {
        // Demo: pretend the POS just pushed its first bill.
        c.sample = PUSH_SAMPLE;
      }
      const suggestion = suggestMapping(c.sample);
      return { sample: c.sample, paths: samplePaths(c.sample), suggestion, preview: previewMapping(c.mapping ?? suggestion, c.sample) };
    }
    if (sub === "run") {
      c.lastRunAt = new Date().toISOString();
      return { status: "queued" };
    }
    if (M === "DELETE") {
      s.connectors = s.connectors.filter((x) => x.id !== rid);
      return undefined;
    }
    if (M === "PUT") Object.assign(c, body.mapping !== undefined ? { mapping: body.mapping } : {}, body.name ? { name: body.name } : {});
    return connView(c);
  }

  if (res === "mapping") {
    if (rid === "preview") return previewMapping(body.mapping, body.sample);
    return { suggestion: suggestMapping(body.sample), paths: samplePaths(body.sample) };
  }

  if (res === "triggers") {
    if (!rid && M === "GET") return { triggers: [...s.triggers].sort((a, b) => a.priority - b.priority) };
    if (!rid && M === "POST") {
      const t = { id: id(), ...body };
      s.triggers.push(t);
      return t;
    }
    if (M === "DELETE") {
      s.triggers = s.triggers.filter((t) => t.id !== rid);
      return undefined;
    }
    const t = s.triggers.find((x) => x.id === rid);
    return Object.assign(t, body);
  }

  if (res === "feedback") {
    if (rid && M === "PATCH") {
      const f = s.feedback.find((x) => x.id === rid);
      if (!f) throw new DemoError(404, "not_found");
      return Object.assign(f, body);
    }
    const ticket = q.get("ticket");
    return { feedback: s.feedback.filter((f) => !ticket || f.ticketStatus === ticket).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Number(q.get("limit") ?? 50)) };
  }

  if (res === "stores") {
    if (M === "POST") {
      const st = { id: id(), ...body };
      s.stores.push(st);
      return st;
    }
    return { stores: s.stores };
  }

  if (res === "api-keys") {
    if (M === "POST") {
      const prefix = token().slice(0, 10);
      s.apiKeys.push({ id: id(), name: body.name, prefix, requireSignature: !!body.requireSignature, lastUsedAt: null, createdAt: new Date().toISOString() });
      return { key: `lk_live_${prefix}_${token()}${token().slice(0, 10)}`, signingSecret: `whsec_${token()}` };
    }
    if (M === "DELETE") {
      s.apiKeys = s.apiKeys.filter((k) => k.id !== rid);
      return undefined;
    }
    return { keys: s.apiKeys };
  }

  if (res === "webhooks") {
    if (M === "POST") {
      s.webhooks.push({ id: id(), url: body.url, events: body.events ?? ["*"] });
      return { secret: `whsec_${token()}` };
    }
    if (M === "DELETE") {
      s.webhooks = s.webhooks.filter((w) => w.id !== rid);
      return undefined;
    }
    return { webhooks: s.webhooks };
  }

  if (res === "surveys") return { surveys: [{ key: "mission-happiness", name: "Mission Happiness", body: MISSION_HAPPINESS }] };
  throw new DemoError(404, `demo: ${method} ${seg.join("/")} not supported`);
}

export { DemoError };
