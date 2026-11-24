import { takeSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Public, read-only. Served from the same cache as the site, so calling it costs
// no extra SoSoValue quota once the cache is warm.
export async function GET(req: Request) {
  const by = new URL(req.url).searchParams.get("by") ?? "api";
  const takenBy = /^[a-z0-9-]{1,32}$/i.test(by) ? by : "api";
  const snap = await takeSnapshot(takenBy);
  return Response.json(snap, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
