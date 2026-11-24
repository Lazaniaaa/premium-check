// Records SoDEX market parameters (tick/step size, min notional) into fixtures/.
// Public endpoints only — no SoSoValue quota used.
import fs from "node:fs";
import path from "node:path";
import { fixtureKey, toQueryString } from "../lib/slug.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
for (const [market, symbol] of [["perps", "BTC-USD"], ["perps", "ETH-USD"], ["spot", "vBTC_vUSDC"], ["spot", "vETH_vUSDC"]]) {
  const p = `/${market}/markets/symbols`;
  const q = { symbol };
  const res = await fetch(`https://mainnet-gw.sodex.dev/api/v1${p}${toQueryString(q)}`, { headers: { "User-Agent": "premium-check/0.1 (+fixtures)" } });
  const body = await res.json();
  const file = path.join(ROOT, "fixtures", fixtureKey("sodex", p, q));
  fs.writeFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), status: res.status, body }, null, 1));
  console.log(res.status, p, symbol);
}
