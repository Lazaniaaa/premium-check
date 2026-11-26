// Freezes the ETF premium/discount history used by /validation into the repo, so the
// published numbers can be reproduced without an API key (scripts/reproduce-validation.mjs).
//
//   node scripts/freeze-premium-history.mjs [--out data/validation/<file>.json]
//
// Default output is the backtest dataset. With --out it saves a later copy, used to check
// the frozen p90s on sessions that closed after the dataset was frozen (out of sample).
//
// Reads SOSO_API_KEY from .env (never written anywhere). About 25 SoSoValue requests:
// the US spot ETF lists for BTC and ETH and one /etfs/{ticker}/history per fund.
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const KEY = env.SOSO_API_KEY;
if (!KEY) throw new Error("SOSO_API_KEY missing in .env");
const BASE = "https://openapi.sosovalue.com/openapi/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  await sleep(700); // well under 100 requests/minute
  const r = await fetch(BASE + path, { headers: { "x-soso-api-key": KEY, "User-Agent": "premium-check/1.0 (validation)" } });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`${path}: ${j.message}`);
  return j.data;
}

const out = {
  frozenAt: new Date().toISOString(),
  source: "SoSoValue OpenAPI v1: GET /etfs?country_code=US&symbol={BTC|ETH}, GET /etfs/{ticker}/history (field prem_dsc)",
  metric: "reported closing premium/discount to NAV, as a fraction (0.001 = 0.1%)",
  assets: {},
};
for (const asset of ["BTC", "ETH"]) {
  const list = await get(`/etfs?country_code=US&symbol=${asset}`);
  const funds = {};
  const missing = [];
  for (const e of list) {
    try {
      const h = await get(`/etfs/${e.ticker}/history`);
      const pts = h
        .filter((x) => x.prem_dsc !== null && x.prem_dsc !== undefined && x.prem_dsc !== "")
        .map((x) => ({ date: String(x.date), p: Number(x.prem_dsc) }))
        .filter((x) => Number.isFinite(x.p))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (pts.length > 1) funds[e.ticker] = pts;
      else missing.push(e.ticker);
    } catch (err) {
      missing.push(e.ticker);
      console.warn(asset, e.ticker, String(err));
    }
  }
  out.assets[asset] = { listed: list.map((e) => e.ticker), missing, funds };
  console.log(asset, `${Object.keys(funds).length}/${list.length} funds`, missing.length ? `missing ${missing.join(",")}` : "");
}
fs.mkdirSync("data/validation", { recursive: true });
const outIdx = process.argv.indexOf("--out");
const file = outIdx > 0 ? process.argv[outIdx + 1] : "data/validation/etf-premium-history.json";
fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log(`Saved ${file}`);
