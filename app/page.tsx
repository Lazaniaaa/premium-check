import { buildComparison, type Asset, type CompanyRow, type DirectRoute } from "@/lib/model";
import { bps, compactUsd, int, pct, ratio, signedPct, timeUtc, units, usd } from "@/lib/format";

// A cold cache needs ~100 paced SoSoValue requests; allow the first render time to finish.
export const maxDuration = 60;

type SP = Promise<Record<string, string | string[] | undefined>>;
const HORIZONS = [1, 3, 6, 12, 24];

function parse(sp: Record<string, string | string[] | undefined>) {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const asset: Asset = one("asset")?.toUpperCase() === "ETH" ? "ETH" : "BTC";
  const amount = Math.min(Math.max(Number(one("usd")) || 1000, 10), 1_000_000);
  const m = Number(one("months"));
  const months = HORIZONS.includes(m) ? m : 12;
  return { asset, amount, months };
}

const FLAG_TEXT: Record<string, string> = {
  fee_unverified: "fee reported as 0 — not ranked",
  book_too_thin: "visible order book too thin for this size",
  funding_varies: "funding changes hourly",
};

export default async function Page({ searchParams }: { searchParams: SP }) {
  const { asset, amount, months } = parse(await searchParams);
  const c = await buildComparison(asset, amount, months);
  const ranked = c.direct.filter((r) => r.cost != null);
  const best = ranked[0];
  const worst = ranked.at(-1);
  const sodexRoutes = c.direct.filter((r) => r.fill);
  const horizon = months === 1 ? "1 month" : `${months} months`;

  return (
    <>
      <h1>
        What does it really cost to hold {asset}?
      </h1>
      <p className="lede">
        Every way to own {asset} has a premium on top of the asset itself: ETF fees and premium to NAV, perp funding,
        DEX spread and fees — or, for treasury stocks, paying more (or less) than the {asset} the company holds. Premium
        Check puts them on one yardstick with live SoSoValue and SoDEX data.
      </p>

      <form className="card form" method="get">
        <label>
          Asset
          <select name="asset" defaultValue={asset}>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
          </select>
        </label>
        <label>
          Amount (USD)
          <input name="usd" type="number" min={10} max={1000000} step={10} defaultValue={amount} />
        </label>
        <label>
          Holding period
          <select name="months" defaultValue={String(months)}>
            {HORIZONS.map((h) => (
              <option key={h} value={h}>
                {h === 1 ? "1 month" : `${h} months`}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Compare</button>
      </form>

      {best && (
        <section className="card answer">
          <div className="muted">
            Cheapest way to hold {usd(amount)} of {asset} for {horizon}
          </div>
          <div className="big">
            {best.name}: {pct(best.cost)} total cost → you keep {units(best.units, asset)}
          </div>
          {worst && worst.id !== best.id && (
            <p>
              Most expensive direct route: <b>{worst.name}</b> at {pct(worst.cost)} (
              {usd(amount * (worst.cost! - best.cost!), 2)} more than the cheapest).
            </p>
          )}
          <div className="kpis">
            <div className="kpi">
              <div className="label">Reference price</div>
              <div className="value">{usd(c.reference.price, 2)}</div>
              <span className="sub">{c.reference.source}</span>
            </div>
            <div className="kpi">
              <div className="label">SoSoValue cross-check</div>
              <div className="value">{usd(c.reference.sosoPrice, 2)}</div>
              <span className="sub">difference {bps(c.reference.deviationBps)}</span>
            </div>
            <div className="kpi">
              <div className="label">{asset} at reference, no costs</div>
              <div className="value">{units(amount / c.reference.price, asset)}</div>
              <span className="sub">the 0% benchmark every route is measured against</span>
            </div>
          </div>
        </section>
      )}

      <h2>Direct exposure (tracks {asset} 1:1)</h2>
      <p className="lede">
        Total cost = trading cost (SoDEX: buy + sell into today's book vs its mid, fees included; ETFs: premium to NAV) + recurring cost × {horizon}. Ranked cheapest first.
      </p>
      <DirectTable rows={c.direct} asset={asset} bestId={best?.id} />

      {sodexRoutes.length > 0 && (
        <>
          <h2>SoDEX execution check for {usd(amount)}</h2>
          <div className="grid2">
            {sodexRoutes.map((r) => (
              <Ticket key={r.id} r={r} asset={asset} />
            ))}
          </div>
        </>
      )}

      {asset === "BTC" && <Companies rows={c.companies} />}

      <h2>Method and limits</h2>
      <div className="card">
        <ul className="notes">
          <li>Reference price: SoDEX {asset}-USD index price; SoSoValue price shown as an independent cross-check.</li>
          <li>SoDEX routes: buy {usd(amount)} and sell the same quantity into the live order book (100 levels), measured against that book's mid price, with tier-0 taker fees (0.065% spot, 0.04% perps) each way. A persistent gap between a market and the index is shown as a note, not counted as a gain — you get it back when you sell.</li>
          <li>Perp carry = current hourly funding × 8,760. It changes every hour; past funding is not a promise.</li>
          <li>ETF cost = latest premium/discount to NAV (SoSoValue ETF history) + sponsor fee. Brokerage fees and spread are not included. A fee SoSoValue reports as 0 is shown but not ranked.</li>
          <li>Treasury mNAV = share price × total shares ÷ (BTC held × BTC price). &ldquo;With debt&rdquo; adds debt and subtracts cash from the latest SoSoValue quarterly balance sheet; preferred stock is not in that data, so the official enterprise-value mNAV is higher.</li>
          <li>SoSoValue history is limited to 90 days for this API key; holdings come from company purchase disclosures and can be months old (flagged).</li>
          <li>Nothing here places orders. Execution numbers are a preview from the public order book.</li>
        </ul>
      </div>

      {c.errors.length > 0 && (
        <>
          <h2>Data warnings</h2>
          <div className="card">
            <ul className="notes">
              {c.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        </>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Generated {timeUtc(c.generatedAt)} · <a href="/diag">data status</a>
      </p>
    </>
  );
}

function DirectTable({ rows, asset, bestId }: { rows: DirectRoute[]; asset: string; bestId?: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Route</th>
            <th className="num">Trading cost / premium</th>
            <th className="num">Recurring / year</th>
            <th className="num">Total cost</th>
            <th className="num">{asset} you keep</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.id === bestId ? "best" : undefined}>
              <td className="muted">{r.cost != null ? i + 1 : "—"}</td>
              <td>
                {r.name}
                <span className="sub">{r.provider}</span>
              </td>
              <td className="num">{signedPct(r.entryPremium, 3)}</td>
              <td className={`num ${r.annualCarry != null && r.annualCarry > 0.02 ? "bad" : ""}`}>
                {r.annualCarry == null ? "n/a" : pct(r.annualCarry)}
              </td>
              <td className="num">
                <b>{pct(r.cost)}</b>
              </td>
              <td className="num">{units(r.units, asset)}</td>
              <td>
                {r.flags.map((f) => (
                  <span key={f} className="chip warn">
                    {FLAG_TEXT[f]}
                  </span>
                ))}
                <span className="sub">{r.notes.join(" · ")}</span>
                <span className="sub">
                  Source: {r.source}
                  {r.asOf ? ` · ${r.asOf.length > 10 ? timeUtc(r.asOf) : r.asOf}` : ""}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ticket({ r, asset }: { r: DirectRoute; asset: string }) {
  const f = r.fill!;
  return (
    <div className="card">
      <b>{r.name}</b>
      <table style={{ marginTop: 8 }}>
        <tbody>
          <tr>
            <td>Fills</td>
            <td className="num">
              {usd(f.filledUsd, 2)} of {usd(f.requestedUsd, 2)} {f.complete ? "" : "(book exhausted)"}
            </td>
          </tr>
          <tr>
            <td>Quantity</td>
            <td className="num">{units(f.qty, asset)}</td>
          </tr>
          <tr>
            <td>Best ask → VWAP</td>
            <td className="num">
              {usd(f.bestPrice, 2)} → {usd(f.vwap, 2)}
            </td>
          </tr>
          <tr>
            <td>Slippage</td>
            <td className="num">{bps(f.slippageBps)}</td>
          </tr>
          <tr>
            <td>Taker fee</td>
            <td className="num">{pct(f.feeRate, 3)}</td>
          </tr>
          <tr>
            <td>Max size within 10 bps</td>
            <td className="num">{compactUsd(f.maxUsdWithin10bps)}</td>
          </tr>
        </tbody>
      </table>
      <span className="sub">Preview only — no order is signed or sent.</span>
    </div>
  );
}

function Companies({ rows }: { rows: CompanyRow[] }) {
  const pure = rows.filter((r) => r.kind !== "operating");
  const ops = rows.filter((r) => r.kind === "operating");
  return (
    <>
      <h2>Indirect exposure: companies holding BTC</h2>
      <p className="lede">
        mNAV below 1× means the stock is priced below the bitcoin the company holds; above 1× means you pay a premium.
        This is equity, not BTC: debt, dilution and the business itself move the price. US listings with at least 1,000
        BTC; prices switch to SoDEX 24/7 perps when the US market is closed.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th className="num">BTC held</th>
              <th className="num">Price</th>
              <th className="num">mNAV (equity)</th>
              <th className="num">mNAV (with debt)</th>
              <th className="num">BTC per $1,000</th>
              <th>Last purchase</th>
            </tr>
          </thead>
          <tbody>
            {pure.map((r) => (
              <tr key={r.ticker}>
                <td>
                  <b>{r.ticker}</b> {r.name}
                  <span className="sub">{r.kind === "miner" ? "miner — part of value is the mining business" : "treasury company"}</span>
                </td>
                <td className="num">
                  {int(r.btcHolding)}
                  <span className="sub">
                    as of {r.holdingsAsOf}
                    {r.stale ? " · stale" : ""}
                  </span>
                </td>
                <td className="num">
                  {usd(r.price, 2)}
                  <span className="sub">
                    {r.priceSource === "sodex_24_7" ? `SoDEX ${r.sodexSymbol} (24/7)` : `exchange · ${r.marketStatus}`}
                  </span>
                </td>
                <td className={`num ${r.mnavEquity != null && r.mnavEquity < 1 ? "good" : ""}`}>
                  <b>{ratio(r.mnavEquity)}</b>
                </td>
                <td className="num">
                  {ratio(r.mnavWithDebt)}
                  <span className="sub">{r.balanceAsOf ? `balance ${r.balanceAsOf}` : "no balance data"}</span>
                </td>
                <td className="num">{r.btcPer1000 != null ? r.btcPer1000.toFixed(5) : "—"}</td>
                <td>
                  {r.lastBuy ? (
                    <>
                      {r.lastBuy.date}: +{int(r.lastBuy.btc)} BTC
                      <span className="sub">{r.lastBuy.usdPerBtc ? `at ${usd(r.lastBuy.usdPerBtc)}/BTC` : ""}</span>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ops.length > 0 && (
        <>
          <h2>Operating companies with BTC on the balance sheet</h2>
          <p className="lede">mNAV is meaningless here — BTC is a small part of the business. Shown: what share of market cap the BTC represents.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="num">BTC held</th>
                  <th className="num">BTC share of market cap</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((r) => (
                  <tr key={r.ticker}>
                    <td>
                      <b>{r.ticker}</b> {r.name}
                    </td>
                    <td className="num">
                      {int(r.btcHolding)}
                      <span className="sub">
                        as of {r.holdingsAsOf}
                        {r.stale ? " · stale" : ""}
                      </span>
                    </td>
                    <td className="num">{pct(r.btcShareOfMcap, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
