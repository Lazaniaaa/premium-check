// Records what Premium Check predicts for a SoDEX spot round trip *before* you trade, so it
// can be compared with the real fills afterwards (scripts/record-fill.mjs).
//
//   node scripts/predict-trade.mjs --usd 20 [--symbol vBTC_vUSDC]
//
// Saves data/validation/predictions/<book time>.json with the full order book it used (every
// level fetched), the code version and both fee rates, so anyone can recompute the prediction
// with lib/calc.ts. Commit and push that file before trading: GitHub's timestamp then shows the
// prediction came first. Trade within seconds: the book moves.
// Public SoDEX endpoints only; no key, no wallet, nothing is sent.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { roundTrip, SODEX_FEES } from "../lib/calc.ts";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, xs) => (a.startsWith("--") ? [...acc, [a.slice(2), xs[i + 1]]] : acc), []),
);
const usd = Number(args.usd ?? 20);
const symbol = args.symbol ?? "vBTC_vUSDC";
const BASE = "https://mainnet-gw.sodex.dev/api/v1";
const UA = { "User-Agent": "premium-check/1.0 (validation script)" };

const get = async (path) => {
  const r = await fetch(BASE + path, { headers: UA });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`${path}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data;
};

const symbols = await get(`/spot/markets/symbols?symbol=${symbol}`);
const info = symbols.find((s) => s.name === symbol);
if (!info) throw new Error(`unknown symbol ${symbol}`);
if (usd < Number(info.minNotional)) throw new Error(`below SoDEX minimum order of $${info.minNotional}`);
const requestedAt = new Date().toISOString();
const book = await get(`/spot/markets/${symbol}/orderbook?limit=100`);
const receivedAt = new Date().toISOString();

// Same fee as the site's model, so this checks what the site would have said.
const fee = SODEX_FEES.spotTaker;
const lv = (xs) => xs.map(([p, s]) => [Number(p), Number(s)]);
const b = { bids: lv(book.bids), asks: lv(book.asks) };
const rt = roundTrip(b, usd, fee);
if (!rt || !rt.complete) throw new Error("book too thin for this amount");
const sha = (() => {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return null;
  }
})();
const bookTime = new Date(book.blockTime).toISOString();
const out = {
  kind: "sodex_spot_round_trip",
  symbol,
  usd,
  bookTime,
  requestedAt,
  receivedAt,
  blockHeight: book.blockHeight,
  updateID: book.updateID,
  code: { sha, function: "lib/calc.ts roundTrip(book, usd, SODEX_FEES.spotTaker)" },
  feeRates: { model: fee, symbolTaker: Number(info.takerFee) },
  lot: { stepSize: info.stepSize, minNotional: info.minNotional, tickSize: info.tickSize },
  plan: "taker buy at market for about the amount, then sell the bought quantity at market, within seconds",
  predicted: {
    mid: rt.mid,
    buyVwap: rt.buy.vwap,
    buyQty: rt.buy.qty,
    sellVwap: rt.sell.vwap,
    roundTripCost: rt.total,
    roundTripUsd: usd * rt.total,
    spreadBps: ((b.asks[0][0] - b.bids[0][0]) / rt.mid) * 1e4,
  },
  book: { levels: { bids: book.bids.length, asks: book.asks.length }, bids: book.bids, asks: book.asks },
};
const dir = "data/validation/predictions";
mkdirSync(dir, { recursive: true });
const file = `${dir}/${bookTime.replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log(`Prediction for $${usd} of ${info.displayName} (buy, then sell back), fee ${(fee * 100).toFixed(3)}% each way:`);
console.log(`  book ${bookTime}  mid ${rt.mid}  buy VWAP ${rt.buy.vwap.toFixed(2)}  sell VWAP ${rt.sell.vwap.toFixed(2)}`);
console.log(`  cost ${(rt.total * 1e4).toFixed(2)} bps = $${(usd * rt.total).toFixed(4)}`);
console.log(`Saved ${file}`);
