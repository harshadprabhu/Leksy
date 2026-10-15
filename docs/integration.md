# Integrating with Leksy

There are three ways to get bills into Leksy. Pick whichever needs the least work on your side; all three end up as the same bill.

| Option | You do | Best when |
| --- | --- | --- |
| A. Call our API | `POST /v1/bills` with Leksy's bill JSON | You are building a new integration |
| B. Push your own JSON | `POST` your existing payload to a source URL | Your POS can already call a webhook |
| C. We pull from you | Give us an endpoint that lists bills | Your ERP has an API but can't call out |

After a bill arrives, **triggers** decide which template, survey and channels it gets, then the worker sends it.

## Authentication

Create keys in **Settings → API keys**. Send them as a bearer token:

```
Authorization: Bearer lk_live_XXXXXXXXXX_YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY
```

Optional request signing (turn on per key): sign the raw body with the key's signing secret.

```
X-Leksy-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
```

Requests older than 5 minutes are rejected.

```bash
T=$(date +%s); SIG=$(printf "%s.%s" "$T" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/.* //')
curl -H "X-Leksy-Signature: t=$T,v1=$SIG" ...
```

## A. `POST /v1/bills`

Idempotent on `(store_code, invoice_no)`: retries return the same bill. Sending changed data updates the bill (`changed: true`).

| Field | Required | Notes |
| --- | --- | --- |
| `invoice_no` | yes | Unique per store |
| `store_code` | yes | Must match a store in Settings |
| `issued_at` | yes | ISO 8601 with offset, e.g. `2026-10-15T14:32:00+05:30` |
| `total` | yes | Grand total in rupees |
| `items[]` | yes | `name`, `qty`, `unit_price`; optional `sku`, `discount`, `hsn`, `tax_rate`, `amount`, `image_url`, `category` |
| `items[].jewellery` | no | `metal`, `purity`, `gross_wt_g`, `net_wt_g`, `stone_wt_ct`, `rate_per_g`, `making_charges`, `huid` |
| `items[].certificates[]` | no | `type` (`BIS_HALLMARK`, `IGI`, `GIA`, `WARRANTY`…), `number`, `url`, `issuer` |
| `customer` | no | `name`, `phone` (E.164, `+91…`), `email`, `gstin`, `consent` (default `true`) |
| `staff` | no | `id`, `name`; used for staff-level happiness scores |
| `taxes[]` | no | `type`, `rate`, `amount` |
| `charges[]`, `round_off`, `payments[]` | no | Shown in the totals block |
| `e_invoice` | no | `irn`, `ack_no`, `signed_qr` for B2B |
| `loyalty` | no | `points_earned`, `points_balance`, `tier` |
| `template`, `survey` | no | Override the trigger for this bill |
| `meta` | no | Anything else; available to templates as `{{meta.*}}` |

Responses:

| Status | Meaning |
| --- | --- |
| `201` | New bill accepted and queued |
| `200` | Already had this bill (`changed` tells you whether it was updated) |
| `422` | Validation failed; `details[]` lists each field and problem |
| `401` | Missing/invalid key or signature |

```json
{ "id": "…", "created": true, "changed": true, "status": "queued",
  "url": "https://bills.leksy.in/b/4qS3LocUjd5nQtmAsUVZlp", "issues": [] }
```

`issues` are warnings that never block sending (`total_mismatch`, `payment_mismatch`, `no_contact`, `no_consent`).

`POST /v1/bills/batch` accepts up to 100 bills and returns a per-bill result (`207`).

## B. Push your own JSON

1. **Integrations → Add a source → "They push to Leksy"**. You get a URL like `https://api.leksy.in/v1/ingest/<key>`.
2. Point your POS at it and send one real bill exactly as your system produces it (one object or an array).
3. Open the source in Leksy. It shows your payload, suggests a mapping, and checks the result live. Adjust and save.
4. From then on every push becomes a bill and is sent.

The mapping supports constants, nested item lists, tax lines built from separate columns, and transforms: `number`, `phone` (to `+91…`), `date` (auto-detects `DD/MM/YYYY HH:mm`, ISO, epoch), `upper`, `lower`, `trim`, `multiply`, `divide`, `round`, `lookup`, `split`, `concat`.

## C. Leksy pulls from your API

1. **Integrations → Add a source → "Leksy pulls from their API"**: URL, auth (bearer, basic or header), where the list sits in the response (`data.invoices`), and optionally a cursor (`updated_since` parameter + the field that holds the update time).
2. Leksy fetches on your interval (1 minute to 1 hour), maps each bill and only asks for newer ones next time.
3. Want it instant? `POST` anything to the source's URL; Leksy fetches right away.

Only `https` URLs on public addresses are allowed in production.

## Webhooks from Leksy

Add endpoints in **Settings → Webhooks**. Events: `bill.received`, `bill.updated`, `bill.sent`, `bill.opened`, `feedback.submitted`, `ticket.sla_breached`.

```json
{ "event": "feedback.submitted", "created_at": "2026-10-15T09:10:00Z",
  "data": { "bill_id": "…", "invoice_no": "INV-1001", "store_code": "BLR-01", "rating": 2, "alert": true } }
```

Verify `X-Leksy-Signature` the same way as above, using the endpoint's secret. Failed deliveries are retried with exponential back-off (8 attempts).

## WhatsApp setup

Leksy uses Meta's WhatsApp Cloud API with an approved **utility** template. The default template name is `leksy_ebill`:

- Body: `Hi {{1}}, thank you for shopping at {{2}}. Your bill for {{3}} is ready.`
- Button (URL, dynamic): `https://<bill domain>/b/{{1}}`
- Optional document header: the bill PDF.

Per-brand overrides live in the brand's `settings.channels.whatsapp` (phone number ID, token, template name, language, body parameters as `{{field}}` expressions, `attachPdf`). Delivery receipts arrive at `/hooks/whatsapp`. A failed WhatsApp message falls back to SMS, then email.
