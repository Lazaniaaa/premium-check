// Pure, deterministic math. No I/O, no LLM. Everything shown in the UI comes from here.
import type { BookLevel } from "./sources";

/** SoDEX tier-0 taker fees (docs.sodex.com/trading-mechanics/trading-fees, from 13 Mar 2026). */
export const SODEX_FEES = { spotTaker: 0.00065, perpTaker: 0.0004 } as const;
export const HOURS_PER_YEAR = 24 * 365;

export type Fill = {
  requestedUsd: number;
  filledUsd: number;
  qty: number;
  vwap: number | null;
  bestPrice: number | null;
  worstPrice: number | null; // deepest level the order reaches (an IOC limit at this price fills it)
  slippageBps: number | null; // vwap vs best level
  complete: boolean; // false if the visible book could not absorb the order
};

/** Market-buy `usd` against ascending ask levels; returns what the visible book can fill. */
export function walkAsks(asks: BookLevel[], usd: number): Fill {
  let left = usd;
  let qty = 0;
  let spent = 0;
  let worst: number | null = null;
  for (const [px, sz] of asks) {
    if (left <= 1e-9) break;
    const levelUsd = px * sz;
    const take = Math.min(levelUsd, left);
    qty += take / px;
    spent += take;
    left -= take;
    worst = px;
  }
  const best = asks[0]?.[0] ?? null;
  const vwap = qty > 0 ? spent / qty : null;
  return {
    requestedUsd: usd,
    filledUsd: spent,
    qty,
    vwap,
    bestPrice: best,
    worstPrice: worst,
    slippageBps: vwap && best ? (vwap / best - 1) * 1e4 : null,
    complete: left <= 1e-6,
  };
}

/** Market-sell `qty` units against descending bid levels. */
export function walkBids(bids: BookLevel[], qty: number): { qty: number; usd: number; vwap: number | null; complete: boolean } {
  let left = qty;
  let got = 0;
  for (const [px, sz] of bids) {
    if (left <= 1e-12) break;
    const take = Math.min(sz, left);
    got += take * px;
    left -= take;
  }
  const sold = qty - left;
  return { qty: sold, usd: got, vwap: sold > 0 ? got / sold : null, complete: left <= 1e-9 };
}

export const midPrice = (bids: BookLevel[], asks: BookLevel[]) =>
  bids[0] && asks[0] ? (bids[0][0] + asks[0][0]) / 2 : null;

/**
 * Round-trip trading cost: buy `usd` into today's asks, sell the same quantity into
 * today's bids, fees both ways. Returned as the fraction of the money spent that is
 * lost: 1 - sellProceeds / buySpend. Measuring the venue against itself (not an
 * external index) means a persistent basis, e.g. a wrapped token trading a few bps
 * under the index, is neither a gain nor a loss — it is paid and received alike, as
 * long as it stays the same. Tomorrow's book may differ: this is today's friction.
 */
export function roundTrip(book: { bids: BookLevel[]; asks: BookLevel[] }, usd: number, fee: number) {
  const mid = midPrice(book.bids, book.asks);
  const buy = walkAsks(book.asks, usd);
  const sell = walkBids(book.bids, buy.qty);
  if (!mid || !buy.vwap || !sell.vwap) return null;
  const total = 1 - (sell.vwap * (1 - fee)) / (buy.vwap * (1 + fee));
  return { mid, buy, sell, total, complete: buy.complete && sell.complete };
}

/**
 * Largest USD order whose average fill price (VWAP) stays within `maxBps` of the
 * best ask. Includes the part of the last level that keeps the average at the limit.
 */
export function maxSizeVwapWithin(asks: BookLevel[], maxBps: number): number {
  const best = asks[0]?.[0];
  if (!best) return 0;
  const limit = best * (1 + maxBps / 1e4);
  let qty = 0;
  let spent = 0;
  for (const [px, sz] of asks) {
    if ((spent + px * sz) / (qty + sz) <= limit) {
      qty += sz;
      spent += px * sz;
      continue;
    }
    // take x units of this level so that (spent + px*x) / (qty + x) == limit
    if (px > limit) spent += px * Math.max(0, (limit * qty - spent) / (px - limit));
    break;
  }
  return spent;
}

/**
 * The common yardstick for every route: what fraction of your money is lost
 * versus owning the asset at the reference price, after `months` of holding.
 *   entryPremium: paid above reference on the way in (fees, slippage, ETF premium)
 *   annualCarry:  recurring cost per year (ETF sponsor fee, perp funding)
 */
export function holdingCost(entryPremium: number, annualCarry: number, months: number): number {
  return entryPremium + annualCarry * (months / 12);
}

/** Units of the asset you effectively hold for `usd` after the holding cost. */
export function effectiveUnits(usd: number, refPrice: number, cost: number): number {
  return (usd / refPrice) * (1 - cost);
}

/** Annualised perp funding paid by a long, from SoDEX' hourly rate (positive = longs pay). */
export const annualFunding = (hourlyRate: number) => hourlyRate * HOURS_PER_YEAR;

export type Mnav = {
  equity: number | null; // market cap / BTC value (common equity only)
  withDebt: number | null; // (market cap + debt - cash) / BTC value; preferreds not included
  btcPer1000: number | null; // look-through BTC owned per $1,000 of stock
  btcPerShare: number | null;
};

export function mnav(args: {
  price: number;
  shares: number;
  btcHolding: number;
  btcPrice: number;
  debt?: number | null;
  cash?: number | null;
}): Mnav {
  const { price, shares, btcHolding, btcPrice } = args;
  if (!(price > 0 && shares > 0 && btcHolding > 0 && btcPrice > 0)) {
    return { equity: null, withDebt: null, btcPer1000: null, btcPerShare: null };
  }
  const mcap = price * shares;
  const nav = btcHolding * btcPrice;
  const withDebt =
    args.debt != null ? (mcap + args.debt - (args.cash ?? 0)) / nav : null;
  return {
    equity: mcap / nav,
    withDebt,
    btcPer1000: (1000 / mcap) * btcHolding,
    btcPerShare: btcHolding / shares,
  };
}

export function daysBetween(isoDate: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(isoDate + "T00:00:00Z").getTime()) / 86_400_000);
}
