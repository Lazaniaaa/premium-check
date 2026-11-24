// "Insight -> action" bridge: the exact order a user would sign on SoDEX for the
// route they picked. Pure function; nothing here signs or sends anything.
// Schema: docs.sodex.com/for-developers/api-reference/trading-api/rest-v1/schema.md
import type { Fill } from "./calc";
import type { SymbolInfo } from "./sources";

// Enum integer values from the SoDEX schema
const SIDE_BUY = 1;
const TYPE_LIMIT = 1;
const TIF_IOC = 3;
const MODIFIER_NORMAL = 1;
const POSITION_BOTH = 1;

export type OrderTicket = {
  tradeUrl: string;
  endpoint: string;
  body: Record<string, unknown>;
  quantity: string;
  limitPrice: string;
  notional: number;
  warnings: string[];
};

const roundDown = (x: number, step: number) => (step > 0 ? Math.floor(x / step + 1e-9) * step : x);
const roundUp = (x: number, step: number) => (step > 0 ? Math.ceil(x / step - 1e-9) * step : x);

export function sodexTradeUrl(market: "perps" | "spot", info: Pick<SymbolInfo, "name" | "displayName">): string {
  return market === "perps"
    ? `https://sodex.com/trade/futures/${info.name}`
    : `https://sodex.com/trade/spot/${info.displayName.replace("/", "_")}`;
}

export function buildTicket(market: "perps" | "spot", info: SymbolInfo, fill: Fill, nowMs: number): OrderTicket | null {
  if (!fill.worstPrice || fill.qty <= 0) return null;
  const qtyNum = roundDown(fill.qty, info.stepSize);
  const priceNum = roundUp(fill.worstPrice, info.tickSize);
  const quantity = qtyNum.toFixed(info.quantityPrecision);
  const limitPrice = priceNum.toFixed(info.pricePrecision);
  const notional = qtyNum * priceNum;
  const warnings: string[] = [];
  if (qtyNum < info.minQuantity) warnings.push(`Quantity below the market minimum (${info.minQuantity}).`);
  if (info.minNotional && notional < info.minNotional) warnings.push(`Order value below SoDEX minimum of $${info.minNotional}.`);
  if (!fill.complete) warnings.push("The visible order book cannot fill the whole amount.");

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
    notional,
    warnings,
  };
}
