import type { Block, BlockType } from "@leksy/template-engine";

export const uid = () => Math.random().toString(36).slice(2, 9);

interface Entry {
  type: BlockType;
  label: string;
  make: () => Block;
}

/** Everything a brand can drop onto a bill, with sensible starting content. */
export const CATALOG: Entry[] = [
  { type: "heading", label: "Heading", make: () => ({ id: uid(), type: "heading", style: { align: "center" }, props: { text: "{{brand.name}}", level: 1 } }) },
  { type: "text", label: "Text", make: () => ({ id: uid(), type: "text", style: {}, props: { text: "Thank you for shopping with us, {{customer.name | default:'friend'}}." } }) },
  { type: "image", label: "Image / logo", make: () => ({ id: uid(), type: "image", style: { align: "center" }, props: { src: "{{brand.logo_url}}", alt: "{{brand.name}}", width: 40 } }) },
  {
    type: "kv_list",
    label: "Details list",
    make: () => ({ id: uid(), type: "kv_list", style: {}, props: { emphasizeLast: false, rows: [{ label: "Invoice", value: "{{invoice_no}}" }, { label: "Date", value: "{{issued_at | datetime}}" }] } }),
  },
  {
    type: "items_table",
    label: "Items table",
    make: () => ({
      id: uid(),
      type: "items_table",
      style: {},
      props: { source: "items", showHeader: true, columns: [{ label: "Item", value: "{{name}}", align: "left" }, { label: "Qty", value: "{{qty}}", align: "center" }, { label: "Amount", value: "{{amount | inr}}", align: "right" }] },
    }),
  },
  {
    type: "item_cards",
    label: "Item cards",
    make: () => ({ id: uid(), type: "item_cards", style: {}, props: { source: "items", title: "{{name}}", subtitle: "{{category}}", price: "{{amount | inr}}", showImage: true, details: [{ label: "Qty", value: "{{qty}}" }] } }),
  },
  { type: "totals", label: "Totals & tax", make: () => ({ id: uid(), type: "totals", style: {}, props: { showTaxBreakup: true, showPayments: true, grandTotalLabel: "Total" } }) },
  { type: "certificates", label: "Certificates", make: () => ({ id: uid(), type: "certificates", style: {}, props: { title: "Certificates" } }) },
  { type: "survey", label: "Happiness survey", make: () => ({ id: uid(), type: "survey", style: {}, props: { title: "How was your visit?" } }) },
  { type: "download_buttons", label: "Download buttons", make: () => ({ id: uid(), type: "download_buttons", style: {}, props: { formats: ["pdf", "share"] } }) },
  { type: "qr", label: "QR code", make: () => ({ id: uid(), type: "qr", style: { align: "center" }, props: { value: "{{links.verify}}", size: 110, caption: "Scan to verify" } }) },
  { type: "button", label: "Button", make: () => ({ id: uid(), type: "button", style: { align: "center" }, props: { label: "Visit our website", href: "{{brand.website}}" } }) },
  {
    type: "social_links",
    label: "Social icons",
    make: () => ({
      id: uid(),
      type: "social_links",
      style: { align: "center" },
      props: { title: "Show us your love", style: "icons", links: [{ label: "Instagram", href: "https://instagram.com/" }, { label: "Facebook", href: "https://facebook.com/" }, { label: "YouTube", href: "https://youtube.com/" }] },
    }),
  },
  {
    type: "banner_carousel",
    label: "Promotion banners",
    make: () => ({
      id: uid(),
      type: "banner_carousel",
      style: { bleed: true },
      props: {
        autoplay: 4,
        slides: [
          { kicker: "Festive edit", title: "New arrivals in store", subtitle: "Handcrafted for the season", cta: "Explore", href: "{{brand.website}}", art: "diamond" },
          { kicker: "Refer & earn", title: "Share the joy", subtitle: "Gift vouchers for you and a friend", cta: "Refer now", href: "{{brand.website}}", art: "gift" },
        ],
      },
    }),
  },
  { type: "video_card", label: "Video", make: () => ({ id: uid(), type: "video_card", style: {}, props: { title: "Watch our story", subtitle: "On YouTube", href: "https://youtube.com/" } }) },
  {
    type: "accordion",
    label: "Terms & FAQs",
    make: () => ({ id: uid(), type: "accordion", style: {}, props: { items: [{ title: "Terms & Conditions", body: "Goods once sold are subject to the store's exchange policy." }] } }),
  },
  { type: "contact_bar", label: "Contact bar", make: () => ({ id: uid(), type: "contact_bar", style: {}, props: { phone: "{{brand.support_phone}}", label: "Contact us", seal: "Secured by Leksy" } }) },
  { type: "divider", label: "Divider", make: () => ({ id: uid(), type: "divider", style: {}, props: { thickness: 1, style: "solid" } }) },
  { type: "spacer", label: "Spacer", make: () => ({ id: uid(), type: "spacer", style: {}, props: { height: 16 } }) },
  { type: "columns", label: "Two columns", make: () => ({ id: uid(), type: "columns", style: {}, props: { gap: 16, columns: [[], []] } }) },
];

export const LABEL: Record<string, string> = Object.fromEntries(CATALOG.map((c) => [c.type, c.label]));

/** A short human name for a block in the layers list. */
export function blockTitle(b: Block): string {
  const p = b.props as Record<string, unknown>;
  const t = (p.text ?? p.title ?? p.label) as string | undefined;
  if (t) return t.replace(/\{\{\s*([^}|]+?)\s*(\|[^}]*)?\}\}/g, "‹$1›").slice(0, 40);
  return LABEL[b.type] ?? b.type;
}

/** Deep-clone a block with fresh ids (duplicate). */
export function cloneBlock(b: Block): Block {
  const copy = JSON.parse(JSON.stringify(b)) as Block;
  const walk = (x: Block) => {
    x.id = uid();
    if (x.type === "columns") x.props.columns.forEach((col) => col.forEach(walk));
  };
  walk(copy);
  return copy;
}
