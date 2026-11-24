// History that SoSoValue itself provides (not recorded by us): ETF premium/discount
// over the API's 30-day window and Strategy's BTC purchases. Same cache keys as the
// main page, so this costs no extra quota.
import { getJson, maybe } from "./http";
import { etfData, etfList, num, purchaseHistory, TTL } from "./sources";

export type EtfPremiumStats = {
  ticker: string;
  name: string;
  fee: number | null;
  days: number;
  from: string | null;
  to: string | null;
  min: number | null;
  median: number | null;
  max: number | null;
  latest: number | null;
  netAssets: number | null;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function etfPremiumHistory(asset: "BTC" | "ETH"): Promise<EtfPremiumStats[]> {
  const list = (await maybe(etfList(asset))) ?? [];
  const rows = await Promise.all(
    list.map(async (e) => {
      const [hist, d] = await Promise.all([
        maybe(getJson<any[]>("sosovalue", `/etfs/${e.ticker}/history`, {}, TTL.etf)),
        maybe(etfData(e.ticker)),
      ]);
      const pts = (hist ?? [])
        .map((h) => ({ date: String(h.date), p: num(h.prem_dsc) }))
        .filter((x): x is { date: string; p: number } => x.p !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
      const ps = pts.map((x) => x.p);
      return {
        ticker: e.ticker,
        name: e.name,
        fee: d?.fee ?? null,
        days: pts.length,
        from: pts[0]?.date ?? null,
        to: pts.at(-1)?.date ?? null,
        min: ps.length ? Math.min(...ps) : null,
        median: median(ps),
        max: ps.length ? Math.max(...ps) : null,
        latest: ps.at(-1) ?? null,
        netAssets: d?.netAssets ?? null,
      };
    }),
  );
  return rows.sort((a, b) => (b.netAssets ?? 0) - (a.netAssets ?? 0));
}

export async function strategyPurchases(limit = 12) {
  const h = (await maybe(purchaseHistory("MSTR"))) ?? [];
  return {
    total: h.length,
    since: h.at(-1)?.date ?? null,
    rows: h.slice(0, limit).map((r) => ({ ...r, usdPerBtc: r.btcAcq ? r.acqCost / r.btcAcq : null })),
  };
}
