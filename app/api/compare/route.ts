import { buildComparison, type Asset } from "@/lib/model";
import { METHOD_VERSION } from "@/lib/snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HORIZONS = [1, 3, 6, 12, 24];

// The calculation behind one page view, as a dated, self-describing JSON file:
// inputs, reference price, every route with its cost parts, flags and notes, sources
// and times, and the method version. Same cache as the page: no extra API quota.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const asset: Asset = q.get("asset")?.toUpperCase() === "ETH" ? "ETH" : "BTC";
  const usd = Math.min(Math.max(Number(q.get("usd")) || 1000, 10), 1_000_000);
  const m = Number(q.get("months"));
  const months = HORIZONS.includes(m) ? m : 12;
  const etfPct = Math.min(Math.max(Number(q.get("etfcost")) || 0, 0), 2);
  const exclude = (q.get("exclude") ?? "").split(",").filter(Boolean);

  const c = await buildComparison(asset, usd, months, { etfTradingCost: etfPct / 100 });
  const routes = c.direct
    .filter((r) => !exclude.includes(r.kind))
    .map(({ fill, ticket, ...r }) => ({
      ...r,
      costUsd: r.cost != null ? Number((usd * r.cost).toFixed(2)) : null,
      ...(fill ? { execution: { vwap: fill.vwap, slippageBps: fill.slippageBps, maxUsdVwapWithin10bps: fill.maxUsdVwapWithin10bps } } : {}),
      ...(ticket ? { orderPreview: { endpoint: ticket.endpoint, body: ticket.body, maxSpend: ticket.maxSpend, warnings: ticket.warnings } } : {}),
    }));

  const body = {
    kind: "premium-check/calculation",
    methodVersion: METHOD_VERSION,
    generatedAt: c.generatedAt,
    inputs: { asset, usd, months, etfTradingCostPct: etfPct, exclude },
    recompute: `https://premium-check-iota.vercel.app/?${q.toString()}`,
    reference: c.reference,
    routes,
    companies: asset === "BTC" ? c.companies : [],
    coverage: c.coverage,
    errors: c.errors,
  };
  const name = `premium-check-${asset}-${usd}-${months}m-${c.generatedAt.slice(0, 16).replace(/[:T]/g, "")}.json`;
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
