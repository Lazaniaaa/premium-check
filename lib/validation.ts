// Checking the method against history (reconstructed from SoSoValue, not recorded by us).
//
// Our cost rule assumes a fund's premium/discount to NAV is the same when you sell as when
// you buy. SoSoValue's ETF history (about 30 days) lets us test that: for every fund and
// every start day, how far did the premium actually move after N trading days? We compare
// three exit assumptions and also measure how far the gap between two funds moved, which is
// what decides a ranking between ETFs. Same cache keys as the main page: no extra quota.
import { getJson, maybe } from "./http";
import { etfList, num, TTL } from "./sources";

export type Assumption = "unchanged" | "zero" | "pastMedian";
export type Stats = { n: number; median: number | null; p90: number | null; max: number | null };
export type HorizonResult = {
  days: number; // trading days between entry and exit
  unchanged: Stats; // |p(t+h) - p(t)|: our rule
  zero: Stats; // |p(t+h)|: premium returns to zero
  pastMedian: Stats; // |p(t+h) - median(p up to t)|
  pairwise: Stats; // |Δ(pA - pB)| for two funds on the same days
  meanSigned: number | null; // mean of p(t+h) - p(t)
};
export type FundRow = { ticker: string; days: number; latest: number | null; median5: number | null; p90_5: number | null };
export type Backtest = {
  asset: "BTC" | "ETH";
  method: string;
  funds: FundRow[];
  from: string | null;
  to: string | null;
  horizons: HorizonResult[];
  /** p90 premium move over the longest horizon with enough samples: gaps smaller than this can go either way. */
  noise: number | null;
  noiseDays: number | null;
  bestAssumption: Assumption | null;
  generatedAt: string;
};

/** A real SoDEX round trip next to the prediction recorded before it (scripts/predict-trade.mjs). */
export type TradeRecord = {
  symbol: string;
  usd: number;
  predictionFile: string; // data/validation/predictions/<time>.json, with the book it used
  predictedAt: string;
  tradedAt: string;
  account: string; // public: anyone can re-read GET /spot/accounts/{account}/trades
  tradeIds: number[];
  predicted: { buyVwap: number; sellVwap: number; roundTripCost: number; roundTripUsd: number };
  actual: { buyVwap: number; sellVwap: number; qty: number; feesUsd: number; roundTripCost: number; roundTripUsd: number };
  note?: string;
};

export const HORIZON_DAYS = [1, 5, 10];
const MIN_SAMPLES = 50;

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(q * (s.length - 1))];
};
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stats = (xs: number[]): Stats => ({ n: xs.length, median: median(xs), p90: quantile(xs, 0.9), max: xs.length ? Math.max(...xs) : null });

export type Series = Record<string, { date: string; p: number }[]>;

/** Pure part, tested in tests/validation.test.ts. Points must be sorted by date. */
export function backtest(series: Series, horizons = HORIZON_DAYS) {
  const tickers = Object.keys(series).filter((t) => series[t].length > 1);
  const out: HorizonResult[] = horizons.map((h) => {
    const un: number[] = [];
    const zero: number[] = [];
    const pm: number[] = [];
    const signed: number[] = [];
    for (const t of tickers) {
      const ps = series[t].map((x) => x.p);
      for (let i = 0; i + h < ps.length; i++) {
        un.push(Math.abs(ps[i + h] - ps[i]));
        signed.push(ps[i + h] - ps[i]);
        zero.push(Math.abs(ps[i + h]));
        pm.push(Math.abs(ps[i + h] - median(ps.slice(0, i + 1))!));
      }
    }
    // Two funds, same dates: how far did the gap between their premiums move?
    const pair: number[] = [];
    for (let a = 0; a < tickers.length; a++)
      for (let b = a + 1; b < tickers.length; b++) {
        const B = new Map(series[tickers[b]].map((x) => [x.date, x.p]));
        const common = series[tickers[a]].filter((x) => B.has(x.date)).map((x) => x.p - B.get(x.date)!);
        for (let i = 0; i + h < common.length; i++) pair.push(Math.abs(common[i + h] - common[i]));
      }
    return {
      days: h,
      unchanged: stats(un),
      zero: stats(zero),
      pastMedian: stats(pm),
      pairwise: stats(pair),
      meanSigned: signed.length ? signed.reduce((s, x) => s + x, 0) / signed.length : null,
    };
  });
  const usable = out.filter((r) => r.unchanged.n >= MIN_SAMPLES);
  const longest = usable.at(-1) ?? null;
  const best = longest
    ? (["unchanged", "zero", "pastMedian"] as Assumption[]).reduce((b, k) => (longest[k].p90! < longest[b].p90! ? k : b), "unchanged" as Assumption)
    : null;
  const funds: FundRow[] = tickers.map((t) => {
    const ps = series[t].map((x) => x.p);
    const d5 = ps.slice(0, -5).map((p, i) => Math.abs(ps[i + 5] - p));
    return { ticker: t, days: ps.length, latest: ps.at(-1) ?? null, median5: median(d5), p90_5: quantile(d5, 0.9) };
  });
  const dates = tickers.flatMap((t) => series[t].map((x) => x.date)).sort();
  return {
    horizons: out,
    noise: longest?.unchanged.p90 ?? null,
    noiseDays: longest?.days ?? null,
    bestAssumption: best,
    funds,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
  };
}

export async function premiumBacktest(asset: "BTC" | "ETH"): Promise<Backtest> {
  const list = (await maybe(etfList(asset))) ?? [];
  const series: Series = {};
  await Promise.all(
    list.map(async (e) => {
      const hist = await maybe(getJson<any[]>("sosovalue", `/etfs/${e.ticker}/history`, {}, TTL.etf));
      const pts = (hist ?? [])
        .map((h) => ({ date: String(h.date), p: num(h.prem_dsc) }))
        .filter((x): x is { date: string; p: number } => x.p !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (pts.length > 1) series[e.ticker] = pts;
    }),
  );
  const r = backtest(series);
  r.funds.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return {
    asset,
    method:
      "For every US spot ETF and every start day in SoSoValue /etfs/{ticker}/history, the error of each exit-premium assumption after N trading days; p90 = 9 in 10 cases were smaller.",
    ...r,
    generatedAt: new Date().toISOString(),
  };
}
