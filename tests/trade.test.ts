import { beforeAll, describe, expect, it } from "vitest";
import { buildTicket, sodexTradeUrl } from "@/lib/trade";
import { buildComparison, type Comparison } from "@/lib/model";
import type { SymbolInfo } from "@/lib/sources";

// BTC-USD perp parameters as returned by SoDEX /perps/markets/symbols (recorded 25 Nov 2026)
const btcPerp: SymbolInfo = {
  id: 1,
  name: "BTC-USD",
  displayName: "BTC-USD",
  tickSize: 1,
  stepSize: 0.00001,
  quantityPrecision: 5,
  pricePrecision: 0,
  minQuantity: 0.00001,
  minNotional: 10,
};

describe("order ticket", () => {
  const asks: [number, number][] = [
    [60000.4, 0.01], // $600
    [60003, 0.05],
  ];

  it("limit = deepest level needed (on the tick); quantity sized so the order can't exceed the budget", () => {
    const t = buildTicket("perps", btcPerp, asks, 1000, 0.0004, 0)!;
    expect(t.limitPrice).toBe("60003");
    expect(t.quantity).toBe("0.01665"); // floor(1000 / (60003 x 1.0004)) to 0.00001
    expect(t.maxSpend).toBeLessThanOrEqual(1000);
    expect(t.warnings).toEqual([]);
  });

  it("never bids more than 0.5% above the best ask, and says so", () => {
    const thin: [number, number][] = [[100, 1], [200, 100]];
    const info = { ...btcPerp, tickSize: 0.01, pricePrecision: 2, stepSize: 0.001, quantityPrecision: 3 };
    const t = buildTicket("spot", info, thin, 1000, 0.00065, 0)!;
    expect(Number(t.limitPrice)).toBeLessThanOrEqual(100.5);
    expect(t.maxSpend).toBeLessThanOrEqual(1000);
    expect(t.warnings.join()).toMatch(/0.5% above the best ask/);
    expect(t.warnings.join()).toMatch(/IOC cancels the rest/);
  });

  it("matches the SoDEX perps order schema (enum integers, accountID placeholder)", () => {
    const t = buildTicket("perps", btcPerp, asks, 1000, 0.0004, 0)!;
    expect(t.endpoint).toBe("POST https://mainnet-gw.sodex.dev/api/v1/perps/trade/orders");
    expect(t.body).toMatchObject({
      symbolID: 1,
      orders: [{ modifier: 1, side: 1, type: 1, timeInForce: 3, reduceOnly: false, positionSide: 1 }],
    });
    expect(String(t.body.accountID)).toMatch(/your SoDEX account/);
  });

  it("warns below SoDEX' minimum order value", () => {
    const t = buildTicket("perps", btcPerp, asks, 5, 0.0004, 0)!;
    expect(t.warnings.join()).toMatch(/minimum/);
  });

  it("builds the trade URLs SoDEX uses", () => {
    expect(sodexTradeUrl("perps", { name: "MSTR-USD", displayName: "MSTR-USD" })).toBe("https://sodex.com/trade/futures/MSTR-USD");
    expect(sodexTradeUrl("spot", { name: "vBTC_vUSDC", displayName: "BTC/USDC" })).toBe("https://sodex.com/trade/spot/BTC_USDC");
  });
});

describe("tickets on recorded data", () => {
  let c: Comparison;
  beforeAll(async () => {
    process.env.DATA_SOURCE = "fixture";
    c = await buildComparison("BTC", 1000, 12);
  });
  it("every SoDEX route carries a ticket that can never cost more than the amount", () => {
    for (const r of c.direct.filter((x) => x.kind !== "etf")) {
      expect(r.ticket).toBeTruthy();
      expect(r.ticket!.maxSpend).toBeLessThanOrEqual(1000);
      expect(r.ticket!.maxSpend).toBeGreaterThan(985);
    }
  });
  it("links MSTR to its SoDEX perp", () => {
    expect(c.companies.find((x) => x.ticker === "MSTR")!.sodexUrl).toBe("https://sodex.com/trade/futures/MSTR-USD");
  });
});
