// npm run deploy — stamp the commit, deploy to Vercel production, then warm the cache
// so the first judge never hits a cold start (each deploy starts with an empty cache).
import { execSync } from "node:child_process";
import fs from "node:fs";

const sha = execSync("git rev-parse HEAD").toString().trim();
const dirty = execSync("git status --porcelain -- app lib").toString().trim();
if (dirty) {
  console.error("Uncommitted changes in app/ or lib/ — commit first so the stamped SHA matches what is deployed.");
  process.exit(1);
}
fs.writeFileSync("lib/build-info.json", JSON.stringify({ sha, builtAt: new Date().toISOString() }) + "\n");
try {
  execSync("npx --yes vercel@66.6.0 deploy --prod --yes", { stdio: ["ignore", "ignore", "inherit"] });
} finally {
  fs.writeFileSync("lib/build-info.json", JSON.stringify({ sha: "", builtAt: "" }, null, 1) + "\n");
}
const site = "https://premium-check-iota.vercel.app";
const paths = ["/", "/?asset=ETH", "/judges", "/journal", "/diag", "/?asset=BTC&usd=2000&months=6"];
for (const p of paths) {
  const t0 = Date.now();
  const r = await fetch(site + p).catch((e) => ({ status: String(e) }));
  console.log(`${r.status} ${p} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
