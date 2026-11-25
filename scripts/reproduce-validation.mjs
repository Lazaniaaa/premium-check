// Re-computes the /validation tables from the frozen dataset with the same code the site
// runs (lib/backtest.ts). No API key, no network.
//
//   node scripts/reproduce-validation.mjs
import fs from "node:fs";
import { backtest } from "../lib/backtest.ts";

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
