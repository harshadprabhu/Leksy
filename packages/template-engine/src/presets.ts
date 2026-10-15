import { TemplateSchema, type Template, type TemplateInput } from "./schema.js";

const luxe: TemplateInput = {
  name: "Luxe Gold",
  page: { format: "mobile", background: "#fbf8f2", textColor: "#2a2118", mutedColor: "#8a7a66", accentColor: "#b08d57", fontFamily: "Inter", headingFontFamily: "Cormorant Garamond", padding: 24 },
  blocks: [
    { id: "logo", type: "image", props: { src: "{{brand.logo_url}}", alt: "{{brand.name}}", width: 40 }, style: { align: "center" }, visibleIf: { field: "brand.logo_url", op: "exists" } },
    { id: "brand", type: "heading", props: { text: "{{brand.name}}", level: 1 }, style: { align: "center", letterSpacing: 2 } },
    { id: "thanks", type: "text", props: { text: "Thank you, {{customer.name | default:'dear guest'}}" }, style: { align: "center", italic: true, color: "#8a7a66" } },
    { id: "d1", type: "divider", props: { thickness: 1, style: "solid" }, style: { color: "#b08d57" } },
    {
      id: "meta",
      type: "kv_list",
      props: {
        rows: [
          { label: "Invoice", value: "{{invoice_no}}" },
          { label: "Date", value: "{{issued_at | datetime}}" },
          { label: "Store", value: "{{store.name}}" },
          { label: "Served by", value: "{{staff.name}}", visibleIf: { field: "staff.name", op: "exists" } },
        ],
      },
      style: { fontSize: 13 },
    },
    {
      id: "items",
      type: "item_cards",
      props: {
        source: "items",
        title: "{{name}}",
        subtitle: "{{jewellery.purity}} {{jewellery.metal}} · HSN {{hsn}}",
        price: "{{amount | inr}}",
        showImage: true,
        details: [
          { label: "Gross / net weight", value: "{{jewellery.gross_wt_g | grams}} / {{jewellery.net_wt_g | grams}}", visibleIf: { field: "jewellery.gross_wt_g", op: "exists" } },
          { label: "Stone weight", value: "{{jewellery.stone_wt_ct}} ct", visibleIf: { field: "jewellery.stone_wt_ct", op: "exists" } },
          { label: "Rate per gram", value: "{{jewellery.rate_per_g | inr}}", visibleIf: { field: "jewellery.rate_per_g", op: "exists" } },
          { label: "Making charges", value: "{{jewellery.making_charges | inr}}", visibleIf: { field: "jewellery.making_charges", op: "exists" } },
          { label: "Discount", value: "{{discount | inr}}", visibleIf: { field: "discount", op: "gt", value: 0 } },
          { label: "HUID", value: "{{jewellery.huid}}", visibleIf: { field: "jewellery.huid", op: "exists" } },
        ],
      },
      style: { marginTop: 8 },
    },
    { id: "totals", type: "totals", props: { showTaxBreakup: true, showPayments: true, grandTotalLabel: "Total paid" } },
    { id: "certs", type: "certificates", props: { title: "Certificates" }, visibleIf: { field: "items[].certificates[]", op: "exists" } },
    {
      id: "goldrate",
      type: "kv_list",
      props: { rows: [{ label: "22K gold rate today", value: "{{meta.gold_rate_22k | inr}}/g" }, { label: "24K gold rate today", value: "{{meta.gold_rate_24k | inr}}/g" }] },
      visibleIf: { field: "meta.gold_rate_22k", op: "exists" },
      style: { background: "#f3ecdf", paddingY: 10, paddingX: 12, radius: 10, fontSize: 12 },
    },
    {
      id: "loyalty",
      type: "text",
      props: { text: "You earned {{loyalty.points_earned}} points · Balance {{loyalty.points_balance}} ({{loyalty.tier}} tier)" },
      visibleIf: { field: "loyalty.points_earned", op: "exists" },
      style: { align: "center", fontSize: 12, color: "#8a7a66" },
    },
    { id: "survey", type: "survey", props: { title: "How was your visit, {{customer.name | default:'friend'}}?" }, style: { marginTop: 16 } },
    { id: "dl", type: "download_buttons", props: { formats: ["pdf"] } },
    { id: "qr", type: "qr", props: { value: "{{links.verify}}", size: 96, caption: "Scan to verify this bill" }, style: { align: "center", marginTop: 12 } },
    { id: "foot", type: "text", props: { text: "{{store.address}}, {{store.city}}\nGSTIN {{store.gstin}} · {{store.phone}}" }, style: { align: "center", fontSize: 11, color: "#8a7a66", marginTop: 12 } },
  ],
};

const classic: TemplateInput = {
  name: "Classic",
  page: { format: "mobile", background: "#ffffff", textColor: "#111111", mutedColor: "#666666", accentColor: "#111111", fontFamily: "Inter", headingFontFamily: "Inter", padding: 20 },
  blocks: [
    { id: "brand", type: "heading", props: { text: "{{brand.name}}", level: 2 }, style: { align: "center" } },
    { id: "store", type: "text", props: { text: "{{store.name}}\n{{store.address}}" }, style: { align: "center", fontSize: 12 } },
    { id: "meta", type: "kv_list", props: { rows: [{ label: "Invoice", value: "{{invoice_no}}" }, { label: "Date", value: "{{issued_at | datetime}}" }, { label: "Customer", value: "{{customer.name}}" }] } },
    {
      id: "items",
      type: "items_table",
      props: {
        source: "items",
        showHeader: true,
        columns: [
          { label: "Item", value: "{{name}}", align: "left", width: 50 },
          { label: "Qty", value: "{{qty}}", align: "center" },
          { label: "Amount", value: "{{amount | inr}}", align: "right" },
        ],
      },
    },
    { id: "totals", type: "totals", props: { showTaxBreakup: true, showPayments: true, grandTotalLabel: "Total" } },
    { id: "survey", type: "survey", props: { title: "Rate your experience" } },
    { id: "dl", type: "download_buttons", props: { formats: ["pdf"] } },
  ],
};

export const PRESETS: Record<string, Template> = {
  "luxe-gold": TemplateSchema.parse(luxe),
  classic: TemplateSchema.parse(classic),
};
