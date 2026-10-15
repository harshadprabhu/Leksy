import { createBrand } from "@leksy/core";
import { brands, stores } from "@leksy/core/db";
import { createDb } from "@leksy/core/db";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";

/** Demo tenant: login demo@leksy.in / leksy-demo-123 */
const { db, pool } = createDb(loadConfig().DATABASE_URL, 1);
const existing = await db.query.brands.findFirst({ where: eq(brands.slug, "aurum-demo") });
if (existing) {
  console.log("demo brand already exists");
} else {
  const out = await createBrand(db, {
    name: "Aurum & Co.",
    slug: "aurum-demo",
    ownerEmail: "demo@leksy.in",
    ownerPassword: "leksy-demo-123",
    store: { code: "BLR-INDIRANAGAR", name: "Aurum & Co. Indiranagar", city: "Bengaluru", address: "100 Feet Road, Indiranagar", managerPhone: "+919800000001" },
  });
  await db.insert(stores).values({ brandId: out.brand.id, code: "MUM-BANDRA", name: "Aurum & Co. Bandra", city: "Mumbai", address: "Linking Road, Bandra West" });
  console.log("Demo brand created");
  console.log("  login:        demo@leksy.in / leksy-demo-123");
  console.log(`  API key:      ${out.apiKey}`);
  console.log(`  signing:      ${out.signingSecret}`);
  console.log(`  push URL key: ${out.ingestKey}`);
}
await pool.end();
