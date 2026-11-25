import { int, pct, ratio, signedPct, timeUtc, usd } from "@/lib/format";
import { etfPremiumHistory, strategyPurchases } from "@/lib/history";
import { methodOf, type Snapshot } from "@/lib/snapshot";
import type { Report } from "@/lib/report";

export const dynamic = "force-dynamic";

const REPO = "Lazaniaaa/premium-check";
const DIR = "data/snapshots";
const FIRST_DAY = "2026-11-24";

type GhFile = { name: string; html_url: string };

// Snapshot files are named by UTC day, so we can read them straight from
// raw.githubusercontent.com — no GitHub API, whose unauthenticated rate limit is
// shared across serverless IPs.
async function loadSnapshots(): Promise<{ file: GhFile; snap: Snapshot; report: Report | null }[]> {
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
        const rr = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/reports/${name}`, { next: { revalidate } });
        const report = rr.ok ? ((await rr.json()) as Report) : null;
        return { file: { name, html_url: `https://github.com/${REPO}/blob/main/${DIR}/${name}` }, snap, report };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((r): r is { file: GhFile; snap: Snapshot; report: Report | null } => r !== null);
}

// change vs the previous recorded day, in percentage points / ratio points
function Delta({ now, prev, kind }: { now: number | null | undefined; prev: number | null | undefined; kind: "pp" | "x" }) {
  if (now == null || prev == null) return null;
  const d = now - prev;
  const text = kind === "pp" ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(2)} pp` : `${d >= 0 ? "+" : ""}${d.toFixed(2)}×`;
  return <span className="sub">{text} vs previous day</span>;
}

export default async function Journal() {
  const [rows, etfHist, mstrBuys] = await Promise.all([loadSnapshots(), etfPremiumHistory("BTC"), strategyPurchases()]);
  return (
    <>
      <h1>Journal</h1>
      <p className="lede">
        Every day at 00:30 UTC a GitHub Action calls <code>/api/report</code> (snapshot + AI note checked against the
        facts) and commits the result to{" "}
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
                <th className="num">MSTR market cap ÷ BTC value (plain / with debt)</th>
                <th>Cheapest way to hold ETH</th>
                <th>Note</th>
                <th>Raw</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ file, snap, report }, i) => {
                const mstr = snap.btc?.companies.find((c) => c.ticker === "MSTR");
                const older = rows[i + 1]?.snap;
                // Day-over-day changes only between snapshots computed with the same method.
                const sameMethod = !!older && methodOf(older) === methodOf(snap);
                const prev = sameMethod ? older : undefined;
                const prevMstr = prev?.btc?.companies.find((c) => c.ticker === "MSTR");
                return (
                  <tr key={file.name}>
                    <td>
                      {file.name.replace(".json", "")}
                      <span className="sub">
                        {`${timeUtc(snap.takenAt)} · ${snap.takenBy} · method v${methodOf(snap)}`}
                      </span>
                      {older && !sameMethod && <span className="sub">method changed since the previous day — no comparison</span>}
                    </td>
                    <td className="num">{usd(snap.btc?.reference.price, 0)}</td>
                    <td>
                      {snap.btc?.cheapest ? (
                        <>
                          {snap.btc?.cheapest.name} <b>{pct(snap.btc?.cheapest.cost)}</b>
                          <Delta now={snap.btc?.cheapest.cost} prev={prev?.btc?.cheapest?.cost} kind="pp" />
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num">
                      {pct(snap.btc?.perpAnnualFunding)}
                      <Delta now={snap.btc?.perpAnnualFunding} prev={prev?.btc?.perpAnnualFunding} kind="pp" />
                    </td>
                    <td className="num">
                      {ratio(mstr?.mnavEquity)} / {ratio(mstr?.mnavWithDebt)}
                      <Delta now={mstr?.mnavEquity} prev={prevMstr?.mnavEquity} kind="x" />
                    </td>
                    <td>
                      {snap.eth?.cheapest ? (
                        <>
                          {snap.eth?.cheapest.name} <b>{pct(snap.eth?.cheapest.cost)}</b>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {report ? (
                        <>
                          {report.note.headline}
                          <span className="sub">{report.author.kind === "llm" ? `${report.author.model}, numbers checked against facts` : "template"}</span>
                          {report.snapshotTakenAt && report.snapshotTakenAt !== snap.takenAt && (
                            <span className="sub bad">note computed from a different snapshot ({timeUtc(report.snapshotTakenAt)})</span>
                          )}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <a href={file.html_url}>snapshot</a>
                      {report && (
                        <>
                          {" · "}
                          <a href={`https://github.com/${REPO}/blob/main/data/reports/${file.name}`}>report</a>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2>History from SoSoValue (not recorded by us)</h2>
      <p className="lede">
        The rows above are what Premium Check recorded live, day by day. The tables below come straight from
        SoSoValue&apos;s own history endpoints, limited by this API key to the last 30 days for ETFs.
      </p>

      <h2 style={{ fontSize: 16 }}>BTC ETF premium / discount to NAV</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ETF</th>
              <th className="num">Days</th>
              <th className="num">Min</th>
              <th className="num">Median</th>
              <th className="num">Max</th>
              <th className="num">Latest</th>
              <th className="num">Fee / year</th>
            </tr>
          </thead>
          <tbody>
            {etfHist.map((e) => (
              <tr key={e.ticker}>
                <td>
                  <b>{e.ticker}</b> {e.name}
                  <span className="sub">
                    {e.from} → {e.to}
                  </span>
                </td>
                <td className="num">{e.days}</td>
                <td className="num">{signedPct(e.min, 3)}</td>
                <td className="num">{signedPct(e.median, 3)}</td>
                <td className="num">{signedPct(e.max, 3)}</td>
                <td className="num">{signedPct(e.latest, 3)}</td>
                <td className="num">{e.fee ? pct(e.fee) : "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        How to read it: the premium is paid once, on entry, while the fee is paid every year. Compare the min–max range
        with the fee to see which of the two matters more for your holding period.
      </p>

      <h2 style={{ fontSize: 16 }}>Strategy (MSTR) BTC purchases</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">BTC bought</th>
              <th className="num">Price per BTC</th>
              <th className="num">BTC held after</th>
            </tr>
          </thead>
          <tbody>
            {mstrBuys.rows.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td className={`num ${r.btcAcq < 0 ? "bad" : ""}`}>{r.btcAcq > 0 ? "+" : ""}{int(r.btcAcq)}</td>
                <td className="num">{usd(r.usdPerBtc)}</td>
                <td className="num">{int(r.btcHolding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Latest {mstrBuys.rows.length} of {mstrBuys.total} disclosures since {mstrBuys.since} (SoSoValue BTC treasuries).
        Price per BTC = acquisition cost ÷ BTC acquired; negative rows are sales.
      </p>
    </>
  );
}
