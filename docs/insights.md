# Insights: analysis, forecasting and decks

Insights is the power user's analysis desk. It answers questions about the business, forecasts sales, and builds a PowerPoint pre-read in the company's own look. **By default, no company data leaves the user's browser.**

## Three levels of AI, each opt-in beyond the first

| Level | What it is | Where it runs | Cost | Who switches it on |
| --- | --- | --- | --- | --- |
| 1. Leksy engine | Question understanding, calculations, forecasting models | In the browser (or the company's Leksy server) | Free | Always on |
| 2. Local language model | Ollama with an open model (Qwen, Llama, Mistral, Gemma) explains results and answers open questions | The company's own computer or server | Free (needs a machine) | Admin, in Settings → AI & Insights |
| 3. External copilot | Microsoft Copilot, ChatGPT, Claude or Gemini | The provider's cloud | Provider's plan | Admin allows; each user decides each time |

## Accuracy: numbers are calculated, never generated

The engine works out the question's subject, period and stores, then computes every figure from the data. A language model (level 2 or 3) may reword or comment on those figures but never supplies them; the computed figures stay on screen as the source of truth.

## Forecasting

- Weekly revenue or bills, per store or all stores, 4–26 weeks ahead.
- Candidate models: seasonal regression (trend, yearly cycle, festival weeks, week before festivals, wedding season); same week last year × growth; trend smoothing.
- Festivals move every year (Diwali: 20 Oct 2025, 8 Nov 2026), so every model is festival-aware: the lift each festival produced in past years is measured, removed while the model learns, and re-applied on the festival's new date.
- Each forecast tests every candidate on the most recent weeks it has not seen (backtest) and uses the most accurate. The error is shown; ranges are 80% intervals from that model's own backtest errors.
- Festival dates live in `packages/insights/src/calendar.ts` and can be extended per region.

## What can ever be shared outward

Only when an admin allows external copilots, and only when a user chooses to:

- A text brief of totals and averages built from on-screen answers.
- Admin options: hide store and brand names ("Store A"), turn rupee amounts into an index.
- Never included: customer names, phone numbers, emails, invoice numbers, comments. A final check blocks text that looks like it contains them.
- Leksy sends nothing itself: the user sees the exact text, copies it, and pastes it into the copilot (ideally the company's own Microsoft 365 Copilot or business plan).

## Local model setup (Ollama)

1. Install from ollama.com on a company machine.
2. `ollama pull qwen2.5:7b` (or `llama3.1:8b`, `mistral`, `gemma2`).
3. Start it so the dashboard may call it: `OLLAMA_ORIGINS=https://<your Leksy address> ollama serve`.
4. Settings → AI & Insights → Test connection → pick the model → Save.

The model receives only the totals Leksy already computed.

## Leadership pack (PowerPoint)

Built in the browser with native, editable PowerPoint charts, in the company's colours, fonts and logo (Settings → Deck template). Metric-first, few words:

1. Cover with next week's forecast and headline numbers
2. Scorecard: revenue, bills, average bill, rating, NPS, responses with ▲▼ vs prior 30 days and last year
3. Next week by region (All India = sum of regions), WoW and YoY, festival in the week
4. Weekly trend with next week's forecast
5. Regional season radar: each region's next festival, last year's lift, push / stock / go levers
6. National moments (Dhanteras, Diwali, Akshaya Tritiya…) with forecast and playbook
7. Stores, 8. Customer happiness, 9. Category mix
10. Decisions for the week, each with a metric, owner and date
11. Any answers the user ticked, then a short method slide

Generated decks are checked against PowerPoint's own rules (escaped `&` in properties, no empty chart values, only inside labels on stacked charts).

Importing a company's own `.potx` master directly is planned for the server version.

## Regional calendar

`packages/insights/src/calendar.ts` holds national moments (Akshaya Tritiya, Dhanteras, Diwali, wedding season) and regional ones: North (Lohri, Raksha Bandhan, Dussehra, Karva Chauth), South (Pongal, Ugadi, Onam), East (Poila Baisakh, Durga Puja), West (Gudi Padwa, Ganesh Chaturthi, Navratri), each with a playbook. Stores get their region from the city (or set it explicitly). Each region's forecast uses only its own festivals plus national ones. Lunar dates are approximate; verify with a local panchang.

## Accuracy at national scale

The engine is tested against a 400-store network (tier 1 and tier 2 cities, all four regions) in `packages/insights/src/accuracy.test.ts`. Every figure is recomputed by brute force and must match what the page shows:

- sales, bills and average bill for 11 periods × 7 scopes (city, region, tier, region + tier);
- every row of store, region, tier and city rankings; group totals add up to the national total;
- happiness, NPS, least- and most-happy store, and complaint themes counted only in the stores asked about;
- category revenue (bill totals shared over items, so it adds up to store revenue to the paisa) and staff totals (add up exactly to each store);
- next week by region (All India = sum of regions), forecasts, festival dates and decision deadlines;
- the deck's figures, and the number guard that hides local-model wording containing any figure the engine did not compute.

Comparisons use the calendar: this week vs the same weekdays last week, this month vs the same days last month, this year vs the same dates last year, and every comparison names its dates. Breakdowns (staff, categories, complaints) cover the last 30 days and say so when a question asks about another period. Stores need at least 10 ratings before they are ranked on happiness.

## Brand kit

Settings → Brand kit sets the brand name, logo (PNG, JPG or SVG) and colours once and applies them to every bill template (as a new published version) and to the Insights deck. In the public demo it is stored only in the browser, so a pilot brand's assets are never published.
