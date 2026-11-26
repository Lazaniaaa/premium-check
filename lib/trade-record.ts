// Pure evaluation of one SoDEX spot round trip against the prediction published before it.
// No imports, no I/O: scripts/record-fill.mjs fetches the fills of the two orders and the
// GitHub push time, then calls evaluateRoundTrip; tests/trade-record.test.ts covers it.
//
// An attempt is "complete" only if: the buy order and the sell order both have fills, every
// fill is on the predicted symbol with the expected side, all fills come after the book the
// prediction used, sells come after buys, fees are in the base or quote coin, and the coin
// left over after fees is smaller than one lot step. Anything else is "partial" (with the
// reasons) or "failed" (no fills). It is "verified" only if it is complete AND GitHub's
// server time for the push of the prediction commit is before the first fill.

export type Fill = {
  tradeID: number;
  orderID: number;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  fee: number;
  feeCoin: string;
  isMaker: boolean | null;
  time: number; // ms
};

export type PredictionFile = {
  symbol: string;
  usd: number;
  bookTime: string;
  feeRates: { model: number; symbolTaker: number };
  lot: { stepSize: string | number; minNotional: string | number };
  predicted: { mid: number; buyVwap: number; sellVwap: number; roundTripCost: number; roundTripUsd: number };
};

export type TradeLeg = {
  orderID: number;
  fills: number;
  predictedVwap: number;
  actualVwap: number | null;
  diffBps: number | null; // positive = worse for you than predicted
  qty: number;
  feePaid: number;
  feeAsset: string;
  feeRate: number | null; // fee value / notional actually charged
  makerFills: number;
};

export type TradeStatus = "complete" | "partial" | "failed";

export type TradeRecord = {
  status: TradeStatus;
  verified: boolean;
  reasons: string[]; // why it is not complete / verified; empty when verified
  symbol: string;
  usd: number;
  predictionFile: string;
  predictionCommit: string | null; // commit that published the prediction
  predictionPushedAt: string | null; // GitHub server time of that push
  predictedAt: string; // book block time used by the prediction
  firstFillAt: string | null;
  lastFillAt: string | null;
  bookToBuySeconds: number | null;
  buyToSellSeconds: number | null;
  account: string;
  accountID: number | null;
  tradeIds: number[];
  feeRates: { model: number; symbol: number };
  stepSize: number;
  buy: TradeLeg;
  sell: TradeLeg;
  usdcSpent: number | null;
  usdcReturned: number | null;
  baseLeft: number | null; // coin not sold back (lot rounding and fees in coin)
  predictedCostUsd: number;
  actualCostUsd: number | null; // usdcSpent - usdcReturned - value of baseLeft at the sell VWAP (negative baseLeft = coin from an earlier balance, adds to cost)
  predictedCostBps: number;
  actualCostBps: number | null;
  note?: string;
};

const num = (x: unknown) => (x === null || x === undefined || x === "" ? NaN : Number(x));

/** Strict parse of a SoDEX UserTrade; throws on anything unexpected instead of guessing. */
export function parseUserTrade(x: Record<string, unknown>): Fill {
  const side = String(x.side ?? "").toUpperCase();
  const f: Fill = {
    tradeID: num(x.tradeID),
    orderID: num(x.orderID),
    symbol: String(x.symbol ?? ""),
    side: side as Fill["side"],
    price: num(x.price),
    quantity: num(x.quantity),
    fee: x.fee === undefined || x.fee === null || x.fee === "" ? 0 : num(x.fee),
    feeCoin: String(x.feeCoin ?? ""),
    isMaker: typeof x.isMaker === "boolean" ? x.isMaker : null,
    time: num(x.time),
  };
  const bad = (["tradeID", "orderID", "price", "quantity", "fee", "time"] as const).filter((k) => !Number.isFinite(f[k]));
  if (bad.length || !f.symbol || (side !== "BUY" && side !== "SELL")) {
    throw new Error(`unexpected UserTrade fields (${[...bad, !f.symbol ? "symbol" : "", side !== "BUY" && side !== "SELL" ? "side" : ""].filter(Boolean).join(", ")}): ${JSON.stringify(x)}`);
  }
  return f;
}

export function evaluateRoundTrip(a: {
  pred: PredictionFile;
  predictionFile: string;
  buyOrderID: number;
  sellOrderID: number;
  buyFills: Fill[];
  sellFills: Fill[];
  account: string;
  accountID?: number | null;
  predictionCommit?: string | null;
  predictionPushedAt?: string | null;
}): TradeRecord {
  const { pred } = a;
  const [base, quote] = pred.symbol.split("_");
  const step = Number(pred.lot.stepSize);
  const t0 = Date.parse(pred.bookTime);
  const reasons: string[] = [];
  const buys = [...a.buyFills].sort((x, y) => x.time - y.time);
  const sells = [...a.sellFills].sort((x, y) => x.time - y.time);
  const all = [...buys, ...sells].sort((x, y) => x.time - y.time);

  for (const [name, xs, id, side] of [["buy", buys, a.buyOrderID, "BUY"], ["sell", sells, a.sellOrderID, "SELL"]] as const) {
    if (xs.some((f) => f.orderID !== id)) reasons.push(`a ${name} fill belongs to another order`);
    if (xs.some((f) => f.symbol !== pred.symbol)) reasons.push(`a ${name} fill is not on ${pred.symbol}`);
    if (xs.some((f) => f.side !== side)) reasons.push(`a ${name} fill has side ${xs.find((f) => f.side !== side)!.side}`);
  }
  if (all.some((f) => f.time < t0)) reasons.push("a fill happened before the order book the prediction used");
  if (buys.length && sells.length && sells[0].time < buys.at(-1)!.time) reasons.push("selling started before buying finished");
  const unknownFee = [...new Set(all.filter((f) => f.fee !== 0 && f.feeCoin !== base && f.feeCoin !== quote).map((f) => f.feeCoin))];
  if (unknownFee.length) reasons.push(`fee charged in ${unknownFee.join(", ")}, which is not valued here`);

  const leg = (xs: Fill[], orderID: number, predictedVwap: number, buy: boolean): TradeLeg & { notional: number; feeBase: number; feeQuote: number } => {
    const qty = xs.reduce((s, f) => s + f.quantity, 0);
    const notional = xs.reduce((s, f) => s + f.quantity * f.price, 0);
    const vwap = qty > 0 ? notional / qty : null;
    const feeBase = xs.reduce((s, f) => s + (f.feeCoin === base ? f.fee : 0), 0);
    const feeQuote = xs.reduce((s, f) => s + (f.feeCoin === quote ? f.fee : 0), 0);
    const feeValue = xs.reduce((s, f) => s + (f.feeCoin === base ? f.fee * f.price : f.feeCoin === quote ? f.fee : 0), 0);
    return {
      orderID,
      fills: xs.length,
      predictedVwap,
      actualVwap: vwap,
      diffBps: vwap == null ? null : ((buy ? vwap - predictedVwap : predictedVwap - vwap) / predictedVwap) * 1e4,
      qty,
      feePaid: Number((feeBase || feeQuote).toPrecision(6)),
      feeAsset: [...new Set(xs.map((f) => f.feeCoin))].join("+"),
      feeRate: notional > 0 ? feeValue / notional : null,
      makerFills: xs.filter((f) => f.isMaker === true).length,
      notional,
      feeBase,
      feeQuote,
    };
  };
  const p = pred.predicted;
  const B = leg(buys, a.buyOrderID, p.buyVwap, true);
  const S = leg(sells, a.sellOrderID, p.sellVwap, false);

  let status: TradeStatus = "complete";
  let usdcSpent: number | null = null, usdcReturned: number | null = null, baseLeft: number | null = null, actualCostUsd: number | null = null;
  if (!buys.length) {
    status = "failed";
    reasons.unshift("the buy order has no fills");
  } else {
    if (!sells.length) reasons.unshift("the sell order has no fills");
    usdcSpent = B.notional + B.feeQuote;
    usdcReturned = S.notional - S.feeQuote;
    baseLeft = Number((B.qty - B.feeBase - S.qty - S.feeBase).toFixed(12));
    if (baseLeft < -1e-12) reasons.push(`sold ${(-baseLeft).toPrecision(3)} ${base} more than bought`);
    else if (baseLeft >= step - 1e-12) reasons.push(`${baseLeft} ${base} left, more than one lot step (${step})`);
    if (sells.length) actualCostUsd = usdcSpent - usdcReturned - baseLeft * (S.actualVwap ?? 0);
    if (reasons.length) status = "partial";
  }
  const pushed = a.predictionPushedAt ? Date.parse(a.predictionPushedAt) : NaN;
  if (status === "complete") {
    if (!a.predictionCommit) reasons.push("no prediction commit given");
    else if (!Number.isFinite(pushed)) reasons.push("no GitHub push time found for the prediction commit");
    else if (pushed >= all[0].time) reasons.push("the prediction was pushed after the first fill");
  }
  const strip = ({ notional, feeBase, feeQuote, ...l }: ReturnType<typeof leg>): TradeLeg => l;
  return {
    status,
    verified: status === "complete" && reasons.length === 0,
    reasons,
    symbol: pred.symbol,
    usd: pred.usd,
    predictionFile: a.predictionFile,
    predictionCommit: a.predictionCommit ?? null,
    predictionPushedAt: a.predictionPushedAt ?? null,
    predictedAt: pred.bookTime,
    firstFillAt: all.length ? new Date(all[0].time).toISOString() : null,
    lastFillAt: all.length ? new Date(all.at(-1)!.time).toISOString() : null,
    bookToBuySeconds: buys.length ? (buys[0].time - t0) / 1000 : null,
    buyToSellSeconds: buys.length && sells.length ? (sells[0].time - buys.at(-1)!.time) / 1000 : null,
    account: a.account,
    accountID: a.accountID ?? null,
    tradeIds: all.map((f) => f.tradeID),
    feeRates: { model: pred.feeRates.model, symbol: pred.feeRates.symbolTaker },
    stepSize: step,
    buy: strip(B),
    sell: strip(S),
    usdcSpent,
    usdcReturned,
    baseLeft,
    predictedCostUsd: p.roundTripUsd,
    actualCostUsd,
    predictedCostBps: p.roundTripCost * 1e4,
    actualCostBps: actualCostUsd != null && usdcSpent ? (actualCostUsd / usdcSpent) * 1e4 : null,
  };
}
