// What /validation shows: the exit-premium backtest on the frozen SoSoValue dataset
// (data/validation/etf-premium-history.json, made by scripts/freeze-premium-history.mjs)
// and recorded prediction-vs-fill trades. Reading committed files: no API quota, and the
// published numbers stay reproducible (scripts/reproduce-validation.mjs).
import history from "@/data/validation/etf-premium-history.json";
import after from "@/data/validation/etf-premium-after.json";
import tradesJson from "@/data/validation/trades.json";
import funding from "@/data/validation/funding-history.json";
import { HOURS_PER_YEAR } from "./calc";
import { backtest, fundingBacktest, fundingPaid, outOfSample, type BacktestResult, type FundingResult, type HorizonResult } from "./backtest";

export type { Assumption, ErrorStats, OosHorizon, OosResult, FundingAssumption, FundingHorizon, HorizonResult, Stats } from "./backtest";

/** A real SoDEX round trip next to the prediction committed before it (scripts/predict-trade.mjs). */
export type TradeLeg = {
  predictedVwap: number;
  actualVwap: number;
  diffBps: number; // actual vs predicted, positive = worse for you
  qty: number;
  feePaid: number;
  feeAsset: string;
  feeRate: number | null; // fee / notional actually charged
};
export type TradeRecord = {
  symbol: string;
  usd: number;
  predictionFile: string;
  predictionCommit: string | null; // commit that published the prediction before the trade
  predictedAt: string; // book block time, ms precision
  firstFillAt: string;
  lastFillAt: string;
  account: string;
  tradeIds: number[];
  feeRates: { model: number; symbol: number };
  buy: TradeLeg;
  sell: TradeLeg;
  usdcSpent: number;
  usdcReturned: number;
  baseLeft: number; // BTC not sold back (lot rounding)
  predictedCostUsd: number;
  actualCostUsd: number; // usdcSpent - usdcReturned - value of baseLeft at the sell price
  predictedCostBps: number;
  actualCostBps: number;
  note?: string;
};

export type Backtest = BacktestResult & {
  asset: "BTC" | "ETH";
  listed: number;
  covered: number;
  frozenAt: string;
  longest: HorizonResult | null;
};

export const trades = tradesJson as TradeRecord[];
export const datasetFile = "data/validation/etf-premium-history.json";

const cache = new Map<string, Backtest>();
export function premiumBacktest(asset: "BTC" | "ETH"): Backtest {
  if (cache.has(asset)) return cache.get(asset)!;
  const a = (history as any).assets[asset] as { listed: string[]; funds: Record<string, { date: string; p: number }[]> };
  const r = backtest(a.funds);
  const out: Backtest = {
    ...r,
    asset,
    listed: a.listed.length,
    covered: Object.keys(a.funds).length,
    frozenAt: (history as any).frozenAt,
    longest: r.horizons.at(-1) ?? null,
  };
  cache.set(asset, out);
  return out;
}

export type FundingTest = FundingResult & { asset: "BTC" | "ETH"; frozenAt: string; venue: string };
export const fundingFile = "data/validation/funding-history.json";

/** "Today's hourly funding for the whole period", tested on Hyperliquid's hourly history (SoDEX publishes none). */
const fcache = new Map<string, FundingTest>();
export function fundingTest(asset: "BTC" | "ETH"): FundingTest {
  if (fcache.has(asset)) return fcache.get(asset)!;
  const f = funding as any;
  const out: FundingTest = { ...fundingBacktest(f.coins[asset], undefined, HOURS_PER_YEAR), asset, frozenAt: f.frozenAt, venue: "Hyperliquid" };
  fcache.set(asset, out);
  return out;
}

/**
 * Share of historical windows (same venue and holding period) whose cumulative funding
 * averaged below `annualRate` a year. Used to put a perp's break-even funding in context.
 */
const paidCache = new Map<string, number[]>();
export function fundingShareBelow(asset: "BTC" | "ETH", months: number, annualRate: number): { below: number; n: number } {
  const key = `${asset}:${months}`;
  if (!paidCache.has(key)) paidCache.set(key, fundingPaid((funding as any).coins[asset], months, HOURS_PER_YEAR));
  const xs = paidCache.get(key)!;
  const limit = annualRate * (months / 12);
  return { below: xs.filter((x) => x < limit).length, n: xs.length };
}

export const afterFile = "data/validation/etf-premium-after.json";
export type OutOfSample = import("./backtest").OosResult & { asset: "BTC" | "ETH"; fetchedAt: string };

/** The frozen p90s checked on sessions that closed after the dataset was frozen. */
const oosCache = new Map<string, OutOfSample>();
export function premiumOutOfSample(asset: "BTC" | "ETH"): OutOfSample {
  if (oosCache.has(asset)) return oosCache.get(asset)!;
  const a = (history as any).assets[asset].funds;
  const b = (after as any).assets[asset].funds;
  const out = { ...outOfSample(a, b, premiumBacktest(asset)), asset, fetchedAt: (after as any).frozenAt };
  oosCache.set(asset, out);
  return out;
}
