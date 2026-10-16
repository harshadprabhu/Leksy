import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const brandRef = () => uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" });

/** A tenant. Every other row belongs to exactly one brand. */
export const brands = pgTable("brands", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  website: text("website"),
  supportPhone: text("support_phone"),
  googleReviewUrl: text("google_review_url"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    brandId: brandRef(),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["owner", "admin", "manager", "viewer"] }).notNull().default("admin"),
    storeCodes: jsonb("store_codes").$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

/**
 * An invitation to join a brand's team. Only a SHA-256 hash of the link's token is
 * stored; the link works once and expires after 7 days.
 */
export const invites = pgTable(
  "invites",
  {
    id: id(),
    brandId: brandRef(),
    email: text("email").notNull(),
    name: text("name"),
    role: text("role", { enum: ["admin", "manager", "viewer"] }).notNull(),
    storeCodes: jsonb("store_codes").$type<string[]>(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invites_token_uq").on(t.tokenHash), index("invites_brand_idx").on(t.brandId)],
);

export const stores = pgTable(
  "stores",
  {
    id: id(),
    brandId: brandRef(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    region: text("region"),
    address: text("address"),
    city: text("city"),
    phone: text("phone"),
    gstin: text("gstin"),
    managerName: text("manager_name"),
    managerPhone: text("manager_phone"),
    managerEmail: text("manager_email"),
    mapsUrl: text("maps_url"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("stores_brand_code_uq").on(t.brandId, t.code)],
);

/** Integration keys. Only a SHA-256 hash of the secret is stored. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    brandId: brandRef(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    /** Shared secret for optional HMAC request signing. */
    signingSecret: text("signing_secret").notNull(),
    requireSignature: boolean("require_signature").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_prefix_uq").on(t.prefix)],
);

/** A template: draft JSON plus immutable published versions. */
export const templates = pgTable("templates", {
  id: id(),
  brandId: brandRef(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  draft: jsonb("draft").$type<unknown>().notNull(),
  publishedVersion: integer("published_version"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("templates_brand_key_uq").on(t.brandId, t.key)]);

export const templateVersions = pgTable(
  "template_versions",
  {
    id: id(),
    templateId: uuid("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    body: jsonb("body").$type<unknown>().notNull(),
    publishedBy: uuid("published_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("template_versions_uq").on(t.templateId, t.version)],
);

export const surveys = pgTable("surveys", {
  id: id(),
  brandId: brandRef(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  body: jsonb("body").$type<unknown>().notNull(),
  alertThreshold: integer("alert_threshold").notNull().default(2),
  reviewThreshold: integer("review_threshold").notNull().default(4),
  slaMinutes: integer("sla_minutes").notNull().default(240),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("surveys_brand_key_uq").on(t.brandId, t.key)]);

/**
 * A source of bills. "push": the brand calls /v1/ingest/:key with its own JSON.
 * "pull": Leksy calls the brand's API on a schedule or when pinged.
 * Either way `mapping` turns the payload into the canonical bill.
 */
export const connectors = pgTable("connectors", {
  id: id(),
  brandId: brandRef(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["push", "pull"] }).notNull(),
  /** Public key used in the push URL /v1/ingest/:ingestKey. */
  ingestKey: text("ingest_key").notNull().unique(),
  mapping: jsonb("mapping").$type<Record<string, unknown>>(),
  /** Pull config: url, method, headers, auth, bills path, cursor. */
  pull: jsonb("pull").$type<PullConfig>(),
  intervalSeconds: integer("interval_seconds"),
  cursor: text("cursor"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastError: text("last_error"),
  sample: jsonb("sample").$type<unknown>(),
  createdAt: createdAt(),
});

export interface PullConfig {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  auth?: { type: "none" } | { type: "bearer"; token: string } | { type: "basic"; username: string; password: string } | { type: "header"; name: string; value: string };
  body?: unknown;
  /** Where the array of bills sits in the response, e.g. "data.invoices". Empty = the response itself. */
  billsPath?: string;
  /** Query parameter that receives the cursor, e.g. "updated_since". */
  cursorParam?: string;
  /** Field in each bill used to advance the cursor, e.g. "UpdatedAt". */
  cursorField?: string;
}

export interface TriggerActions {
  templateKey: string;
  surveyKey?: string;
  /** Tried in order until one succeeds. */
  channels: ("whatsapp" | "sms" | "email")[];
  delaySeconds?: number;
}

export const triggers = pgTable("triggers", {
  id: id(),
  brandId: brandRef(),
  name: text("name").notNull(),
  event: text("event", { enum: ["bill.created", "bill.updated"] }).notNull().default("bill.created"),
  /** All conditions must hold; they use the template condition syntax over the bill. */
  conditions: jsonb("conditions").$type<{ field: string; op: string; value?: string | number | boolean }[]>().notNull().default([]),
  actions: jsonb("actions").$type<TriggerActions>().notNull(),
  priority: integer("priority").notNull().default(100),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});

export const bills = pgTable(
  "bills",
  {
    id: id(),
    brandId: brandRef(),
    storeCode: text("store_code").notNull(),
    invoiceNo: text("invoice_no").notNull(),
    /** Unguessable token for the public link. */
    token: text("token").notNull(),
    source: text("source", { enum: ["api", "push", "pull", "ocr", "print", "manual"] }).notNull(),
    connectorId: uuid("connector_id"),
    raw: jsonb("raw").$type<unknown>(),
    data: jsonb("data").$type<unknown>().notNull(),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    staffId: text("staff_id"),
    status: text("status", { enum: ["received", "processing", "queued", "sent", "delivered", "failed", "skipped"] }).notNull().default("received"),
    issues: jsonb("issues").$type<unknown[]>().notNull().default([]),
    triggerId: uuid("trigger_id"),
    templateVersionId: uuid("template_version_id"),
    surveyKey: text("survey_key"),
    /** SHA-256 of the canonical data at render time; printed in the verify page. */
    contentHash: text("content_hash"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("bills_brand_store_invoice_uq").on(t.brandId, t.storeCode, t.invoiceNo),
    uniqueIndex("bills_token_uq").on(t.token),
    index("bills_brand_issued_idx").on(t.brandId, t.issuedAt),
  ],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    billId: uuid("bill_id").notNull().references(() => bills.id, { onDelete: "cascade" }),
    brandId: brandRef(),
    channel: text("channel", { enum: ["whatsapp", "sms", "email", "console"] }).notNull(),
    to: text("to").notNull(),
    status: text("status", { enum: ["queued", "sent", "delivered", "read", "failed"] }).notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("deliveries_bill_idx").on(t.billId), index("deliveries_provider_idx").on(t.providerMessageId)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    billId: uuid("bill_id").notNull().references(() => bills.id, { onDelete: "cascade" }),
    brandId: brandRef(),
    storeCode: text("store_code").notNull(),
    staffId: text("staff_id"),
    rating: integer("rating").notNull(),
    nps: integer("nps"),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
    comment: text("comment"),
    /** Closed loop: a low score opens a ticket. */
    ticketStatus: text("ticket_status", { enum: ["none", "open", "in_progress", "resolved"] }).notNull().default("none"),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    reviewPrompted: boolean("review_prompted").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("feedback_bill_uq").on(t.billId), index("feedback_brand_created_idx").on(t.brandId, t.createdAt)],
);

/** Append-only event log; streams to the analytics store. */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    brandId: uuid("brand_id").notNull(),
    billId: uuid("bill_id"),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_brand_type_at_idx").on(t.brandId, t.type, t.at)],
);

/** Outbound webhooks to the brand's systems. */
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: id(),
  brandId: brandRef(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default(["*"]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});
