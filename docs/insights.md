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

## Decks

Built in the browser with native PowerPoint charts and tables: cover, pre-read (performance, happiness, outlook, recommended actions), forecast, one slide per chosen answer, and a method slide. The look (colours, fonts, logo, footer) is set once in Settings → Deck template.

Importing a company's own `.potx` master directly is planned for the server version.
