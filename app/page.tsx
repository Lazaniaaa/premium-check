import { buildComparison, TIE_SHARE, type Asset, type CompanyRow, type Comparison, type DirectRoute } from "@/lib/model";
import { bps, compactUsd, int, pct, ratio, signedPct, timeUtc, units, usd } from "@/lib/format";
import { ROUTE_GROUPS, type RouteGroup } from "@/lib/query";
import { latestReport } from "@/lib/reports-store";
import Link from "next/link";
import { premiumBacktest } from "@/lib/validation";
import { TabLink, Tabs, type TabDef } from "./components/tabs";
import { METHOD_VERSION } from "@/lib/snapshot";

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
  // the user's ETF round-trip cost (commission + spread) in percent, 0-2
  const etfPct = Math.min(Math.max(Number(one("etfcost")) || 0, 0), 2);
  return { asset, amount, months, exclude, etfPct, q: one("q")?.slice(0, 200) ?? "", qerr: one("qerr") ?? "" };
}

const GROUP_TEXT: Record<RouteGroup, string> = {
  sodex_spot: "SoDEX spot",
  sodex_perp: "perps",
  etf: "ETFs",
  treasury_stock: "treasury stocks",
};

const EXAMPLES: [string, string][] = [
  ["$1,000 BTC · 1 year", "/?asset=BTC&usd=1000&months=12"],
  ["$2,000 BTC · 6 months", "/?asset=BTC&usd=2000&months=6"],
  ["same, broker 0.25%", "/?asset=BTC&usd=2000&months=6&etfcost=0.25"],
  ["$1M ETH · 2 years", "/?asset=ETH&usd=1000000&months=24"],
  ["$10 ETH · 1 month", "/?asset=ETH&usd=10&months=1"],
];

const REASON_TEXT: Record<string, string> = {
  staking_unmodeled: "staking ETFs",
  thin_trading: "thinly traded for this amount",
  fee_unverified: "fee not verified",
  book_too_thin: "order book too thin",
  below_min_order: "below SoDEX minimum",
  funding_unavailable: "no funding rate",
  book_anomaly: "crossed order book",
};

/** "Not ranked" reasons, one per route (the first that applies), most common first. */
function reasonCounts(rows: DirectRoute[]): [string, number][] {
  const order = ["book_too_thin", "below_min_order", "book_anomaly", "funding_unavailable", "staking_unmodeled", "fee_unverified", "thin_trading"];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const f = order.find((x) => (r.flags as string[]).includes(x));
    if (f) counts.set(REASON_TEXT[f], (counts.get(REASON_TEXT[f]) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function uniqueRoutes(rows: (DirectRoute | undefined)[]): DirectRoute[] {
  const seen = new Set<string>();
  return rows.filter((r): r is DirectRoute => !!r && !seen.has(r.id) && !!seen.add(r.id));
}

function HorizonTable({ routes, amount, months }: { routes: DirectRoute[]; amount: number; months: number }) {
  const cost = (r: DirectRoute, h: number) => (r.tradingCost ?? 0) + (r.annualCarry ?? 0) * (h / 12);
  const cheapest = HORIZONS.map((h) => Math.min(...routes.map((r) => cost(r, h))));
  return (
    <>
      <h2 id="horizons">How the answer changes with the holding period</h2>
      <p className="lede">
        Same amount, today&apos;s costs. Recurring costs (ETF fees, perp funding at today&apos;s rate) grow with time;
        trading costs are paid once. Cheapest in each column in bold.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Route</th>
              {HORIZONS.map((h) => (
                <th key={h} className="num">
                  {h === 1 ? "1 month" : `${h} months`}
                  {h === months ? " ◂" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.id}>
                <td>{r.name.split(" — ")[0]}</td>
                {HORIZONS.map((h, i) => {
                  const v = cost(r, h);
                  return (
                    <td key={h} className="num">
                      {v - cheapest[i] < 1e-12 ? <b>{usd(amount * v, 2)}</b> : usd(amount * v, 2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const FLAG_TEXT: Record<string, string> = {
  fee_unverified: "fee reported as 0 — not ranked",
  thin_trading: "thin trading for this amount (rule of thumb); not ranked",
  staking_unmodeled: "staking ETF — distributions not modelled; not ranked",
  below_min_order: "below SoDEX minimum order; not ranked",
  book_anomaly: "crossed order book (data anomaly); not ranked",
  funding_unavailable: "funding rate unavailable; not ranked",
  book_too_thin: "order book too thin for this amount; not ranked",
  funding_varies: "funding changes hourly",
};

export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { asset, amount, months, exclude, etfPct, q, qerr } = parse(sp);
  const [full, report] = await Promise.all([
    buildComparison(asset, amount, months, { etfTradingCost: etfPct / 100 }),
    latestReport(),
  ]);
  const c = { ...full, direct: full.direct.filter((r) => !exclude.includes(r.kind)) };
  const ranked = c.direct.filter((r) => r.ranked);
  const best = ranked[0];
  const worst = ranked.at(-1);
  const tied = best ? ranked.filter((r) => r.id !== best.id && r.cost! - best.cost! < TIE_SHARE) : [];
  const unranked = c.direct.filter((r) => !r.ranked);
  const reasons = reasonCounts(unranked);
  const horizon = months === 1 ? "1 month" : `${months} months`;
  // Broker break-even: the ETF round-trip cost at which the best ranked ETF costs the same as the best SoDEX route.
  const bestEtf = ranked.find((r) => r.kind === "etf");
  const bestSodex = ranked.find((r) => r.kind !== "etf");
  const breakEven = bestEtf && bestSodex ? bestSodex.cost! - (bestEtf.cost! - (bestEtf.tradingCost ?? 0)) : null;
  // Rows that show how the answer moves with time: the winner, both SoDEX routes, the best ETF, then other close ETFs.
  const horizonRoutes = uniqueRoutes([
    best,
    ...ranked.filter((r) => r.kind === "sodex_spot"),
    ...ranked.filter((r) => r.kind === "sodex_perp"),
    bestEtf,
    ...tied,
  ]).slice(0, 5);
  // SoDEX routes the visible book can't fill: the reason the answer looks the way it does.
  const partial = c.direct.filter((r) => r.kind !== "etf" && r.fillableUsd != null);
  const execution = [...c.direct.filter((r) => r.fill)].sort((a, b) => Number(b.fillableUsd != null) - Number(a.fillableUsd != null));
  const showCompanies = asset === "BTC" && !exclude.includes("treasury_stock");
  // Backtest on frozen SoSoValue history (/validation). Only a hint where it matters: if
  // routes are already tied, a link; if one route leads an ETF (or an ETF leads) by less
  // than the 1-in-10 premium move seen after 10 sessions, say the order could reverse.
  // ETF vs ETF uses the change in the gap between two funds; ETF vs SoDEX the ETF's own move.
  const premiumTest = premiumBacktest(asset);
  const longest = premiumTest.longest;
  const runnerUp = ranked[1];
  const short = (r: DirectRoute) => r.name.split(" — ")[0].replace(/ \(.*\)$/, "");
  const premiumHint = (() => {
    if (!best || !runnerUp || !longest) return null;
    if (tied.length > 0) return [best, ...tied].some((r) => r.kind === "etf") ? ({ tie: true } as const) : null;
    if (best.kind !== "etf" && runnerUp.kind !== "etf") return null;
    const pair = best.kind === "etf" && runnerUp.kind === "etf";
    const move = pair ? longest.pairwise.p90 : longest.unchanged.p90;
    const gap = runnerUp.cost! - best.cost!;
    if (move == null || gap >= move) return null;
    const etf = best.kind === "etf" ? best : runnerUp;
    return { tie: false, pair, move, gap, etf } as const;
  })();

  const query = `asset=${asset}&usd=${amount}&months=${months}${etfPct ? `&etfcost=${etfPct}` : ""}${exclude.length ? `&exclude=${exclude.join(",")}` : ""}`;
  const tabs: TabDef[] = [
    {
      id: "routes",
      label: "Routes",
      panel: (
        <RoutesPanel
          rows={c.direct}
          asset={asset}
          bestId={best?.id}
          horizon={horizon}
          horizonRoutes={horizonRoutes}
          amount={amount}
          months={months}
        />
      ),
    },
    { id: "execution", label: "Execution", panel: <ExecutionPanel rows={execution} asset={asset} amount={amount} /> },
    ...(showCompanies ? [{ id: "companies", label: "Companies", panel: <Companies rows={c.companies} coverage={c.coverage} /> }] : []),
  ];
  const requested = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "";
  const activeTab = tabs.some((t) => t.id === requested) ? requested : "routes";

  return (
    <>
      <h1>What does it cost to hold {asset}?</h1>
      <details className="scenario">
        <summary>
          <span>
            {usd(amount)} · {horizon} · ETF broker cost {etfPct || 0}%
            {exclude.length ? ` · without ${exclude.map((x) => GROUP_TEXT[x]).join(", ")}` : ""}
          </span>
          <span className="edit-btn">Edit</span>
        </summary>
        <div className="scenario-body">
          <div className="examples">
            <span className="muted">Examples:</span>
            {EXAMPLES.map(([label, href]) => (
              <a key={href} className="chip-link" href={href}>
                {label}
              </a>
            ))}
          </div>
          <form className="form ask" method="get" action="/ask">
            <label style={{ flex: 1 }}>
              Ask in your own words
              <input name="q" defaultValue={q} maxLength={200} placeholder="e.g. 5k in ether for half a year, no broker" />
            </label>
            <button type="submit">Ask</button>
          </form>
          <form className="form" method="get" style={{ marginTop: 12 }}>
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
            <label>
              ETF: your commission + spread, % round trip
              <input name="etfcost" type="number" min={0} max={2} step={0.01} defaultValue={etfPct || ""} placeholder="0" />
            </label>
            {exclude.length > 0 && <input type="hidden" name="exclude" value={exclude.join(",")} />}
            <button type="submit">Compare</button>
            {exclude.length > 0 && (
              <span className="sub">
                <a href={`/?asset=${asset}&usd=${amount}&months=${months}`}>Show all routes</a>
              </span>
            )}
          </form>
        </div>
      </details>
      {q && !qerr && (
        <p className="sub" style={{ margin: "0 0 8px" }}>
          You asked: &ldquo;{q}&rdquo; — understood as the scenario above. The AI only filled in the form; every number is
          calculated by code.
        </p>
      )}
      {qerr && (
        <p className="sub bad" style={{ margin: "0 0 8px" }}>
          {qerr === "notunderstood" ? "That doesn't look like a question about holding BTC or ETH." : "The AI parser is unavailable right now — use Edit."}
        </p>
      )}

      <section className="card answer">
        {!best ? (
          <div className="big">No route passes the checks for this amount.</div>
        ) : ranked.length === 1 ? (
          <>
            <div className="big">
              Only 1 of {c.direct.length} routes passes: {best.name} — {usd(amount * best.cost!, 2)} ({pct(best.cost)})
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              {best.costAtZeroFunding != null
                ? `At zero funding it would be ${usd(amount * best.costAtZeroFunding, 2)}; funding changes hourly. `
                : ""}
              There is no real comparison at this size.
            </p>
          </>
        ) : tied.length > 0 ? (
          <>
            <div className="big">
              {tied.length + 1} routes are within {usd(amount * TIE_SHARE, 2)} — effectively tied
            </div>
            <p style={{ marginTop: 0 }}>
              Lowest estimate: <b>{best.name.split(" — ")[0]}</b> · {usd(amount * best.cost!, 2)} over {horizon}.{" "}
              <span className="muted">
                Also within the tie:{" "}
                {tied
                  .slice(0, 3)
                  .map((r) => `${r.name.split(" — ")[0]} ${usd(amount * r.cost!, 2)}`)
                  .join(" · ")}
                {tied.length > 3 ? ` and ${tied.length - 3} more` : ""}.
              </span>
            </p>
          </>
        ) : (
          <div className="big">
            {usd(amount * best.cost!, 2)} ({pct(best.cost)}) — {best.name} is the cheapest
          </div>
        )}

        {best && breakEven != null && bestEtf && bestSodex && (
          <p>
            {breakEven <= 0 ? (
              <>{bestSodex.name} is cheaper than every ranked ETF even with a 0% broker cost.</>
            ) : (
              <>
                Above ~<b>{pct(breakEven, 2)}</b> in ETF broker costs (round trip), {bestSodex.name.replace(/ \(.*\)$/, "")} costs
                less.{" "}
                <a href={`/?asset=${asset}&usd=${amount}&months=${months}&etfcost=${Math.min(2, Math.ceil((breakEven * 100 + 0.05) * 100) / 100)}`}>
                  Try {Math.min(2, Math.ceil((breakEven * 100 + 0.05) * 100) / 100)}% broker cost
                </a>
              </>
            )}
          </p>
        )}

        {premiumHint?.tie && (
          <p className="muted">
            <Link href="/validation#premium">How ETF exit prices could change this result</Link>
          </p>
        )}
        {premiumHint && !premiumHint.tie && (
          <p>
            {short(best)} leads {short(runnerUp)} by {usd(amount * premiumHint.gap, 2)}.{" "}
            {premiumHint.pair
              ? `A change in the gap between their exit premiums could reverse that.`
              : `A change in ${short(premiumHint.etf)}'s exit premium could reverse that.`}{" "}
            <span className="sub">
              In {premiumTest.sessions} sessions ({premiumTest.from} – {premiumTest.to}), 1 in 10{" "}
              {premiumHint.pair ? "two-fund premium gaps" : `${asset} ETF premiums`} moved by more than {pct(premiumHint.move, 2)} (
              {usd(amount * premiumHint.move, 2)} here) after {longest!.days} sessions.{" "}
              <Link href="/validation#premium">How we checked</Link>
            </span>
          </p>
        )}

        {partial.map((r) => (
          <p key={r.id}>
            {r.name.replace(/ \(.*\)$/, "")} covers only <b>{usd(r.fillableUsd)}</b> of {usd(amount)} in today&apos;s visible
            book.{" "}
            <TabLink tab="execution" anchor={`fill-${r.id}`} href={`/?${query}&tab=execution#fill-${r.id}`}>
              Inspect the fill
            </TabLink>
          </p>
        ))}

        <p className="muted">
          {ranked.length} of {c.direct.length} routes ranked
          {reasons.length > 0 ? ` · not ranked: ${reasons.map(([why, n]) => `${n} ${why}`).join(", ")}` : ""}
          {best && worst && worst.id !== best.id ? ` · most expensive ranked: ${worst.name.split(" — ")[0]} ${usd(amount * worst.cost!, 2)}` : ""}
        </p>

        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
            Price, sources &amp; calculation JSON
          </summary>
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
              <div className="label">This calculation</div>
              <div className="value" style={{ fontSize: 14 }}>
                <a href={`/api/compare?${query}`}>Download JSON</a>
              </div>
              <span className="sub">
                inputs, sources, times, method v{METHOD_VERSION} · computed {timeUtc(c.generatedAt)}
              </span>
            </div>
          </div>
        </details>
      </section>

      <Tabs tabs={tabs} initial={activeTab} baseQuery={query} />

      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Method and limits</summary>
        <ul className="notes" style={{ marginTop: 8 }}>
          <li>Reference price: SoDEX {asset}-USD index price (mark price if the index is unavailable); SoSoValue price shown as an independent cross-check.</li>
          <li>SoDEX round trip = 1 − (sell VWAP × (1 − fee)) ÷ (buy VWAP × (1 + fee)) for {usd(amount)} against the live order book (100 levels), tier-0 taker fees 0.065% spot / 0.04% perps. It is today&apos;s friction; tomorrow&apos;s book may differ.</li>
          <li>Gaps to a reference — an ETF&apos;s premium to NAV, a SoDEX market&apos;s gap to the index — are treated the same way for every route: shown, and assumed unchanged when you sell. If they change, the result changes by that amount.</li>
          <li>Perp carry = current hourly funding × 8,760, i.e. what a year would cost if today&apos;s rate never changed. Funding resets every hour; the cost at zero funding is shown too.</li>
          <li>ETF cost = sponsor fee × holding period + your commission and spread if you enter them. Not ranked, but shown: a fee SoSoValue reports as 0, funds that traded under $2M on the last day or where your amount exceeds 0.1% of that day&apos;s trading (a rule of thumb — we have no spread data), staking ETFs, and any route the order book cannot fill. Routes within 0.1 pp are called a tie.</li>
          <li>Company ratios: market cap ÷ BTC value, and (market cap + debt − cash) ÷ BTC value with debt and cash from the latest SoSoValue quarterly balance sheet. Preferred stock and dilution are not in that data, so these are simple ratios, not Strategy&apos;s own mNAV (since 23 Jul 2026 Strategy defines mNAV from net bitcoin per share after senior claims).</li>
          <li>Nothing here places orders. Execution numbers are a preview from the public order book.</li>
        </ul>
      </details>

      {report && (
        <p style={{ marginTop: 16 }}>
          <span className="muted">Daily Premium Report ({report.day}, general $1,000 / 12 months): </span>
          <a href={`/journal#note-${report.day}`}>{report.note.headline}</a>
        </p>
      )}

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
        Computed {timeUtc(c.generatedAt)} · <a href="/diag">data status</a>
      </p>
    </>
  );
}

function RoutesPanel(props: {
  rows: DirectRoute[];
  asset: string;
  bestId?: string;
  horizon: string;
  horizonRoutes: DirectRoute[];
  amount: number;
  months: number;
}) {
  const { rows, asset, bestId, horizon, horizonRoutes, amount, months } = props;
  return (
    <>
      <p className="lede" style={{ marginTop: 12 }}>
        Every direct route, cheapest first. Total cost = round-trip trading cost + recurring cost × {horizon}.{" "}
        {horizonRoutes.length > 1 && <a href="#horizons">Compare holding periods ↓</a>}
      </p>
      <DirectTable rows={rows} asset={asset} bestId={bestId} />
      {horizonRoutes.length > 1 && <HorizonTable routes={horizonRoutes} amount={amount} months={months} />}
    </>
  );
}

function ExecutionPanel({ rows, asset, amount }: { rows: DirectRoute[]; asset: string; amount: number }) {
  if (!rows.length) return <p className="muted" style={{ marginTop: 12 }}>No SoDEX route in this scenario.</p>;
  return (
    <>
      <p className="lede" style={{ marginTop: 12 }}>
        What {usd(amount)} would do in SoDEX&apos;s live order book right now, and the order you would sign. Nothing is sent.
      </p>
      <div className="grid2">
        {rows.map((r) => (
          <Ticket key={r.id} r={r} asset={asset} />
        ))}
      </div>
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
            <th className="num">Total cost</th>
            <th className="num">Round-trip trading cost</th>
            <th className="num">Recurring / year</th>
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
                <b>{pct(r.cost)}</b>
                {r.costAtZeroFunding != null && <span className="sub">{pct(r.costAtZeroFunding)} at zero funding</span>}
              </td>
              <td className="num">
                {r.kind === "etf" && !r.tradingCost ? <span className="muted">not incl.</span> : pct(r.tradingCost, 3)}
                {r.premiumNow != null && (
                  <span className="sub">{r.kind === "etf" ? "premium to NAV" : "vs index"} {signedPct(r.premiumNow, 3)}</span>
                )}
              </td>
              <td className={`num ${r.annualCarry != null && r.annualCarry > 0.02 ? "bad" : ""}`}>
                {r.annualCarry == null ? "n/a" : pct(r.annualCarry)}
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
                <details>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
                    details &amp; source
                  </summary>
                  <span className="sub">{r.notes.join(" · ")}</span>
                  <span className="sub">
                    Source: {r.source}
                    {r.asOf ? ` · ${r.asOf.length > 10 ? timeUtc(r.asOf) : r.asOf}` : ""}
                  </span>
                </details>
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
    <div className="card ticket" id={`fill-${r.id}`} tabIndex={-1}>
      <b>{r.name}</b>{" "}
      <span className={`chip ${f.complete ? "good" : "warn"}`}>{f.complete ? "full fill" : "partial fill"}</span>
      <table className="kv" style={{ marginTop: 8 }}>
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
      <h2 id="treasuries">Indirect exposure: companies holding BTC</h2>
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
