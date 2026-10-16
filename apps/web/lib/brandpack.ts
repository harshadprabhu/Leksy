"use client";
/**
 * Brand packs: one file with everything that makes Leksy look like a client —
 * name, logos, watermark, colours, fonts, store list and bill templates. A pack
 * is imported in Settings. In the demo it lives only in this browser, so a pilot
 * client's assets are never published on the public site.
 */
import { TemplateSchema, type Template } from "@leksy/template-engine";
import { z } from "zod";

const DataImage = z.string().max(2_000_000).regex(/^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/, "images must be embedded (data:image/…)");
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const BrandKitSchema = z.object({
  name: z.string().min(1).max(120),
  /** Logo for light backgrounds. */
  logo: DataImage.optional(),
  /** Logo for dark backgrounds (deck cover, dark headers). */
  logoLight: DataImage.optional(),
  /** Faint mark for watermarks (defaults to the logo). */
  mark: DataImage.optional(),
  watermark: z.boolean().default(true),
  primary: Hex,
  accent: Hex,
  background: Hex,
  /** Main brand colour for the app chrome (sidebar highlight, buttons). */
  ui: Hex.optional(),
  headingFont: z.string().max(80),
  bodyFont: z.string().max(80),
  tagline: z.string().max(160).optional(),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;

export const PackStoreSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  city: z.string().max(80),
  state: z.string().max(80).optional(),
  region: z.enum(["North", "South", "East", "West"]).optional(),
  tier: z.union([z.literal(1), z.literal(2)]).optional(),
  address: z.string().max(400).optional(),
});
export type PackStore = z.infer<typeof PackStoreSchema>;

export const BrandPackSchema = z.object({
  kind: z.literal("leksy-brand-pack"),
  version: z.literal(1),
  brand: z.object({
    name: z.string().min(1).max(120),
    website: z.string().max(300).optional(),
    supportPhone: z.string().max(40).optional(),
    googleReviewUrl: z.string().max(500).optional(),
    invoicePrefix: z.string().max(6).optional(),
  }),
  kit: BrandKitSchema,
  stores: z.array(PackStoreSchema).max(5000).optional(),
  templates: z.array(z.object({ key: z.string().regex(/^[a-z0-9-]{2,40}$/), name: z.string().max(120), body: z.unknown() })).max(20).optional(),
  /** Template sent on WhatsApp (the landing page) and the one used for PDF downloads. */
  billTemplate: z.string().optional(),
  pdfTemplate: z.string().optional(),
  deck: z.object({ footer: z.string().max(200).optional() }).optional(),
});
export type BrandPack = Omit<z.infer<typeof BrandPackSchema>, "templates"> & { templates?: { key: string; name: string; body: Template }[] };

/** Parse and check a pack file; templates are validated like any other template. */
export function parsePack(raw: unknown): BrandPack {
  const p = BrandPackSchema.parse(raw);
  const templates = (p.templates ?? []).map((t) => ({ ...t, body: TemplateSchema.parse(t.body) }));
  const keys = new Set(templates.map((t) => t.key));
  for (const k of [p.billTemplate, p.pdfTemplate]) if (k && !keys.has(k) && !["luxe-gold", "classic"].includes(k)) throw new Error(`template "${k}" is not in the pack`);
  const codes = new Set<string>();
  for (const s of p.stores ?? []) {
    if (codes.has(s.code)) throw new Error(`store code ${s.code} appears twice`);
    codes.add(s.code);
  }
  return { ...p, templates };
}

const PACK_KEY = "lx_brand_pack";

export function loadPack(): BrandPack | null {
  try {
    const raw = localStorage.getItem(PACK_KEY);
    return raw ? parsePack(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function savePack(p: BrandPack) {
  localStorage.setItem(PACK_KEY, JSON.stringify(p));
}

export function clearPack() {
  try {
    localStorage.removeItem(PACK_KEY);
  } catch {}
}

/** The deck look that follows from a kit. */
export function deckFromKit(kit: BrandKit, footer?: string) {
  return {
    company: kit.name,
    primary: kit.ui ?? kit.primary,
    accent: kit.accent,
    text: "#1F2937",
    headingFont: ["Cormorant Garamond", "Playfair Display"].includes(kit.headingFont) ? "Cambria" : kit.headingFont,
    bodyFont: ["Inter", "Red Hat Display", "Nunito", "Figtree"].includes(kit.bodyFont) ? "Calibri" : kit.bodyFont,
    logo: kit.logo && /^data:image\/(png|jpeg);base64,/.test(kit.logo) ? kit.logo : undefined,
    logoLight: kit.logoLight && /^data:image\/(png|jpeg);base64,/.test(kit.logoLight) ? kit.logoLight : undefined,
    mark: kit.watermark ? [kit.mark, kit.logo].find((x) => x && /^data:image\/(png|jpeg);base64,/.test(x)) : undefined,
    footer: footer ?? "Confidential · for internal use only",
  };
}

/** Apply a kit's colours to the app chrome (sidebar, buttons, highlights). */
export function applyAppTheme(kit: BrandKit | null) {
  const root = document.documentElement.style;
  if (!kit) {
    for (const v of ["--accent", "--accent-soft", "--brand-ink"]) root.removeProperty(v);
    return;
  }
  const c = kit.ui ?? kit.accent;
  root.setProperty("--accent", c);
  root.setProperty("--accent-soft", `color-mix(in srgb, ${c} 12%, transparent)`);
  root.setProperty("--brand-ink", kit.primary);
}
