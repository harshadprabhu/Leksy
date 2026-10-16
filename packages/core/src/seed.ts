import { PRESETS } from "@leksy/template-engine";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { generateApiKey, hashPassword, randomToken } from "./crypto.js";
import { apiKeys, brands, connectors, stores, surveys, templates, templateVersions, triggers, users, type Db } from "./db/index.js";
import { PROJECT_WOW } from "./survey.js";

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
}

export interface NewBrand {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerPassword: string;
  store?: { code: string; name: string; city?: string; address?: string; managerPhone?: string };
}

/**
 * Onboard a brand with everything needed to send a first bill:
 * owner login, a store, an API key, published starter templates,
 * the Project WOW survey, a default trigger and a push connector.
 */
export async function createBrand(db: Db, input: NewBrand) {
  return db.transaction(async (tx) => {
    const [brand] = await tx.insert(brands).values({ name: input.name, slug: input.slug }).returning();
    if (!brand) throw new Error("brand insert failed");
    await tx.insert(users).values({ brandId: brand.id, email: input.ownerEmail.toLowerCase(), passwordHash: hashPassword(input.ownerPassword), role: "owner", name: "Owner" });
    if (input.store) await tx.insert(stores).values({ brandId: brand.id, ...input.store });
    const key = generateApiKey("live");
    await tx.insert(apiKeys).values({ brandId: brand.id, name: "Default", prefix: key.prefix, secretHash: key.secretHash, signingSecret: key.signingSecret });
    for (const [k, body] of Object.entries(PRESETS)) {
      const [t] = await tx.insert(templates).values({ brandId: brand.id, key: k, name: body.name, draft: body, publishedVersion: 1 }).returning();
      await tx.insert(templateVersions).values({ templateId: t!.id, version: 1, body });
    }
    await tx.insert(surveys).values({ brandId: brand.id, key: "project-wow", name: "Project WOW", body: PROJECT_WOW });
    await tx.insert(triggers).values({
      brandId: brand.id,
      name: "Send every bill",
      event: "bill.created",
      conditions: [{ field: "customer.consent", op: "neq", value: false }],
      actions: { templateKey: "luxe-gold", surveyKey: "project-wow", channels: ["whatsapp", "sms", "email"] },
      priority: 100,
    });
    const [connector] = await tx
      .insert(connectors)
      .values({ brandId: brand.id, name: "Direct push", kind: "push", ingestKey: randomToken(24) })
      .returning();
    return { brand, apiKey: key.key, signingSecret: key.signingSecret, ingestKey: connector!.ingestKey };
  });
}
