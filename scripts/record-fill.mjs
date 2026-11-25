// Reads the real fills of a SoDEX round trip from the public account-trades endpoint and
// records them next to the prediction made before the trade.
//
//   node scripts/record-fill.mjs --prediction data/validation/predictions/<file>.json --account 0x... [--commit <sha>]
//
// --commit is the commit that published the prediction before the trade.
// Writes the raw response to data/validation/fills/ and adds the comparison to
// data/validation/trades.json (shown on /validation). Public endpoint; no key.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, xs) => (a.startsWith("--") ? [...acc, [a.slice(2), xs[i + 1]]] : acc), []),
);
if (!args.prediction || !args.account) throw new Error("usage: --prediction <file> --account <0x...> [--commit <sha>]");
const pred = JSON.parse(readFileSync(args.prediction, "utf8"));
const account = args.account;
const BASE = "https://mainnet-gw.sodex.dev/api/v1";
const r = await fetch(`${BASE}/spot/accounts/${account}/trades?symbol=${pred.symbol}`, { headers: { "User-Agent": "premium-check/1.0 (validation script)" } });
const body = await r.json();
if (body.code !== 0) throw new Error(JSON.stringify(body).slice(0, 300));
mkdirSync("data/validation/fills", { recursive: true });
const rawFile = `data/validation/fills/${basename(args.prediction)}`;
writeFileSync(rawFile, JSON.stringify({ fetchedAt: new Date().toISOString(), account, response: body }, null, 1) + "\n");

// Field names as SoDEX returns them; fail loudly if they differ, rather than guess.
const pick = (o, ...ks) => {
  for (const k of ks) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
const t0 = Date.parse(pred.bookTime);
const rows = (Array.isArray(body.data) ? body.data : body.data?.trades ?? [])
  .map((x) => ({
    raw: x,
    id: Number(pick(x, "t", "tradeID", "tradeId", "id")),
    time: Number(pick(x, "T", "time", "timestamp", "ts")),
    symbol: pick(x, "s", "symbol"),
    side: String(pick(x, "S", "side") ?? "").toUpperCase(),
    price: Number(pick(x, "p", "price")),
    qty: Number(pick(x, "q", "quantity", "qty")),
    fee: Number(pick(x, "n", "fee", "commission") ?? NaN),
    feeAsset: pick(x, "N", "feeAsset", "feeCoin", "commissionAsset"),
  }))
  .filter((x) => x.symbol === pred.symbol && x.time >= t0 && x.time <= t0 + 30 * 60_000)
  .sort((a, b) => a.time - b.time);
console.log(`${rows.length} fills within 30 min after the prediction. Raw saved to ${rawFile}`);
if (!rows.length) process.exit(1);
for (const x of rows) console.log(JSON.stringify(x.raw));
if (rows.some((x) => !["BUY", "SELL"].includes(x.side) || !Number.isFinite(x.fee) || !x.feeAsset))
  throw new Error("unexpected fill fields — inspect the raw lines above and adjust the field names");

const base = pred.symbol.split("_")[0];
const leg = (side) => {
  const xs = rows.filter((x) => x.side === side);
  const qty = xs.reduce((s, x) => s + x.qty, 0);
  const notional = xs.reduce((s, x) => s + x.qty * x.price, 0);
  const vwap = notional / qty;
  // Fee in USD at the fill price, whatever asset it was charged in.
  const feeUsd = xs.reduce((s, x) => s + (x.feeAsset === base ? x.fee * x.price : x.fee), 0);
  const feeBase = xs.reduce((s, x) => s + (x.feeAsset === base ? x.fee : 0), 0);
  const feeQuote = xs.reduce((s, x) => s + (x.feeAsset === base ? 0 : x.fee), 0);
  const assets = [...new Set(xs.map((x) => x.feeAsset))].join("+");
  return { xs, qty, notional, vwap, feeUsd, feeBase, feeQuote, assets };
};
const buy = leg("BUY");
const sell = leg("SELL");
if (!buy.qty || !sell.qty) throw new Error("need both a buy and a sell fill");
const usdcSpent = buy.notional + buy.feeQuote;
const usdcReturned = sell.notional - sell.feeQuote;
const baseLeft = Number((buy.qty - buy.feeBase - sell.qty - sell.feeBase).toFixed(10));
const actualCostUsd = usdcSpent - usdcReturned - baseLeft * sell.vwap;
const p = pred.predicted;
const rec = {
  symbol: pred.symbol,
  usd: pred.usd,
  predictionFile: args.prediction.replace(/\\/g, "/"),
  predictionCommit: args.commit ?? null,
  predictedAt: pred.bookTime,
  firstFillAt: new Date(rows[0].time).toISOString(),
  lastFillAt: new Date(rows.at(-1).time).toISOString(),
  account,
  tradeIds: rows.map((x) => x.id),
  feeRates: { model: pred.feeRates.model, symbol: pred.feeRates.symbolTaker },
  buy: {
    predictedVwap: p.buyVwap,
    actualVwap: buy.vwap,
    diffBps: ((buy.vwap - p.buyVwap) / p.buyVwap) * 1e4,
    qty: buy.qty,
    feePaid: Number((buy.feeBase || buy.feeQuote).toPrecision(6)),
    feeAsset: buy.assets,
    feeRate: buy.feeUsd / buy.notional,
  },
  sell: {
    predictedVwap: p.sellVwap,
    actualVwap: sell.vwap,
    diffBps: ((p.sellVwap - sell.vwap) / p.sellVwap) * 1e4,
    qty: sell.qty,
    feePaid: Number((sell.feeBase || sell.feeQuote).toPrecision(6)),
    feeAsset: sell.assets,
    feeRate: sell.feeUsd / sell.notional,
  },
  usdcSpent,
  usdcReturned,
  baseLeft,
  predictedCostUsd: p.roundTripUsd,
  actualCostUsd,
  predictedCostBps: p.roundTripCost * 1e4,
  actualCostBps: (actualCostUsd / usdcSpent) * 1e4,
};
const file = "data/validation/trades.json";
const all = JSON.parse(readFileSync(file, "utf8")).filter((t) => t.predictionFile !== rec.predictionFile);
writeFileSync(file, JSON.stringify([...all, rec], null, 2) + "\n");
console.log(
  `Predicted ${rec.predictedCostBps.toFixed(2)} bps ($${rec.predictedCostUsd.toFixed(4)}), actual ${rec.actualCostBps.toFixed(2)} bps ($${rec.actualCostUsd.toFixed(4)}). Saved to ${file}`,
);
