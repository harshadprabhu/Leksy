import { describe, expect, it } from "vitest";
import { buildContext, evaluate, getAll, interpolate, listFields, PRESETS, renderDocument, renderTemplate, SAMPLE_BILL, SAMPLE_BRAND, SAMPLE_STORE, TemplateSchema, checkCondition } from "./index.js";

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
