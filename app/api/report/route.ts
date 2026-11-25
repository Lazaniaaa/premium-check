import { unstable_cache } from "next/cache";
import { buildFacts, writeNote, type Report } from "@/lib/report";
import { protectedTerms, takeSnapshot, type Snapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RAW = "https://raw.githubusercontent.com/Lazaniaaa/premium-check/main/data/snapshots";

async function fromRepo(kind: "reports" | "snapshots", day: string): Promise<unknown | null> {
  const r = await fetch(`https://raw.githubusercontent.com/Lazaniaaa/premium-check/main/data/${kind}/${day}.json`, {
    next: { revalidate: 300 },
  }).catch(() => null);
  return r?.ok ? r.json() : null;
}

async function previousSnapshot(day: string): Promise<Snapshot | null> {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  const r = await fetch(`${RAW}/${d.toISOString().slice(0, 10)}.json`, { next: { revalidate: 86400 } }).catch(() => null);
  return r?.ok ? ((await r.json()) as Snapshot) : null;
}

// At most one note per UTC day, whoever calls first (normally the daily GitHub
// Action), so this public endpoint can't be used to run up OpenAI costs.
//
// The snapshot is taken OUTSIDE the day cache: its upstream calls use their own
// unstable_cache entries, and nesting unstable_cache inside unstable_cache hangs in
// the production runtime. The cached value stores snapshot + facts + note together,
// so a cache hit always returns a note that matches its own facts.
export async function GET(req: Request) {
  const by = new URL(req.url).searchParams.get("by") ?? "api";
  const takenBy = /^[a-z0-9-]{1,32}$/i.test(by) ? by : "api";
  const day = new Date().toISOString().slice(0, 10);

  // A report already committed for today is served as is: 0 SoSoValue and 0 OpenAI calls.
  const [committedReport, committedSnap] = await Promise.all([fromRepo("reports", day), fromRepo("snapshots", day)]);
  if (committedReport && committedSnap)
    return Response.json(
      { ...(committedReport as object), snapshot: committedSnap, servedFrom: "repository" },
      { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } },
    );

  const [snapshot, prev] = await Promise.all([takeSnapshot(takenBy), previousSnapshot(day)]);
  const facts = buildFacts(snapshot, prev);

  const report = await unstable_cache(
    async (): Promise<Report> => {
      const { note, author } = await writeNote(facts, protectedTerms(snapshot));
      return {
        schema: 1,
        day,
        generatedAt: new Date().toISOString(),
        by: takenBy,
        snapshotTakenAt: snapshot.takenAt,
        facts,
        note,
        author,
        snapshot,
      };
    },
    ["report-v3", day],
    { revalidate: 86400 },
  )();

  return Response.json(report, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
