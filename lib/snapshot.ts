import { buildComparison, type Comparison } from "./model";

/** Compact, stable JSON shape committed daily to data/snapshots/ by GitHub Actions. */
export type Snapshot = {
  schema: 1;
  takenAt: string;
  takenBy: string;
  params: { usd: number; months: number };
  btc: AssetSnapshot;
  eth: AssetSnapshot;
};

type AssetSnapshot = {
  reference: Comparison["reference"];
  cheapest: { id: string; name: string; cost: number | null } | null;
  perpAnnualFunding: number | null;
  routes: { id: string; name: string; entryPremium: number | null; annualCarry: number | null; cost: number | null; ranked: boolean; flags: string[] }[];
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
      entryPremium: r.entryPremium,
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
  const [btc, eth] = await Promise.all([buildComparison("BTC", usd, months), buildComparison("ETH", usd, months)]);
  return { schema: 1, takenAt: new Date().toISOString(), takenBy, params: { usd, months }, btc: compact(btc), eth: compact(eth) };
}
