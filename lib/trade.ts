// "Insight -> action" bridge: the exact order a user would sign on SoDEX for the
// route they picked. Pure function; nothing here signs or sends anything.
// Schema: docs.sodex.com/for-developers/api-reference/trading-api/rest-v1/schema.md
import { walkAsks } from "./calc";
import type { BookLevel, SymbolInfo } from "./sources";

// Enum integer values from the SoDEX schema
const SIDE_BUY = 1;
const TYPE_LIMIT = 1;
const TIF_IOC = 3;
const MODIFIER_NORMAL = 1;
const POSITION_BOTH = 1;

/** The ticket never bids more than this above the best ask. */
export const MAX_TICKET_SLIPPAGE_BPS = 50;

export type OrderTicket = {
  tradeUrl: string;
  endpoint: string;
  body: Record<string, unknown>;
  quantity: string;
  limitPrice: string;
  maxSpend: number; // quantity x limit price x (1 + fee): the most this order can cost
  fillableAtLimit: number; // quantity resting at or below the limit price right now
  warnings: string[];
};

const roundDown = (x: number, step: number) => (step > 0 ? Math.floor(x / step + 1e-9) * step : x);
const roundUp = (x: number, step: number) => (step > 0 ? Math.ceil(x / step - 1e-9) * step : x);

export function sodexTradeUrl(market: "perps" | "spot", info: Pick<SymbolInfo, "name" | "displayName">): string {
  return market === "perps"
    ? `https://sodex.com/trade/futures/${info.name}`
    : `https://sodex.com/trade/spot/${info.displayName.replace("/", "_")}`;
}

/**
 * IOC limit buy for at most `usd` including the taker fee. The limit is the deepest
 * level needed to fill `usd`, capped at best ask + MAX_TICKET_SLIPPAGE_BPS; the
 * quantity is sized so that quantity x limit x (1 + fee) never exceeds `usd`.
 */
export function buildTicket(
  market: "perps" | "spot",
  info: SymbolInfo,
  asks: BookLevel[],
  usd: number,
  fee: number,
  nowMs: number,
): OrderTicket | null {
  const best = asks[0]?.[0];
  if (!best || usd <= 0) return null;
  const cap = best * (1 + MAX_TICKET_SLIPPAGE_BPS / 1e4);
  const worst = walkAsks(asks, usd).worstPrice ?? best;
  let priceNum = roundUp(Math.min(worst, cap), info.tickSize);
  if (priceNum > cap) priceNum = roundDown(cap, info.tickSize);
  if (priceNum < best) priceNum = best;
  const qtyNum = roundDown(usd / (priceNum * (1 + fee)), info.stepSize);
  const maxSpend = qtyNum * priceNum * (1 + fee);
  const fillableAtLimit = asks.filter(([px]) => px <= priceNum).reduce((s, [, sz]) => s + sz, 0);

  const warnings: string[] = [];
  if (qtyNum < info.minQuantity) warnings.push(`Quantity below the market minimum (${info.minQuantity}).`);
  if (info.minNotional && qtyNum * priceNum < info.minNotional) warnings.push(`Order value below SoDEX minimum of $${info.minNotional}.`);
  if (worst > cap) warnings.push(`Filling the full amount needs more than ${MAX_TICKET_SLIPPAGE_BPS / 100}% above the best ask; the limit is capped there.`);
  if (fillableAtLimit + 1e-12 < qtyNum) warnings.push("Only part of this quantity rests at or below the limit; IOC cancels the rest.");

  const quantity = qtyNum.toFixed(info.quantityPrecision);
  const limitPrice = priceNum.toFixed(info.pricePrecision);
  const clOrdID = `pc-${nowMs.toString(36)}`;
  const order =
    market === "perps"
      ? {
          clOrdID,
          modifier: MODIFIER_NORMAL,
          side: SIDE_BUY,
          type: TYPE_LIMIT,
          timeInForce: TIF_IOC,
          price: limitPrice,
          quantity,
          reduceOnly: false,
          positionSide: POSITION_BOTH,
        }
      : { symbolID: info.id, clOrdID, side: SIDE_BUY, type: TYPE_LIMIT, timeInForce: TIF_IOC, price: limitPrice, quantity };
  const body =
    market === "perps"
      ? { accountID: "<your SoDEX account ID>", symbolID: info.id, orders: [order] }
      : { accountID: "<your SoDEX account ID>", orders: [order] };

  return {
    tradeUrl: sodexTradeUrl(market, info),
    endpoint: `POST https://mainnet-gw.sodex.dev/api/v1/${market}/trade/orders`,
    body,
    quantity,
    limitPrice,
    maxSpend,
    fillableAtLimit,
    warnings,
  };
}
