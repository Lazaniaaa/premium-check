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

  it("IBIT cost = latest premium + 0.25% fee", () => {
    const hist = raw("sosovalue/etfs_IBIT_history.json");
    const ibit = btc.direct.find((r) => r.id === "etf-IBIT")!;
    expect(ibit.annualCarry).toBe(0.0025);
    expect(ibit.entryPremium).toBeCloseTo(hist[0].prem_dsc, 12);
    expect(ibit.cost).toBeCloseTo(hist[0].prem_dsc + 0.0025, 12);
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
    for (const r of btc.direct.filter((x) => x.kind !== "etf")) expect(r.entryPremium!).toBeGreaterThan(0);
  });

  it("reports no upstream errors on the recorded set", () => {
    expect(btc.errors).toEqual([]);
  });
});

describe("ETH comparison on recorded data", () => {
  it("has 11 ETH ETFs and no treasury companies", () => {
    expect(eth.direct.filter((r) => r.kind === "etf")).toHaveLength(11);
    expect(eth.companies).toHaveLength(0);
  });
});
