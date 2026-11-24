# Premium Check

**What does it really cost to hold BTC or ETH?**
Spot or perps on SoDEX, a spot ETF from BlackRock, Fidelity, ARK, Grayscale, Bitwise…, or a stock like Strategy (MSTR)
that holds bitcoin — every route has a premium on top of the asset itself. Premium Check puts all of them on one
yardstick, on live SoSoValue and SoDEX data.

- **Live demo:** https://premium-check-iota.vercel.app
- **For judges — the 60-second path:** https://premium-check-iota.vercel.app/judges
- **Data status (every upstream endpoint, live):** https://premium-check-iota.vercel.app/diag
- **Daily journal (committed by GitHub Actions):** https://premium-check-iota.vercel.app/journal · raw files in [`data/snapshots`](data/snapshots)
- **Snapshot API (JSON):** https://premium-check-iota.vercel.app/api/snapshot
- **Today's report (facts + validated AI note, JSON):** https://premium-check-iota.vercel.app/api/report

Built for the SoSoValue Buildathon (AKINDO, Wave 3).

---

## Who it is for

A person who has decided to hold some BTC or ETH and wants to know the cheapest way to do it for their amount and
holding period — and a treasury-stock buyer who wants to know whether they are paying more or less than the bitcoin
behind the share.

## What it answers

Pick an asset, an amount and a holding period. You get:

1. **Direct exposure, ranked by total cost** — SoDEX spot, SoDEX perp (1x long), 12 US BTC ETFs or 11 US ETH ETFs.
   Total cost = trading cost + recurring cost × holding period, and how much of the asset you actually keep.
2. **A SoDEX execution check** for your exact size — VWAP, slippage, fee, and the largest size that stays within
   10 bps, from the live order book. Preview only; nothing is signed or sent.
3. **Indirect exposure** — US-listed companies holding ≥ 1,000 BTC: mNAV (equity, and with debt), BTC per $1,000
   of stock, last purchase. When the US market is closed, the price switches to the SoDEX 24/7 perp
   (e.g. `MSTR-USD`).

4. **Ask in your own words** — "5k in ether for half a year, no broker" fills the form (ETH, $5,000, 6 months,
   without ETFs and stocks). The page says how it understood you.
5. **Premium Report** — a short daily note on what holding BTC/ETH costs today, written by an AI from facts our
   code computed, with every number checked (see below).

Example from the live data on 24 Nov 2026 ($1,000, 12 months): SoDEX spot ≈ 0.13 %, the cheapest ETFs ≈ 0.20 %,
IBIT ≈ 0.30 %, SoDEX BTC perp ≈ 7–11 % a year because of funding; Strategy at ≈ 0.62× mNAV on equity and ≈ 0.70×
with debt.

## How it works

```
SoSoValue OpenAPI (v1 + v3)          SoDEX mainnet (public REST)
  ETFs: list, snapshot, history        perps + spot tickers (mark, index, funding)
  BTC treasuries + purchase history    order books (100 levels)
  crypto stocks: market snapshot
  v3 balance sheets (debt, cash)
  currency price (cross-check)
            │                                   │
            └──────────► lib/sources.ts ◄───────┘   typed accessors, quirks handled once
                              │
                         lib/calc.ts                 pure math, no I/O, no LLM
                              │
                         lib/model.ts                one comparable table
                              │
               app/ (pages, /diag, /journal, /api/snapshot)
```

### Method

| Route | Trading cost | Recurring cost |
|---|---|---|
| SoDEX spot | Buy `$X` and sell the same quantity into today's book, measured against that book's mid; tier‑0 taker fee 0.065 % each way | none |
| SoDEX perp (1x long) | Same round trip on the perp book; taker fee 0.04 % each way | current hourly funding × 8,760 (paid by longs when positive) |
| Spot ETF | latest premium / discount to NAV (SoSoValue ETF history) | sponsor fee |
| Treasury stock | not a 1:1 route — shown separately as mNAV | — |

- **Reference price:** SoDEX `BTC-USD` / `ETH-USD` index price; the SoSoValue price is shown next to it as an
  independent cross-check.
- **Why round trip against the venue's own mid:** a wrapped token can trade a few bps under the index. Counting
  that as a discount on entry would be wrong — you get the same gap back when you sell. It is shown as a note instead.
- **mNAV (equity)** = share price × total shares ÷ (BTC held × BTC price).
  **mNAV (with debt)** adds total debt and subtracts cash from the latest quarterly balance sheet (SoSoValue v3).
  Preferred stock is not in that data, so the official enterprise-value mNAV is higher than our "with debt" figure.
- **Operating companies** (Coinbase, Tesla, Block…) get no mNAV — it would be meaningless — only the share of
  market cap their BTC represents.
- **Not ranked, but shown:** ETFs whose fee SoSoValue reports as 0 (FBTC), funds under $100M in net assets (trading
  spread can outweigh their fee edge), and order books too thin for the requested size.

### Data quirks found on real responses (and how they are handled)

| Quirk | Handling |
|---|---|
| History endpoints are limited to the last 90 days for this API key | only current values + short history are used |
| `purchase-history.avg_btc_cost` returns 0.09 for every row | never used; cost per BTC = `acq_cost / btc_acq` |
| `crypto-stocks/{t}/market-cap` history disagrees with price × shares by up to 20 % | never used; mNAV from snapshot price × `total_shares` |
| ETF `market-snapshot.prem_dsc` is always `null` | premium taken from `/etfs/{t}/history` |
| FBTC `sponsor_fee` = 0 | flagged, not ranked |
| Numbers arrive as strings | parsed once in `lib/sources.ts` |
| SoDEX gateway returns 403 without a `User-Agent` | always sent |

## Where the AI is used — and where it is not

Every number on the site is computed by deterministic code (`lib/calc.ts`, `lib/model.ts`). The AI is used in two
places, and in neither can it introduce a number:

| | Model | What it does | Guard |
|---|---|---|---|
| Ask box (`/ask`) | `gpt-6-luna` | turns a sentence into `{asset, usd, months, exclude}` | strict JSON schema; values snapped to supported options; the page shows the interpretation |
| Premium Report (`/api/report`) | `gpt-6.1-terra` | writes 3–4 plain-English points from numbered facts | **validator**: every number in a sentence must appear in a fact that sentence cites; one retry with the validator's errors, then a template fallback |

How the report works (`lib/report.ts`):

1. Code builds numbered facts from today's snapshot and yesterday's committed one, e.g.
   `F6: SoDEX BTC-USD perp funding is 6.93% per year at the current hourly rate.`
2. The model returns `{headline, points: [{text, facts: ["F6"]}]}` — it may only copy numbers, not compute them
   (no differences, no bps conversions).
3. `validate()` extracts every number from each sentence and checks it against the numbers in the facts that
   sentence cites. A wrong number, a right number cited to the wrong fact, or a derived number is rejected
   (`tests/report.test.ts`).
4. At most one generation per UTC day (cached), so the public endpoint can't run up costs. The daily GitHub Action
   commits the note together with its facts and the model's name to `data/reports/`.

The model choice was tested on the actual task: on parsing requests into the schema, `gpt-6-luna` and
`gpt-6.1-terra` were 3/3, `gpt-4.1-mini` was 1/3.

## Trust and verifiability

- **/diag** checks every upstream endpoint the app depends on, live, and shows the SoSoValue quota left.
- **/journal** — a GitHub Action commits a dated snapshot and the day's validated note every day; the git history
  makes it tamper-evident.
- **Tests on real data:** `fixtures/` holds responses recorded from the live APIs (key stripped).
  `tests/model.test.ts` runs the whole pipeline on them and re-derives each figure from the raw JSON
  (e.g. IBIT cost = latest `prem_dsc` + 0.25 %, MSTR mNAV from the raw snapshot and holdings).
- **No orders, no keys in the browser:** all upstream calls run server-side; nothing on the site trades.

## Mapped to the judging criteria

| Criterion | Where it shows |
|---|---|
| User value & practical impact (30 %) | One concrete decision — the cheapest way to hold BTC/ETH for your amount and horizon — with the cost in dollars and units kept |
| Functionality & working demo (25 %) | Live site, no login; /diag shows every integration working right now |
| Logic, workflow & product design (20 %) | Deterministic method above; round-trip costing; mNAV in two variants; explicit "not ranked" rules |
| Data / API integration (15 %) | SoSoValue: ETFs (list, snapshot, history), BTC treasuries, purchase history, crypto-stock snapshots, v3 balance sheets, currency price. SoDEX: perps + spot tickers, funding, order books for 4 markets, 24/7 equity perps |
| UX & clarity (10 %) | Ask in plain words or use the form; one answer, then the full table with sources and timestamps on every row |

## Quick start

```bash
npm install
cp .env.example .env        # add SOSO_API_KEY (SoSoValue OpenAPI) and OPENAI_API_KEY
npm run dev                 # live APIs, cached
npm run dev:fixture         # offline, on the recorded real responses in fixtures/
npm test                    # 29 tests: math, full pipeline on fixtures, note validator
npm run record              # re-record fixtures (~130 SoSoValue requests)
```

Requires Node 20+. The SoSoValue key used here allows 100 requests/minute and 10,000/month; the HTTP layer
(`lib/http.ts`) caches every response (`unstable_cache`), merges identical in-flight requests, paces SoSoValue
to ~92 requests/minute and never caches 429/5xx — a cold start costs ~97 requests.

## Project structure

```
app/
  page.tsx              comparison page
  diag/page.tsx         live status of every upstream endpoint
  journal/page.tsx      daily snapshots and notes read from this repo
  ask/route.ts          plain-language question -> form parameters
  api/snapshot/route.ts JSON snapshot
  api/report/route.ts   snapshot + facts + validated note (used by the daily GitHub Action)
lib/
  http.ts               cached, paced upstream client + fixture mode
  sources.ts            typed SoSoValue / SoDEX accessors
  calc.ts               pure math (order-book walk, round trip, funding, mNAV)
  model.ts              assembles the comparison
  universe.ts           company classification and thresholds
  snapshot.ts           compact snapshot shape
  llm.ts                OpenAI Responses API client (strict JSON schema)
  query.ts              question parser + normalisation
  report.ts             facts, writer prompt, validator, template fallback
  reports-store.ts      reads committed daily files back from GitHub
fixtures/               recorded real API responses (key stripped)
tests/                  vitest
.github/workflows/      daily snapshot
```

## Limitations

- Holdings come from company disclosures and can be months old — flagged as stale after 120 days.
- Perp funding changes every hour; the yearly figure is the current rate annualised, not a forecast.
- ETF costs exclude brokerage commissions and the ETF's own bid/ask spread.
- Only US listings for companies: SoSoValue snapshots do not state the quote currency of foreign tickers.
- Not investment advice.

## Wave 3 changelog

New project in Wave 3: comparison engine, SoDEX execution check, treasury mNAV with 24/7 SoDEX pricing, ETF coverage
for BTC and ETH, plain-language ask box, daily AI note with a number validator, /diag, daily journal, tests on
recorded real data.

## Team

Solo builder — GitHub [@Lazaniaaa](https://github.com/Lazaniaaa).
