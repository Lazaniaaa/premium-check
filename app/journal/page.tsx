import { pct, ratio, timeUtc, usd } from "@/lib/format";
import type { Snapshot } from "@/lib/snapshot";

export const revalidate = 3600;

const REPO = "Lazaniaaa/premium-check";
const DIR = "data/snapshots";

type GhFile = { name: string; download_url: string; html_url: string };

async function loadSnapshots(): Promise<{ file: GhFile; snap: Snapshot | null }[]> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${DIR}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "premium-check" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) return [];
  const files = ((await res.json()) as GhFile[])
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, 60);
  return Promise.all(
    files.map(async (file) => {
      const r = await fetch(file.download_url, { next: { revalidate: 86400 } }); // a dated file never changes
      return { file, snap: r.ok ? ((await r.json()) as Snapshot) : null };
    }),
  );
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
                        {snap ? `${timeUtc(snap.takenAt)} · ${snap.takenBy}` : "unreadable"}
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
