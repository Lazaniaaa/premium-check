import { buildComparison, type Comparison } from "./model";

/** Compact, stable JSON shape committed daily to data/snapshots/ by GitHub Actions. */
/**
 * schema 2 / methodVersion 2 (25 Nov 2026): ETF cost = sponsor fee (premium assumed unchanged
 * at exit), SoDEX round trip vs money spent, staking ETFs and sub-minimum orders unranked,
 * ETF liquidity rule from daily value traded (>= $2M and order <= 0.1% of it).
 * Files written before that are schema 1 (method 1) and are not comparable day-over-day.
 */
export const METHOD_VERSION = 2;

/**
 * Method of a stored snapshot. Files from before methodVersion existed are told apart by
 * their fields: method 1 stored `entryPremium` (ETF premium counted as a cost). A file with
 * `tradingCost` but no methodVersion (25 Nov 2026) is transitional, 1.5: ETF cost already
 * as in method 2, but ETFs were still filtered by net assets (under $100M not ranked)
 * instead of daily value traded. It is not compared with either neighbour.
 */
export function methodOf(s: Pick<Snapshot, "methodVersion" | "btc">): number {
  if (s.methodVersion) return s.methodVersion;
  const r = s.btc?.routes?.[0] as Record<string, unknown> | undefined;
  return r && "tradingCost" in r ? 1.5 : 1;
}

/** Short label for a method version, as shown in the journal. */
export const methodLabel = (m: number) => (m === 1.5 ? "transitional (v2 cost, $100M net-asset ETF filter)" : `method v${m}`);

/** Tickers the AI note may only mention through {variables} (BTC / ETH are excluded: they are also the coins). */
export function protectedTerms(s: Snapshot): string[] {
  const etfs = [...(s.btc?.routes ?? []), ...(s.eth?.routes ?? [])].filter((r) => r.id.startsWith("etf-")).map((r) => r.id.slice(4));
  const companies = (s.btc?.companies ?? []).map((c) => c.ticker).filter((t) => t !== "MSTR");
  return [...new Set([...etfs, ...companies])].filter((t) => t !== "BTC" && t !== "ETH");
}

export type Snapshot = {
  schema: 1 | 2;
  methodVersion?: number;
  takenAt: string;
  takenBy: string;
  params: { usd: number; months: number };
  btc: AssetSnapshot | null;
  eth: AssetSnapshot | null;
  errors?: string[];
};

type AssetSnapshot = {
  reference: Comparison["reference"];
  cheapest: { id: string; name: string; cost: number | null } | null;
  perpAnnualFunding: number | null;
  routes: { id: string; name: string; tradingCost: number | null; premiumNow: number | null; premiumAsOf?: string | null; annualCarry: number | null; cost: number | null; ranked: boolean; flags: string[] }[];
  companies: {
    ticker: string;
    kind: string;
    btcHolding: number;
    holdingsAsOf: string;
    price: number;
    priceSource: string;
    mnavEquity: number | null;
    mnavWithDebt: number | null;
  }[];
  errors: string[];
};

const compact = (c: Comparison): AssetSnapshot => {
  const best = c.direct.find((r) => r.ranked) ?? null;
  return {
    reference: c.reference,
    cheapest: best ? { id: best.id, name: best.name, cost: best.cost } : null,
    perpAnnualFunding: c.direct.find((r) => r.kind === "sodex_perp")?.annualCarry ?? null,
    routes: c.direct.map((r) => ({
      id: r.id,
      name: r.name,
      tradingCost: r.tradingCost,
      premiumNow: r.premiumNow,
      ...(r.premiumAsOf !== undefined ? { premiumAsOf: r.premiumAsOf } : {}),
      annualCarry: r.annualCarry,
      cost: r.cost,
      ranked: r.ranked,
      flags: r.flags,
    })),
    companies: c.companies.map((r) => ({
      ticker: r.ticker,
      kind: r.kind,
      btcHolding: r.btcHolding,
      holdingsAsOf: r.holdingsAsOf,
      price: r.price,
      priceSource: r.priceSource,
      mnavEquity: r.mnavEquity,
      mnavWithDebt: r.mnavWithDebt,
    })),
    errors: c.errors,
  };
};

export async function takeSnapshot(takenBy: string): Promise<Snapshot> {
  const usd = 1000;
  const months = 12;
  // One asset failing must not take the other down with it.
  const [btc, eth] = await Promise.allSettled([buildComparison("BTC", usd, months), buildComparison("ETH", usd, months)]);
  const errors = [btc, eth].flatMap((r, i) => (r.status === "rejected" ? [`${i ? "ETH" : "BTC"}: ${String(r.reason?.message ?? r.reason)}`] : []));
  return {
    schema: 2,
    methodVersion: METHOD_VERSION,
    takenAt: new Date().toISOString(),
    takenBy,
    params: { usd, months },
    btc: btc.status === "fulfilled" ? compact(btc.value) : null,
    eth: eth.status === "fulfilled" ? compact(eth.value) : null,
    errors,
  };
}
