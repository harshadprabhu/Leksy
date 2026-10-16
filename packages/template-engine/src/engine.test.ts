import { describe, expect, it } from "vitest";
import { buildContext, evaluate, getAll, interpolate, listFields, PRESETS, renderDocument, renderTemplate, templateCss, SAMPLE_BILL, SAMPLE_BRAND, SAMPLE_STORE, TemplateSchema, checkCondition } from "./index.js";

const ctx = buildContext(SAMPLE_BILL, { brand: SAMPLE_BRAND, store: SAMPLE_STORE, links: { pdf: "/b/abc/pdf", verify: "https://leksy.in/v/abc" } });

describe("expressions", () => {
  it("resolves paths and formatters", () => {
    expect(interpolate("{{customer.name | upper}}", ctx)).toBe("ANANYA RAO");
    expect(interpolate("{{items[0].jewellery.huid}}", ctx)).toBe("AB12CD");
    expect(interpolate("{{items.1.name}}", ctx)).toBe("Solitaire Studs");
    expect(interpolate("{{missing | default:'n/a'}}", ctx)).toBe("n/a");
    expect(interpolate("{{issued_at | date}}", ctx)).toBe("15 Oct 2026");
    expect(interpolate("{{issued_at | datetime}}", ctx)).toBe("15 Oct 2026, 02:32 PM");
    expect(evaluate("items | count", ctx)).toBe(2);
    expect(String(evaluate("total | inr", ctx))).toContain("2,84,345");
  });

  it("blocks prototype access", () => {
    expect(interpolate("{{__proto__.toString}}", ctx)).toBe("");
  });

  it("fans out over arrays", () => {
    expect(getAll(ctx, "items[].jewellery.huid")).toEqual(["AB12CD", "ZX98QW"]);
    expect(checkCondition({ field: "items[].certificates[]", op: "exists" }, ctx)).toBe(true);
    expect(checkCondition({ field: "total", op: "gt", value: 50000 }, ctx)).toBe(true);
  });
});

describe("rendering", () => {
  it("renders the luxe preset with bill data", () => {
    const html = renderTemplate(PRESETS["luxe-gold"]!, ctx);
    expect(html).toContain("Aurum &amp; Co.");
    expect(html).toContain("Temple Necklace");
    expect(html).toContain("IGI · LG612345678");
    expect(html).toContain("CGST @ 1.5%");
    // Gross subtotal 2,80,888 − discount 4,825 + tax + round-off = total 2,84,345
    expect(html).toContain("₹2,80,888.00");
    expect(html).toContain("-₹4,825.00");
  });

  it("escapes user data and drops unsafe urls and colours", () => {
    const t = TemplateSchema.parse({
      blocks: [
        { id: "a", type: "text", props: { text: "{{customer.name}}" }, style: { color: "red;background:url(x)" } },
        { id: "b", type: "image", props: { src: "javascript:alert(1)" } },
        { id: "c", type: "button", props: { label: "Go", href: "javascript:alert(1)" } },
      ],
    });
    const html = renderTemplate(t, { customer: { name: "<script>x</script>" } });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("url(x)");
  });

  it("hides blocks whose condition fails, but shows them dimmed in the editor", () => {
    const t = TemplateSchema.parse({ blocks: [{ id: "x", type: "text", props: { text: "hi" }, visibleIf: { field: "nope", op: "exists" } }] });
    expect(renderTemplate(t, {})).not.toContain("hi");
    expect(renderTemplate(t, {}, { editor: true })).toContain('data-block-id="x"');
  });

  it("renders a full document with fonts", () => {
    const doc = renderDocument(PRESETS["luxe-gold"]!, ctx, { title: "Bill" });
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("fonts.googleapis.com");
  });

  it("lists bindable fields", () => {
    const paths = listFields(ctx).map((f) => f.path);
    expect(paths).toContain("customer.name");
    expect(paths).toContain("items[].jewellery.huid");
    expect(paths).toContain("totals.tax");
  });
});

describe("watermark", () => {
  const t = TemplateSchema.parse({ page: { watermark: { src: "{{brand.watermark_url}}", opacity: 0.08, size: 40 } }, blocks: [{ id: "h", type: "heading", props: { text: "{{brand.name}}" } }] });
  it("draws the brand mark behind the content when the brand has one", () => {
    const html = renderTemplate(t, { brand: { name: "B", watermark_url: "https://cdn.example.com/mark.png" } });
    expect(html).toContain(`class="lx-wm"`);
    expect(html).toContain("url('https://cdn.example.com/mark.png')");
    expect(html).toContain("opacity:0.08");
  });
  it("draws nothing without a mark, and never an unsafe URL", () => {
    expect(renderTemplate(t, { brand: { name: "B" } })).not.toContain("lx-wm");
    expect(renderTemplate(t, { brand: { name: "B", watermark_url: "javascript:alert(1)" } })).not.toContain("lx-wm");
  });
});

describe("amount in words", () => {
  it("uses the Indian system", () => {
    expect(interpolate("{{v | words}}", { v: 103000 })).toBe("Rupees One Lakh Three Thousand Only");
    expect(interpolate("{{v | words}}", { v: 25412345.5 })).toBe("Rupees Two Crore Fifty Four Lakh Twelve Thousand Three Hundred Forty Five and Fifty Paise Only");
    expect(interpolate("{{v | words}}", { v: 0 })).toBe("Rupees Zero Only");
    expect(interpolate("{{v | words}}", { v: 999 })).toBe("Rupees Nine Hundred Ninety Nine Only");
  });
});

describe("download and share buttons", () => {
  const t = TemplateSchema.parse({ blocks: [{ id: "dl", type: "download_buttons", props: { formats: ["pdf", "share"] } }] });
  it("offers a direct PDF download and a share button for the same PDF", () => {
    const html = renderTemplate(t, { links: { pdf: "https://bills.example.com/b/abc/pdf" } });
    expect(html).toContain('href="https://bills.example.com/b/abc/pdf" download>Download PDF');
    expect(html).toContain('class="lx-button lx-share" href="https://bills.example.com/b/abc/pdf" data-lx-share>Share');
  });
  it("draws the watermark once, not tiled", () => {
    const css = templateCss(TemplateSchema.parse({ page: { watermark: { src: "x" } }, blocks: [] }));
    expect(css).toMatch(/\.lx-wm\{[^}]*background-repeat:no-repeat;/);
  });
});

describe("rich landing blocks", () => {
  const t = TemplateSchema.parse({
    blocks: [
      { id: "car", type: "banner_carousel", props: { slides: [{ kicker: "Festive", title: "Hello {{customer.name}}", href: "https://brand.example.com/offer", art: "diamond" }, { title: "Bad", href: "javascript:alert(1)", background: "red;x:y" }, { title: "Picture", image: "https://cdn.example.com/b.jpg" }] } },
      { id: "soc", type: "social_links", props: { title: "Show us your love", links: [{ label: "Instagram", href: "https://instagram.com/brand" }, { label: "YouTube", href: "https://www.youtube.com/@brand" }, { label: "X", href: "https://x.com/brand" }, { label: "Evil", href: "javascript:alert(1)" }] } },
      { id: "vid", type: "video_card", props: { title: "Our story", href: "https://www.youtube.com/watch?v=abc" } },
      { id: "acc", type: "accordion", props: { items: [{ title: "Terms", body: "<b>No</b> refunds" }] } },
      { id: "bar", type: "contact_bar", props: {} },
      { id: "dl", type: "download_buttons", props: { formats: ["pdf", "certificates"], pdfLabel: "Download invoice" } },
    ],
  });
  const html = renderTemplate(t, ctx);
  it("renders swipeable banners with safe links and colours", () => {
    expect(html).toContain('data-autoplay="4"');
    expect(html.match(/class="lx-slide( lx-slide-img)?"/g)).toHaveLength(3);
    expect(html).toContain("Hello Ananya Rao");
    expect(html).toContain('href="https://brand.example.com/offer"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("red;x:y");
    expect(html).toContain('<img src="https://cdn.example.com/b.jpg"');
    expect(html.match(/<i( class="on")?><\/i>/g)).toHaveLength(3);
  });
  it("draws social icons per network and drops unsafe links", () => {
    expect(html).toContain("Show us your love");
    for (const n of ["instagram", "youtube", "x"]) expect(html).toContain(`lx-soc lx-soc-${n}`);
    expect(html).not.toContain('aria-label="Evil"');
  });
  it("renders the video card, escaped terms and the contact bar", () => {
    expect(html).toContain('class="lx-video" href="https://www.youtube.com/watch?v=abc"');
    expect(html).toContain("<summary>Terms</summary>");
    expect(html).toContain("&lt;b&gt;No&lt;/b&gt; refunds");
    expect(html).toContain(`href="tel:${SAMPLE_BRAND.support_phone!.replace(/[^\d+]/g, "")}"`);
    expect(html).toContain('href="https://leksy.in/v/abc"');
  });
  it("labels the invoice download and links to the certificates", () => {
    expect(html).toContain("download>Download invoice");
    expect(html).toContain('href="#lx-certificates">View certificates');
    const none = renderTemplate(t, { ...ctx, items: [{ name: "Ring" }] });
    expect(none).not.toContain("View certificates");
  });
});
