import Link from "next/link";
import { datasetFile, premiumBacktest, trades, type Backtest, type Stats, type TradeRecord } from "@/lib/validation";
import { REPO_URL } from "@/lib/reports-store";
import { bps, pct, usd } from "@/lib/format";

export const metadata = { title: "Premium Check — validation" };

const b = (x: number | null | undefined) => bps(x == null ? null : x * 1e4);
const NAMES = { unchanged: "premium stays the same", zero: "sold at NAV", pastMedian: "back to the fund's past median" };
const ms = (iso: string) => iso.replace("T", " ").replace("Z", " UTC");
const day = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";

function Cell({ s, best }: { s: Stats; best?: boolean }) {
  return (
    <td style={best ? { fontWeight: 600 } : undefined}>
      {b(s.median)} <span className="muted">/ {b(s.p90)}</span>
    </td>
  );
}

function BacktestTable({ r }: { r: Backtest }) {
  const l = r.longest!;
  return (
    <>
      <h3>
        {r.asset}: {r.covered}/{r.listed} US spot ETFs · {r.sessions} sessions, {day(r.from)} – {day(r.to)}
      </h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sold after</th>
              <th>Same premium (our rule)</th>
              <th>Sold at NAV</th>
              <th>Past median</th>
              <th>Gap between two funds</th>
            </tr>
          </thead>
          <tbody>
            {r.horizons.map((h) => (
              <tr key={h.days}>
                <td>
                  {h.days === 1 ? "1 session" : `${h.days} sessions`}
                  <div className="sub">
                    {h.startDates} start dates · {h.unchanged.n} fund-windows
                  </div>
                </td>
                <Cell s={h.unchanged} best={h.best === "unchanged"} />
                <Cell s={h.zero} best={h.best === "zero"} />
                <Cell s={h.pastMedian} best={h.best === "pastMedian"} />
                <td>
                  {b(h.pairwise.median)} <span className="muted">/ {b(h.pairwise.p90)}</span>
                  <div className="sub">{h.pairwise.n} pair-windows</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub">
        Each cell: typical error (median) / error exceeded in 1 of 10 windows (p90); lowest p90 in bold. Example: after{" "}
        {l.days} sessions, {l.startDates} start dates × {r.covered} funds = {l.unchanged.n} windows. Windows overlap and funds
        share market moves, so these describe this sample; they are not independent observations.
      </p>
    </>
  );
}

function TradeTable({ t }: { t: TradeRecord }) {
  const leg = (name: string, l: TradeRecord["buy"]) => (
    <tr>
      <td>{name}</td>
      <td>{l.predictedVwap.toFixed(2)}</td>
      <td>{l.actualVwap.toFixed(2)}</td>
      <td>{bps(l.diffBps)}</td>
      <td>{l.qty}</td>
      <td>
        {l.feePaid} {l.feeAsset}
        <div className="sub">{l.feeRate != null ? `rate ${pct(l.feeRate, 3)}` : ""}</div>
      </td>
    </tr>
  );
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <b>
        {usd(t.usd)} {t.symbol} round trip
      </b>
      <div className="sub">
        Prediction (book at {ms(t.predictedAt)}) published in{" "}
        {t.predictionCommit ? <a href={`${REPO_URL}/commit/${t.predictionCommit}`}>{t.predictionCommit.slice(0, 7)}</a> : "—"}{" "}
        before the trade · fills {ms(t.firstFillAt)} → {ms(t.lastFillAt)}
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table>
          <thead>
            <tr>
              <th>Leg</th>
              <th>Predicted VWAP</th>
              <th>Actual VWAP</th>
              <th>Difference</th>
              <th>Quantity</th>
              <th>Fee charged</th>
            </tr>
          </thead>
          <tbody>
            {leg("Buy", t.buy)}
            {leg("Sell", t.sell)}
          </tbody>
        </table>
      </div>
      <p style={{ marginBottom: 4 }}>
        Round-trip cost: predicted <b>{usd(t.predictedCostUsd, 4)}</b> ({bps(t.predictedCostBps)}), actual{" "}
        <b>{usd(t.actualCostUsd, 4)}</b> ({bps(t.actualCostBps)}).
      </p>
      <p className="sub">
        Spent {usd(t.usdcSpent, 4)} USDC, got back {usd(t.usdcReturned, 4)}; {t.baseLeft} BTC left from lot rounding, valued at
        the sell price. Fee rate: site model {pct(t.feeRates.model, 3)}, SoDEX symbol {pct(t.feeRates.symbol, 3)}, charged as
        shown per leg.
        {t.note ? ` ${t.note}` : ""} <a href={`${REPO_URL}/blob/main/${t.predictionFile}`}>Prediction + full book</a> ·{" "}
        <a href={`https://mainnet-gw.sodex.dev/api/v1/spot/accounts/${t.account}/trades?symbol=${t.symbol}`}>fills on SoDEX</a>{" "}
        (trade ids {t.tradeIds.join(", ")})
      </p>
    </div>
  );
}

export default function Validation() {
  const both = [premiumBacktest("BTC"), premiumBacktest("ETH")];
  const [btc] = both;
  const oneDay = both.map((r) => ({ asset: r.asset, best: r.horizons[0].best }));

  return (
    <>
      <h1>Validation: does the method hold up?</h1>

      <section className="card answer">
        <b>Result</b>
        <ul className="notes" style={{ color: "var(--text)", marginTop: 6 }}>
          <li>
            We tested one assumption of the cost rule — an ETF&apos;s premium to NAV is the same when you sell as when you buy
            — on {btc.sessions} trading sessions ({day(btc.from)} – {day(btc.to)}) for every US spot BTC and ETH ETF.
          </li>
          {both.map((r) => (
            <li key={r.asset}>
              <b>{r.asset}:</b> after {r.longest!.days} sessions the reported premium moved by more than{" "}
              <b>{b(r.longest!.unchanged.p90)}</b> in 1 of 10 fund-windows. Assuming the fund is sold at NAV would have cut
              that to <b>{b(r.longest!.zero.p90)}</b>.
            </li>
          ))}
          <li>
            After 1 session the best of the three was{" "}
            {oneDay.map((o, i) => (
              <span key={o.asset}>
                {i ? "; " : ""}
                {o.asset}: {NAMES[o.best]}
              </span>
            ))}
            . So the alternative is better only in this sample and horizon, not proven in general.
          </li>
          <li>
            <b>Real-trade check:</b>{" "}
            {trades.length === 0
              ? "0 verified round trips so far · the protocol is below."
              : `${trades.length} verified SoDEX round trip${trades.length > 1 ? "s" : ""} · see section 2.`}
          </li>
        </ul>
        <span className="sub">
          Frozen dataset: <a href={`${REPO_URL}/blob/main/${datasetFile}`}>{datasetFile}</a> ({ms(btc.frozenAt)}). Re-run
          without a key: <code>node scripts/reproduce-validation.mjs</code> · <a href="/api/validation">JSON</a> ·{" "}
          <a href={`${REPO_URL}/blob/main/lib/backtest.ts`}>code</a> ·{" "}
          <a href={`${REPO_URL}/blob/main/tests/validation.test.ts`}>tests</a>
        </span>
      </section>

      <h2 id="premium">1. The ETF exit premium</h2>
      <p>
        The ranking books no gain or loss from an exit premium nobody knows yet: it assumes the premium stays the same. We
        then checked separately how far that assumption was from historical closing prices, against two alternatives. A
        discount can pay off if it narrows; what we avoid is counting that possible gain in advance, which is the error the
        first review found. When the gap between two routes is small enough for a premium change to reverse it, the answer
        says so.
      </p>
      <p className="sub">
        The metric is SoSoValue&apos;s <i>reported closing premium/discount</i> (<code>prem_dsc</code>): the closing share
        price against NAV. Funds value NAV from a benchmark coin price taken at a different time than the closing trade, so
        part of the reported premium is timing, not a cost an investor pays. The test compares two end dates; it does not
        measure moves within the window, and it says nothing direct about selling after 1–24 months.
      </p>
      {both.map((r) => (
        <BacktestTable key={r.asset} r={r} />
      ))}

      <h2 id="trade">2. Prediction vs a real SoDEX fill</h2>
      {trades.length === 0 ? (
        <div className="card">
          <b>0 verified round trips so far.</b> The protocol, so that one small trade can be checked end to end:
          <ol className="notes" style={{ marginTop: 6 }}>
            <li>
              <a href={`${REPO_URL}/blob/main/scripts/predict-trade.mjs`}>scripts/predict-trade.mjs</a> saves the prediction,
              the code version and the full order book it used; the file is committed and pushed before the trade, so
              GitHub&apos;s timestamp shows it came first.
            </li>
            <li>A taker buy at market, then the bought quantity sold back at market, within seconds.</li>
            <li>
              <a href={`${REPO_URL}/blob/main/scripts/record-fill.mjs`}>scripts/record-fill.mjs</a> reads the fills from
              SoDEX&apos;s public account-trades endpoint and shows, per leg, predicted vs actual VWAP, quantity and the fee
              actually charged, plus USDC spent and returned and any BTC left from lot rounding. Failed or partial attempts
              are published too.
            </li>
          </ol>
          <span className="sub">
            A $20 trade fits inside the best price level, so it checks spread, side of the book, lot rounding and fees — not
            depth. Depth is shown from the live book on the Execution tab.
          </span>
        </div>
      ) : (
        trades.map((t) => <TradeTable key={t.predictionFile} t={t} />)
      )}

      <h2 id="limits">3. What history can&apos;t test</h2>
      <div className="card">
        <ul className="notes">
          <li>
            <b>SoDEX order books.</b> There is no public history of past books, so past SoDEX round-trip costs can&apos;t be
            rebuilt. Our <Link href="/journal">journal</Link> records the computed route costs once a day from 24 Nov 2026
            (not the books themselves).
          </li>
          <li>
            <b>Perp funding.</b> We found no public funding-history endpoint, so &ldquo;today&apos;s rate over the whole
            period&rdquo; can&apos;t be tested backwards. The page shows the cost at zero funding next to it.
          </li>
          <li>
            <b>Treasury company ratios.</b> SoSoValue&apos;s market-cap history doesn&apos;t reconcile with price × shares,
            so we don&apos;t chart those ratios over time.
          </li>
          <li>
            <b>{btc.sessions} sessions is short.</b> It covers one market regime. The numbers describe that window, not a
            guarantee.
          </li>
        </ul>
      </div>
    </>
  );
}
