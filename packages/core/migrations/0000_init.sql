CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"signing_secret" text NOT NULL,
	"require_signature" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"store_code" text NOT NULL,
	"invoice_no" text NOT NULL,
	"token" text NOT NULL,
	"source" text NOT NULL,
	"connector_id" uuid,
	"raw" jsonb,
	"data" jsonb NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"customer_phone" text,
	"customer_email" text,
	"staff_id" text,
	"status" text DEFAULT 'received' NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_id" uuid,
	"template_version_id" uuid,
	"survey_key" text,
	"otp_lock" boolean DEFAULT false NOT NULL,
	"content_hash" text,
	"opened_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"website" text,
	"support_phone" text,
	"google_review_url" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"ingest_key" text NOT NULL,
	"mapping" jsonb,
	"pull" jsonb,
	"interval_seconds" integer,
	"cursor" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"sample" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connectors_ingest_key_unique" UNIQUE("ingest_key")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"to" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"bill_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"store_code" text NOT NULL,
	"staff_id" text,
	"rating" integer NOT NULL,
	"nps" integer,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comment" text,
	"ticket_status" text DEFAULT 'none' NOT NULL,
	"sla_due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"review_prompted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"address" text,
	"city" text,
	"phone" text,
	"gstin" text,
	"manager_name" text,
	"manager_phone" text,
	"manager_email" text,
	"maps_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"body" jsonb NOT NULL,
	"alert_threshold" integer DEFAULT 2 NOT NULL,
	"review_threshold" integer DEFAULT 4 NOT NULL,
	"sla_minutes" integer DEFAULT 240 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" jsonb NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"draft" jsonb NOT NULL,
	"published_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event" text DEFAULT 'bill.created' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"store_codes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '["*"]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_uq" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_brand_store_invoice_uq" ON "bills" USING btree ("brand_id","store_code","invoice_no");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_token_uq" ON "bills" USING btree ("token");--> statement-breakpoint
CREATE INDEX "bills_brand_issued_idx" ON "bills" USING btree ("brand_id","issued_at");--> statement-breakpoint
CREATE INDEX "deliveries_bill_idx" ON "deliveries" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "deliveries_provider_idx" ON "deliveries" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "events_brand_type_at_idx" ON "events" USING btree ("brand_id","type","at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_bill_uq" ON "feedback" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "feedback_brand_created_idx" ON "feedback" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_brand_code_uq" ON "stores" USING btree ("brand_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "surveys_brand_key_uq" ON "surveys" USING btree ("brand_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_uq" ON "template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_brand_key_uq" ON "templates" USING btree ("brand_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");