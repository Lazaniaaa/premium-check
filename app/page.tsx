import { buildComparison, type Asset, type CompanyRow, type Comparison, type DirectRoute } from "@/lib/model";
import { bps, compactUsd, int, pct, ratio, signedPct, timeUtc, units, usd } from "@/lib/format";
import { ROUTE_GROUPS, type RouteGroup } from "@/lib/query";
import { latestReport, REPO_URL } from "@/lib/reports-store";

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
  const exclude = (one("exclude") ?? "")
    .split(",")
    .filter((x): x is RouteGroup => (ROUTE_GROUPS as readonly string[]).includes(x));
  return { asset, amount, months, exclude, q: one("q")?.slice(0, 200) ?? "", qerr: one("qerr") ?? "" };
}

const GROUP_TEXT: Record<RouteGroup, string> = {
  sodex_spot: "SoDEX spot",
  sodex_perp: "perps",
  etf: "ETFs",
  treasury_stock: "treasury stocks",
};

const FLAG_TEXT: Record<string, string> = {
  fee_unverified: "fee reported as 0 — not ranked",
  small_fund: "fund under $100M — spread may exceed the fee edge; not ranked",
  staking_unmodeled: "staking ETF — yield and fee waiver not modelled; not ranked",
  funding_unavailable: "funding rate unavailable; not ranked",
  book_too_thin: "order book too thin for this amount; not ranked",
  funding_varies: "funding changes hourly",
};

export default async function Page({ searchParams }: { searchParams: SP }) {
  const { asset, amount, months, exclude, q, qerr } = parse(await searchParams);
  const [full, report] = await Promise.all([buildComparison(asset, amount, months), latestReport()]);
  const c = { ...full, direct: full.direct.filter((r) => !exclude.includes(r.kind)) };
  const ranked = c.direct.filter((r) => r.ranked);
  const best = ranked[0];
  const worst = ranked.at(-1);
  // Differences smaller than this are inside what the model leaves out (spreads, commissions).
  const TIE = 0.001;
  const tied = best ? ranked.filter((r) => r.id !== best.id && r.cost! - best.cost! < TIE) : [];
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

      <form className="card form ask" method="get" action="/ask">
        <label style={{ flex: 1 }}>
          Ask in your own words
          <input name="q" defaultValue={q} maxLength={200} placeholder="e.g. 5k in ether for half a year, no broker" />
        </label>
        <button type="submit">Ask</button>
        {q && !qerr && (
          <span className="sub" style={{ width: "100%" }}>
            Understood as: {asset}, {usd(amount)}, {horizon}
            {exclude.length ? `, without ${exclude.map((x) => GROUP_TEXT[x]).join(", ")}` : ""}. The AI only fills in this
            form; every number below is calculated by code.
          </span>
        )}
        {qerr && (
          <span className="sub bad" style={{ width: "100%" }}>
            {qerr === "notunderstood" ? "That doesn't look like a question about holding BTC or ETH." : "The AI parser is unavailable right now — use the form below."}
          </span>
        )}
      </form>

      <form className="card form" method="get" style={{ marginTop: 12 }}>
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
        {exclude.length > 0 && <input type="hidden" name="exclude" value={exclude.join(",")} />}
        <button type="submit">Compare</button>
        {exclude.length > 0 && (
          <span className="sub">
            Excluding {exclude.map((x) => GROUP_TEXT[x]).join(", ")} · <a href={`/?asset=${asset}&usd=${amount}&months=${months}`}>show all</a>
          </span>
        )}
      </form>

      {best && (
        <section className="card answer">
          <div className="muted">
            Cheapest way to hold {usd(amount)} of {asset} for {horizon}
          </div>
          <div className="big">
            {best.name}: {pct(best.cost)} total cost ≈ {usd(amount * best.cost!, 2)}
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            About {units(best.units, asset)}-equivalent kept at today&apos;s price (for ETFs and perps this is price
            exposure, not coins in your wallet).
          </p>
          {tied.length > 0 && (
            <p>
              Effectively tied (within 0.1 pp, i.e. less than {usd(amount * TIE, 2)}):{" "}
              {tied.map((t) => `${t.name.split(" — ")[0]} ${pct(t.cost)}`).join(", ")}. At this gap, your broker&apos;s
              commission or the spread can decide the winner.
            </p>
          )}
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
              <span className="sub">the 0% benchmark; costs are measured in money, at a constant price</span>
            </div>
          </div>
        </section>
      )}

      <h2>Direct exposure (tracks {asset} 1:1)</h2>
      <p className="lede">
        Total cost = round-trip trading cost + recurring cost × {horizon}, as a share of the money you put in. SoDEX: buy
        and sell into today&apos;s order book, fees both ways. ETFs: sponsor fee; today&apos;s premium to NAV is shown as
        entry-timing risk and assumed unchanged when you sell (the same rule as a SoDEX market&apos;s gap to the index).
        Ranked cheapest first.
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

      {asset === "BTC" && !exclude.includes("treasury_stock") && <Companies rows={c.companies} coverage={c.coverage} />}

      {report && <DailyNote report={report} />}

      <h2>Method and limits</h2>
      <div className="card">
        <ul className="notes">
          <li>Reference price: SoDEX {asset}-USD index price; SoSoValue price shown as an independent cross-check.</li>
          <li>SoDEX round trip = 1 − (sell VWAP × (1 − fee)) ÷ (buy VWAP × (1 + fee)) for {usd(amount)} against the live order book (100 levels), tier-0 taker fees 0.065% spot / 0.04% perps. It is today&apos;s friction; tomorrow&apos;s book may differ.</li>
          <li>Gaps to a reference — an ETF&apos;s premium to NAV, a SoDEX market&apos;s gap to the index — are treated the same way for every route: shown, and assumed unchanged when you sell. If they change, the result changes by that amount.</li>
          <li>Perp carry = current hourly funding × 8,760, i.e. what a year would cost if today&apos;s rate never changed. Funding resets every hour; the row also shows the cost at zero funding.</li>
          <li>ETF cost = sponsor fee × holding period. Your broker&apos;s commission and the ETF&apos;s bid/ask spread are not included. Not ranked, but shown: a fee SoSoValue reports as 0, funds under $100M in net assets (a rule of thumb for thin trading), staking ETFs whose yield and fee waivers are not modelled, and any route the order book cannot fill.</li>
          <li>Company ratios: market cap ÷ BTC value, and (market cap + debt − cash) ÷ BTC value with debt and cash from the latest SoSoValue quarterly balance sheet. Preferred stock and dilution are not in that data, so these are simple ratios, not Strategy&apos;s own mNAV (since 23 Jul 2026 Strategy defines mNAV from net bitcoin per share after senior claims).</li>
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
            <th className="num">Round-trip trading cost</th>
            <th className="num">Recurring / year</th>
            <th className="num">Total cost</th>
            <th className="num">{asset}-equivalent kept*</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.id === bestId ? "best" : undefined}>
              <td className="muted">{r.ranked ? i + 1 : "—"}</td>
              <td>
                {r.name}
                <span className="sub">{r.provider}</span>
              </td>
              <td className="num">
                {r.kind === "etf" ? <span className="muted">not incl.</span> : pct(r.tradingCost, 3)}
                {r.premiumNow != null && (
                  <span className="sub">{r.kind === "etf" ? "premium to NAV" : "vs index"} {signedPct(r.premiumNow, 3)}</span>
                )}
              </td>
              <td className={`num ${r.annualCarry != null && r.annualCarry > 0.02 ? "bad" : ""}`}>
                {r.annualCarry == null ? "n/a" : pct(r.annualCarry)}
              </td>
              <td className="num">
                <b>{pct(r.cost)}</b>
                {r.costAtZeroFunding != null && <span className="sub">{pct(r.costAtZeroFunding)} at zero funding</span>}
              </td>
              <td className="num">
                {r.fillableUsd != null ? <span className="bad">book fills {usd(r.fillableUsd)} only</span> : units(r.units, asset)}
              </td>
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
      <p className="muted" style={{ fontSize: 12, margin: "6px 10px" }}>
        * What your money is worth in {asset} at today&apos;s price after costs. ETFs and perps give you a price exposure,
        not coins in a wallet.
      </p>
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
            <td>Largest order with average price ≤ 10 bps above best ask</td>
            <td className="num">{compactUsd(f.maxUsdVwapWithin10bps)}</td>
          </tr>
        </tbody>
      </table>
      {r.ticket ? (
        <>
          <p style={{ margin: "10px 0 6px" }}>
            <a className="btn-link" href={r.ticket.tradeUrl} target="_blank" rel="noreferrer">
              Open this market on SoDEX ↗
            </a>
          </p>
          {r.ticket.warnings.map((w) => (
            <span key={w} className="chip warn">
              {w}
            </span>
          ))}
          <details>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
              The order you would sign: IOC limit buy {r.ticket.quantity} at {r.ticket.limitPrice} (at most{" "}
              {usd(r.ticket.maxSpend, 2)} with fee)
            </summary>
            <pre>{`${r.ticket.endpoint}
${JSON.stringify(r.ticket.body, null, 2)}`}</pre>
            <span className="sub">
              Built from the live book and the market&apos;s tick/step size: the limit never exceeds best ask + 0.5%,
              and quantity × limit × (1 + fee) never exceeds your amount. You sign it with your own SoDEX API key
              (EIP-712); this site never asks for keys and sends nothing.
            </span>
          </details>
        </>
      ) : (
        <span className="sub">Preview only — no order is signed or sent.</span>
      )}
    </div>
  );
}

function Companies({ rows, coverage }: { rows: CompanyRow[]; coverage: Comparison["coverage"] }) {
  const pure = rows.filter((r) => r.kind !== "operating");
  const ops = rows.filter((r) => r.kind === "operating");
  return (
    <>
      <h2>Indirect exposure: companies holding BTC</h2>
      <p className="lede">
        How much the market pays for each dollar of bitcoin on the balance sheet. A ratio below 1× does not mean cheap
        bitcoin: debt and preferred stock rank ahead of shareholders, so compare both columns. This is equity, not BTC —
        dilution and the business itself move the price. US listings with at least 1,000 BTC; when the US market is
        closed, the price comes from the SoDEX 24/7 perp where one exists (a proxy, not the exchange price).
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th className="num">BTC held</th>
              <th className="num">Price</th>
              <th className="num">Market cap ÷ BTC value</th>
              <th className="num">(Market cap + debt − cash) ÷ BTC value</th>
              <th className="num">Gross BTC per $1,000 of stock</th>
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
                    {r.sodexUrl && (
                      <>
                        {" · "}
                        <a href={r.sodexUrl} target="_blank" rel="noreferrer">
                          trade on SoDEX ↗
                        </a>
                      </>
                    )}
                  </span>
                </td>
                <td className="num">
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

      {coverage && (
        <p className="muted" style={{ fontSize: 13 }}>
          Coverage: {coverage.shown} shown of {coverage.listed} US-listed companies in SoSoValue&apos;s BTC treasury list
          ({coverage.queried} held ≥ 1,000 BTC when checked).
          {coverage.noStockData.length > 0 && ` No SoSoValue stock price for ${coverage.noStockData.join(", ")}, so they can't be valued.`}
          {coverage.missing.length > 0 && ` Data unavailable right now for ${coverage.missing.join(", ")}.`}
        </p>
      )}

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

function DailyNote({ report }: { report: NonNullable<Awaited<ReturnType<typeof latestReport>>> }) {
  const byId = new Map(report.facts.map((f) => [f.id, f.text]));
  const a = report.author;
  return (
    <>
      <h2>Daily Premium Report · {report.day}</h2>
      <p className="lede">
        A general note for $1,000 held 12 months, written once a day — not for the amount and period you chose above.
      </p>
      <div className="card">
        <div className="big" style={{ fontSize: 17, fontWeight: 650, marginBottom: 6 }}>
          {report.note.headline}
        </div>
        <ul className="notes" style={{ color: "var(--text)", fontSize: 14 }}>
          {report.note.points.map((p, i) => (
            <li key={i}>
              {p.text}{" "}
              {p.facts.map((f) => (
                <span key={f} className="chip" title={byId.get(f)}>
                  {f}
                </span>
              ))}
            </li>
          ))}
        </ul>
        <details style={{ marginTop: 8 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
            How this note is made: facts and checks
          </summary>
          <p className="muted" style={{ fontSize: 13 }}>
            Our code computes the facts below from that day&apos;s snapshot.{" "}
            {a.kind === "llm"
              ? `${a.model} turned them into prose; a validator confirmed every number appears in the facts each sentence cites (accepted on attempt ${a.attempts}).`
              : `The AI writer was not used (${a.reason}); this is the template version.`}{" "}
            Raw file: <a href={`${REPO_URL}/blob/main/data/reports/${report.day}.json`}>data/reports/{report.day}.json</a>
          </p>
          <ul className="notes">
            {report.facts.map((f) => (
              <li key={f.id}>
                <b>{f.id}</b> {f.text}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </>
  );
}
