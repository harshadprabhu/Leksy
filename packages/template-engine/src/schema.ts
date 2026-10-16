import { z } from "zod";

/**
 * A template is a JSON tree of blocks — never raw HTML — so brands can design
 * without code, and every template renders safely and identically to the web
 * page, PDF and image.
 */

export const StyleSchema = z
  .object({
    align: z.enum(["left", "center", "right"]).optional(),
    color: z.string().max(32).optional(),
    background: z.string().max(32).optional(),
    fontSize: z.number().min(6).max(96).optional(),
    fontWeight: z.enum(["300", "400", "500", "600", "700"]).optional(),
    fontFamily: z.string().max(80).optional(),
    italic: z.boolean().optional(),
    letterSpacing: z.number().min(-2).max(20).optional(),
    uppercase: z.boolean().optional(),
    paddingY: z.number().min(0).max(120).optional(),
    paddingX: z.number().min(0).max(120).optional(),
    marginTop: z.number().min(0).max(200).optional(),
    radius: z.number().min(0).max(48).optional(),
    border: z.string().max(32).optional(),
    /** Run edge to edge across the page (e.g. a coloured thank-you band). */
    bleed: z.boolean().optional(),
  })
  .partial();

export type Style = z.infer<typeof StyleSchema>;

export const ConditionSchema = z.object({
  field: z.string().max(200),
  op: z.enum(["exists", "not_exists", "eq", "neq", "gt", "gte", "lt", "lte", "contains"]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export type Condition = z.infer<typeof ConditionSchema>;

export const TableColumnSchema = z.object({
  label: z.string().max(80),
  /** Expression evaluated per item, e.g. "{{name}}" or "{{amount | inr}}". */
  value: z.string().max(300),
  align: z.enum(["left", "center", "right"]).default("left"),
  width: z.number().min(0).max(100).optional(),
});

export const KvRowSchema = z.object({
  label: z.string().max(120),
  value: z.string().max(500),
  visibleIf: ConditionSchema.optional(),
});

const base = {
  id: z.string().min(1).max(64),
  style: StyleSchema.default({}),
  visibleIf: ConditionSchema.optional(),
};

const leaf = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("heading"), props: z.object({ text: z.string().max(500), level: z.number().int().min(1).max(3).default(1) }) }),
  z.object({ ...base, type: z.literal("text"), props: z.object({ text: z.string().max(5000) }) }),
  z.object({ ...base, type: z.literal("image"), props: z.object({ src: z.string().max(2000), alt: z.string().max(200).default(""), width: z.number().min(10).max(100).default(100) }) }),
  z.object({ ...base, type: z.literal("divider"), props: z.object({ thickness: z.number().min(0.5).max(8).default(1), style: z.enum(["solid", "dashed", "dotted", "double", "ornament"]).default("solid") }) }),
  z.object({ ...base, type: z.literal("spacer"), props: z.object({ height: z.number().min(0).max(400).default(16) }) }),
  z.object({ ...base, type: z.literal("items_table"), props: z.object({ source: z.string().max(200).default("items"), columns: z.array(TableColumnSchema).min(1).max(10), showHeader: z.boolean().default(true), detailLine: z.string().max(500).optional() }) }),
  z.object({ ...base, type: z.literal("item_cards"), props: z.object({ source: z.string().max(200).default("items"), title: z.string().max(300).default("{{name}}"), subtitle: z.string().max(500).optional(), price: z.string().max(300).default("{{amount | inr}}"), details: z.array(KvRowSchema).max(20).default([]), showImage: z.boolean().default(true) }) }),
  z.object({ ...base, type: z.literal("kv_list"), props: z.object({ rows: z.array(KvRowSchema).max(40), emphasizeLast: z.boolean().default(false) }) }),
  z.object({ ...base, type: z.literal("totals"), props: z.object({ showTaxBreakup: z.boolean().default(true), showPayments: z.boolean().default(true), grandTotalLabel: z.string().max(80).default("Total") }) }),
  z.object({ ...base, type: z.literal("certificates"), props: z.object({ title: z.string().max(120).default("Certificates") }) }),
  z.object({ ...base, type: z.literal("qr"), props: z.object({ value: z.string().max(2000).default("{{links.verify}}"), size: z.number().min(48).max(400).default(120), caption: z.string().max(200).optional() }) }),
  z.object({ ...base, type: z.literal("button"), props: z.object({ label: z.string().max(80), href: z.string().max(2000) }) }),
  z.object({ ...base, type: z.literal("download_buttons"), props: z.object({ formats: z.array(z.enum(["pdf", "share", "certificates", "image", "json"])).default(["pdf", "share"]), pdfLabel: z.string().max(40).optional() }) }),
  z.object({ ...base, type: z.literal("survey"), props: z.object({ title: z.string().max(200).default("How was your visit?") }) }),
  z.object({ ...base, type: z.literal("social_links"), props: z.object({ title: z.string().max(120).optional(), style: z.enum(["icons", "text"]).default("icons"), links: z.array(z.object({ label: z.string().max(40), href: z.string().max(500) })).max(10) }) }),
  /** Swipeable promotions: campaign images, or designed slides from text and colours. */
  z.object({
    ...base,
    type: z.literal("banner_carousel"),
    props: z.object({
      autoplay: z.number().min(0).max(15).default(4),
      slides: z
        .array(
          z.object({
            image: z.string().max(2000).optional(),
            kicker: z.string().max(60).optional(),
            title: z.string().max(120).default(""),
            subtitle: z.string().max(240).optional(),
            cta: z.string().max(40).optional(),
            href: z.string().max(2000).optional(),
            background: z.string().max(32).optional(),
            background2: z.string().max(32).optional(),
            color: z.string().max(32).optional(),
            accent: z.string().max(32).optional(),
            art: z.enum(["diamond", "ring", "gift", "star", "coin", "none"]).default("diamond"),
          }),
        )
        .min(1)
        .max(8),
    }),
  }),
  z.object({ ...base, type: z.literal("video_card"), props: z.object({ title: z.string().max(120), subtitle: z.string().max(200).optional(), href: z.string().max(2000), thumbnail: z.string().max(2000).optional(), background: z.string().max(32).optional() }) }),
  z.object({ ...base, type: z.literal("accordion"), props: z.object({ items: z.array(z.object({ title: z.string().max(120), body: z.string().max(4000) })).min(1).max(12) }) }),
  /** Bar fixed to the bottom of the phone screen: call the store and the authenticity seal. */
  z.object({ ...base, type: z.literal("contact_bar"), props: z.object({ phone: z.string().max(200).default("{{brand.support_phone}}"), label: z.string().max(40).default("Contact us"), seal: z.string().max(60).default("Secured by Leksy") }) }),
]);

export type LeafBlock = z.infer<typeof leaf>;

export type ColumnsBlock = {
  id: string;
  type: "columns";
  style: Style;
  visibleIf?: Condition;
  props: { gap: number; columns: Block[][] };
};

export type Block = LeafBlock | ColumnsBlock;

export const BlockSchema: z.ZodType<Block> = z.lazy(() =>
  z.union([
    leaf,
    z.object({
      ...base,
      type: z.literal("columns"),
      props: z.object({ gap: z.number().min(0).max(64).default(16), columns: z.array(z.array(BlockSchema).max(50)).min(1).max(4) }),
    }),
  ]),
) as z.ZodType<Block>;

export const PageSchema = z.object({
  format: z.enum(["mobile", "a4", "thermal"]).default("mobile"),
  background: z.string().max(32).default("#ffffff"),
  backgroundImage: z.string().max(2000).optional(),
  textColor: z.string().max(32).default("#1a1a1a"),
  mutedColor: z.string().max(32).default("#6b6b6b"),
  accentColor: z.string().max(32).default("#b08d57"),
  fontFamily: z.string().max(80).default("Inter"),
  headingFontFamily: z.string().max(80).default("Cormorant Garamond"),
  padding: z.number().min(0).max(80).default(24),
  /** A small "Powered by Leksy" logo at the foot of the bill and its PDF. */
  poweredBy: z.boolean().default(true),
  /** A faint brand mark repeated down the page (bill, PDF and every printed page). */
  watermark: z
    .object({
      src: z.string().max(2000),
      opacity: z.number().min(0.02).max(0.3).default(0.06),
      size: z.number().min(10).max(100).default(55),
    })
    .optional(),
});

export const TemplateSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().max(120).default("Untitled"),
  page: PageSchema.default(PageSchema.parse({})),
  blocks: z.array(BlockSchema).max(200),
});

export type Template = z.infer<typeof TemplateSchema>;
export type TemplateInput = z.input<typeof TemplateSchema>;
export type BlockType = Block["type"];
