import { pct, ratio, timeUtc, usd } from "@/lib/format";
import type { Snapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

const REPO = "Lazaniaaa/premium-check";
const DIR = "data/snapshots";
const FIRST_DAY = "2026-11-24";

type GhFile = { name: string; html_url: string };

// Snapshot files are named by UTC day, so we can read them straight from
// raw.githubusercontent.com — no GitHub API, whose unauthenticated rate limit is
// shared across serverless IPs.
async function loadSnapshots(): Promise<{ file: GhFile; snap: Snapshot }[]> {
  const days: string[] = [];
  for (let d = new Date(); d.toISOString().slice(0, 10) >= FIRST_DAY && days.length < 60; d.setUTCDate(d.getUTCDate() - 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const today = days[0];
  const rows = await Promise.all(
    days.map(async (day) => {
      const name = `${day}.json`;
      // recent days may still appear; older dated files never change
      const revalidate = day >= today || days.indexOf(day) <= 1 ? 600 : 86400;
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${DIR}/${name}`, { next: { revalidate } });
        if (!r.ok) return null;
        const snap = (await r.json()) as Snapshot;
        return { file: { name, html_url: `https://github.com/${REPO}/blob/main/${DIR}/${name}` }, snap };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((r): r is { file: GhFile; snap: Snapshot } => r !== null);
}

export default async function Journal() {
  const rows = await loadSnapshots();
  return (
    <>
      <h1>Journal</h1>
      <p className="lede">
        Every day at 00:30 UTC a GitHub Action calls <code>/api/snapshot</code> and commits the result to{" "}
        <a href={`https://github.com/${REPO}/tree/main/${DIR}`}>{DIR}</a>. The git history is the record: nothing here
        can be edited after the fact without it showing in the commits.
      </p>
      {rows.length === 0 ? (
        <div className="card muted">No snapshots yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">BTC</th>
                <th>Cheapest way to hold BTC (12 months)</th>
                <th className="num">SoDEX BTC perp funding / year</th>
                <th className="num">MSTR mNAV (equity / with debt)</th>
                <th>Cheapest way to hold ETH</th>
                <th>Raw</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ file, snap }) => {
                const mstr = snap?.btc.companies.find((c) => c.ticker === "MSTR");
                return (
                  <tr key={file.name}>
                    <td>
                      {file.name.replace(".json", "")}
                      <span className="sub">
                        {`${timeUtc(snap.takenAt)} · ${snap.takenBy}`}
                      </span>
                    </td>
                    <td className="num">{usd(snap?.btc.reference.price, 0)}</td>
                    <td>
                      {snap?.btc.cheapest ? (
                        <>
                          {snap.btc.cheapest.name} <b>{pct(snap.btc.cheapest.cost)}</b>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num">{pct(snap?.btc.perpAnnualFunding)}</td>
                    <td className="num">
                      {ratio(mstr?.mnavEquity)} / {ratio(mstr?.mnavWithDebt)}
                    </td>
                    <td>
                      {snap?.eth.cheapest ? (
                        <>
                          {snap.eth.cheapest.name} <b>{pct(snap.eth.cheapest.cost)}</b>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <a href={file.html_url}>json</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
