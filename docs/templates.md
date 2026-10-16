# Templates

A template is JSON: page settings plus a list of blocks. Brands edit it in **Template Studio** without code. Publishing freezes the draft as a new version, and each bill records the version it was rendered with.

## Blocks

| Block | Shows |
| --- | --- |
| `heading`, `text` | Text with `{{fields}}`; lines left empty by missing data are dropped |
| `image` | Logo or picture (https or a field such as `{{brand.logo_url}}`) |
| `kv_list` | Label/value rows; a row whose fields are all empty is hidden |
| `items_table` | One row per item, columns you define |
| `item_cards` | One card per item with image, title, price and detail rows (jewellery-friendly) |
| `totals` | Subtotal, discount, each tax, charges, round-off, grand total, payment modes |
| `certificates` | Every certificate on every item, with "View" links |
| `qr` | QR of any value; defaults to the bill's verification link |
| `survey` | The Project WOW survey (interactive on the bill page) |
| `download_buttons` | PDF / data download |
| `button`, `social_links`, `divider`, `spacer` | Layout and links |
| `columns` | Side-by-side layout (1–4 columns) holding other blocks |

Every block has a **style** (alignment, colours, font, size, weight, padding, spacing, corners, border) and an optional **show rule**.

## Fields

Bill fields sit at the top level, next to `brand`, `store`, `totals` and `links`:

```
{{invoice_no}}  {{issued_at | datetime}}  {{customer.name}}  {{staff.name}}
{{brand.name}}  {{store.name}}  {{store.gstin}}
{{totals.taxable}}  {{totals.tax}}  {{total | inr}}
{{links.pdf}}  {{links.verify}}  {{meta.gold_rate_22k}}
```

Inside item tables and cards, fields are relative to the item: `{{name}}`, `{{amount | inr}}`, `{{jewellery.huid}}`.

## Formatters

| Formatter | Example | Result |
| --- | --- | --- |
| `inr` | `{{total \| inr}}` | ₹1,03,000.00 |
| `number:N` | `{{qty \| number:0}}` | 2 |
| `grams` | `{{jewellery.net_wt_g \| grams}}` | 23.900 g |
| `date`, `datetime` | `{{issued_at \| date:'DD MMM YYYY'}}` | 15 Oct 2026 |
| `upper`, `lower`, `title` | `{{customer.name \| upper}}` | ANANYA RAO |
| `default:'x'` | `{{customer.name \| default:'friend'}}` | friend |
| `prefix:'x'`, `suffix:'x'` | `{{store.gstin \| prefix:'GSTIN '}}` | GSTIN 29AB… (nothing if empty) |
| `count`, `sum:field`, `join:', '` | `{{items \| count}}` | 2 |
| `mask` | `{{customer.phone \| mask}}` | ••••••••5678 |

## Show rules

`{ "field": "total", "op": "gt", "value": 50000 }`. Operators: `exists`, `not_exists`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`. Use `[]` to check across items: `items[].certificates[]` with `exists` shows a block only when any item has a certificate.

## Safety

Templates never contain HTML or scripts. Text is escaped, colours must be hex/rgb/keywords, and links and images must be `https:` (or same-origin). The bill page sends a strict Content-Security-Policy.
