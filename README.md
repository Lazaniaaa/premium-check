# Premium Check

**What does it really cost to hold BTC or ETH?**
Spot or perps on SoDEX, a spot ETF from BlackRock, Fidelity, ARK, Grayscale, Bitwise…, or a stock like Strategy (MSTR)
that holds bitcoin — every route has a premium on top of the asset itself. Premium Check puts all of them on one
yardstick, on live SoSoValue and SoDEX data.

- **Live demo:** https://premium-check-iota.vercel.app
- **For judges — the 60-second path:** https://premium-check-iota.vercel.app/judges
- **Data status (spot checks of each upstream kind + deployed commit):** https://premium-check-iota.vercel.app/diag
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

0. **The answer in dollars** — the cheapest route, or an honest tie when several routes are within 0.1 pp; the
   **broker break-even** ("ETFs stay cheapest only while your commission + spread is below X%"); a table of how the
   answer changes from 1 to 24 months; and a **downloadable JSON** of the calculation (inputs, sources, times,
   method version). The answer comes first; below it, tabs **Routes · Execution · Companies** (each has its own
   link, e.g. `?tab=execution`; switching tabs does not recompute, so the numbers stay the ones you are reading).
1. **Direct exposure, ranked by total cost** — SoDEX spot, SoDEX perp (1x long), 12 US BTC ETFs or 11 US ETH ETFs.
   Total cost = trading cost + recurring cost × holding period, and how much of the asset you actually keep.
2. **A SoDEX execution check** for your exact size — VWAP, slippage, fee, and the largest size that stays within
   10 bps, from the live order book — plus a button that opens that market on SoDEX and the exact order body you
   would sign (IOC limit, quantity and price rounded to the market's step and tick size from
   `/markets/symbols`, SoDEX enum values). Nothing is signed or sent.
3. **Indirect exposure** — US-listed companies holding ≥ 1,000 BTC: market cap ÷ BTC value, the same with debt
   minus cash, gross BTC per $1,000
   of stock, last purchase. When the US market is closed, the price switches to the SoDEX 24/7 perp
   (e.g. `MSTR-USD`).

4. **Ask in your own words** — "5k in ether for half a year, no broker" fills the form (ETH, $5,000, 6 months,
   without ETFs and stocks). The page says how it understood you.
5. **Premium Report** — a short daily note on what holding BTC/ETH costs today, written by an AI from facts our
   code computed, with every number checked (see below).

Example from the live data on 24 Nov 2026 ($1,000, 12 months): SoDEX spot ≈ 0.13 %, the cheapest ETFs ≈ 0.20 %,
IBIT ≈ 0.30 %, SoDEX BTC perp ≈ 7–11 % a year because of funding; Strategy's market cap ≈ 0.62× its BTC value, ≈ 0.70×
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
| Treasury stock | not a 1:1 route — shown separately as market cap ÷ BTC value | — |

- **Reference price:** SoDEX `BTC-USD` / `ETH-USD` index price; the SoSoValue price is shown next to it as an
  independent cross-check.
- **Why round trip against the venue's own mid:** a wrapped token can trade a few bps under the index. Counting
  that as a discount on entry would be wrong — you get the same gap back when you sell. It is shown as a note instead.
- **Market cap ÷ BTC value** = share price × total shares ÷ (BTC held × BTC price).
  **With debt** adds total debt and subtracts cash from the latest quarterly balance sheet (SoSoValue v3).
  Preferred stock and dilution are not in that data, so these are simple ratios — not Strategy's own mNAV, which
  since 23 Jul 2026 is based on net bitcoin per share after senior claims. A ratio below 1× is not "cheap bitcoin":
  debt and preferred rank ahead of shareholders, so read both columns.
- **One rule for every gap to a reference:** an ETF's premium to NAV and a SoDEX market's gap to the index are shown,
  and assumed unchanged when you sell, so they are neither a cost nor a gain. ETF cost is therefore the sponsor fee
  (commission and spread not included); SoDEX cost is the round trip `1 − sell VWAP × (1 − fee) ÷ (buy VWAP × (1 + fee))`.
- **Ties:** routes within 0.1 pp of the cheapest are shown as effectively tied — at that gap, your broker can decide.
- **Your broker:** an optional field adds your own ETF round-trip commission + spread to every ETF route.
- **Partial fills:** if the visible book can't fill the amount, the route shows what is fillable and is not ranked.
- **Also shown but not ranked:** staking ETFs (ETHB, ETH, ETHE, TETH — distributions and fee waivers are not
  modelled), amounts below SoDEX's minimum order, crossed order books (treated as a data anomaly).
- **Method versions:** snapshots carry `methodVersion`; the journal never shows a day-over-day change across a
  method change. Method 2 (25 Nov 2026) introduced the rules above.
- **Operating companies** (Coinbase, Tesla, Block…) get no mNAV — it would be meaningless — only the share of
  market cap their BTC represents.
- **Not ranked, but shown:** ETFs whose fee SoSoValue reports as 0 (FBTC); ETFs that traded under $2M on the last
  day, or where your amount exceeds 0.1% of that day's trading (a rule of thumb — no spread data exists in the
  APIs, and thin trading usually means wide spreads); and order books too thin for the requested size.

### Data quirks found on real responses (and how they are handled)

| Quirk | Handling |
|---|---|
| History endpoints are limited to the last 90 days for this API key | only current values + short history are used |
| `purchase-history.avg_btc_cost` returns 0.09 for every row | never used; cost per BTC = `acq_cost / btc_acq` |
| `crypto-stocks/{t}/market-cap` history disagrees with price × shares by up to 20 % | never used; ratios from snapshot price × `total_shares` |
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
| Premium Report (`/api/report`) | `gpt-6.1-terra` | writes 3–4 plain-English points from numbered facts | **the model may not type a digit**: numbers and names appear only as `{variables}` of the facts it cites, and code inserts the values; one retry with the validator's errors, then a template fallback |

How the report works (`lib/report.ts`):

1. Code builds numbered facts from today's snapshot and yesterday's committed one. Every number and name in a fact
   is a named variable, e.g. `F6: SoDEX BTC-USD perp funding is {btc_funding_year} a year…` with
   `{btc_funding_year} = "6.93%"`.
2. The model returns `{headline, points: [{text, facts: ["F6"]}]}` where the text uses those variables —
   "Funding would cost {btc_funding_year} a year" — and **contains no digits**.
3. `validate()` rejects any digit or fund ticker outside a variable and any variable that does not belong to a fact
   the sentence cites; then code renders the values. So the model cannot invent, round, flip, convert or misattribute a number.
   It can still word a sentence poorly — each point lists its facts so a reader can check (`tests/report.test.ts`;
   an opt-in live check: `LIVE_LLM=1 npx vitest run tests/live-note.test.ts`).
4. A report already committed for the day is served straight from the repo (no API or AI calls); otherwise at
   most one generation per UTC day per instance (cached). The ask box has a daily parse budget and capped output
   tokens. The daily GitHub Action
   commits the note together with its facts and the model's name to `data/reports/`.

The model choice was tested on the actual task: on parsing requests into the schema, `gpt-6-luna` and
`gpt-6.1-terra` were 3/3, `gpt-4.1-mini` was 1/3.

## Trust and verifiability

- **/diag** spot-checks one endpoint of each upstream kind (through the same cache, up to 5 min old), shows the
  SoSoValue quota left and the deployed commit. Each row on the comparison page names its own source and time.
- **/journal** — a GitHub Action commits a dated snapshot and the day's validated note every day, with the change vs
  the previous day; the git history makes it tamper-evident. Below it, history straight from SoSoValue (clearly
  separated from what we recorded): 30 days of BTC ETF premium/discount and Strategy's BTC purchases.
- **/validation** — two assumptions tested where history allows it. (1) The cost rule assumes an ETF's premium to NAV
  is the same at exit as at entry. On 22 sessions of SoSoValue history (26 Oct – 24 Nov 2026, all 12 BTC and 11 ETH
  US spot ETFs), after 10 sessions the reported closing premium moved by more than 0.35 % (BTC) / 0.34 % (ETH) in
  1 of 10 fund-windows; "sold at NAV" would have cut that to 0.19 % / 0.23 %; after 1 session the fund's past median
  did best. Windows overlap and funds move together, so these describe this sample only. The ranking still books no
  gain or loss from an unknown exit premium; the answer says when a premium change could reverse the order (gap
  between two funds for ETF vs ETF, the fund's own move for ETF vs SoDEX). The exact inputs are frozen in
  `data/validation/etf-premium-history.json` (`scripts/freeze-premium-history.mjs`), and
  `node scripts/reproduce-validation.mjs` re-computes the tables without a key, with the same `lib/backtest.ts`.
  Out of sample: the dataset was frozen before the 25 Nov US close; a later copy
  (`data/validation/etf-premium-after.json`, no earlier value revised) checks the frozen p90s on that close. After
  5 sessions 8 of 12 BTC and 8 of 11 ETH funds moved more than the frozen p90 (0/12 and 3/11 after 10 sessions);
  "sold at NAV" was exceeded just as often. One correlated event, but it shows 22 sessions understate days like it.
  Real-trade check: a prediction with the full order book is committed *before* a SoDEX round trip
  (`scripts/predict-trade.mjs`), then `scripts/record-fill.mjs` reads the fills of exactly the buy and the sell order
  (SoDEX's public account-trades endpoint; it ignores the orderID filter, so the script keeps only fills with the matching orderID) and `lib/trade-record.ts` grades the attempt:
  complete only if both orders filled on the predicted market and side, after the predicted book, with fees in the
  base or quote coin and under one lot step left; otherwise partial or failed. It counts as verified only if complete
  and GitHub's server time for the push of the prediction commit (activity API) is before the first fill. Every
  attempt is published; the page shows predicted / actual / difference in dollars and bps, and both order ids.
  (2) A perp's cost uses today's hourly funding for the whole period. SoDEX publishes no market funding history, so
  this is tested on Hyperliquid's public hourly history (Jun 2023 – Nov 2026, ~30,400 hours per coin, frozen in
  `data/validation/funding-history.json` by `scripts/freeze-funding-history.mjs`) and labelled as another venue.
  Over 12 months the rule missed cumulative funding on a constant dollar position by more than 45 % (BTC) / 44 % (ETH) in
  1 of 10 daily starts; a past 30-day average would have cut that to 27 % / 25 %. Only 3 non-overlapping 12-month
  windows fit in that history. The rule stays (SoDEX has no history to average); the answer now shows the
  break-even funding rate at which the perp would beat the cheapest other route, next to today's rate and how many
  historical windows averaged below it. What history cannot test: past SoDEX books,
  SoDEX's own funding history, treasury ratios.
- **Tests on real data:** `fixtures/` holds responses recorded from the live APIs (key stripped).
  `tests/model.test.ts` runs the whole pipeline on them and re-derives each figure from the raw JSON
  (e.g. IBIT cost = 0.25 % fee, MSTR ratio from the raw snapshot and holdings), plus the edge cases reviewers found:
  partial fills, tickets that must never exceed the amount, sign/unit/period changes in the AI note, and a cold
  render that must stay inside the API's per-minute limit.
- **No orders, no keys in the browser:** all upstream calls run server-side; nothing on the site trades.

## Mapped to the judging criteria

| Criterion | Where it shows |
|---|---|
| User value & practical impact (30 %) | One concrete decision — the cheapest way to hold BTC/ETH for your amount and horizon — with the cost in dollars and units kept |
| Functionality & working demo (25 %) | Live site, no login; /diag shows every integration working right now |
| Logic, workflow & product design (20 %) | Deterministic method above; round-trip costing; one rule for gaps to a reference; ties; explicit "not ranked" rules |
| Data / API integration (15 %) | SoSoValue: ETFs (list, snapshot, history), BTC treasuries, purchase history, crypto-stock snapshots, v3 balance sheets, currency price. SoDEX: perps + spot tickers, funding, order books for 4 markets, 24/7 equity perps |
| UX & clarity (10 %) | Ask in plain words or use the form; one answer, then the full table with sources and timestamps on every row |

## Quick start

```bash
npm install
cp .env.example .env        # add SOSO_API_KEY (SoSoValue OpenAPI) and OPENAI_API_KEY
npm run dev                 # live APIs, cached
npm run dev:fixture         # offline, on the recorded real responses in fixtures/
npm test                    # 66 tests (+1 opt-in live AI check): math, full pipeline on fixtures, note validator, order tickets, edge cases
npm run deploy              # stamp commit, deploy to Vercel, warm the cache
npm run record              # re-record fixtures (~130 SoSoValue requests)
```

Requires Node 20+. The SoSoValue key used here allows 100 requests/minute and 10,000/month; the HTTP layer
(`lib/http.ts`) caches every response (`unstable_cache`), merges identical in-flight requests, paces SoSoValue
to the key's per-minute limit (bursts of up to 85 per rolling minute) and never caches 429/5xx — a cold start costs ~80 requests and fits in one minute's limit.

## Project structure

```
app/
  page.tsx              comparison page
  diag/page.tsx         spot checks of each upstream kind, quota, deployed commit
  journal/page.tsx      daily snapshots and notes read from this repo
  ask/route.ts          plain-language question -> form parameters
  api/snapshot/route.ts JSON snapshot
  api/report/route.ts   snapshot + facts + validated note (used by the daily GitHub Action)
  api/compare/route.ts  one calculation as a downloadable JSON file
  validation/page.tsx   method tested on SoSoValue history and against a real SoDEX fill
  api/validation/route.ts the same as JSON
lib/
  http.ts               cached, paced upstream client + fixture mode
  sources.ts            typed SoSoValue / SoDEX accessors
  calc.ts               pure math (order-book walk, round trip, funding, mNAV)
  model.ts              assembles the comparison
  universe.ts           company classification and thresholds
  snapshot.ts           compact snapshot shape
  trade.ts              SoDEX deep links and unsigned order tickets
  history.ts            ETF premium history and Strategy purchases from SoSoValue
  backtest.ts           exit-premium and perp-funding backtests (pure, tested)
  validation.ts         reads the frozen datasets and recorded trades for /validation
  llm.ts                OpenAI Responses API client (strict JSON schema)
  query.ts              question parser + normalisation
  report.ts             facts, writer prompt, validator, template fallback
  reports-store.ts      reads committed daily files back from GitHub
fixtures/               recorded real API responses (key stripped)
tests/                  vitest
data/                   daily snapshots and notes (Action), validation/ predictions and trades
scripts/                predict-trade / record-fill (real-trade check), freeze-premium-history /
                        freeze-funding-history /
                        reproduce-validation (backtest inputs and offline re-run), deploy, fixtures
.github/workflows/      daily snapshot
```

## Limitations

- Holdings come from company disclosures and can be months old — flagged as stale after 120 days.
- Perp funding changes every hour; the yearly figure is the current rate annualised, not a forecast.
- ETF costs exclude brokerage commissions and the ETF's own bid/ask spread.
- Only US listings for companies: SoSoValue snapshots do not state the quote currency of foreign tickers.
- Not investment advice.

## Wave 3 changelog

New project in Wave 3: comparison engine, SoDEX execution check, treasury market-cap ratios with 24/7 SoDEX pricing, ETF coverage
for BTC and ETH, plain-language ask box, daily AI note in which the model types no digits (code inserts every number), SoDEX order tickets and deep links,
/diag, daily journal with day-over-day changes and SoSoValue history, /judges, /validation (exit-premium assumption tested
on 22 sessions of SoSoValue history and the perp funding assumption on 3.5 years of Hyperliquid hourly funding, both with
frozen inputs; protocol for checking a prediction against a real SoDEX fill), tests on recorded real data.

## Team

Solo builder — GitHub [@Lazaniaaa](https://github.com/Lazaniaaa).
