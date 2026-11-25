import Link from "next/link";
import { premiumBacktest, type Backtest, type Stats, type TradeRecord } from "@/lib/validation";
import { REPO_URL } from "@/lib/reports-store";
import { bps, timeUtc, usd } from "@/lib/format";
import tradesJson from "@/data/validation/trades.json";

export const maxDuration = 60;
export const metadata = { title: "Premium Check — validation" };

const trades = tradesJson as TradeRecord[];
const b = (x: number | null | undefined) => bps(x == null ? null : x * 1e4);
const NAMES = { unchanged: "stays the same (our cost rule)", zero: "returns to zero", pastMedian: "returns to the fund's past median" };

function Cell({ s, best }: { s: Stats; best?: boolean }) {
  return (
    <td style={best ? { fontWeight: 600 } : undefined}>
      {b(s.median)} <span className="muted">/ {b(s.p90)}</span>
    </td>
  );
}

function BacktestTable({ r }: { r: Backtest }) {
  return (
    <>
      <h3>
        {r.asset}: {r.funds.length} US spot ETFs, {r.from} → {r.to}
      </h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sold after</th>
              <th>Premium stays the same (our rule)</th>
              <th>Returns to zero</th>
              <th>Returns to past median</th>
              <th>Gap between two funds</th>
              <th>Samples</th>
            </tr>
          </thead>
          <tbody>
            {r.horizons.map((h) => {
              const min = Math.min(h.unchanged.p90 ?? 1, h.zero.p90 ?? 1, h.pastMedian.p90 ?? 1);
              return (
                <tr key={h.days}>
                  <td>{h.days === 1 ? "1 trading day" : `${h.days} trading days`}</td>
                  <Cell s={h.unchanged} best={h.unchanged.p90 === min} />
                  <Cell s={h.zero} best={h.zero.p90 === min} />
                  <Cell s={h.pastMedian} best={h.pastMedian.p90 === min} />
                  <Cell s={h.pairwise} />
                  <td className="muted">{h.unchanged.n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="sub">Each cell: typical error (median) / error in 9 of 10 cases (p90). Lowest p90 in bold.</p>
    </>
  );
}

export default async function Validation() {
  const [btc, eth] = await Promise.all([premiumBacktest("BTC"), premiumBacktest("ETH")]);
  const both = [btc, eth];
  const stillUnchanged = both.filter((r) => r.bestAssumption === "unchanged").length;
  // Figures for the conclusions, all at the longest horizon the history allows.
  const at = (r: Backtest) => r.horizons.find((h) => h.days === r.noiseDays) ?? null;
  const pairCalmer = both.filter((r) => {
    const h = at(r);
    return h && h.pairwise.p90! < h.unchanged.p90!;
  });
  const gain = (r: Backtest) => {
    const h = at(r);
    if (!h || !r.bestAssumption || r.bestAssumption === "unchanged") return null;
    const alt = h[r.bestAssumption];
    return { name: NAMES[r.bestAssumption], median: h.unchanged.median! - alt.median!, p90: h.unchanged.p90! - alt.p90! };
  };

  return (
    <>
      <h1>Validation: does the method hold up?</h1>
      <p className="lede">
        Premium Check is new in Wave 3, so it has no long track record. Instead, this page tests the method two ways: against
        30 days of history that SoSoValue already holds, and against a real trade on SoDEX. It also says what can&apos;t be
        tested.
      </p>

      <h2 id="premium">1. The ETF exit premium, tested on 30 days of history</h2>
      <p>
        An ETF trades a little above or below the value of the coins it holds (its premium or discount). Nobody knows the
        premium on the day you sell, so the cost rule assumes it <b>stays the same</b>: no gain or loss from it. Here is how
        wrong that assumption was. For every fund and every start day, we compare the premium when you buy with the premium
        when you sell, using SoSoValue&apos;s daily history. We also test two other assumptions.
      </p>
      {both.map((r) => (
        <BacktestTable key={r.asset} r={r} />
      ))}

      <div className="card answer">
        <b>What we learned</b>
        <ul className="notes" style={{ color: "var(--text)", marginTop: 6 }}>
          {both.map((r) =>
            r.noise != null ? (
              <li key={r.asset}>
                {r.asset} ETFs: within {r.noiseDays} trading days, the premium moved by up to <b>{b(r.noise)}</b> in 9 of 10
                cases ({r.noiseDays} trading days is the longest window the 30-day history allows). Gaps between routes
                smaller than that can go either way.
              </li>
            ) : (
              <li key={r.asset}>{r.asset}: not enough history to measure.</li>
            ),
          )}
          {stillUnchanged === 2 ? (
            <li>Assuming the premium stays the same had the lowest error of the three assumptions for both assets.</li>
          ) : (
            <li>
              Our rule was not the most accurate.{" "}
              {both.map((r) => {
                const g = gain(r);
                return g ? (
                  <span key={r.asset}>
                    For {r.asset}, &ldquo;{g.name}&rdquo; cut the typical error by {b(g.median)} and the 9-in-10 error by{" "}
                    {b(g.p90)}.{" "}
                  </span>
                ) : null;
              })}
              We kept our rule for the cost: switching would turn today&apos;s discount into a predicted profit, the error the
              first review caught, while the typical gain is a few bps. Instead, the answer now warns when routes are closer
              than this noise.
            </li>
          )}
          <li>
            {pairCalmer.length === 2
              ? "The gap between two funds moved less than each premium alone: premiums of different funds tend to move together, so rankings between ETFs are a little more stable than their absolute costs."
              : pairCalmer.length === 1
                ? `For ${pairCalmer[0].asset} the gap between two funds moved less than each premium alone (funds tend to move together); for ${both.find((r) => !pairCalmer.includes(r))!.asset} it did not, so a ranking between those ETFs is as uncertain as their costs.`
                : "The gap between two funds moved about as much as each premium alone, so a ranking between ETFs is as uncertain as their costs."}
          </li>
        </ul>
        <span className="sub">
          Reconstructed from SoSoValue <code>/etfs/&#123;ticker&#125;/history</code> when this page was built (
          {timeUtc(btc.generatedAt)}); not recorded by us at the time. The same funds and cache as the main page.{" "}
          <a href="/api/validation">Download JSON</a> · <a href={`${REPO_URL}/blob/main/lib/validation.ts`}>code</a> ·{" "}
          <a href={`${REPO_URL}/blob/main/tests/validation.test.ts`}>tests</a>
        </span>
      </div>

      <h2 id="trade">2. Prediction vs a real SoDEX fill</h2>
      <p>
        Right before a real trade, a script saves what Premium Check predicts for the round trip (buy, then sell straight back)
        together with the order book it used. The real fills come from SoDEX&apos;s public account trades endpoint, so anyone
        can check them.
      </p>
      {trades.length === 0 ? (
        <div className="card">
          <b>Not recorded yet.</b>{" "}
          <span className="muted">
            The prediction script is <a href={`${REPO_URL}/blob/main/scripts/predict-trade.mjs`}>scripts/predict-trade.mjs</a>.
          </span>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trade</th>
                <th>Buy price (VWAP)</th>
                <th>Sell price (VWAP)</th>
                <th>Round-trip cost</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.predictionFile}>
                  <td>
                    {usd(t.usd)} {t.symbol}
                    <div className="sub">
                      predicted {timeUtc(t.predictedAt)}, traded {timeUtc(t.tradedAt)}
                    </div>
                  </td>
                  <td>
                    predicted {t.predicted.buyVwap.toFixed(2)}
                    <div>actual {t.actual.buyVwap.toFixed(2)}</div>
                  </td>
                  <td>
                    predicted {t.predicted.sellVwap.toFixed(2)}
                    <div>actual {t.actual.sellVwap.toFixed(2)}</div>
                  </td>
                  <td>
                    predicted {b(t.predicted.roundTripCost)} ({usd(t.predicted.roundTripUsd, 4)})
                    <div>
                      <b>
                        actual {b(t.actual.roundTripCost)} ({usd(t.actual.roundTripUsd, 4)})
                      </b>
                    </div>
                    {t.note && <div className="sub">{t.note}</div>}
                  </td>
                  <td>
                    <a href={`${REPO_URL}/blob/main/${t.predictionFile}`}>prediction + book</a>
                    <div>
                      <a href={`https://mainnet-gw.sodex.dev/api/v1/spot/accounts/${t.account}/trades`}>fills on SoDEX</a>
                    </div>
                    <div className="sub">trade ids {t.tradeIds.join(", ")}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 id="limits">3. What history can&apos;t test</h2>
      <div className="card">
        <ul className="notes">
          <li>
            <b>SoDEX order books.</b> There is no public history of past books, so past SoDEX round-trip costs can&apos;t be
            rebuilt. Our own <Link href="/journal">journal</Link> records them once a day from 24 Nov 2026.
          </li>
          <li>
            <b>Perp funding.</b> We found no public funding-history endpoint, so the &ldquo;today&apos;s rate over the whole
            period&rdquo; assumption can&apos;t be tested backwards. The page shows the cost at zero funding next to it.
          </li>
          <li>
            <b>Treasury company ratios.</b> SoSoValue&apos;s market-cap history doesn&apos;t reconcile with price × shares,
            so we don&apos;t chart those ratios over time.
          </li>
          <li>
            <b>Thirty days is short.</b> It covers one market regime. The numbers above describe that window, not a guarantee.
          </li>
        </ul>
      </div>
    </>
  );
}
