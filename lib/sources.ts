// Typed accessors over the raw SoSoValue / SoDEX endpoints.
// Field quirks found on real responses (24 Nov 2026) are handled here, once:
//  - numbers often arrive as strings -> num()
//  - purchase-history `avg_btc_cost` is garbage (0.09) -> never used
//  - ETF market-snapshot `prem_dsc` is always null -> taken from /history
//  - /crypto-stocks/{t}/market-cap history disagrees with price x shares -> never used
import { getJson, maybe } from "./http";

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

// Cache windows (seconds). Worst case (page always busy) ≈ 800 SoSoValue calls/day:
// ~22 stock snapshots/hour + 46 ETF calls/6h + 36 holdings/12h + a few balances.
export const TTL = {
  sodexTicker: 30,
  sodexBook: 30,
  stockSnapshot: 3600,
  holdings: 43200,
  etf: 21600,
  balance: 86400,
  list: 86400,
} as const;

// ---------- SoDEX ----------
export type PerpTicker = {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  fundingRate: number; // per hour
  nextFundingTime: number;
  openInterest: number;
  quoteVolume: number;
};
export type BookLevel = [price: number, size: number];
export type Book = { bids: BookLevel[]; asks: BookLevel[]; blockTime?: number };

export async function perpTickers(): Promise<PerpTicker[]> {
  const raw = await getJson<any[]>("sodex", "/perps/markets/tickers", {}, TTL.sodexTicker);
  return raw.map((t) => ({
    symbol: t.symbol,
    markPrice: num(t.markPrice) ?? 0,
    indexPrice: num(t.indexPrice) ?? 0,
    fundingRate: num(t.fundingRate) ?? 0,
    nextFundingTime: Number(t.nextFundingTime ?? 0),
    openInterest: num(t.openInterest) ?? 0,
    quoteVolume: num(t.quoteVolume) ?? 0,
  }));
}

export async function orderbook(market: "perps" | "spot", symbol: string): Promise<Book> {
  const raw = await getJson<any>("sodex", `/${market}/markets/${symbol}/orderbook`, { limit: 100 }, TTL.sodexBook);
  const lv = (xs: any[]): BookLevel[] => (xs ?? []).map(([p, s]: [string, string]) => [Number(p), Number(s)]);
  return { bids: lv(raw.bids), asks: lv(raw.asks), blockTime: raw.blockTime };
}

export type SymbolInfo = {
  id: number;
  name: string;
  displayName: string;
  tickSize: number;
  stepSize: number;
  quantityPrecision: number;
  pricePrecision: number;
  minQuantity: number;
  minNotional: number;
};
export async function symbolInfo(market: "perps" | "spot", symbol: string): Promise<SymbolInfo | null> {
  const r = await maybe(getJson<any[]>("sodex", `/${market}/markets/symbols`, { symbol }, 3600));
  const s = r?.find((x) => x.name === symbol);
  if (!s) return null;
  return {
    id: Number(s.id),
    name: s.name,
    displayName: s.displayName ?? s.name,
    tickSize: num(s.tickSize) ?? 1,
    stepSize: num(s.stepSize) ?? 0,
    quantityPrecision: Number(s.quantityPrecision ?? 8),
    pricePrecision: Number(s.pricePrecision ?? 2),
    minQuantity: num(s.minQuantity) ?? 0,
    minNotional: num(s.minNotional) ?? 0,
  };
}

// ---------- SoSoValue: treasuries & stocks ----------
export type TreasuryListItem = { ticker: string; name: string; list_location: string };
export const treasuryList = () => getJson<TreasuryListItem[]>("sosovalue", "/btc-treasuries", {}, TTL.list);

export type Purchase = { date: string; btcHolding: number; btcAcq: number; acqCost: number };
export async function purchaseHistory(ticker: string): Promise<Purchase[]> {
  const raw = await getJson<any[]>("sosovalue", `/btc-treasuries/${ticker}/purchase-history`, { limit: 100 }, TTL.holdings);
  return raw.map((r) => ({
    date: r.date,
    btcHolding: num(r.btc_holding) ?? 0,
    btcAcq: num(r.btc_acq) ?? 0,
    acqCost: num(r.acq_cost) ?? 0,
  }));
}

export type StockSnapshot = {
  ticker: string;
  price: number;
  status: string;
  totalShares: number;
  at: number;
};
export async function stockSnapshot(ticker: string): Promise<StockSnapshot | null> {
  const r = await maybe(getJson<any>("sosovalue", `/crypto-stocks/${ticker}/market-snapshot`, {}, TTL.stockSnapshot));
  const price = num(r?.mkt_price);
  const shares = num(r?.total_shares);
  if (!r || !price || !shares) return null;
  return { ticker, price, status: String(r.mkt_status ?? ""), totalShares: shares, at: Number(r.timestamp ?? 0) };
}

/** Latest quarterly balance sheet from SoSoValue v3 (debt and cash; preferreds are not reported). */
export type Balance = { fiscalDate: string; knownAt: string; debt: number | null; cash: number | null };
export async function latestBalance(ticker: string): Promise<Balance | null> {
  const r = await maybe(
    getJson<any>("sosovalue-v3", `/parties/${ticker}/financials`, { period: "quarterly", statement: "balance" }, TTL.balance),
  );
  const st = r?.statements?.find((s: any) => s.statement === "balance");
  if (!st) return null;
  const li = st.line_items ?? {};
  const pick = (k: string) => num(Array.isArray(li) ? li.find((x: any) => x.name === k || x.key === k)?.value : li[k]);
  return {
    fiscalDate: st.fiscal_date,
    knownAt: st.known_at,
    debt: pick("short_long_term_debt_total") ?? pick("long_term_debt_total"),
    cash: pick("cash_and_short_term_investments") ?? pick("cash"),
  };
}

// ---------- SoSoValue: ETFs ----------
export type EtfListItem = { ticker: string; name: string; exchange: string };
export const etfList = (symbol: "BTC" | "ETH") =>
  getJson<EtfListItem[]>("sosovalue", "/etfs", { country_code: "US", symbol }, TTL.list);

export type EtfData = {
  ticker: string;
  fee: number | null; // annual sponsor fee, fraction
  netAssets: number | null;
  price: number | null;
  premium: number | null; // latest premium(+)/discount(-) to NAV, fraction
  premiumDate: string | null;
  netInflow: number | null;
  date: string | null;
};
export async function etfData(ticker: string): Promise<EtfData | null> {
  const [snap, hist] = await Promise.all([
    maybe(getJson<any>("sosovalue", `/etfs/${ticker}/market-snapshot`, {}, TTL.etf)),
    maybe(getJson<any[]>("sosovalue", `/etfs/${ticker}/history`, {}, TTL.etf)),
  ]);
  if (!snap) return null;
  const lastPrem = (hist ?? []).find((h) => num(h.prem_dsc) !== null);
  return {
    ticker,
    fee: num(snap.sponsor_fee),
    netAssets: num(snap.net_assets),
    price: num(snap.mkt_price),
    premium: lastPrem ? num(lastPrem.prem_dsc) : null,
    premiumDate: lastPrem?.date ?? null,
    netInflow: num(snap.net_inflow),
    date: snap.date ?? null,
  };
}

// ---------- SoSoValue: reference price ----------
export const CURRENCY_ID = { BTC: "1673723677362319866", ETH: "1673723677362319867" } as const;
export async function sosoPrice(asset: "BTC" | "ETH"): Promise<number | null> {
  const r = await maybe(getJson<any>("sosovalue", `/currencies/${CURRENCY_ID[asset]}/market-snapshot`, {}, 1800));
  return num(r?.price);
}
