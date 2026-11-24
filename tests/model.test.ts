// Runs the real pipeline on responses recorded from the live APIs (fixtures/),
// and cross-checks the results against numbers recomputed straight from raw JSON.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildComparison, type Comparison } from "@/lib/model";

const raw = (rel: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", rel), "utf8")).body.data;

let btc: Comparison;
let eth: Comparison;
beforeAll(async () => {
  process.env.DATA_SOURCE = "fixture";
  btc = await buildComparison("BTC", 1000, 12);
  eth = await buildComparison("ETH", 1000, 12);
});

describe("BTC comparison on recorded data", () => {
  it("uses the SoDEX BTC-USD index price as reference", () => {
    const t = raw("sodex/perps_markets_tickers.json").find((x: any) => x.symbol === "BTC-USD");
    expect(btc.reference.price).toBe(Number(t.indexPrice));
    expect(Math.abs(btc.reference.deviationBps!)).toBeLessThan(50); // SoSoValue agrees within 0.5%
  });

  it("has spot, perp and all 12 US BTC ETFs", () => {
    expect(btc.direct.find((r) => r.kind === "sodex_spot")).toBeTruthy();
    expect(btc.direct.find((r) => r.kind === "sodex_perp")).toBeTruthy();
    expect(btc.direct.filter((r) => r.kind === "etf")).toHaveLength(12);
  });

  it("perp carry equals hourly funding x 8760", () => {
    const t = raw("sodex/perps_markets_tickers.json").find((x: any) => x.symbol === "BTC-USD");
    const perp = btc.direct.find((r) => r.kind === "sodex_perp")!;
    expect(perp.annualCarry).toBeCloseTo(Number(t.fundingRate) * 8760, 10);
  });

  it("IBIT cost = 0.25% fee over 12 months; today's premium is shown, assumed unchanged at exit", () => {
    const hist = raw("sosovalue/etfs_IBIT_history.json");
    const ibit = btc.direct.find((r) => r.id === "etf-IBIT")!;
    expect(ibit.annualCarry).toBe(0.0025);
    expect(ibit.premiumNow).toBeCloseTo(hist[0].prem_dsc, 12);
    expect(ibit.cost).toBeCloseTo(0.0025, 12);
  });

  it("no route shows a negative cost (a discount is not a free gain)", () => {
    for (const r of [...btc.direct, ...eth.direct]) if (r.cost != null) expect(r.cost).toBeGreaterThanOrEqual(0);
  });

  it("does not rank FBTC on a fee SoSoValue reports as 0", () => {
    const fbtc = btc.direct.find((r) => r.id === "etf-FBTC")!;
    expect(fbtc.flags).toContain("fee_unverified");
    expect(fbtc.cost).toBeNull();
    expect(btc.direct.at(-1)!.cost).toBeNull(); // unranked rows sort last
  });

  it("MSTR mNAV recomputed from raw snapshot + holdings", () => {
    const mstr = btc.companies.find((c) => c.ticker === "MSTR")!;
    const snap = raw("sosovalue/crypto-stocks_MSTR_market-snapshot.json");
    const hold = Number(raw("sosovalue/btc-treasuries_MSTR_purchase-history__limit-100.json")[0].btc_holding);
    expect(hold).toBe(851305);
    // snapshot says AFTER_HOURS, so the live price comes from SoDEX MSTR-USD
    expect(mstr.priceSource).toBe("sodex_24_7");
    const mark = Number(raw("sodex/perps_markets_tickers.json").find((x: any) => x.symbol === "MSTR-USD").markPrice);
    expect(mstr.price).toBe(mark);
    expect(mstr.mnavEquity).toBeCloseTo((mark * Number(snap.total_shares)) / (hold * btc.reference.price), 10);
    expect(mstr.mnavEquity!).toBeGreaterThan(0.4);
    expect(mstr.mnavEquity!).toBeLessThan(1.2);
    expect(mstr.mnavWithDebt!).toBeGreaterThan(mstr.mnavEquity!); // debt > cash at Strategy
  });

  it("never computes mNAV for operating companies", () => {
    const tsla = btc.companies.find((c) => c.ticker === "TSLA")!;
    expect(tsla.kind).toBe("operating");
    expect(tsla.mnavEquity).toBeNull();
    expect(tsla.btcShareOfMcap!).toBeLessThan(0.01);
  });

  it("drops tickers without a SoSoValue stock snapshot instead of guessing", () => {
    expect(btc.companies.find((c) => c.ticker === "CEP")).toBeUndefined(); // 404 upstream
  });

  it("SoDEX round trips are never cheaper than free", () => {
    for (const r of btc.direct.filter((x) => x.kind !== "etf")) expect(r.tradingCost!).toBeGreaterThan(0);
  });

  it("reports no upstream errors on the recorded set", () => {
    expect(btc.errors).toEqual([]);
  });
});

describe("ETH comparison on recorded data", () => {
  it("keeps funds under $100M out of the ranking", () => {
    const teth = eth.direct.find((r) => r.id === "etf-TETH")!; // ~$20M net assets in the recording
    expect(teth.flags).toContain("small_fund");
    expect(teth.ranked).toBe(false);
    const firstUnranked = eth.direct.findIndex((r) => !r.ranked);
    expect(eth.direct.slice(firstUnranked).every((r) => !r.ranked)).toBe(true);
  });

  it("keeps the staking ETF ETHB out of the ranking", () => {
    const ethb = eth.direct.find((r) => r.id === "etf-ETHB")!;
    expect(ethb.flags).toContain("staking_unmodeled");
    expect(ethb.ranked).toBe(false);
  });

  it("has 11 ETH ETFs and no treasury companies", () => {
    expect(eth.direct.filter((r) => r.kind === "etf")).toHaveLength(11);
    expect(eth.companies).toHaveLength(0);
  });
});

describe("edge cases found in review", () => {
  it("a partial fill shows what is fillable, never a full-size quantity", async () => {
    process.env.DATA_SOURCE = "fixture";
    const big = await buildComparison("ETH", 1_000_000, 24);
    const spot = big.direct.find((r) => r.kind === "sodex_spot")!;
    expect(spot.flags).toContain("book_too_thin");
    expect(spot.units).toBeNull();
    expect(spot.cost).toBeNull();
    expect(spot.fillableUsd!).toBeLessThan(1_000_000);
  });

  it("a cold BTC render stays within one minute of the SoSoValue key limit", async () => {
    process.env.DATA_SOURCE = "fixture";
    const { recentCalls } = await import("@/lib/http");
    const before = recentCalls().length;
    await buildComparison("BTC", 1000, 12);
    const soso = recentCalls().slice(before).filter((c) => c.source !== "sodex");
    expect(soso.length).toBeLessThanOrEqual(85);
  });

  it("reports companies it could not value instead of dropping them silently", () => {
    expect(btc.coverage!.noStockData).toEqual(expect.arrayContaining(["CEP", "BSTR"]));
    expect(btc.coverage!.shown).toBe(btc.companies.length);
  });
});
