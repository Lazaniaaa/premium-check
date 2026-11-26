// Re-computes the /validation tables from the frozen dataset with the same code the site
// runs (lib/backtest.ts): ETF exit premium (SoSoValue) and perp funding (Hyperliquid).
// No API key, no network.
//
//   node scripts/reproduce-validation.mjs
import fs from "node:fs";
import { backtest, fundingBacktest, outOfSample } from "../lib/backtest.ts";
import { HOURS_PER_YEAR } from "../lib/calc.ts";

const d = JSON.parse(fs.readFileSync("data/validation/etf-premium-history.json", "utf8"));
const bp = (x) => (x == null ? "—" : (x * 1e4).toFixed(1).padStart(5));
console.log(`Dataset frozen ${d.frozenAt}. Errors in bps: median / p90.`);
for (const [asset, a] of Object.entries(d.assets)) {
  const r = backtest(a.funds);
  console.log(`\n${asset}: ${Object.keys(a.funds).length}/${a.listed.length} funds, ${r.sessions} sessions ${r.from} → ${r.to}`);
  console.log("sessions  starts  fund-windows  same premium   at NAV        past median   two-fund gap (pair-windows)");
  for (const h of r.horizons)
    console.log(
      `${String(h.days).padStart(8)}  ${String(h.startDates).padStart(6)}  ${String(h.unchanged.n).padStart(12)}  ` +
        [h.unchanged, h.zero, h.pastMedian].map((s) => `${bp(s.median)} /${bp(s.p90)}`).join("  ") +
        `  ${bp(h.pairwise.median)} /${bp(h.pairwise.p90)} (${h.pairwise.n})`,
    );
}

const later = JSON.parse(fs.readFileSync("data/validation/etf-premium-after.json", "utf8"));
console.log(`
Out of sample: frozen p90s checked on sessions in a copy fetched ${later.frozenAt}.`);
for (const [asset, a] of Object.entries(d.assets)) {
  const o = outOfSample(a.funds, later.assets[asset].funds, backtest(a.funds));
  console.log(`${asset}: new closes ${o.exitDates.join(", ")}; ${o.revised} of ${o.shared} shared values revised`);
  for (const h of o.horizons)
    console.log(
      `  after ${String(h.days).padStart(2)} sessions: ${h.exceeded}/${h.n} funds moved more than the frozen p90 (${bp(h.threshold)} bps), ` +
        `median ${bp(h.median)}, max ${h.max?.ticker} ${bp(h.max?.move)}; at NAV ${h.navExceeded}/${h.n} over ${bp(h.navThreshold)}`,
    );
}

const f = JSON.parse(fs.readFileSync("data/validation/funding-history.json", "utf8"));
const pc = (x) => (x == null ? "—" : (x * 100).toFixed(2).padStart(6) + "%");
console.log(`\nPerp funding, ${f.venue}. Frozen ${f.frozenAt}. Errors in % of the amount: median / p90 of |paid - predicted|.`);
for (const [coin, s] of Object.entries(f.coins)) {
  const r = fundingBacktest(s, undefined, HOURS_PER_YEAR);
  console.log(`\n${coin}: ${r.hours} hours ${r.from} → ${r.to} (${r.dropped} early hours dropped, ${r.filled} filled)`);
  console.log("months  starts  paid p10 / median / p90         today's rate          zero               30-day average");
  for (const h of r.horizons)
    console.log(
      `${String(h.months).padStart(6)}  ${String(h.starts).padStart(6)}  ${pc(h.actual.p10)} /${pc(h.actual.median)} /${pc(h.actual.p90)}  ` +
        [h.today, h.zero, h.trailing30].map((e) => `${pc(e.medianAbs)} /${pc(e.p90Abs)}`).join("  ") +
        `  best: ${h.best}`,
    );
}
