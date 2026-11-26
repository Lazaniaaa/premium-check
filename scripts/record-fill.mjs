// Records a real SoDEX spot round trip next to the prediction published before it.
//
//   node scripts/record-fill.mjs --prediction data/validation/predictions/<file>.json \
//     --account 0x... --buy-order <orderID> --sell-order <orderID> --commit <sha> [--account-id <n>]
//
// Fetches the fills of exactly those two orders from SoDEX's public account-trades endpoint
// (filter orderID, no time window guessing), saves the raw responses to data/validation/fills/,
// reads GitHub's server time for the push of the prediction commit, and evaluates the attempt
// with lib/trade-record.ts: complete / partial / failed, verified only if complete and pushed
// before the first fill. Every attempt is recorded, including failed and partial ones.
// Public endpoints; no key.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { evaluateRoundTrip, parseUserTrade } from "../lib/trade-record.ts";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, xs) => (a.startsWith("--") ? [...acc, [a.slice(2), xs[i + 1]]] : acc), []),
);
for (const k of ["prediction", "account", "buy-order", "sell-order"])
  if (!args[k]) throw new Error("usage: --prediction <file> --account <0x...> --buy-order <id> --sell-order <id> --commit <sha> [--account-id <n>]");
const pred = JSON.parse(readFileSync(args.prediction, "utf8"));
const BASE = "https://mainnet-gw.sodex.dev/api/v1";
const UA = { "User-Agent": "premium-check/1.0 (validation script)" };
const REPO = "Lazaniaaa/premium-check";

async function fills(orderID) {
  const q = new URLSearchParams({ symbol: pred.symbol, orderID: String(orderID), limit: "1000" });
  if (args["account-id"]) q.set("accountID", args["account-id"]);
  const r = await fetch(`${BASE}/spot/accounts/${args.account}/trades?${q}`, { headers: UA });
  const body = await r.json();
  if (body.code !== 0) throw new Error(JSON.stringify(body).slice(0, 300));
  return body;
}
const [buyRaw, sellRaw] = [await fills(args["buy-order"]), await fills(args["sell-order"])];
const fetchedAt = new Date().toISOString();
mkdirSync("data/validation/fills", { recursive: true });
const rawFile = `data/validation/fills/${basename(args.prediction)}`;
writeFileSync(
  rawFile,
  JSON.stringify({ fetchedAt, account: args.account, accountID: args["account-id"] ?? null, buyOrder: args["buy-order"], sellOrder: args["sell-order"], buy: buyRaw, sell: sellRaw }, null, 1) + "\n",
);
const list = (b) => (Array.isArray(b.data) ? b.data : b.data?.trades ?? []);
for (const x of [...list(buyRaw), ...list(sellRaw)]) console.log(JSON.stringify(x));
const buyFills = list(buyRaw).map(parseUserTrade);
const sellFills = list(sellRaw).map(parseUserTrade);

// GitHub's own record of when the prediction commit was pushed (server time, not commit dates).
let pushedAt = null;
if (args.commit) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/activity?per_page=100&ref=refs/heads/main`, { headers: UA });
  const acts = r.ok ? await r.json() : [];
  const hit = Array.isArray(acts) ? acts.find((x) => x.after?.startsWith(args.commit)) : null;
  pushedAt = hit ? new Date(hit.timestamp).toISOString() : null;
  if (!hit) console.warn(`No push of ${args.commit} found in GitHub activity; the attempt cannot be verified.`);
}

const rec = evaluateRoundTrip({
  pred,
  predictionFile: args.prediction.replace(/\\/g, "/"),
  buyOrderID: Number(args["buy-order"]),
  sellOrderID: Number(args["sell-order"]),
  buyFills,
  sellFills,
  account: args.account,
  accountID: args["account-id"] ? Number(args["account-id"]) : null,
  predictionCommit: args.commit ?? null,
  predictionPushedAt: pushedAt,
});
const file = "data/validation/trades.json";
const all = JSON.parse(readFileSync(file, "utf8")).filter((t) => t.predictionFile !== rec.predictionFile);
writeFileSync(file, JSON.stringify([...all, rec], null, 2) + "\n");
const f = (x, d = 2) => (x == null ? "—" : x.toFixed(d));
console.log(`Status: ${rec.status}${rec.verified ? " (verified)" : ""}${rec.reasons.length ? ` — ${rec.reasons.join("; ")}` : ""}`);
console.log(
  `Predicted ${f(rec.predictedCostBps)} bps ($${f(rec.predictedCostUsd, 4)}), actual ${f(rec.actualCostBps)} bps ($${f(rec.actualCostUsd, 4)}). ` +
    `Book → buy ${f(rec.bookToBuySeconds, 1)} s, buy → sell ${f(rec.buyToSellSeconds, 1)} s. Saved to ${file}; raw fills in ${rawFile}`,
);
