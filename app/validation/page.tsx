import Link from "next/link";
import {
  afterFile,
  datasetFile,
  fundingFile,
  fundingTest,
  premiumBacktest,
  premiumOutOfSample,
  type OutOfSample,
  trades,
  type Backtest,
  type ErrorStats,
  type FundingTest,
  type Stats,
  type TradeRecord,
} from "@/lib/validation";
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

const p1 = (x: number | null | undefined) => (x == null ? "—" : pct(x, 1));
const monthYear = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "—";

function Miss({ e, best }: { e: ErrorStats; best?: boolean }) {
  return (
    <td style={best ? { fontWeight: 600 } : undefined}>
      {p1(e.medianAbs)} <span className="muted">/ {p1(e.p90Abs)}</span>
    </td>
  );
}

function FundingTable({ r }: { r: FundingTest }) {
  const last = r.horizons.at(-1)!;
  return (
    <>
      <h3>
        {r.asset}-USD perp on {r.venue} · {r.hours.toLocaleString("en-US")} hours, {monthYear(r.from)} – {monthYear(r.to)}
      </h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Held for</th>
              <th>Cumulative funding, constant $ position</th>
              <th>Starting hourly rate × period (our rule)</th>
              <th>No funding</th>
              <th>Past 30-day average</th>
            </tr>
          </thead>
          <tbody>
            {r.horizons.map((h) => (
              <tr key={h.months}>
                <td>
                  {h.months === 1 ? "1 month" : `${h.months} months`}
                  <div className="sub">
                    {h.starts} daily starts · {h.independent} non-overlapping window{h.independent === 1 ? "" : "s"}
                  </div>
                </td>
                <td>
                  {p1(h.actual.median)}
                  <div className="sub">
                    {p1(h.actual.p10)} – {p1(h.actual.p90)}
                  </div>
                </td>
                <Miss e={h.today} best={h.best === "today"} />
                <Miss e={h.zero} best={h.best === "zero"} />
                <Miss e={h.trailing30} best={h.best === "trailing30"} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub">
        Cumulative funding: the sum of hourly rates over the period, i.e. what a long of a constant dollar size pays, in % of
        that size (the site books perp carry the same way; a holder of a fixed coin amount pays more in dollars if the price
        rises). Median, and p10 – p90 below it. Other cells: typical miss (median) / miss exceeded in 1 of 10 historical starts
        (p90) of |cumulative − predicted|; lowest p90 in bold. These describe past starts on this venue, not a probability for
        your position. One start per day at 00:00
        UTC; the &ldquo;starting rate&rdquo; is the last settled hour. Starts overlap heavily — only {last.independent}{" "}
        non-overlapping {last.months}-month window{last.independent === 1 ? " fits" : "s fit"} in this history — so the long
        horizons describe very few market paths. {r.dropped} early hours were dropped (the venue did not yet
        settle every hour); {r.filled} isolated missing hours repeat the previous hour.
      </p>
    </>
  );
}

function OutOfSampleTable({ rows, frozenAt, sessions }: { rows: OutOfSample[]; frozenAt: string; sessions: number }) {
  const r0 = rows[0];
  return (
    <>
      <h3 id="new-close">Out of sample: the first close after the dataset was frozen ({r0.exitDates.map(day).join(", ")})</h3>
      <p>
        The p90s above were frozen at {ms(frozenAt)}, before that day&apos;s US close. We then fetched the same SoSoValue
        history again ({ms(r0.fetchedAt)}) and checked every fund on the new close: did its premium move by more than the
        frozen p90 for that horizon?
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Asset · sold after</th>
              <th>Frozen p90 (our rule)</th>
              <th>Funds that moved more</th>
              <th>Median · largest move</th>
              <th>&ldquo;Sold at NAV&rdquo;: over its p90</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((o) =>
              o.horizons.map((h) => (
                <tr key={`${o.asset}-${h.days}`}>
                  <td>
                    {o.asset} · {h.days === 1 ? "1 session" : `${h.days} sessions`}
                  </td>
                  <td>{b(h.threshold)}</td>
                  <td style={h.exceeded * 2 > h.n ? { fontWeight: 600 } : undefined}>
                    {h.exceeded} of {h.n}
                  </td>
                  <td>
                    {b(h.median)} <span className="muted">· {h.max ? `${h.max.ticker} ${b(h.max.move)}` : "—"}</span>
                  </td>
                  <td>
                    {h.navExceeded} of {h.n} <span className="muted">(p90 {b(h.navThreshold)})</span>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <p className="sub">
        One new date: the funds share the market move, so this is one event, not {rows.reduce((n, o) => n + (o.horizons[0]?.n ?? 0), 0)}{" "}
        independent checks, and for 5 and 10 sessions the start lies inside the frozen sample. A p90 allows 1 in
        10; when most funds exceed it, the {sessions}-session sample did not contain a move like this one. None of the{" "}
        {rows.reduce((n, o) => n + o.shared, 0)} values the two copies share was revised ({rows.reduce((n, o) => n + o.revised, 0)}{" "}
        changes). Later copy: <a href={`${REPO_URL}/blob/main/${afterFile}`}>{afterFile}</a>. US markets were closed on 26 Nov.
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
  const fund = [fundingTest("BTC"), fundingTest("ETH")];
  const oos = [premiumOutOfSample("BTC"), premiumOutOfSample("ETH")];
  const oos5 = oos.map((o) => o.horizons.find((h) => h.days === 5)!);
  const oos10 = oos.map((o) => o.horizons.find((h) => h.days === 10)!);
  const year = fund.map((r) => ({ asset: r.asset, h: r.horizons.find((h) => h.months === 12)! }));

  return (
    <>
      <h1>Validation: does the method hold up?</h1>

      <section className="card answer">
        <b>Result</b>
        <ul className="notes" style={{ color: "var(--text)", marginTop: 6 }}>
          <li>
            We tested two assumptions of the cost rule. First, an ETF&apos;s premium to NAV is the same when you sell as when
            you buy — on {btc.sessions} trading sessions ({day(btc.from)} – {day(btc.to)}) for every US spot BTC and ETH ETF.
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
            <b>Perp funding</b>, tested on {fund[0].venue}&apos;s hourly history ({monthYear(fund[0].from)} –{" "}
            {monthYear(fund[0].to)}) because SoDEX publishes none: over 12 months, our rule — the starting hourly rate × the
            period — missed cumulative funding on a constant dollar position by more than{" "}
            {year.map((y, i) => (
              <span key={y.asset}>
                {i ? " / " : ""}
                <b>{p1(y.h.today.p90Abs)}</b>
              </span>
            ))}{" "}
            of the amount (BTC / ETH) in 1 of 10 historical starts (typical miss{" "}
            {year.map((y) => p1(y.h.today.medianAbs)).join(" / ")}). A past 30-day average would have cut the 1-in-10 miss
            to {year.map((y) => p1(y.h.trailing30.p90Abs)).join(" / ")}. So the perp cost is the least certain number on the
            site; the answer now shows the funding rate at which the perp would win, and how often this history averaged
            below it.
          </li>
          <li>
            <b>First close after freezing ({oos[0].exitDates.map(day).join(", ")}):</b> after 5 sessions the premium moved by
            more than the frozen p90 in <b>{oos5[0].exceeded} of {oos5[0].n}</b> BTC and{" "}
            <b>{oos5[1].exceeded} of {oos5[1].n}</b> ETH funds (after 10 sessions: {oos10[0].exceeded}/{oos10[0].n} and{" "}
            {oos10[1].exceeded}/{oos10[1].n}). The funds moved together, so this is one market event — but it shows the p90s
            from 22 sessions understate a day like this, for &ldquo;sold at NAV&rdquo; as much as for our rule.{" "}
            <a href="#new-close">Details</a>
          </li>
          <li>
            <b>Real-trade check:</b>{" "}
            {trades.length === 0
              ? "0 verified round trips so far · the protocol is below."
              : `${trades.length} verified SoDEX round trip${trades.length > 1 ? "s" : ""} · see section 3.`}
          </li>
        </ul>
        <span className="sub">
          Frozen datasets: <a href={`${REPO_URL}/blob/main/${datasetFile}`}>{datasetFile}</a> ({ms(btc.frozenAt)}),{" "}
          <a href={`${REPO_URL}/blob/main/${fundingFile}`}>{fundingFile}</a> ({ms(fund[0].frozenAt)}). Re-run
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
      <OutOfSampleTable rows={oos} frozenAt={btc.frozenAt} sessions={btc.sessions} />

      <h2 id="funding">2. Perp funding</h2>
      <p>
        A perp&apos;s cost over months is mostly funding, and the ranking uses the hourly rate SoDEX reports now as if it held
        for the whole period (the cost at zero funding is shown next to it). SoDEX publishes no history of market funding
        rates — only each account&apos;s own payments — so we tested the same kind of assumption on {fund[0].venue}, which
        also settles funding every hour and publishes its full history.
      </p>
      <p className="sub">
        This is another venue: its funding formula and levels differ from SoDEX&apos;s, so the amounts paid below are not
        SoDEX&apos;s. What carries over is how far a single hourly rate can be from what a long period ends up costing.
        Source: Hyperliquid&apos;s public <code>fundingHistory</code> endpoint, frozen by{" "}
        <a href={`${REPO_URL}/blob/main/scripts/freeze-funding-history.mjs`}>scripts/freeze-funding-history.mjs</a>.
      </p>
      {fund.map((r) => (
        <FundingTable key={r.asset} r={r} />
      ))}
      <p>
        What changed: the answer now gives the break-even funding — the average rate a year at which the perp costs the same
        as the cheapest other route, (that route&apos;s cost − perp cost at zero funding) ÷ years — next to today&apos;s rate,
        and how many {fund[0].venue} windows of your holding period averaged below it. Example on 26 Nov 2026: $1,000 of BTC for 12 months
        with SoDEX spot at about $1.32 and the perp at $0.82 before funding gives about 0.05% a year. We keep the rule
        itself: a 30-day average needs a funding history SoDEX doesn&apos;t publish, and on this sample it was not the best
        at 12–24 months either.
      </p>

      <h2 id="trade">3. Prediction vs a real SoDEX fill</h2>
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

      <h2 id="limits">4. What history can&apos;t test</h2>
      <div className="card">
        <ul className="notes">
          <li>
            <b>SoDEX order books.</b> There is no public history of past books, so past SoDEX round-trip costs can&apos;t be
            rebuilt. Our <Link href="/journal">journal</Link> records the computed route costs once a day from 24 Nov 2026
            (not the books themselves).
          </li>
          <li>
            <b>SoDEX funding itself.</b> SoDEX has no public history of market funding rates, so section 2 uses another
            venue. Our journal records SoDEX&apos;s rate once a day from 24 Nov 2026.
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
