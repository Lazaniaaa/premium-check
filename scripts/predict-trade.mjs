// Records what Premium Check predicts for a SoDEX round trip *before* you trade, so the
// prediction can later be compared with your real fills (scripts/record-fill.mjs).
//
//   node scripts/predict-trade.mjs --usd 20 [--symbol vBTC_vUSDC]
//
// Saves data/validation/predictions/<time>.json with the raw order book it used, so anyone
// can recompute the prediction with lib/calc.ts. Trade right after running it: the book moves.
// Public SoDEX endpoints only; no key, no wallet, nothing is sent.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { roundTrip } from "../lib/calc.ts";

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

const [book, symbols] = await Promise.all([get(`/spot/markets/${symbol}/orderbook?limit=100`), get(`/spot/markets/symbols?symbol=${symbol}`)]);
const info = symbols.find((s) => s.name === symbol);
if (!info) throw new Error(`unknown symbol ${symbol}`);
const fee = Number(info.takerFee);
const lv = (xs) => xs.map(([p, s]) => [Number(p), Number(s)]);
const b = { bids: lv(book.bids), asks: lv(book.asks) };
if (usd < Number(info.minNotional)) throw new Error(`below SoDEX minimum order of $${info.minNotional}`);

const rt = roundTrip(b, usd, fee);
if (!rt || !rt.complete) throw new Error("book too thin for this amount");
const sha = (() => {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return null;
  }
})();
const takenAt = new Date(book.blockTime).toISOString();
const out = {
  kind: "sodex_spot_round_trip",
  symbol,
  usd,
  takenAt,
  blockHeight: book.blockHeight,
  code: { sha, function: "lib/calc.ts roundTrip" },
  feeRate: fee,
  predicted: {
    mid: rt.mid,
    buyVwap: rt.buy.vwap,
    buyQty: rt.buy.qty,
    sellVwap: rt.sell.vwap,
    roundTripCost: rt.total,
    roundTripUsd: usd * rt.total,
    spreadBps: ((b.asks[0][0] - b.bids[0][0]) / rt.mid) * 1e4,
  },
  book: { bids: book.bids.slice(0, 20), asks: book.asks.slice(0, 20) },
};
const dir = "data/validation/predictions";
mkdirSync(dir, { recursive: true });
const file = `${dir}/${takenAt.replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`Prediction for $${usd} of ${info.displayName}, round trip (buy then sell), taker fee ${(fee * 100).toFixed(3)}% each way:`);
console.log(`  mid ${rt.mid}  buy VWAP ${rt.buy.vwap.toFixed(2)}  sell VWAP ${rt.sell.vwap.toFixed(2)}`);
console.log(`  cost ${(rt.total * 100).toFixed(4)}% = $${(usd * rt.total).toFixed(4)}`);
console.log(`Saved ${file}. Now buy ~$${usd} at market and sell it back right away.`);
