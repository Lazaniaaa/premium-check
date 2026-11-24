import { beforeAll, describe, expect, it } from "vitest";
import { walkAsks } from "@/lib/calc";
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

  it("rounds quantity down to the step and the limit price up to the tick", () => {
    const t = buildTicket("perps", btcPerp, walkAsks(asks, 1000), 0)!;
    expect(t.quantity).toBe("0.01666"); // 0.01 + 400/60003 = 0.016666… -> floor to 0.00001
    expect(t.limitPrice).toBe("60003"); // deepest level reached
    expect(t.warnings).toEqual([]);
  });

  it("matches the SoDEX perps order schema (enum integers, accountID placeholder)", () => {
    const t = buildTicket("perps", btcPerp, walkAsks(asks, 1000), 0)!;
    expect(t.endpoint).toBe("POST https://mainnet-gw.sodex.dev/api/v1/perps/trade/orders");
    expect(t.body).toMatchObject({
      symbolID: 1,
      orders: [{ modifier: 1, side: 1, type: 1, timeInForce: 3, reduceOnly: false, positionSide: 1 }],
    });
    expect(String(t.body.accountID)).toMatch(/your SoDEX account/);
  });

  it("warns below SoDEX' minimum order value", () => {
    const t = buildTicket("perps", btcPerp, walkAsks(asks, 5), 0)!;
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
  it("every SoDEX route carries a ticket whose order value stays within the requested amount", () => {
    for (const r of c.direct.filter((x) => x.kind !== "etf")) {
      expect(r.ticket).toBeTruthy();
      expect(r.ticket!.notional).toBeLessThanOrEqual(1000 * 1.01);
      expect(r.ticket!.notional).toBeGreaterThan(990);
    }
  });
  it("links MSTR to its SoDEX perp", () => {
    expect(c.companies.find((x) => x.ticker === "MSTR")!.sodexUrl).toBe("https://sodex.com/trade/futures/MSTR-USD");
  });
});
