# Leksy

**Leksy** (pronounced "Lexi") sends luxury digital bills on WhatsApp, captures customer happiness on the same page, and turns every low score into a ticket for the store team.

- **E-bills:** a branded, mobile-first page per bill, with PDF download, certificates (hallmark/HUID, IGI/GIA), loyalty points and a QR that proves the bill is genuine.
- **Plug-and-play integration in both directions:** the store system calls Leksy's API, *or* Leksy pulls from the store system's API. Either way, a no-code field mapper turns their JSON into a Leksy bill.
- **Template Studio:** a no-code designer. Drag blocks, bind fields from real bills, add show/hide rules, preview, publish.
- **Mission Happiness:** branching survey inside the bill, low-score alerts to the store manager with an SLA, Google-review prompt for happy customers.
- **Analytics:** delivery, opens, ratings, NPS, store league table and improvement themes.
- **Insights:** ask questions in plain English, forecast sales with festival-aware models, and download a PowerPoint pre-read in the company's look. Runs locally; an optional local language model (Ollama) or, only if an admin allows it, an external copilot can add more help. See [docs/insights.md](docs/insights.md).

## Live demo

**https://harshadprabhu.github.io/Leksy/** — a browser-only proof of concept with sample data for a jewellery brand. Click **Simulate a sale**, open the bill as the customer, rate the visit, then watch the dashboard and the Mission Happiness inbox update. Change the bill's design in Template Studio, publish, and reload the bill. Nothing is sent and no server is involved; data lives in your browser (use **Reset demo** to start over).

Build it yourself: `NEXT_PUBLIC_DEMO=1 NEXT_PUBLIC_BASE_PATH=/Leksy pnpm --filter @leksy/web build` → `apps/web/out`.

## Architecture

```
POS / ERP ──push──► API (Fastify) ──► PostgreSQL
Brand API ◄──pull── Worker (BullMQ on Redis) ──► WhatsApp / SMS / email
Customer ─────────► Bill page (+ survey, PDF, verify)        Web app (Next.js): dashboard, Studio, mapper
```

| Path | What it is |
| --- | --- |
| `packages/bill-schema` | The canonical bill (Zod) and GST/total checks |
| `packages/template-engine` | Template JSON schema, `{{field \| formatter}}` binding, safe HTML renderer, presets |
| `packages/mapper` | No-code field mapping (any JSON → canonical bill), suggestions |
| `packages/core` | Database schema and migrations, services (ingest, triggers, render, pull, feedback, analytics, webhooks), channels, queues |
| `apps/api` | REST API, public bill pages, PDF, OTP lock, provider webhooks |
| `apps/worker` | Queue processors: trigger matching, delivery with fallback, scheduled pulls, alerts, SLA checks, outbound webhooks |
| `apps/web` | Dashboard, bills, Mission Happiness inbox, Template Studio, integrations and mapper, triggers, settings |

Everything is self-hosted on standard infrastructure: PostgreSQL, Redis, Node.js and Chromium, with no backend-as-a-service. Each service is stateless and scales on its own (see `infra/k8s`).

## Run it locally

Requirements: Node 22, pnpm 10, Docker (or a local PostgreSQL 16 and Redis 7).

```bash
cp .env.example .env
docker compose up -d postgres redis mailpit
pnpm install
pnpm build
pnpm db:migrate
pnpm db:seed          # prints a demo login and API key
pnpm dev              # API :4000, worker, web :3000
```

Sign in at http://localhost:3000 with `demo@leksy.in` / `leksy-demo-123`.

In development, messages are not sent; the worker logs them (`CHANNELS_DRY_RUN=true`). Emails go to Mailpit at http://localhost:8025 when `SMTP_URL` is set.

### Send a first bill

```bash
curl -X POST http://localhost:4000/v1/bills \
  -H "Authorization: Bearer <API key from db:seed>" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_no": "INV-1001",
    "store_code": "BLR-INDIRANAGAR",
    "issued_at": "2026-10-15T14:32:00+05:30",
    "customer": { "name": "Ananya", "phone": "+919812345678" },
    "items": [{ "name": "Temple Necklace", "qty": 1, "unit_price": 100000,
                "jewellery": { "purity": "22K", "huid": "AB12CD" } }],
    "taxes": [{ "type": "CGST", "rate": 1.5, "amount": 1500 },
              { "type": "SGST", "rate": 1.5, "amount": 1500 }],
    "total": 103000
  }'
```

The response holds the customer's link. Open it to see the bill and the survey.

## Tests

```bash
pnpm test                                   # unit tests
TEST_DATABASE_URL=postgres://leksy:leksy@localhost:5432/leksy_test \
TEST_REDIS_URL=redis://localhost:6379/1 pnpm --filter @leksy/api test   # API end-to-end
```

The API tests wipe the test database's schema, so point them at a dedicated database.

## Docs

- [Integration guide](docs/integration.md): for the brand's IT team (API, push, pull, webhooks, signatures)
- [Templates](docs/templates.md): blocks, fields, formatters and rules
- [Architecture](docs/architecture.md): data flow, scaling, security
