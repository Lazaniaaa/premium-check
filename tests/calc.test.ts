import { describe, expect, it } from "vitest";
import { annualFunding, holdingCost, maxSizeWithin, mnav, roundTrip, walkAsks } from "@/lib/calc";

describe("walkAsks", () => {
  const asks: [number, number][] = [
    [100, 1], // $100
    [101, 2], // $202
    [110, 10],
  ];
  it("fills across levels and reports VWAP and slippage", () => {
    const f = walkAsks(asks, 200);
    expect(f.complete).toBe(true);
    expect(f.filledUsd).toBeCloseTo(200);
    expect(f.qty).toBeCloseTo(1 + 100 / 101);
    expect(f.vwap!).toBeCloseTo(200 / (1 + 100 / 101));
    expect(f.slippageBps!).toBeGreaterThan(0);
  });
  it("flags an order larger than the visible book", () => {
    const f = walkAsks(asks, 10_000);
    expect(f.complete).toBe(false);
    expect(f.filledUsd).toBeCloseTo(100 + 202 + 1100);
  });
  it("maxSizeWithin stops at the bps limit", () => {
    expect(maxSizeWithin(asks, 150)).toBeCloseTo(302); // 101 is within 1.5%, 110 is not
  });
});

describe("costs", () => {
  it("annualises SoDEX hourly funding", () => {
    // 0.0000125/h is SoDEX' baseline (0.03%/day interest component)
    expect(annualFunding(0.0000125)).toBeCloseTo(0.1095, 4);
  });
  it("adds entry premium and pro-rated carry", () => {
    expect(holdingCost(0.001, 0.0025, 12)).toBeCloseTo(0.0035);
    expect(holdingCost(0.001, 0.12, 3)).toBeCloseTo(0.031);
  });
});

describe("mnav", () => {
  it("computes equity and debt-adjusted mNAV", () => {
    const m = mnav({ price: 10, shares: 100, btcHolding: 1, btcPrice: 500, debt: 300, cash: 100 });
    expect(m.equity).toBeCloseTo(2); // 1000 / 500
    expect(m.withDebt).toBeCloseTo(2.4); // (1000 + 300 - 100) / 500
    expect(m.btcPer1000).toBeCloseTo(1);
  });
  it("returns nulls on missing inputs instead of NaN", () => {
    expect(mnav({ price: 0, shares: 1, btcHolding: 1, btcPrice: 1 }).equity).toBeNull();
  });
});

describe("roundTrip", () => {
  it("costs at least the spread plus two fees, even when the market trades below an index", () => {
    // a wrapped token trading ~0.1% under the index: bid 99.9 / ask 100.0
    const book = { bids: [[99.9, 100]] as [number, number][], asks: [[100, 100]] as [number, number][] };
    const rt = roundTrip(book, 1000, 0.00065)!;
    expect(rt.total).toBeGreaterThan(0.001); // spread 10 bps + 2 x 6.5 bps
    expect(rt.total).toBeCloseTo(0.001 + 2 * 0.00065, 4);
  });
});
