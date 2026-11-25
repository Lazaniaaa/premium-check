import Link from "next/link";
import { buildComparison } from "@/lib/model";
import { pct, ratio, usd } from "@/lib/format";
import { latestReport, REPO_URL } from "@/lib/reports-store";

export const maxDuration = 60;

export const metadata = { title: "Premium Check — for judges" };

const ASK_EN = "5k in ether for half a year, no broker";
const ASK_UK = "Куплю біткоїна на 2к на пів року";

export default async function Judges() {
  const [btc, report] = await Promise.all([buildComparison("BTC", 1000, 12), latestReport()]);
  const best = btc.direct.find((r) => r.ranked);
  const perp = btc.direct.find((r) => r.kind === "sodex_perp");
  const ibit = btc.direct.find((r) => r.id === "etf-IBIT");
  const mstr = btc.companies.find((c) => c.ticker === "MSTR");

  return (
    <>
      <h1>For judges: Premium Check in 60 seconds</h1>
      <p className="lede">
        One question: <b>what does it really cost to hold BTC or ETH</b> — SoDEX spot or perps, a spot ETF, or a
        treasury stock — for my amount and holding period? Everything below is live; nothing needs a login.
      </p>

      <div className="card">
        <b>Right now, for $1,000 of BTC held 12 months</b>
        <ul className="notes" style={{ color: "var(--text)", marginTop: 6 }}>
          {best && (
            <li>
              Cheapest: {best.name} — {pct(best.cost)} total cost
            </li>
          )}
          {ibit && <li>BlackRock IBIT — {pct(ibit.cost)}</li>}
          {perp && (
            <li>
              SoDEX BTC perp — {pct(perp.cost)} (funding {pct(perp.annualCarry)} a year at the current hourly rate)
            </li>
          )}
          {mstr && (
            <li>
              Strategy (MSTR) — market cap {ratio(mstr.mnavEquity)} its BTC value, {ratio(mstr.mnavWithDebt)} adding debt minus cash, priced at{" "}
              {usd(mstr.price, 2)} {mstr.priceSource === "sodex_24_7" ? "from SoDEX MSTR-USD (24/7)" : "on the exchange"}
            </li>
          )}
        </ul>
      </div>

      <h2>The path</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            <tr>
              <td className="muted">1</td>
              <td>
                <Link href="/?asset=BTC&usd=1000&months=12">Open the comparison</Link> — one answer on top, then every
                route ranked by total cost, with the source and timestamp on each row.
              </td>
            </tr>
            <tr>
              <td className="muted">2</td>
              <td>
                Ask in plain words: <Link href={`/ask?q=${encodeURIComponent(ASK_EN)}`}>&ldquo;{ASK_EN}&rdquo;</Link> or
                in Ukrainian: <Link href={`/ask?q=${encodeURIComponent(ASK_UK)}`}>&ldquo;{ASK_UK}&rdquo;</Link>. The AI
                only fills the form; the page shows how it understood you.
              </td>
            </tr>
            <tr>
              <td className="muted">3</td>
              <td>
                Scroll to <b>SoDEX execution check</b> — VWAP, slippage, fee and the largest size within 10 bps from the
                live order book, a button that opens that market on SoDEX, and the exact order body you would sign (IOC
                limit, rounded to the market&apos;s tick and step size; never sent). Then <b>companies holding BTC</b> for
                market cap vs BTC value, with 24/7 SoDEX pricing when the US market is closed.
              </td>
            </tr>
            <tr>
              <td className="muted">4</td>
              <td>
                Read today&apos;s <b>Premium Report</b> on the main page and open &ldquo;facts and checks&rdquo;: each
                the AI writes sentences with named variables like {"{mstr_ratio_debt}"} and may not type a single digit;
                code inserts every number and name from facts it computed.
                {report ? (
                  <>
                    {" "}
                    Latest: <i>&ldquo;{report.note.headline}&rdquo;</i> ({report.day}).
                  </>
                ) : null}
              </td>
            </tr>
            <tr>
              <td className="muted">5</td>
              <td>
                Check it is real: <Link href="/diag">/diag</Link> spot-checks one endpoint of each kind and shows the
                deployed commit;{" "}
                <Link href="/journal">/journal</Link> shows the snapshots a GitHub Action commits daily to{" "}
                <a href={`${REPO_URL}/tree/main/data`}>data/</a>; <a href="/api/snapshot">/api/snapshot</a> and{" "}
                <a href="/api/report">/api/report</a> return the raw JSON.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Typical judge feedback in Waves 1–2, and how this build answers it</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Feedback seen across submissions</th>
              <th>Premium Check</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>&ldquo;Logic leans heavily on LLM judgment&rdquo;</td>
              <td>
                All numbers are deterministic code (<a href={`${REPO_URL}/blob/main/lib/calc.ts`}>lib/calc.ts</a>). The LLM
                parses questions, and writes the daily note with named variables only — the{" "}
                <a href={`${REPO_URL}/blob/main/lib/report.ts`}>validator</a> rejects any digit it types, and code fills in
                the values. It can still word a sentence badly, so every point links to the facts it used.
              </td>
            </tr>
            <tr>
              <td>&ldquo;Needs proof / validation, not claims&rdquo;</td>
              <td>
                Tests run the full pipeline on <a href={`${REPO_URL}/tree/main/fixtures`}>recorded real API responses</a>{" "}
                and re-derive key figures (route costs, funding, Strategy&apos;s ratio) from the raw JSON; a daily, git-committed journal shows what the site said each day.
              </td>
            </tr>
            <tr>
              <td>&ldquo;Demo failed to fetch&rdquo; / &ldquo;live or mock?&rdquo;</td>
              <td>
                <Link href="/diag">/diag</Link> shows every integration&apos;s live status and the API quota left; every row
                names its endpoint and time.
              </td>
            </tr>
            <tr>
              <td>&ldquo;Crowded AI-signal category; sharpen the identity&rdquo;</td>
              <td>No buy/sell signals. One decision — the cheapest way to hold — with cost in dollars and units kept.</td>
            </tr>
            <tr>
              <td>&ldquo;Execution hand-waved&rdquo;</td>
              <td>
                Execution is shown as what it is: a preview from the live SoDEX order book (VWAP, slippage, fees, size within
                10 bps). Nothing is signed or sent, and the page says so.
              </td>
            </tr>
            <tr>
              <td>&ldquo;Breadth without depth&rdquo;</td>
              <td>
                Narrow scope, done to the end: round-trip costing on each venue&apos;s own book, one rule for every gap to a
                reference (ETF premium, SoDEX basis), partial fills shown as partial,
                explicit rules for what is not ranked, data quirks documented in the{" "}
                <a href={`${REPO_URL}#data-quirks-found-on-real-responses-and-how-they-are-handled`}>README</a>.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>SoSoValue and SoDEX surfaces used</h2>
      <div className="grid2">
        <div className="card">
          <b>SoSoValue</b>
          <ul className="notes">
            <li>ETFs: US BTC and ETH lists, market snapshots, history (premium/discount)</li>
            <li>BTC treasuries: list and purchase history</li>
            <li>Crypto stocks: market snapshots (price, shares, market status)</li>
            <li>v3 financials: quarterly balance sheets (debt, cash)</li>
            <li>Currency market snapshot (independent price cross-check)</li>
          </ul>
        </div>
        <div className="card">
          <b>SoDEX</b>
          <ul className="notes">
            <li>Perps tickers: index and mark price, hourly funding, open interest</li>
            <li>Order books: BTC-USD, ETH-USD perps; vBTC/vUSDC, vETH/vUSDC spot</li>
            <li>Equity perps (MSTR-USD and others) for 24/7 pricing when the US market is closed</li>
          </ul>
        </div>
      </div>

      <h2>Known limits</h2>
      <div className="card">
        <ul className="notes">
          <li>Company ratios exclude preferred stock and dilution (not in the data); they are not Strategy&apos;s own mNAV, which since 23 Jul 2026 is based on net bitcoin per share after senior claims.</li>
          <li>ETF costs exclude your broker&apos;s commission and the bid/ask spread; differences under 0.1 pp are shown as a tie.</li>
          <li>SoSoValue history is limited to 90 days for this API key; company holdings can be months old (flagged as stale).</li>
          <li>Perp funding is the current hourly rate annualised, not a forecast. ETF costs exclude brokerage and spread.</li>
        </ul>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Source code: <a href={REPO_URL}>{REPO_URL.replace("https://", "")}</a>
      </p>
    </>
  );
}
