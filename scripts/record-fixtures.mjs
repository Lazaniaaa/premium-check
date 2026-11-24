// Records real API responses into ./fixtures so that tests and offline
// development run on what the APIs actually return (not on assumptions).
// The SoSoValue key is read from .env and stripped from everything written.
//
//   npm run record            -> records everything
//
// Uses roughly 130 SoSoValue requests out of the 10,000/month key quota.

import fs from "node:fs";
import path from "node:path";
import { fixtureKey, toQueryString } from "../lib/slug.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env"), "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const KEY = env.SOSO_API_KEY;
if (!KEY) throw new Error("SOSO_API_KEY missing in .env");

const BASES = {
  sosovalue: "https://openapi.sosovalue.com/openapi/v1",
  "sosovalue-v3": "https://openapi.sosovalue.com/openapi/v3",
  sodex: "https://mainnet-gw.sodex.dev/api/v1",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sosoCalls = 0;

async function record(source, p, query = {}) {
  const url = BASES[source] + p + toQueryString(query);
  const headers = { "User-Agent": "premium-check/0.1 (+fixtures)" };
  if (source.startsWith("sosovalue")) {
    headers["x-soso-api-key"] = KEY;
    sosoCalls++;
    await sleep(700); // stay well under 100 req/min
  }
  const res = await fetch(url, { headers });
  const text = (await res.text()).split(KEY).join("<KEY>");
  const file = path.join(ROOT, "fixtures", fixtureKey(source, p, query));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  fs.writeFileSync(
    file,
    JSON.stringify({ recordedAt: new Date().toISOString(), status: res.status, body }, null, 1),
  );
  console.log(res.status, source, p, toQueryString(query));
  return { status: res.status, body };
}

// ---- SoDEX (public) ----
const perps = await record("sodex", "/perps/markets/tickers");
await record("sodex", "/spot/markets/tickers");
for (const s of ["BTC-USD", "ETH-USD", "MSTR-USD", "COIN-USD"]) {
  await record("sodex", `/perps/markets/${s}/orderbook`, { limit: 100 });
}
for (const s of ["vBTC_vUSDC", "vETH_vUSDC"]) {
  await record("sodex", `/spot/markets/${s}/orderbook`, { limit: 100 });
}

// ---- SoSoValue: treasuries ----
const list = await record("sosovalue", "/btc-treasuries");
const treasuries = list.body?.data ?? [];
const us = treasuries.filter((t) => t.list_location === "United States").map((t) => t.ticker);
console.log("US-listed treasuries:", us.length, us.join(","));
for (const t of us) {
  await record("sosovalue", `/crypto-stocks/${t}/market-snapshot`);
  await record("sosovalue", `/btc-treasuries/${t}/purchase-history`, { limit: 100 });
}
await record("sosovalue-v3", "/parties/MSTR/financials", { period: "quarterly", statement: "balance" });

// ---- SoSoValue: ETFs ----
for (const sym of ["BTC", "ETH"]) {
  const etfs = await record("sosovalue", "/etfs", { country_code: "US", symbol: sym });
  for (const e of etfs.body?.data ?? []) {
    await record("sosovalue", `/etfs/${e.ticker}/market-snapshot`);
    await record("sosovalue", `/etfs/${e.ticker}/history`);
  }
}

// ---- SoSoValue: reference prices ----
await record("sosovalue", "/currencies/1673723677362319866/market-snapshot"); // BTC
await record("sosovalue", "/currencies/1673723677362319867/market-snapshot"); // ETH

console.log(`done; SoSoValue calls used: ${sosoCalls}; perps markets: ${perps.body?.data?.length}`);
