// Assembles every way to hold BTC/ETH into one comparable table.
import {
  annualFunding,
  daysBetween,
  effectiveUnits,
  holdingCost,
  maxSizeVwapWithin,
  mnav,
  roundTrip,
  SODEX_FEES,
  walkAsks,
  type Fill,
} from "./calc";

const signedBps = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)} bps`;
const pctStr = (x: number | null, d = 2) => (x == null ? "n/a" : `${(x * 100).toFixed(d)}%`);
const signedPctStr = (x: number | null, d = 2) => (x == null ? "n/a" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const usdStr = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * ETFs that stake and pay distributions (and may run fee waivers) — economics we do not
 * model, so they are shown but not ranked. Sources: ishares.com ETHB (staking, 0.12% waiver
 * from 12 Mar 2026); etfs.grayscale.com ETH and ETHE (staking, monthly distributions);
 * 21shares.com TETH (staking).
 */
const STAKING_ETFS = new Set(["ETHB", "ETH", "ETHE", "TETH"]);
import { maybe } from "./http";
import {
  etfData,
  etfList,
  latestBalance,
  orderbook,
  perpTickers,
  purchaseHistory,
  sosoPrice,
  stockSnapshot,
  symbolInfo,
  treasuryList,
  type PerpTicker,
} from "./sources";
import { buildTicket, sodexTradeUrl, type OrderTicket } from "./trade";
import {
  CANDIDATES,
  COMPANY_KIND,
  LISTING,
  MIN_BTC_HOLDING,
  NO_STOCK_DATA,
  STALE_HOLDINGS_DAYS,
  type CompanyKind,
} from "./universe";

export type Asset = "BTC" | "ETH";
export type RouteKind = "sodex_spot" | "sodex_perp" | "etf";

export type DirectRoute = {
  id: string;
  kind: RouteKind;
  name: string;
  provider: string;
  tradingCost: number | null; // round-trip friction as a fraction of money spent (ETFs: not known, see notes)
  annualCarry: number | null; // fraction per year (ETF fee, perp funding at the current rate)
  cost: number | null; // tradingCost + annualCarry x horizon; null when it can't be computed honestly
  units: number | null; // asset-equivalent kept at a constant price: usd / ref x (1 - cost)
  ranked: boolean; // false when the cost can't be trusted for a ranking (see flags)
  premiumNow: number | null; // ETF premium to NAV / SoDEX market vs index, assumed unchanged at exit
  costAtZeroFunding?: number | null; // perps only: the same route if funding were zero
  fillableUsd?: number; // when the visible book can't absorb the whole amount
  notes: string[];
  flags: (
    | "fee_unverified"
    | "book_too_thin"
    | "book_anomaly"
    | "below_min_order"
    | "funding_varies"
    | "funding_unavailable"
    | "small_fund"
    | "staking_unmodeled"
  )[];
  source: string;
  asOf: string | null;
  fill?: Fill & { maxUsdVwapWithin10bps: number; feeRate: number };
  ticket?: OrderTicket | null;
};

export type CompanyRow = {
  ticker: string;
  name: string;
  kind: CompanyKind;
  btcHolding: number;
  holdingsAsOf: string;
  holdingsAgeDays: number;
  stale: boolean;
  price: number;
  priceSource: "exchange" | "sodex_24_7";
  marketStatus: string;
  sodexSymbol: string | null;
  sodexUrl: string | null;
  mnavEquity: number | null;
  mnavWithDebt: number | null;
  balanceAsOf: string | null;
  btcPer1000: number | null;
  btcShareOfMcap: number | null;
  lastBuy: { date: string; btc: number; usdPerBtc: number | null } | null;
};

export type Comparison = {
  asset: Asset;
  usd: number;
  months: number;
  generatedAt: string;
  reference: { price: number; source: string; sosoPrice: number | null; deviationBps: number | null };
  direct: DirectRoute[];
  companies: CompanyRow[];
  coverage: Coverage | null;
  errors: string[];
};

export type Coverage = {
  listed: number; // US-listed companies in SoSoValue's BTC treasury list
  queried: number; // candidates we query (held >= 1,000 BTC when checked)
  shown: number;
  noStockData: string[]; // no SoSoValue stock snapshot -> can't price them
  missing: string[]; // queried but holdings or snapshot unavailable right now
};

/** Below this, spreads in the fund can easily exceed its fee advantage: shown, not ranked. */
export const SMALL_FUND_USD = 100_000_000;

const PERP: Record<Asset, string> = { BTC: "BTC-USD", ETH: "ETH-USD" };
const SPOT: Record<Asset, string> = { BTC: "vBTC_vUSDC", ETH: "vETH_vUSDC" };
const isRegularSession = (status: string) => /REGULAR|TRADING|OPEN/i.test(status) && !/CLOSE/i.test(status);

export async function buildComparison(asset: Asset, usd: number, months: number): Promise<Comparison> {
  const errors: string[] = [];
  const note = (what: string) => (e: unknown) => {
    errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  };

  const tickers = await perpTickers();
  const refTicker = tickers.find((t) => t.symbol === PERP[asset]);
  if (!refTicker) throw new Error(`SoDEX has no ${PERP[asset]} market`);
  // Only a finite, positive price can be a reference; say which one was used.
  const refPick = (
    [
      ["index", refTicker.indexPrice],
      ["mark", refTicker.markPrice],
    ] as const
  ).find(([, v]) => Number.isFinite(v) && v > 0);
  if (!refPick) throw new Error(`SoDEX returned no valid ${PERP[asset]} reference price`);
  const [refKind, ref] = refPick;
  const soso = await maybe(sosoPrice(asset));

  const [direct, comp] = await Promise.all([
    directRoutes(asset, usd, months, ref, refTicker, note),
    asset === "BTC" ? companyRows(ref, tickers, note) : Promise.resolve({ rows: [] as CompanyRow[], coverage: null }),
  ]);
  const companies = comp.rows;

  // Trusted rows first (cheapest first), then unranked rows, still by cost.
  direct.sort((a, b) => Number(b.ranked) - Number(a.ranked) || (a.cost ?? Infinity) - (b.cost ?? Infinity));
  companies.sort((a, b) => (b.btcHolding ?? 0) - (a.btcHolding ?? 0));

  return {
    asset,
    usd,
    months,
    generatedAt: new Date().toISOString(),
    reference: {
      price: ref,
      source: `SoDEX ${PERP[asset]} ${refKind} price`,
      sosoPrice: soso,
      deviationBps: soso ? (soso / ref - 1) * 1e4 : null,
    },
    direct,
    companies,
    coverage: comp.coverage,
    errors,
  };
}

async function directRoutes(
  asset: Asset,
  usd: number,
  months: number,
  ref: number,
  perp: PerpTicker,
  note: (w: string) => (e: unknown) => null,
): Promise<DirectRoute[]> {
  const rows: DirectRoute[] = [];
  const finish = (r: Omit<DirectRoute, "cost" | "units" | "ranked">): DirectRoute => {
    const thin = r.flags.includes("book_too_thin");
    // A partial fill has no honest full-size cost or quantity: show what is fillable instead.
    const cost = !thin && r.tradingCost != null && r.annualCarry != null ? holdingCost(r.tradingCost, r.annualCarry, months) : null;
    const untrusted = r.flags.some((f) =>
      ["fee_unverified", "small_fund", "book_too_thin", "book_anomaly", "below_min_order", "funding_unavailable", "staking_unmodeled"].includes(
        f,
      ),
    );
    return { ...r, cost, units: cost != null ? effectiveUnits(usd, ref, cost) : null, ranked: cost != null && !untrusted };
  };

  const [spotBook, perpBook, etfs, spotInfo, perpInfo] = await Promise.all([
    orderbook("spot", SPOT[asset]).catch(note(`SoDEX spot ${SPOT[asset]}`)),
    orderbook("perps", PERP[asset]).catch(note(`SoDEX perp ${PERP[asset]}`)),
    etfList(asset).catch(note(`SoSoValue ETF list ${asset}`)),
    symbolInfo("spot", SPOT[asset]),
    symbolInfo("perps", PERP[asset]),
  ]);
  const now = Date.now();
  const basisNote = (mid: number) =>
    `Market trades ${signedBps((mid / ref - 1) * 1e4)} vs the ${asset} index; assumed unchanged when you sell`;
  const partialNote = (f: Fill) => `Visible book fills only ${usdStr(f.filledUsd)} of ${usdStr(usd)}; no full-size cost shown`;

  const sodexRow = (market: "spot" | "perps") => {
    const book = market === "spot" ? spotBook : perpBook;
    if (!book) return;
    const fee = market === "spot" ? SODEX_FEES.spotTaker : SODEX_FEES.perpTaker;
    const symbol = market === "spot" ? SPOT[asset] : PERP[asset];
    const info = market === "spot" ? spotInfo : perpInfo;
    const crossed = !!(book.bids[0] && book.asks[0] && book.bids[0][0] >= book.asks[0][0]);
    const rt = crossed ? null : roundTrip(book, usd, fee);
    const f = walkAsks(book.asks, usd);
    const thin = rt?.complete === false || !f.complete;
    const ticket = info && !crossed ? buildTicket(market, info, book.asks, usd, fee, now) : null;
    const funding = market === "perps" ? perp.fundingRate : 0;
    const carry = funding == null ? null : annualFunding(funding);
    const notes =
      market === "spot"
        ? [`Buy + sell into today's book, taker fee ${pctStr(fee, 3)} each way`, "No recurring cost; asset held on SoDEX / ValueChain"]
        : [
            funding == null
              ? "SoDEX did not report a funding rate; not ranked"
              : `Funding now ${(funding * 100).toFixed(4)}%/hour (${pctStr(carry)} a year if it stayed the same); paid by longs when positive`,
            `Open + close into today's book, taker fee ${pctStr(fee, 3)} each way; needs USDC margin`,
          ];
    if (rt) notes.push(basisNote(rt.mid));
    if (thin) notes.unshift(partialNote(f));
    if (crossed) notes.unshift("Order book is crossed (best bid at or above best ask): treated as a data anomaly; not ranked");
    if (ticket?.belowMinimum) notes.unshift("Amount is below SoDEX's minimum order for this market; not ranked");
    rows.push(
      finish({
        id: market === "spot" ? "sodex-spot" : "sodex-perp",
        kind: market === "spot" ? "sodex_spot" : "sodex_perp",
        name: market === "spot" ? `SoDEX spot ${symbol.replace("_", "/")}` : `SoDEX perp ${symbol} (1x long)`,
        provider: "SoDEX",
        tradingCost: rt ? rt.total : null,
        annualCarry: carry,
        premiumNow: rt ? rt.mid / ref - 1 : null,
        costAtZeroFunding: market === "perps" && rt && !thin ? holdingCost(rt.total, 0, months) : undefined,
        fillableUsd: thin ? f.filledUsd : undefined,
        notes,
        flags: [
          ...(market === "perps" ? (["funding_varies"] as const) : []),
          ...(market === "perps" && funding == null ? (["funding_unavailable"] as const) : []),
          ...(thin ? (["book_too_thin"] as const) : []),
          ...(crossed ? (["book_anomaly"] as const) : []),
          ...(ticket?.belowMinimum ? (["below_min_order"] as const) : []),
        ],
        source: `SoDEX /${market}/markets/${symbol}/orderbook${market === "perps" ? " + tickers" : ""}`,
        asOf: book.blockTime ? new Date(book.blockTime).toISOString() : null,
        fill: { ...f, maxUsdVwapWithin10bps: maxSizeVwapWithin(book.asks, 10), feeRate: fee },
        ticket,
      }),
    );
  };
  sodexRow("spot");
  sodexRow("perps");

  const etfRows = await Promise.all(
    (etfs ?? []).map(async (e) => {
      const d = await etfData(e.ticker).catch(note(`SoSoValue ETF ${e.ticker}`));
      if (!d) return null;
      const feeUnverified = d.fee === null || d.fee === 0;
      const small = d.netAssets != null && d.netAssets < SMALL_FUND_USD;
      const staking = STAKING_ETFS.has(e.ticker);
      const range = d.premiumRange
        ? `; ${d.premiumRange.days}-day range ${signedPctStr(d.premiumRange.min)} to ${signedPctStr(d.premiumRange.max)}`
        : "";
      return finish({
        id: `etf-${e.ticker}`,
        kind: "etf",
        name: `${e.ticker} — ${e.name}`,
        provider: e.exchange,
        // Same rule as SoDEX: today's gap to NAV is assumed unchanged when you sell, so it
        // is shown as entry-timing risk, not counted as a cost or a gain.
        tradingCost: 0,
        annualCarry: feeUnverified ? null : d.fee,
        premiumNow: d.premium,
        notes: [
          d.premiumDate
            ? `Premium to NAV ${signedPctStr(d.premium, 3)} on ${d.premiumDate}${range}; assumed unchanged when you sell`
            : "No premium/discount data",
          "Your broker's commission and the ETF's bid/ask spread are not included",
          ...(staking ? ["Staking ETF: staking distributions (and any fee waiver) are not modelled; not ranked"] : []),
          ...(d.price && usd < d.price ? [`One share costs ${usdStr(d.price)}: this amount needs fractional shares from your broker`] : []),
          ...(d.netAssets != null ? [`Net assets ${(d.netAssets / 1e9).toFixed(2)}B USD`] : []),
        ],
        flags: [
          ...(feeUnverified ? (["fee_unverified"] as const) : []),
          ...(small ? (["small_fund"] as const) : []),
          ...(staking ? (["staking_unmodeled"] as const) : []),
        ],
        source: `SoSoValue /etfs/${e.ticker}/market-snapshot + /history`,
        asOf: d.date,
      });
    }),
  );
  for (const r of etfRows) if (r) rows.push(r);
  return rows;
}

async function companyRows(
  btcPrice: number,
  tickers: PerpTicker[],
  note: (w: string) => (e: unknown) => null,
): Promise<{ rows: CompanyRow[]; coverage: Coverage }> {
  const list = (await treasuryList().catch(note("SoSoValue treasury list"))) ?? [];
  const now = new Date();
  const us = list.filter((t) => t.list_location === LISTING);
  const queried = us.filter((t) => CANDIDATES.includes(t.ticker) && !NO_STOCK_DATA.has(t.ticker));
  const missing: string[] = [];
  const rows = await Promise.all(
    queried.map(async (t): Promise<CompanyRow | null> => {
        const hist = await purchaseHistory(t.ticker).catch(note(`SoSoValue holdings ${t.ticker}`));
        const latest = hist?.[0];
        if (!latest) {
          missing.push(t.ticker);
          return null;
        }
        if (latest.btcHolding < MIN_BTC_HOLDING) return null;
        const snap = await stockSnapshot(t.ticker);
        if (!snap) {
          missing.push(t.ticker);
          return null;
        }
        const kind = COMPANY_KIND[t.ticker] ?? "operating";
        const sodexSymbol = tickers.some((x) => x.symbol === `${t.ticker}-USD`) ? `${t.ticker}-USD` : null;
        const sodexMark = sodexSymbol ? tickers.find((x) => x.symbol === sodexSymbol)!.markPrice : null;
        const useSodex = !isRegularSession(snap.status) && !!sodexMark;
        const price = useSodex ? sodexMark! : snap.price;
        const balance = kind === "treasury" ? await latestBalance(t.ticker) : null;
        const m = mnav({
          price,
          shares: snap.totalShares,
          btcHolding: latest.btcHolding,
          btcPrice,
          debt: balance?.debt,
          cash: balance?.cash,
        });
        const age = daysBetween(latest.date, now);
        const buy = hist.find((h) => h.btcAcq > 0);
        return {
          ticker: t.ticker,
          name: t.name.trim(),
          kind,
          btcHolding: latest.btcHolding,
          holdingsAsOf: latest.date,
          holdingsAgeDays: age,
          stale: age > STALE_HOLDINGS_DAYS,
          price,
          priceSource: useSodex ? "sodex_24_7" : "exchange",
          marketStatus: snap.status,
          sodexSymbol,
          sodexUrl: sodexSymbol ? sodexTradeUrl("perps", { name: sodexSymbol, displayName: sodexSymbol }) : null,
          mnavEquity: kind === "operating" ? null : m.equity,
          mnavWithDebt: kind === "operating" ? null : m.withDebt,
          balanceAsOf: balance?.fiscalDate ?? null,
          btcPer1000: m.btcPer1000,
          btcShareOfMcap: m.equity ? 1 / m.equity : null,
          lastBuy: buy ? { date: buy.date, btc: buy.btcAcq, usdPerBtc: buy.acqCost ? buy.acqCost / buy.btcAcq : null } : null,
        };
    }),
  );
  const shown = rows.filter((r): r is CompanyRow => r !== null);
  return {
    rows: shown,
    coverage: {
      listed: us.length,
      queried: queried.length,
      shown: shown.length,
      noStockData: us.filter((t) => NO_STOCK_DATA.has(t.ticker)).map((t) => t.ticker),
      missing: missing.sort(),
    },
  };
}
