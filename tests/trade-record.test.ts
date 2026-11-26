import { describe, expect, it } from "vitest";
import { evaluateRoundTrip, parseUserTrade, type Fill, type PredictionFile } from "@/lib/trade-record";

const pred: PredictionFile = {
  symbol: "vBTC_vUSDC",
  usd: 20,
  bookTime: "2026-11-26T20:00:00.000Z",
  feeRates: { model: 0.00065, symbolTaker: 0.00065 },
  lot: { stepSize: "0.00001", minNotional: "5" },
  predicted: { mid: 60000, buyVwap: 60010, sellVwap: 59990, roundTripCost: 0.00163, roundTripUsd: 0.0326 },
};
const T = Date.parse(pred.bookTime);
const fill = (o: Partial<Fill>): Fill => ({
  tradeID: 1,
  orderID: 11,
  symbol: "vBTC_vUSDC",
  side: "BUY",
  price: 60010,
  quantity: 0.00033,
  fee: 0,
  feeCoin: "vUSDC",
  isMaker: false,
  time: T + 5_000,
  ...o,
});
// Buy 0.00033 BTC paying the fee in BTC, then sell what is left (rounded down to the lot step).
const buy = fill({ fee: 0.00000021, feeCoin: "vBTC" });
const sell = fill({ tradeID: 2, orderID: 22, side: "SELL", price: 59990, quantity: 0.00032, fee: 0.0125, feeCoin: "vUSDC", time: T + 9_000 });
const base = { pred, predictionFile: "data/validation/predictions/x.json", buyOrderID: 11, sellOrderID: 22, account: "0xabc" };
const pushedBefore = { predictionCommit: "abc1234", predictionPushedAt: new Date(T + 1_000).toISOString() };

describe("trade record", () => {
  it("a full round trip pushed before the first fill is complete and verified", () => {
    const r = evaluateRoundTrip({ ...base, ...pushedBefore, buyFills: [buy], sellFills: [sell] });
    expect(r.status).toBe("complete");
    expect(r.verified).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.baseLeft).toBeCloseTo(0.00033 - 0.00000021 - 0.00032, 12);
    expect(r.usdcSpent).toBeCloseTo(0.00033 * 60010, 9);
    expect(r.usdcReturned).toBeCloseTo(0.00032 * 59990 - 0.0125, 9);
    expect(r.actualCostUsd).toBeCloseTo(r.usdcSpent! - r.usdcReturned! - r.baseLeft! * 59990, 9);
    expect(r.bookToBuySeconds).toBe(5);
    expect(r.buyToSellSeconds).toBe(4);
    expect(r.buy.diffBps).toBeCloseTo(0);
  });

  it("selling only part of what was bought is partial, not verified", () => {
    const r = evaluateRoundTrip({ ...base, ...pushedBefore, buyFills: [buy], sellFills: [{ ...sell, quantity: 0.0001 }] });
    expect(r.status).toBe("partial");
    expect(r.verified).toBe(false);
    expect(r.reasons.join()).toMatch(/more than one lot step/);
  });

  it("a fill of another order in the same window is flagged, not silently used", () => {
    const r = evaluateRoundTrip({ ...base, ...pushedBefore, buyFills: [buy, { ...buy, tradeID: 9, orderID: 99 }], sellFills: [sell] });
    expect(r.status).toBe("partial");
    expect(r.reasons.join()).toMatch(/another order/);
  });

  it("no buy fills is a failed attempt; no sell fills is partial", () => {
    expect(evaluateRoundTrip({ ...base, ...pushedBefore, buyFills: [], sellFills: [] }).status).toBe("failed");
    const r = evaluateRoundTrip({ ...base, ...pushedBefore, buyFills: [buy], sellFills: [] });
    expect(r.status).toBe("partial");
    expect(r.actualCostUsd).toBeNull();
  });

  it("an unknown fee coin or a prediction pushed after the fill blocks verification", () => {
    const fee = evaluateRoundTrip({ ...base, ...pushedBefore, buyFills: [buy], sellFills: [{ ...sell, feeCoin: "SOSO" }] });
    expect(fee.status).toBe("partial");
    expect(fee.reasons.join()).toMatch(/SOSO/);
    const late = evaluateRoundTrip({ ...base, predictionCommit: "abc", predictionPushedAt: new Date(T + 60_000).toISOString(), buyFills: [buy], sellFills: [sell] });
    expect(late.status).toBe("complete");
    expect(late.verified).toBe(false);
    expect(late.reasons.join()).toMatch(/pushed after/);
  });

  it("parses SoDEX UserTrade strictly", () => {
    const f = parseUserTrade({ symbol: "vBTC_vUSDC", tradeID: 5, orderID: "7", clOrdID: "", side: "BUY", price: "60000", quantity: "0.0003", fee: "0.0000002", feeCoin: "vBTC", isMaker: false, time: 1 });
    expect(f).toMatchObject({ tradeID: 5, orderID: 7, side: "BUY", price: 60000, fee: 0.0000002, feeCoin: "vBTC" });
    expect(() => parseUserTrade({ symbol: "vBTC_vUSDC", side: "BUY", price: "1" })).toThrow(/unexpected UserTrade/);
  });
});
