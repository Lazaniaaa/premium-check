import type { Report } from "./report";
import type { Snapshot } from "./snapshot";

// Daily files committed by the GitHub Action, read back from the public repo.
const RAW = "https://raw.githubusercontent.com/Lazaniaaa/premium-check/main/data";
export const REPO_URL = "https://github.com/Lazaniaaa/premium-check";

const dayString = (d: Date) => d.toISOString().slice(0, 10);

export async function readDaily<T = Report | Snapshot>(kind: "reports" | "snapshots", day: string, fresh: boolean): Promise<T | null> {
  try {
    const r = await fetch(`${RAW}/${kind}/${day}.json`, { next: { revalidate: fresh ? 600 : 86400 } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Today's report, or yesterday's if today's has not been committed yet. */
export async function latestReport(): Promise<Report | null> {
  const now = new Date();
  const today = await readDaily<Report>("reports", dayString(now), true);
  if (today) return today;
  now.setUTCDate(now.getUTCDate() - 1);
  return readDaily<Report>("reports", dayString(now), true);
}
