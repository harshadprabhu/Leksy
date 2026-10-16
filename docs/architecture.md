# Architecture

## Flow of a bill

1. **Ingest** (API): authenticate (API key, optional HMAC) → map (connector mapping, if any) → validate (Zod schema + GST checks) → upsert on `(brand, store, invoice_no)` → enqueue `bill.created` / `bill.updated`. The POS gets an answer in milliseconds.
2. **Process** (worker): match the first trigger whose conditions hold → pin the published template version and survey → hash the bill content → schedule delivery (optional delay).
3. **Deliver** (worker): try channels in order (WhatsApp → SMS → email). A permanent failure falls through to the next channel; a transient one is retried with back-off. Sent channels are never re-sent on retry.
4. **Open** (API): `/b/:token` renders the pinned template with the bill, plus the survey. First open is recorded. Anyone with the link can view and download the bill.
5. **Feedback** (API → worker): one response per bill. A score ≤ the survey's alert threshold opens a ticket with an SLA and alerts the store manager. A high score shows the Google review link.
6. **Events**: every step writes to `events` and fans out to the brand's webhooks.

## Data

PostgreSQL holds tenants (`brands`), users, stores, API keys (hashed), templates and immutable versions, surveys, connectors, triggers, bills (canonical JSON + raw payload), deliveries, feedback and an append-only `events` log. Every tenant-owned row has `brand_id`; every query filters on it.

At scale:
- Analytics move to ClickHouse, fed from `events` (change-data-capture or a Kafka topic). The `summary` service keeps the same response shape.
- `bills` gets monthly partitions on `issued_at`.
- PostgreSQL row-level security on `brand_id` becomes a second line of defence.
- Queues move from Redis/BullMQ to Kafka when throughput needs it. Job shapes are already plain JSON.

## Scaling

| Service | State | Scales on |
| --- | --- | --- |
| API | none (JWT, Redis for rate limits and PDF cache) | CPU / requests |
| Worker | none | queue depth |
| Web | none (static + client) | requests |

PDFs come from headless Chromium in the API pods and are cached in Redis by bill, content hash and template version. They move to S3 when volume justifies it.

## Security

- API keys: only SHA-256 hashes stored; shown once; revocable. Optional HMAC body signing with replay window.
- Passwords: scrypt. Sessions: 12-hour JWTs.
- Public links: 22-character random tokens (≈131 bits), `noindex`, strict CSP with per-request nonces, no third-party scripts.
- Templates are data, never HTML; every value is escaped and URLs/colours are whitelisted.
- Outbound calls (pull connectors, webhooks) are https-only and blocked from private, loopback, link-local, reserved and IPv4-mapped/NAT64 addresses (SSRF guard). Every connection re-checks the address DNS returns, so a name cannot pass the check and then point inside the network (DNS rebinding). Timeouts, no redirects.
- Credentials for a brand's API (tokens, passwords, custom auth headers) are encrypted at rest with AES-256-GCM under `LEKSY_SECRETS_KEY`.
- Roles: owners and admins set the brand up; managers and viewers work with bills and feedback. A user limited to some stores sees only those stores' bills, tickets, analytics and Insights, and can only send bills for them. Only admins see integration keys.
- Rate limits on login, signup, ingestion, bill pages and feedback. Client IPs come from `X-Forwarded-For` only when the request passed through a trusted proxy (`TRUST_PROXY`), so a client cannot reset its own limit.
- Login takes the same time for unknown emails and wrong passwords. Invalid input gets a 400 with the problems, never a 500.
- `apps/api/src/security.test.ts` covers tenant isolation, roles and store scopes, forged tokens, revoked keys, replayed signatures, SQL and XSS payloads, link schemes, SSRF address forms and rate limits.
- Consent: bills with `customer.consent: false` are stored but never sent (DPDP).
- Data residency: deploy in AWS `ap-south-1` (Mumbai).

## Roadmap hooks already in place

- `source` on bills includes `ocr` and `print` for the AI OCR and print-capture agent.
- `e_invoice` fields for GST B2B IRN/QR.
- Template `page.format` supports `a4` and `thermal`.
- Webhook events for CRM and loyalty integrations.
