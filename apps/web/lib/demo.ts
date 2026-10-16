"use client";
/**
 * Demo backend: answers the same API calls as the real server, entirely in the
 * browser, with sample data kept in localStorage. Used for the GitHub Pages POC
 * (NEXT_PUBLIC_DEMO=1). It reuses the real packages, so mapping, validation,
 * templates and surveys behave exactly as in production.
 */
import { BillSchema, validateBill, type Bill } from "@leksy/bill-schema";
import { applyMapping, samplePaths, suggestMapping, type Mapping } from "@leksy/mapper";
import { cleanAnswers, MISSION_HAPPINESS, SurveySchema, type Survey } from "@leksy/survey";
import { buildDemoDataset, regionOf, tierOf, staffFor, storeProfile, themesFor, THEMES, type Dataset, type SampleBill } from "@leksy/insights";
import { deckFromKit, loadPack, parsePack, type BrandPack } from "./brandpack";
import ORRA_PACK from "./orra-pack.json";
import { buildContext, checkCondition, listFields, PRESETS, TemplateSchema, type Condition, type Template } from "@leksy/template-engine";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const KEY = "lx_demo_v7"; // v7: ORRA Fine Jewellery (its 94 stores), e-bill with ORRA's own campaign banners
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
  surveyKey?: string | null;
}

interface DemoSurvey {
  key: string;
  name: string;
  body: Survey;
  alertThreshold: number;
  reviewThreshold: number;
  slaMinutes: number;
  updatedAt: string;
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
  surveys: DemoSurvey[];
  seq: number;
}

const defaultSurveys = (): DemoSurvey[] => [
  { key: "mission-happiness", name: "Mission Happiness", body: MISSION_HAPPINESS, alertThreshold: 2, reviewThreshold: 4, slaMinutes: 240, updatedAt: new Date().toISOString() },
];

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

/** The demo brand: ORRA Fine Jewellery, its stores, bill designs and look. */
const DEFAULT_PACK: BrandPack = parsePack(ORRA_PACK);
const activePack = () => loadPack() ?? DEFAULT_PACK;

const NAMES = ["Meera Iyer", "Kabir Shah", "Aisha Khan", "Rohan Mehta", "Diya Kapoor", "Arjun Rao", "Sana Ali", "Ishaan Gupta", "Tara Menon", "Dev Patel", "Nisha Reddy", "Aditya Joshi", "Zoya Siddiqui", "Karan Malhotra", "Pooja Nair"];
// Categories match the Insights category list, so bills and analytics line up.
const CATALOG = [
  { name: "Temple Necklace", category: "Necklace", metal: "Gold", purity: "22K", wt: 24.6, rate: 7120, making: 14220, cert: "BIS_HALLMARK" },
  { name: "Solitaire Studs", category: "Earrings", metal: "Gold", purity: "18K", wt: 3.2, rate: 0, making: 0, price: 96500, stone: 0.5, cert: "IGI" },
  { name: "Kundan Bangles (pair)", category: "Bangles", metal: "Gold", purity: "22K", wt: 32.4, rate: 7120, making: 18900, cert: "BIS_HALLMARK" },
  { name: "Diamond Tennis Bracelet", category: "Bracelet", metal: "Gold", purity: "18K", wt: 9.8, rate: 0, making: 0, price: 245000, stone: 2.1, cert: "GIA" },
  { name: "Gold Coin 10g", category: "Coins", metal: "Gold", purity: "24K", wt: 10, rate: 7768, making: 450, cert: "BIS_HALLMARK" },
  { name: "Mangalsutra", category: "Mangalsutra", metal: "Gold", purity: "22K", wt: 12.2, rate: 7120, making: 8200, cert: "BIS_HALLMARK" },
  { name: "Diamond Pendant", category: "Pendant", metal: "Gold", purity: "18K", wt: 2.8, rate: 0, making: 0, price: 58500, stone: 0.3, cert: "IGI" },
  { name: "Platinum Band", category: "Rings", metal: "Platinum", purity: "PT950", wt: 6.1, rate: 3350, making: 4100, cert: "WARRANTY" },
];
const HUID = (rand: () => number) => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(rand() * 31)]).join("");

// Set by seed() from the brand pack when one is imported.
let brandName = DEFAULT_PACK.brand.name;
let invoicePrefix = DEFAULT_PACK.brand.invoicePrefix ?? "ORRA";

function makeBill(rand: () => number, at: Date, storeCode: string, n: number): Bill {
  const count = rand() < 0.65 ? 1 : 2;
  const items = Array.from({ length: count }, () => {
    const p = CATALOG[Math.floor(rand() * CATALOG.length)]!;
    const price = p.price ?? Math.round(p.wt * p.rate + p.making);
    const huid = HUID(rand);
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
              ? { type: "WARRANTY", number: `W-${Math.floor(rand() * 1e6)}`, issuer: brandName }
              : { type: "BIS_HALLMARK", number: huid, issuer: "Bureau of Indian Standards" },
      ],
    };
  });
  const taxable = items.reduce((s, i) => s + i.unit_price - i.discount, 0);
  const half = r2(taxable * 0.015);
  const rounded = Math.round(taxable + half * 2);
  const name = NAMES[Math.floor(rand() * NAMES.length)]!;
  const team = staffFor(storeCode);
  const staff = team[Math.floor(rand() * team.length)]!;
  const ist = new Date(at.getTime() + 5.5 * 3600e3).toISOString().slice(0, 19);
  return BillSchema.parse({
    invoice_no: `${invoicePrefix}-${storeCode.slice(0, 3)}-${at.getUTCFullYear()}-${String(n).padStart(5, "0")}`,
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

/** Stores from a brand pack, with region and tier filled in where the pack leaves them out. */
function packStores(p: BrandPack) {
  return (p.stores ?? []).map((st, i) => {
    const region = st.region ?? regionOf({ city: st.city }) ?? undefined;
    const tier = st.tier ?? tierOf(st.city) ?? 2;
    return {
      code: st.code,
      name: st.name,
      city: st.city,
      ...(region ? { region } : {}),
      tier,
      address: st.address ?? st.city,
      managerName: `${["Priya", "Arjun", "Neha", "Kiran", "Sourav", "Meera", "Rahul", "Divya"][i % 8]} ${"NSKRDMPG"[(i * 3) % 8]}`,
      managerPhone: `+9198${String(10000000 + i).slice(-8)}`,
      gstin: `${({ North: "07", South: "29", East: "19", West: "27" } as Record<string, string>)[region ?? ""] ?? "27"}ABCDE1234F1Z${(i % 9) + 1}`,
    };
  });
}

function seed(): DemoState {
  const rand = rng(42);
  const now = Date.now();
  const pack = activePack();
  brandName = pack.brand.name;
  invoicePrefix = pack.brand.invoicePrefix ?? pack.brand.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  const stores = packStores(pack);
  const ver = (key: string, name: string, body: Template) => ({ id: `tpl-${key}`, key, name, draft: body, publishedVersion: 1, updatedAt: new Date(now - 5 * DAY).toISOString(), versions: [{ version: 1, body, createdAt: new Date(now - 5 * DAY).toISOString() }] });
  const billKey = pack.billTemplate ?? "luxe-gold";
  const state: DemoState = {
    brand: {
          id: "brand-demo",
          name: pack.brand.name,
          slug: "pilot",
          logoUrl: pack.kit.logo ?? null,
          website: pack.brand.website ?? null,
          supportPhone: pack.brand.supportPhone ?? null,
          googleReviewUrl: pack.brand.googleReviewUrl ?? "https://www.google.com/maps",
          settings: { brandKit: pack.kit, deck: deckFromKit(pack.kit, pack.deck?.footer), ...(pack.pdfTemplate ? { pdfTemplate: pack.pdfTemplate } : {}), pack: true },
    },
    stores: stores.map((s) => ({ id: id(), managerEmail: null, ...s })),
    templates: [...(pack.templates ?? []).map((t) => ver(t.key, t.name, t.body)), ...Object.entries(PRESETS).map(([key, body]) => ver(key, body.name, body))],
    triggers: [
      { id: id(), name: "High-value jewellery: protect with OTP", event: "bill.created", conditions: [{ field: "total", op: "gt", value: 200000 }], actions: { templateKey: billKey, surveyKey: "mission-happiness", channels: ["whatsapp", "sms", "email"], otpLock: true }, priority: 10, enabled: true },
      { id: id(), name: "Send every bill", event: "bill.created", conditions: [{ field: "customer.consent", op: "neq", value: false }], actions: { templateKey: billKey, surveyKey: "mission-happiness", channels: ["whatsapp", "sms", "email"] }, priority: 100, enabled: true },
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
    surveys: defaultSurveys(),
    seq: 1000,
  };
  // ~600 itemised bills over 30 days across the network. Each store's customer
  // mood comes from the same profile that drives the generated history.
  const slow = new Set(["Mumbai", "Lucknow", "Patna"]);
  for (let d = 29; d >= 0; d--) {
    const perDay = 16 + Math.floor(rand() * 9);
    for (let k = 0; k < perDay; k++) {
      const st = state.stores[Math.floor(rand() * state.stores.length)]!;
      const at = new Date(now - d * DAY - Math.floor(rand() * 9) * 3600e3);
      if (at.getTime() > now) continue;
      const bill = makeBill(rand, at, st.code, ++state.seq);
      const row = addBill(state, bill, "api", at);
      // Opened 5–125 minutes after billing, never in the future.
      const openT = at.getTime() + (5 + rand() * 120) * 60e3;
      if (rand() < 0.74 && openT < now - 4 * 60e3) {
        row.openedAt = new Date(openT).toISOString();
        row.status = "delivered";
        if (rand() < 0.48) {
          // Most visits follow the store's mood; about 1 in 12 goes badly wrong.
          const base = storeProfile(st).mood + (rand() - 0.5) * 2.2 - (rand() < 0.08 ? 2 : 0);
          const rating = Math.max(1, Math.min(5, Math.round(base)));
          const improve = rating <= 3 ? pickSome(rand, slow.has(st.city) ? ["Waiting time", "Waiting time", "Billing", "Staff help"] : THEMES.filter((t) => t !== "Waiting time")) : undefined;
          const loved = rating >= 4 ? pickSome(rand, ["Staff help", "Product range", "Store ambience", "Quick billing"]) : undefined;
          const answers: Record<string, unknown> = { overall: rating, nps: Math.max(0, Math.min(10, rating * 2 + Math.round(rand() * 2 - 1))), ...(improve ? { improve } : {}), ...(loved ? { loved } : {}) };
          if (rating <= 2 && rand() < 0.6) answers.comment = slow.has(st.city) ? "Waited almost 25 minutes at the billing counter." : "The staff seemed busy and didn't explain the making charges.";
          const fb = feedbackRow(state, row, rating, answers, new Date(Math.min(now - 60e3, new Date(row.openedAt).getTime() + 3 * 60e3)));
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

function addBill(state: DemoState, bill: Bill, source: string, at = new Date(), tok = token()): DemoBill {
  const trigger = state.triggers.filter((t) => t.enabled && t.event === "bill.created").sort((a, b) => a.priority - b.priority).find((t) => t.conditions.every((c: Condition) => checkCondition(c, bill as any)));
  const actions = trigger?.actions ?? { templateKey: "luxe-gold", channels: ["whatsapp"] };
  const tpl = state.templates.find((t) => t.key === (bill.template ?? actions.templateKey)) ?? state.templates[0]!;
  const row: DemoBill = {
    id: id(),
    token: tok,
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
    surveyKey: bill.survey ?? actions.surveyKey ?? null,
  };
  state.bills.unshift(row);
  const channel = actions.channels[0] ?? "whatsapp";
  state.deliveries.push({ id: id(), billId: row.id, channel, to: bill.customer.phone ?? bill.customer.email ?? "-", status: "delivered", error: null, createdAt: at.toISOString() });
  state.events.push({ id: state.events.length + 1, billId: row.id, type: "bill.received", at: at.toISOString() }, { id: state.events.length + 2, billId: row.id, type: "delivery.sent", at: new Date(at.getTime() + 2000).toISOString() });
  return row;
}

function feedbackRow(state: DemoState, bill: DemoBill, rating: number, answers: Record<string, unknown>, at = new Date(), alertThreshold = 2, slaMinutes = 240) {
  const alert = rating <= alertThreshold;
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
    slaDueAt: alert ? new Date(at.getTime() + slaMinutes * 60e3).toISOString() : null,
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
    if (raw) {
      cache = JSON.parse(raw) as DemoState;
      cache.surveys ??= defaultSurveys(); // data saved before surveys were editable
      // Surveys saved before rating styles existed: ask the happiness question with faces.
      for (const sv of cache.surveys) for (const q of sv.body.questions) if (q.type === "rating" && q.id === sv.body.primary && !q.style) q.style = "faces";
      return cache;
    }
  } catch {}
  cache = seed();
  save();
  return cache;
}
/**
 * Older demo versions left their data behind, and every github.io page shares one
 * storage quota; once it is full, new bills silently stop being saved. Clear them.
 */
function dropOldVersions() {
  try {
    for (const k of Object.keys(localStorage)) if (/^lx_demo_v\d+$/.test(k) && k !== KEY) localStorage.removeItem(k);
  } catch {}
}
let cleaned = false;
function save() {
  if (!cache) return;
  if (!cleaned) {
    dropOldVersions();
    cleaned = true;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Still full: keep the newest activity log and try once more.
    cache.events = cache.events.slice(-300);
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {}
  }
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
    brand: { name: state.brand.name, logo_url: state.brand.logoUrl ?? undefined, logo_light_url: state.brand.settings?.brandKit?.logoLight ?? state.brand.logoUrl ?? undefined, watermark_url: state.brand.settings?.brandKit?.watermark ? (state.brand.settings.brandKit.mark ?? state.brand.settings.brandKit.logo) : undefined, website: state.brand.website ?? undefined, support_phone: state.brand.supportPhone ?? undefined },
    store: { code: bill.storeCode, name: store?.name ?? bill.storeCode, address: store?.address, city: store?.city, phone: store?.phone, gstin: store?.gstin },
    links: linksFor(bill.token),
  });
}

/** The template version a bill was sent with (falls back to the live one). */
/** The live version of a template by key, or null. */
export function liveTemplate(state: DemoState, key: string): Template | null {
  const t = state.templates.find((x) => x.key === key);
  if (!t) return null;
  const live = t.versions.find((v) => v.version === t.publishedVersion) ?? t.versions.at(-1);
  return live ? TemplateSchema.parse(live.body) : null;
}

export function billTemplate(state: DemoState, bill: DemoBill): Template {
  const t = state.templates.find((x) => x.key === bill.templateKey) ?? state.templates[0]!;
  const live = t.versions.find((v) => v.version === t.publishedVersion) ?? t.versions.at(-1)!;
  return TemplateSchema.parse(live.body);
}

export function findBillByToken(t: string) {
  const s = load();
  return s.bills.find((b) => b.token === t) ?? restoreSimulated(s, t);
}

/**
 * A simulated sale's link names everything needed to make the same bill again
 * (random seed, time, invoice number, store), so the customer link opens on any
 * phone or browser, not only the one that pressed "Simulate a sale".
 */
const simToken = (seed: number, at: number, seq: number, storeIdx: number) => `S${[seed, at, seq, storeIdx].map((n) => n.toString(36)).join("-")}`;

function restoreSimulated(s: DemoState, t: string): DemoBill | null {
  const m = /^S([0-9a-z]+)-([0-9a-z]+)-([0-9a-z]+)-([0-9a-z]+)$/.exec(t);
  if (!m) return null;
  const [seed, at, seq, storeIdx] = m.slice(1).map((x) => parseInt(x, 36)) as [number, number, number, number];
  const store = s.stores[storeIdx];
  if (!store || at > Date.now() + DAY || at < Date.now() - 400 * DAY) return null;
  const row = addBill(s, makeBill(rng(seed), new Date(at), store.code, seq), "api", new Date(at), t);
  s.seq = Math.max(s.seq, seq);
  save();
  return row;
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

/** The survey a bill asks (the one its trigger chose), or null for none. */
export function surveyFor(bill: DemoBill): DemoSurvey | null {
  const s = load();
  const key = bill.surveyKey === undefined ? "mission-happiness" : bill.surveyKey;
  return key ? (s.surveys.find((x) => x.key === key) ?? null) : null;
}

export function submitDemoFeedback(bill: DemoBill, raw: Record<string, unknown>): { ok: boolean; j: any } {
  const s = load();
  if (s.feedback.some((f) => f.billId === bill.id)) return { ok: false, j: { error: "feedback already submitted for this bill" } };
  const sv = surveyFor(bill);
  if (!sv) return { ok: false, j: { error: "no survey for this bill" } };
  const { answers, errors } = cleanAnswers(sv.body, raw);
  if (errors.length) return { ok: false, j: { error: errors.join("; ") } };
  const rating = Number(answers[sv.body.primary]);
  if (!Number.isInteger(rating)) return { ok: false, j: { error: "missing rating" } };
  const npsQ = sv.body.questions.find((q) => q.type === "nps");
  const textQ = sv.body.questions.find((q) => q.type === "text");
  const normalised = { ...answers, ...(npsQ && answers[npsQ.id] !== undefined ? { nps: answers[npsQ.id] } : {}), ...(textQ && answers[textQ.id] ? { comment: answers[textQ.id] } : {}) };
  const fb = feedbackRow(s, bill, rating, normalised, new Date(), sv.alertThreshold, sv.slaMinutes);
  save();
  return { ok: true, j: { ok: true, reviewUrl: rating >= sv.reviewThreshold ? s.brand.googleReviewUrl : null, alert: rating <= sv.alertThreshold } };
}

export function hasFeedback(bill: DemoBill) {
  return load().feedback.some((f) => f.billId === bill.id);
}

/** A new sale, as if a store's POS had just called POST /v1/bills. */
export function simulateSale(storeCode?: string): DemoBill {
  const s = load();
  const seed = Date.now() % 100000;
  const now = new Date();
  const known = storeCode ? s.stores.findIndex((x) => x.code === storeCode) : Math.floor(Math.random() * s.stores.length);
  const store = storeCode ?? s.stores[known]!.code;
  const seq = ++s.seq;
  // Stores outside the list (API callers) get an ordinary random token.
  const row = addBill(s, makeBill(rng(seed), now, store, seq), "api", now, known >= 0 ? simToken(seed, now.getTime(), seq, known) : undefined);
  save();
  return row;
}

// ---------- analytics (same shape as the server's summary) ----------

/**
 * Dashboard numbers come from the same daily facts as Insights (generated network
 * history plus every itemised bill), so the two pages always agree.
 */
function summary(s: DemoState, fromDay: string, toDay: string) {
  const ds = demoDataset(s);
  type Acc = { bills: number; revenue: number; sent: number; opened: number; ratingSum: number; ratingCount: number; promoters: number; detractors: number; npsCount: number };
  const blank = (): Acc => ({ bills: 0, revenue: 0, sent: 0, opened: 0, ratingSum: 0, ratingCount: 0, promoters: 0, detractors: 0, npsCount: 0 });
  const add = (a: Acc, d: Dataset["days"][number]) => {
    a.bills += d.bills;
    a.revenue += d.revenue;
    a.sent += d.sent ?? 0;
    a.opened += d.opened ?? 0;
    a.ratingSum += d.ratingSum;
    a.ratingCount += d.ratingCount;
    a.promoters += d.promoters;
    a.detractors += d.detractors;
    a.npsCount += d.npsCount;
  };
  const all = blank();
  const byStore = new Map<string, Acc>();
  const byDay = new Map<string, Acc>();
  for (const d of ds.days) {
    if (d.date < fromDay || d.date > toDay) continue;
    add(all, d);
    add(byStore.get(d.store) ?? byStore.set(d.store, blank()).get(d.store)!, d);
    add(byDay.get(d.date) ?? byDay.set(d.date, blank()).get(d.date)!, d);
  }
  const rating = (a: Acc) => (a.ratingCount ? a.ratingSum / a.ratingCount : null);
  const nps = (a: Acc) => (a.npsCount ? (100 * (a.promoters - a.detractors)) / a.npsCount : null);
  const names = new Map(s.stores.map((x) => [x.code, x.name]));
  const fromT = new Date(`${fromDay}T00:00:00+05:30`).getTime();
  const toT = new Date(`${toDay}T23:59:59.999+05:30`).getTime();
  const fb = s.feedback.filter((f) => {
    const t = new Date(f.createdAt).getTime();
    return t >= fromT && t <= toT;
  });
  const detailFrom = addDaysIso(ds.asOf, -(ds.detailDays - 1));
  return {
    bills: all.bills,
    sent: all.sent,
    opened: all.opened,
    responses: all.ratingCount,
    avgRating: rating(all),
    nps: nps(all),
    openTickets: fb.filter((f) => ["open", "in_progress"].includes(f.ticketStatus)).length,
    revenue: all.revenue,
    stores: s.stores.length,
    byStore: [...byStore]
      .map(([store, a]) => ({ store, name: names.get(store) ?? store, bills: a.bills, opened: a.opened, sent: a.sent, responses: a.ratingCount, avgRating: rating(a), nps: nps(a) }))
      // Least happy first, among stores with enough ratings to judge.
      .sort((x, y) => Number(y.responses >= 10) - Number(x.responses >= 10) || (x.avgRating ?? 99) - (y.avgRating ?? 99) || y.responses - x.responses),
    byDay: [...byDay].map(([day, a]) => ({ day, bills: a.bills, opened: a.opened, responses: a.ratingCount, avgRating: rating(a) })).sort((x, y) => x.day.localeCompare(y.day)),
    themes: themesFor(ds),
    themesWindow: { from: detailFrom, to: ds.asOf },
  };
}

// ---------- Insights dataset ----------

const istDate = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Every itemised bill in the demo, in the shape the dataset builder adds on top of the history. */
function samplesOf(s: DemoState): SampleBill[] {
  const fbBy = new Map(s.feedback.map((f) => [f.billId, f]));
  return s.bills.map((b) => {
    const f = fbBy.get(b.id);
    return {
      date: istDate(b.issuedAt),
      store: b.storeCode,
      total: Number(b.total),
      sent: ["sent", "delivered"].includes(b.status),
      opened: !!b.openedAt,
      ...(b.data.staff?.id ? { staff: { id: b.data.staff.id, name: b.data.staff.name ?? b.data.staff.id } } : {}),
      items: b.data.items.map((it) => ({ category: it.category ?? "Other", amount: it.qty * it.unit_price - it.discount })),
      ...(f ? { feedback: { rating: f.rating, nps: f.nps, improve: (f.answers.improve as string[] | undefined) ?? [] } } : {}),
    };
  });
}

let memo: { key: string; ds: Dataset } | null = null;

/**
 * Daily aggregates for Insights and the dashboard: two years of generated history
 * for every store (weekends, wedding season, growth, national and regional
 * festivals) with every itemised demo bill added to its day. Rebuilt only when
 * bills, feedback, stores or the date change.
 */
export function demoDataset(s: DemoState): Dataset {
  const asOf = istDate(new Date().toISOString());
  const key = `${asOf}|${s.bills.length}|${s.feedback.length}|${s.stores.length}|${s.stores[0]?.code}|${s.brand.name}`;
  if (memo?.key === key) return memo.ds;
  const ds = buildDemoDataset({
    brand: s.brand.name,
    asOf,
    stores: s.stores.map((x) => ({ code: x.code, name: x.name, city: x.city, ...(x.region ? { region: x.region } : {}), ...(x.tier ? { tier: x.tier } : {}) })),
    samples: samplesOf(s),
  });
  memo = { key, ds };
  return ds;
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
  if (seg[1] === "insights") return out as T; // read-only and large: no copy, no save
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
    const toDay = q.get("to") ?? istDate(new Date().toISOString());
    const fromDay = q.get("from") ?? addDaysIso(toDay, -29);
    return summary(s, fromDay, toDay);
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
    const names = new Map(s.stores.map((x) => [x.code, x.name]));
    const matched = s.bills.filter((b) => !term || b.invoiceNo.toLowerCase().includes(term) || (b.customerPhone ?? "").includes(term) || b.storeCode.toLowerCase().includes(term) || (names.get(b.storeCode) ?? "").toLowerCase().includes(term));
    return {
      total: matched.length,
      bills: matched
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
        .slice(0, Number(q.get("limit") ?? 50))
        .map((b) => ({ ...b, data: undefined, storeName: names.get(b.storeCode) ?? b.storeCode, rating: fbBy.get(b.id)?.rating ?? null, url: linksFor(b.token).page })),
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
    const matched = s.feedback.filter((f) => !ticket || f.ticketStatus === ticket);
    const dist = [1, 2, 3, 4, 5].map((r) => matched.filter((f) => f.rating === r).length);
    return { total: matched.length, dist, feedback: matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Number(q.get("limit") ?? 50)) };
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

  if (res === "insights") return demoDataset(s);
  if (res === "surveys") {
    if (M === "PUT" && rid) {
      const parsed = SurveySchema.safeParse(body.body);
      if (!parsed.success) throw new DemoError(422, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      const row: DemoSurvey = { key: rid, name: body.name, body: parsed.data, alertThreshold: body.alertThreshold ?? 2, reviewThreshold: body.reviewThreshold ?? 4, slaMinutes: body.slaMinutes ?? 240, updatedAt: new Date().toISOString() };
      const i = s.surveys.findIndex((x) => x.key === rid);
      if (i >= 0) s.surveys[i] = row;
      else s.surveys.push(row);
      return row;
    }
    return { surveys: s.surveys };
  }
  throw new DemoError(404, `demo: ${method} ${seg.join("/")} not supported`);
}

export { DemoError };
