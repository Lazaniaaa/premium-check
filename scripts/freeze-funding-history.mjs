// Freezes hourly perp funding history used by /validation into the repo, so the published
// numbers can be reproduced offline (scripts/reproduce-validation.mjs).
//
//   node scripts/freeze-funding-history.mjs
//
// Source: Hyperliquid's public info endpoint (fundingHistory), BTC and ETH, from the first
// record. SoDEX publishes no market funding history, so this tests the *kind* of assumption
// Premium Check makes ("today's hourly rate stays for the whole period") on another venue
// that also settles funding every hour. No key; about 130 requests, 0.4 s apart.
//
// Stored compactly: one integer per hour in units of 1e-10 (Hyperliquid quotes rates with
// 10 decimals, so nothing is rounded), null where no record exists for that hour.
import { writeFileSync, mkdirSync } from "node:fs";

const URL = "https://api.hyperliquid.xyz/info";
const HOUR = 3_600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(coin, startTime) {
  await sleep(400);
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "premium-check/1.0 (validation)" },
    body: JSON.stringify({ type: "fundingHistory", coin, startTime }),
  });
  if (!r.ok) throw new Error(`${coin} ${startTime}: HTTP ${r.status}`);
  return r.json();
}

async function history(coin) {
  const rows = [];
  let start = 0;
  for (;;) {
    const xs = await page(coin, start);
    if (!xs.length) break;
    rows.push(...xs);
    const last = xs.at(-1).time;
    if (xs.length < 500 || last >= Date.now() - HOUR) break;
    start = last + 1;
  }
  // One value per UTC hour (records carry a few ms of settlement delay).
  const byHour = new Map();
  let duplicates = 0;
  for (const x of rows) {
    const h = Math.floor(x.time / HOUR) * HOUR;
    if (byHour.has(h)) duplicates++;
    const [int, frac = ""] = x.fundingRate.replace("-", "").split(".");
    if (frac.length > 10) throw new Error(`more than 10 decimals: ${x.fundingRate}`);
    const units = Number(int) * 1e10 + Number(frac.padEnd(10, "0"));
    byHour.set(h, x.fundingRate.startsWith("-") ? -units : units);
  }
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  const first = hours[0];
  const last = hours.at(-1);
  const rates = [];
  for (let h = first; h <= last; h += HOUR) rates.push(byHour.has(h) ? byHour.get(h) : null);
  const missing = rates.filter((x) => x === null).length;
  console.log(`${coin}: ${rows.length} records, ${rates.length} hours, ${missing} missing, ${duplicates} duplicates`);
  return { firstHour: new Date(first).toISOString(), lastHour: new Date(last).toISOString(), hours: rates.length, missing, duplicates, rates };
}

const out = {
  frozenAt: new Date().toISOString(),
  source: "Hyperliquid public info API, POST https://api.hyperliquid.xyz/info {type: fundingHistory}",
  venue: "Hyperliquid (not SoDEX: SoDEX publishes no market funding history)",
  metric: "hourly funding rate paid by longs when positive; integer units of 1e-10 per hour, null = no record",
  coins: { BTC: await history("BTC"), ETH: await history("ETH") },
};
mkdirSync("data/validation", { recursive: true });
writeFileSync("data/validation/funding-history.json", JSON.stringify(out) + "\n");
console.log("Saved data/validation/funding-history.json");
