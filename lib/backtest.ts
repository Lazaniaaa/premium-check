// Pure backtest of exit-premium assumptions. No imports, no I/O: the site and
// scripts/reproduce-validation.mjs run exactly this code on the frozen dataset in
// data/validation/etf-premium-history.json.
//
// Every fund is placed on one shared calendar of trading sessions (all dates any fund
// reported). "After h sessions" means h steps on that calendar; if a fund has no value on
// either end, that window is skipped instead of silently stretching over a gap.

export type Point = { date: string; p: number };
export type Series = Record<string, Point[]>;
export type Assumption = "unchanged" | "zero" | "pastMedian";
export type Stats = { n: number; median: number | null; p90: number | null; max: number | null };
export type HorizonResult = {
  days: number; // trading sessions between entry and exit
  startDates: number; // distinct calendar start dates with at least one window
  unchanged: Stats; // |p(t+h) - p(t)|: our rule
  zero: Stats; // |p(t+h)|: sold at NAV
  pastMedian: Stats; // |p(t+h) - median(p up to t)|
  pairwise: Stats; // |Δ(pA - pB)|: change in the gap between two funds
  best: Assumption; // lowest p90 of the three
};
export type FundRow = { ticker: string; days: number; latest: number | null; median5: number | null; p90_5: number | null };
export type BacktestResult = {
  sessions: number;
  from: string | null;
  to: string | null;
  horizons: HorizonResult[];
  funds: FundRow[];
};

export const HORIZON_DAYS = [1, 5, 10];

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
export const quantile = (xs: number[], q: number) => (xs.length ? sorted(xs)[Math.floor(q * (xs.length - 1))] : null);
export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = sorted(xs);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stats = (xs: number[]): Stats => ({ n: xs.length, median: median(xs), p90: quantile(xs, 0.9), max: xs.length ? Math.max(...xs) : null });

export function backtest(series: Series, horizons = HORIZON_DAYS): BacktestResult {
  // One value per fund and date (the last one wins if a date repeats).
  const byFund = new Map<string, Map<string, number>>();
  for (const [t, pts] of Object.entries(series)) {
    const m = new Map<string, number>();
    for (const x of pts) if (Number.isFinite(x.p)) m.set(x.date, x.p);
    if (m.size > 1) byFund.set(t, m);
  }
  const tickers = [...byFund.keys()].sort();
  const calendar = [...new Set(tickers.flatMap((t) => [...byFund.get(t)!.keys()]))].sort();
  const at = (t: string, i: number) => byFund.get(t)!.get(calendar[i]);

  const out = horizons.map((h): HorizonResult => {
    const un: number[] = [];
    const zero: number[] = [];
    const pm: number[] = [];
    const pair: number[] = [];
    const starts = new Set<number>();
    for (let i = 0; i + h < calendar.length; i++) {
      for (const t of tickers) {
        const a = at(t, i);
        const b = at(t, i + h);
        if (a === undefined || b === undefined) continue;
        const past = calendar.slice(0, i + 1).map((d) => byFund.get(t)!.get(d)).filter((x): x is number => x !== undefined);
        un.push(Math.abs(b - a));
        zero.push(Math.abs(b));
        pm.push(Math.abs(b - median(past)!));
        starts.add(i);
      }
      for (let x = 0; x < tickers.length; x++)
        for (let y = x + 1; y < tickers.length; y++) {
          const a0 = at(tickers[x], i), a1 = at(tickers[x], i + h), b0 = at(tickers[y], i), b1 = at(tickers[y], i + h);
          if (a0 === undefined || a1 === undefined || b0 === undefined || b1 === undefined) continue;
          pair.push(Math.abs(a1 - b1 - (a0 - b0)));
        }
    }
    const r = { days: h, startDates: starts.size, unchanged: stats(un), zero: stats(zero), pastMedian: stats(pm), pairwise: stats(pair) };
    const best = (["unchanged", "zero", "pastMedian"] as Assumption[]).reduce(
      (b, k) => ((r[k].p90 ?? Infinity) < (r[b].p90 ?? Infinity) ? k : b),
      "unchanged" as Assumption,
    );
    return { ...r, best };
  });

  const funds: FundRow[] = tickers.map((t) => {
    const ps = calendar.map((d) => byFund.get(t)!.get(d));
    const d5: number[] = [];
    for (let i = 0; i + 5 < ps.length; i++) if (ps[i] !== undefined && ps[i + 5] !== undefined) d5.push(Math.abs(ps[i + 5]! - ps[i]!));
    const vals = ps.filter((x): x is number => x !== undefined);
    return { ticker: t, days: vals.length, latest: vals.at(-1) ?? null, median5: median(d5), p90_5: quantile(d5, 0.9) };
  });
  return { sessions: calendar.length, from: calendar[0] ?? null, to: calendar.at(-1) ?? null, horizons: out, funds };
}
