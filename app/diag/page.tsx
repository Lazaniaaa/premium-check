import { dataMode, getJson, recentCalls, sosoQuota, type Source } from "@/lib/http";
import { timeUtc } from "@/lib/format";
import build from "@/lib/build-info.json";

export const dynamic = "force-dynamic";

// Each probe goes through the same cached client as the app (TTL 300 s), so
// reloading this page does not burn the SoSoValue monthly quota.
const PROBES: { label: string; source: Source; path: string; query?: Record<string, string | number> }[] = [
  { label: "SoDEX perps tickers", source: "sodex", path: "/perps/markets/tickers" },
  { label: "SoDEX BTC-USD order book", source: "sodex", path: "/perps/markets/BTC-USD/orderbook", query: { limit: 100 } },
  { label: "SoDEX spot vBTC/vUSDC order book", source: "sodex", path: "/spot/markets/vBTC_vUSDC/orderbook", query: { limit: 100 } },
  { label: "SoDEX ETH-USD order book", source: "sodex", path: "/perps/markets/ETH-USD/orderbook", query: { limit: 100 } },
  { label: "SoDEX spot vETH/vUSDC order book", source: "sodex", path: "/spot/markets/vETH_vUSDC/orderbook", query: { limit: 100 } },
  { label: "SoDEX BTC-USD market parameters", source: "sodex", path: "/perps/markets/symbols", query: { symbol: "BTC-USD" } },
  { label: "SoSoValue BTC treasuries", source: "sosovalue", path: "/btc-treasuries" },
  { label: "SoSoValue MSTR holdings", source: "sosovalue", path: "/btc-treasuries/MSTR/purchase-history", query: { limit: 100 } },
  { label: "SoSoValue MSTR stock snapshot", source: "sosovalue", path: "/crypto-stocks/MSTR/market-snapshot" },
  { label: "SoSoValue US BTC ETFs", source: "sosovalue", path: "/etfs", query: { country_code: "US", symbol: "BTC" } },
  { label: "SoSoValue US ETH ETFs", source: "sosovalue", path: "/etfs", query: { country_code: "US", symbol: "ETH" } },
  { label: "SoSoValue BTC price (cross-check)", source: "sosovalue", path: "/currencies/1673723677362319866/market-snapshot" },
  { label: "SoSoValue IBIT history", source: "sosovalue", path: "/etfs/IBIT/history" },
  { label: "SoSoValue v3 MSTR balance sheet", source: "sosovalue-v3", path: "/parties/MSTR/financials", query: { period: "quarterly", statement: "balance" } },
];

export default async function Diag() {
  const results = await Promise.all(
    PROBES.map(async (p) => {
      const t0 = Date.now();
      try {
        const data = await getJson<unknown>(p.source, p.path, p.query ?? {}, 300);
        const size = Array.isArray(data) ? `${data.length} rows` : "object";
        return { ...p, ok: true, ms: Date.now() - t0, detail: size };
      } catch (e) {
        return { ...p, ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  const q = sosoQuota();
  const calls = recentCalls().slice(-25).reverse();

  return (
    <>
      <h1>Data status: spot checks</h1>
      <p className="lede">
        A sample of the upstream endpoints Premium Check depends on — one of each kind, not every ticker. Each check goes
        through the same cache as the site (up to 5 minutes old). Every row on the comparison page also names its own
        source and time. Mode: <b>{dataMode()}</b>
        {dataMode() === "fixture" ? " (recorded real responses, offline)" : " (live APIs, cached)"}. Code version:{" "}
        {build.sha ? (
          <a href={`https://github.com/Lazaniaaa/premium-check/commit/${build.sha}`}>
            <code>{build.sha.slice(0, 7)}</code>
          </a>
        ) : (
          "unknown"
        )}
        {build.builtAt ? `, deployed ${timeUtc(build.builtAt)}` : ""}.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Status</th>
              <th className="num">Time</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.label}>
                <td>
                  {r.label}
                  <span className="sub">
                    <code>
                      {r.source} {r.path}
                    </code>
                  </span>
                </td>
                <td className={r.ok ? "status-ok" : "status-bad"}>{r.ok ? "OK" : "FAIL"}</td>
                <td className="num">{r.ms} ms</td>
                <td className="muted">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>SoSoValue quota</h2>
      <div className="card">
        {q.monthRemaining != null ? (
          <>
            {q.monthRemaining.toLocaleString("en-US")} requests left this month (key limit 10,000/month, 100/min) · as of the last uncached request,{" "}
            {timeUtc(q.at)}
          </>
        ) : (
          <span className="muted">No uncached SoSoValue request on this server instance yet — everything came from cache.</span>
        )}
      </div>

      <h2>Recent upstream calls (this server instance)</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Call</th>
              <th>Status</th>
              <th className="num">ms</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c, i) => (
              <tr key={i}>
                <td className="muted">{timeUtc(c.at)}</td>
                <td>
                  <code>
                    {c.source} {c.path}
                  </code>
                  {c.error && <span className="sub bad">{c.error}</span>}
                </td>
                <td>{c.status}</td>
                <td className="num">{c.ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
