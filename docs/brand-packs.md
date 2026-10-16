# Brand packs

A brand pack is one JSON file that makes Leksy look like a client: name, logos, watermark, colours, fonts, store list and bespoke bill templates. Open a private pack link (`https://…/Leksy/#pack=…`, made with `node scripts/pack-link.mjs pack.json`), or load it from the **Load brand pack…** button in the demo bar (every page), or in **Settings → Brand kit → Import brand pack**.

- **Demo:** the pack is kept only in the browser (`localStorage`) and the demo rebuilds itself around it: stores, history, bills, templates and theme. "Remove pack" returns to the sample brand. Pilot assets are never published on the public site.
- **Production:** importing updates the brand, adds or updates the pack's templates (published as new versions) and adds any new stores.

The public demo runs as **ORRA Fine Jewellery** out of the box (`apps/web/lib/orra-pack.json`: its 94 stores from orra.com, logo and colours). Packs for other clients belong to those clients: keep them out of this repository unless they have agreed, and use only logos and colours the brand has supplied or approved.

## Format

```jsonc
{
  "kind": "leksy-brand-pack",
  "version": 1,
  "brand": { "name": "…", "website": "…", "supportPhone": "…", "googleReviewUrl": "…", "invoicePrefix": "ABC" },
  "kit": {
    "name": "…",
    "logo": "data:image/png;base64,…",      // light backgrounds
    "logoLight": "data:image/png;base64,…", // dark backgrounds (deck cover, dark sidebar)
    "mark": "data:image/png;base64,…",      // watermark (defaults to the logo)
    "watermark": true,
    "primary": "#2B2B33", "accent": "#A8875A", "background": "#FFFFFF", "ui": "#2B2B33",
    "headingFont": "Cormorant Garamond", "bodyFont": "Red Hat Display"
  },
  "stores": [{ "code": "MUM-01", "name": "…", "city": "Mumbai", "state": "Maharashtra", "region": "West", "tier": 1, "address": "…" }],
  "templates": [{ "key": "brand-signature", "name": "…", "body": { /* a Template Studio template */ } }],
  "billTemplate": "brand-signature",   // sent on WhatsApp (the customer landing page)
  "pdfTemplate": "brand-tax-invoice",  // used for PDF downloads, e.g. an A4 tax invoice
  "deck": { "footer": "Confidential" }
}
```

Region and tier are filled in from the city when left out. Images must be embedded `data:` URLs (PNG, JPEG, SVG or WebP).

## What the kit changes

| Where | What |
|---|---|
| Bill landing page and PDF | logo, colours, fonts; a faint watermark repeated down the page (`page.watermark` in any template, `{{brand.watermark_url}}`) |
| Downloads | the brand's printable template (`pdfTemplate`), with amount in words (`{{total \| words}}`) |
| Dashboard and app | logo in the sidebar, app colour, heading and body fonts, faint watermark |
| Insights | branded header with logo and headline figures, brand serif headings, gold accents, multicolour charts, deck cover preview |
| Insights deck | logo on a dark cover, corner logo and watermark on every slide, brand colours and footer |

## Private pack links

A pack can travel inside a link: `https://harshadprabhu.github.io/Leksy/#pack=<gzip + base64url JSON>`. Everything after `#` stays in the browser — it is never sent to GitHub Pages or stored in this repository — and opening the link switches the demo to that brand. Shrink logos first (about 260 px wide) so the link stays around 20,000 characters, which browsers, WhatsApp and email all accept. Anyone with the link sees the brand, so share it only with the people the pitch is for.
