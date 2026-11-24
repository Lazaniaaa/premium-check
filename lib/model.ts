// Assembles every way to hold BTC/ETH into one comparable table.
import {
  annualFunding,
  daysBetween,
  effectiveUnits,
  holdingCost,
  maxSizeWithin,
  mnav,
  roundTrip,
  SODEX_FEES,
  walkAsks,
  type Fill,
} from "./calc";

const signedBps = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)} bps`;
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
  treasuryList,
  type PerpTicker,
} from "./sources";
import { COMPANY_KIND, LISTING, MIN_BTC_HOLDING, STALE_HOLDINGS_DAYS, type CompanyKind } from "./universe";

export type Asset = "BTC" | "ETH";
export type RouteKind = "sodex_spot" | "sodex_perp" | "etf";

export type DirectRoute = {
  id: string;
  kind: RouteKind;
  name: string;
  provider: string;
  entryPremium: number | null; // fraction paid above reference on entry
  annualCarry: number | null; // fraction per year
  cost: number | null; // holdingCost over the chosen horizon
  units: number | null; // asset held per `usd` after cost
  ranked: boolean; // false when the cost can't be trusted for a ranking (see flags)
  notes: string[];
  flags: ("fee_unverified" | "book_too_thin" | "funding_varies" | "small_fund")[];
  source: string;
  asOf: string | null;
  fill?: Fill & { maxUsdWithin10bps: number; feeRate: number };
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
  errors: string[];
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
  const ref = refTicker.indexPrice || refTicker.markPrice;
  const soso = await maybe(sosoPrice(asset));

  const [direct, companies] = await Promise.all([
    directRoutes(asset, usd, months, ref, refTicker, note),
    asset === "BTC" ? companyRows(ref, tickers, note) : Promise.resolve([]),
  ]);

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
      source: `SoDEX ${PERP[asset]} index price`,
      sosoPrice: soso,
      deviationBps: soso ? (soso / ref - 1) * 1e4 : null,
    },
    direct,
    companies,
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
    const cost = r.entryPremium != null && r.annualCarry != null ? holdingCost(r.entryPremium, r.annualCarry, months) : null;
    const untrusted = r.flags.some((f) => f === "fee_unverified" || f === "small_fund" || f === "book_too_thin");
    return { ...r, cost, units: cost != null ? effectiveUnits(usd, ref, cost) : null, ranked: cost != null && !untrusted };
  };

  const [spotBook, perpBook, etfs] = await Promise.all([
    orderbook("spot", SPOT[asset]).catch(note(`SoDEX spot ${SPOT[asset]}`)),
    orderbook("perps", PERP[asset]).catch(note(`SoDEX perp ${PERP[asset]}`)),
    etfList(asset).catch(note(`SoSoValue ETF list ${asset}`)),
  ]);

  const basisNote = (mid: number) => `Trades ${signedBps((mid / ref - 1) * 1e4)} vs ${asset} index (you get it back on exit)`;

  if (spotBook) {
    const fee = SODEX_FEES.spotTaker;
    const rt = roundTrip(spotBook, usd, fee);
    const f = walkAsks(spotBook.asks, usd);
    rows.push(
      finish({
        id: "sodex-spot",
        kind: "sodex_spot",
        name: `SoDEX spot ${SPOT[asset].replace("_", "/")}`,
        provider: "SoDEX",
        entryPremium: rt ? rt.total : null,
        annualCarry: 0,
        notes: [
          "Buy + sell at today's book, taker fee 0.065% each way",
          "No recurring cost; asset held on SoDEX / ValueChain",
          ...(rt ? [basisNote(rt.mid)] : []),
        ],
        flags: rt?.complete === false || !f.complete ? ["book_too_thin"] : [],
        source: `SoDEX /spot/markets/${SPOT[asset]}/orderbook`,
        asOf: spotBook.blockTime ? new Date(spotBook.blockTime).toISOString() : null,
        fill: { ...f, maxUsdWithin10bps: maxSizeWithin(spotBook.asks, 10), feeRate: fee },
      }),
    );
  }

  if (perpBook) {
    const fee = SODEX_FEES.perpTaker;
    const rt = roundTrip(perpBook, usd, fee);
    const f = walkAsks(perpBook.asks, usd);
    rows.push(
      finish({
        id: "sodex-perp",
        kind: "sodex_perp",
        name: `SoDEX perp ${PERP[asset]} (1x long)`,
        provider: "SoDEX",
        entryPremium: rt ? rt.total : null,
        annualCarry: annualFunding(perp.fundingRate),
        notes: [
          `Funding now ${(perp.fundingRate * 100).toFixed(4)}%/hour, paid hourly by longs when positive`,
          "Open + close at today's book, taker fee 0.04% each way; needs USDC margin",
        ],
        flags: ["funding_varies", ...(rt?.complete === false || !f.complete ? (["book_too_thin"] as const) : [])],
        source: `SoDEX /perps/markets/${PERP[asset]}/orderbook + tickers`,
        asOf: perpBook.blockTime ? new Date(perpBook.blockTime).toISOString() : null,
        fill: { ...f, maxUsdWithin10bps: maxSizeWithin(perpBook.asks, 10), feeRate: fee },
      }),
    );
  }

  const etfRows = await Promise.all(
    (etfs ?? []).map(async (e) => {
      const d = await etfData(e.ticker).catch(note(`SoSoValue ETF ${e.ticker}`));
      if (!d) return null;
      const feeUnverified = d.fee === null || d.fee === 0;
      const small = d.netAssets != null && d.netAssets < SMALL_FUND_USD;
      return finish({
        id: `etf-${e.ticker}`,
        kind: "etf",
        name: `${e.ticker} — ${e.name}`,
        provider: e.exchange,
        entryPremium: d.premium,
        annualCarry: feeUnverified ? null : d.fee,
        notes: [
          d.premiumDate ? `Premium/discount to NAV as of ${d.premiumDate}` : "No premium/discount data",
          "Assumes you sell at NAV; brokerage commission and bid/ask spread not included",
          ...(d.netAssets != null ? [`Net assets ${(d.netAssets / 1e9).toFixed(2)}B USD`] : []),
        ],
        flags: [...(feeUnverified ? (["fee_unverified"] as const) : []), ...(small ? (["small_fund"] as const) : [])],
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
): Promise<CompanyRow[]> {
  const list = (await treasuryList().catch(note("SoSoValue treasury list"))) ?? [];
  const now = new Date();
  const rows = await Promise.all(
    list
      .filter((t) => t.list_location === LISTING)
      .map(async (t): Promise<CompanyRow | null> => {
        const hist = await purchaseHistory(t.ticker).catch(note(`SoSoValue holdings ${t.ticker}`));
        const latest = hist?.[0];
        if (!latest || latest.btcHolding < MIN_BTC_HOLDING) return null;
        const snap = await stockSnapshot(t.ticker);
        if (!snap) return null;
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
          mnavEquity: kind === "operating" ? null : m.equity,
          mnavWithDebt: kind === "operating" ? null : m.withDebt,
          balanceAsOf: balance?.fiscalDate ?? null,
          btcPer1000: m.btcPer1000,
          btcShareOfMcap: m.equity ? 1 / m.equity : null,
          lastBuy: buy ? { date: buy.date, btc: buy.btcAcq, usdPerBtc: buy.acqCost ? buy.acqCost / buy.btcAcq : null } : null,
        };
      }),
  );
  return rows.filter((r): r is CompanyRow => r !== null);
}
