import type { Bill } from "@leksy/bill-schema";
import { buildContext, PRESETS, renderDocument, TemplateSchema, type Links, type Template } from "@leksy/template-engine";
import { and, desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { canonicalJson, sha256 } from "../crypto.js";
import { brands, stores, templates, templateVersions, type Db } from "../db/index.js";
import { MISSION_HAPPINESS, SurveySchema, type Survey } from "../survey.js";
import { surveys } from "../db/index.js";

export function billLinks(baseUrl: string, token: string): Links {
  const b = baseUrl.replace(/\/$/, "");
  return { page: `${b}/b/${token}`, pdf: `${b}/b/${token}/pdf`, json: `${b}/b/${token}/json`, verify: `${b}/v/${token}` };
}

/** The published version of a template, falling back to a built-in preset. */
export async function resolveTemplate(db: Db, brandId: string, key: string): Promise<{ template: Template; versionId: string | null }> {
  const row = await db.query.templates.findFirst({ where: and(eq(templates.brandId, brandId), eq(templates.key, key)) });
  if (row?.publishedVersion) {
    const v = await db.query.templateVersions.findFirst({
      where: and(eq(templateVersions.templateId, row.id), eq(templateVersions.version, row.publishedVersion)),
    });
    if (v) return { template: TemplateSchema.parse(v.body), versionId: v.id };
  }
  return { template: PRESETS[key] ?? PRESETS["luxe-gold"]!, versionId: null };
}

export async function templateByVersionId(db: Db, versionId: string): Promise<Template | null> {
  const v = await db.query.templateVersions.findFirst({ where: eq(templateVersions.id, versionId) });
  return v ? TemplateSchema.parse(v.body) : null;
}

export async function latestTemplateVersion(db: Db, templateId: string) {
  return db.query.templateVersions.findFirst({ where: eq(templateVersions.templateId, templateId), orderBy: desc(templateVersions.version) });
}

export async function resolveSurvey(db: Db, brandId: string, key: string | null | undefined) {
  if (!key) return null;
  const row = await db.query.surveys.findFirst({ where: and(eq(surveys.brandId, brandId), eq(surveys.key, key)) });
  if (row) return { survey: SurveySchema.parse(row.body), row };
  if (key === "mission-happiness") return { survey: MISSION_HAPPINESS, row: null };
  return null;
}

export async function contextFor(db: Db, brandId: string, bill: Bill, links: Links) {
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
  const store = await db.query.stores.findFirst({ where: and(eq(stores.brandId, brandId), eq(stores.code, bill.store_code)) });
  return buildContext(bill, {
    brand: { name: brand?.name ?? "", logo_url: brand?.logoUrl ?? undefined, watermark_url: watermarkOf(brand?.settings), website: brand?.website ?? undefined, support_phone: brand?.supportPhone ?? undefined },
    store: {
      code: bill.store_code,
      name: store?.name ?? bill.store_code,
      address: store?.address ?? undefined,
      city: store?.city ?? undefined,
      phone: store?.phone ?? undefined,
      gstin: store?.gstin ?? undefined,
      maps_url: store?.mapsUrl ?? undefined,
    },
    links,
  });
}

export const contentHash = (bill: Bill) => sha256(canonicalJson(bill));

/**
 * Render a template to a full HTML document. QR codes are drawn as inline SVG.
 * `survey` and `script` let the bill page add its interactive parts.
 */
export async function renderHtml(template: Template, ctx: Record<string, unknown>, opts: { title?: string; surveyHtml?: (title: string) => string; head?: string; bodyEnd?: string } = {}) {
  const qrValues: { value: string; size: number }[] = [];
  const html = renderDocument(template, ctx, {
    title: opts.title,
    head: opts.head,
    bodyEnd: opts.bodyEnd,
    surveySlot: opts.surveyHtml,
    qr: (value, size) => {
      qrValues.push({ value, size });
      return `<!--lx-qr-${qrValues.length - 1}-->`;
    },
  });
  const svgs = await Promise.all(
    qrValues.map(({ value, size }) => QRCode.toString(value, { type: "svg", margin: 0, width: size, errorCorrectionLevel: "M" })),
  );
  return html.replace(/<!--lx-qr-(\d+)-->/g, (_, i: string) => svgs[Number(i)] ?? "");
}

export type { Survey };

/** The brand kit's watermark, when it is switched on. */
function watermarkOf(settings: unknown): string | undefined {
  const kit = (settings as { brandKit?: { watermark?: boolean; mark?: string; logo?: string } } | null)?.brandKit;
  return kit?.watermark ? (kit.mark ?? kit.logo) : undefined;
}
