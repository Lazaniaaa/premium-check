import Link from "next/link";
import { buildComparison, TIE_SHARE, type Comparison } from "@/lib/model";
import { pct, ratio, usd } from "@/lib/format";
import { latestReport, REPO_URL } from "@/lib/reports-store";
import build from "@/lib/build-info.json";

export const maxDuration = 60;

export const metadata = { title: "Premium Check — for judges" };

const ASK_EN = "5k in ether for half a year, no broker";
const ASK_UK = "Куплю біткоїна на 2к на пів року";
const BEFORE = "e44b263"; // first public version, before two external reviews

// Same wording as the main page: a tie is called a tie.
const winner = (c: Comparison, amount: number) => {
  const ranked = c.direct.filter((r) => r.ranked);
  const b = ranked[0];
  if (!b) return "no ranked route";
  const tied = ranked.filter((r) => r.id !== b.id && r.cost! - b.cost! < TIE_SHARE).length;
  const name = `${b.name.split(" — ")[0]} ${usd(amount * b.cost!, 2)}`;
  return tied ? `${tied + 1} routes within ${usd(amount * TIE_SHARE, 2)} — effectively tied (lowest: ${name})` : `${name}, the cheapest`;
};

export default async function Judges() {
  const [btc, noBroker, withBroker, report] = await Promise.all([
    buildComparison("BTC", 1000, 12),
    buildComparison("BTC", 2000, 6),
    buildComparison("BTC", 2000, 6, { etfTradingCost: 0.0025 }),
    latestReport(),
  ]);
  const best = btc.direct.find((r) => r.ranked);
  const perp = btc.direct.find((r) => r.kind === "sodex_perp");
  const ibit = btc.direct.find((r) => r.id === "etf-IBIT");
  const mstr = btc.companies.find((c) => c.ticker === "MSTR");
  const newWriter = report?.note.points.some((p) => p.template);
  const sha = build.sha ? build.sha.slice(0, 7) : null;

  return (
    <>
      <h1>For judges: Premium Check in 60 seconds</h1>
      <p className="lede">
        One question: <b>what does it really cost to hold BTC or ETH</b> — SoDEX spot or perps, a spot ETF, or a
        treasury stock — for my amount and holding period? Everything is live; nothing needs a login.
      </p>

      <div className="card">
        <b>Three questions, one click each</b>
        <ul className="notes" style={{ color: "var(--text)", marginTop: 6 }}>
          <li>
            <Link href="/?asset=BTC&usd=2000&months=6">Does my broker change the answer?</Link> — a near-tie between ETFs and
            SoDEX spot, the broker cost where it flips, and a button to try it.
          </li>
          <li>
            <Link href="/?asset=ETH&usd=1000000&months=24&tab=execution#fill-sodex-spot">Can SoDEX fill $1M of ETH?</Link> —
            requested vs fillable amount in the live book, VWAP, slippage and the order you would sign.
          </li>
          <li>
            <Link href="/?asset=BTC&usd=1000&months=12&tab=companies#treasuries">What changes when debt is included?</Link> —
            market cap vs BTC value for each treasury company, with and without debt minus cash, and the price source.
          </li>
        </ul>
      </div>

      <div className="card answer" style={{ marginTop: 12 }}>
        <b>Two clicks: does your broker change the answer?</b>
        <p style={{ margin: "6px 0" }}>
          $2,000 of BTC for 6 months, on today&apos;s market:
        </p>
        <ul className="notes" style={{ color: "var(--text)" }}>
          <li>
            <Link href="/?asset=BTC&usd=2000&months=6">ETF broker cost 0%</Link> → <b>{winner(noBroker, 2000)}</b>
          </li>
          <li>
            <Link href="/?asset=BTC&usd=2000&months=6&etfcost=0.25">ETF broker cost 0.25% round trip</Link> →{" "}
            <b>{winner(withBroker, 2000)}</b>
          </li>
        </ul>
        <span className="sub">
          The page also shows the break-even broker cost and how the answer moves from 1 to 24 months. Results follow the
          live market, so the winner can differ from the day this page was written.
        </span>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <b>Right now, for $1,000 of BTC held 12 months</b>
        <ul className="notes" style={{ color: "var(--text)", marginTop: 6 }}>
          {best && <li>Cheapest: {best.name} — {pct(best.cost)} total cost</li>}
          {ibit && <li>BlackRock IBIT — {pct(ibit.cost)}</li>}
          {perp && (
            <li>
              SoDEX BTC perp — {pct(perp.cost)} (funding {pct(perp.annualCarry)} a year if today&apos;s hourly rate stayed)
            </li>
          )}
          {mstr && (
            <li>
              Strategy (MSTR) — market cap {ratio(mstr.mnavEquity)} its BTC value, {ratio(mstr.mnavWithDebt)} adding debt minus
              cash, priced at {usd(mstr.price, 2)} {mstr.priceSource === "sodex_24_7" ? "from SoDEX MSTR-USD (24/7)" : "on the exchange"}
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
                <Link href="/?asset=BTC&usd=1000&months=12">Open the comparison</Link>: the answer in dollars, ties called
                ties, the broker break-even, and a table of how the answer changes with the holding period.
              </td>
            </tr>
            <tr>
              <td className="muted">2</td>
              <td>
                Ask in plain words: <Link href={`/ask?q=${encodeURIComponent(ASK_EN)}`}>&ldquo;{ASK_EN}&rdquo;</Link> or in
                Ukrainian: <Link href={`/ask?q=${encodeURIComponent(ASK_UK)}`}>&ldquo;{ASK_UK}&rdquo;</Link>. The AI only
                fills the form; the page says how it understood you.
              </td>
            </tr>
            <tr>
              <td className="muted">3</td>
              <td>
                Switch tabs under the answer: <b>Routes</b> (every route, cheapest first, and costs by holding period),{" "}
                <b>Execution</b> (VWAP, slippage, the largest order whose average price stays within 10 bps, a button to the
                SoDEX market and the exact order body you would sign — never sent) and <b>Companies</b> (market cap vs BTC
                value, priced 24/7 from SoDEX when the US market is closed). Each tab has its own link.
              </td>
            </tr>
            <tr>
              <td className="muted">4</td>
              <td>
                Read the <b>Daily Premium Report</b> in the <Link href="/journal">journal</Link> and open &ldquo;facts and
                checks&rdquo;.{" "}
                {newWriter
                  ? "The AI wrote it with named variables only and typed no digits or fund tickers; code inserted every number and name."
                  : "This note predates the current writer (introduced 25 Nov 2026), which writes with named variables only and types no digits — the next daily note uses it."}
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
                Check it is real: <Link href="/diag">/diag</Link> spot-checks one endpoint of each kind and shows the deployed
                commit{sha ? ` (${sha})` : ""}; <Link href="/journal">/journal</Link> shows what the site said each day, from
                files a GitHub Action commits to <a href={`${REPO_URL}/tree/main/data`}>data/</a>; any calculation can be
                downloaded as JSON from the result card.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Was → now → check</h2>
      <p className="lede">
        Premium Check is new in Wave 3. Two independent reviews of the first public version (
        <a href={`${REPO_URL}/tree/${BEFORE}`}>{BEFORE}</a>) found real problems. Three of them, and how to check the fix:
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Was</th>
              <th>Now</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                $1M of ETH: the table showed ~581 ETH &ldquo;kept&rdquo; although the visible order book filled only ~$167k.
              </td>
              <td>
                Routes the book can&apos;t fill show only the fillable amount and are not ranked; if one route is left, the
                answer says there is no real comparison.
              </td>
              <td>
                <Link href="/?asset=ETH&usd=1000000&months=24">$1M ETH · 24 months</Link>
              </td>
            </tr>
            <tr>
              <td>
                An ETF trading at a discount showed a negative cost (ETHW −0.10% for one month): the premium was counted as a
                gain.
              </td>
              <td>
                One rule for every gap to a reference (ETF premium, SoDEX basis): shown, assumed unchanged at exit. ETF cost =
                fee + your broker; staking ETFs and sub-minimum orders are not ranked.
              </td>
              <td>
                <Link href="/?asset=ETH&usd=10&months=1">$10 ETH · 1 month</Link>
              </td>
            </tr>
            <tr>
              <td>The AI note copied numbers; a checker compared them, but a flipped sign or swapped value could slip through.</td>
              <td>
                The AI may not type a digit or a fund ticker: it writes <code>{"{variables}"}</code> and code inserts the values (
                <a href={`${REPO_URL}/blob/main/lib/report.ts`}>lib/report.ts</a>, tested in{" "}
                <a href={`${REPO_URL}/blob/main/tests/report.test.ts`}>tests/report.test.ts</a>).
              </td>
              <td>
                <a href="/api/report">/api/report</a> → each point has <code>template</code> and <code>text</code>
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
            <li>ETFs: US BTC and ETH lists, market snapshots (fee, value traded), history (premium/discount)</li>
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
            <li>Order books: BTC-USD, ETH-USD perps; vBTC/vUSDC, vETH/vUSDC spot; market parameters (tick, step, minimums)</li>
            <li>Equity perps (MSTR-USD and others) for 24/7 pricing when the US market is closed</li>
          </ul>
        </div>
      </div>

      <h2>Known limits</h2>
      <div className="card">
        <ul className="notes">
          <li>No spread data exists in the APIs: ETF liquidity uses a rule of thumb from daily value traded, and your broker cost is an input.</li>
          <li>Perp funding is today&apos;s hourly rate over the period, not a forecast; the cost at zero funding is shown too.</li>
          <li>Company ratios exclude preferred stock and dilution (not in the data); they are not Strategy&apos;s own mNAV.</li>
          <li>The AI can still word a sentence poorly; every point lists the facts it used.</li>
        </ul>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Source code: <a href={REPO_URL}>{REPO_URL.replace("https://", "")}</a>
      </p>
    </>
  );
}
