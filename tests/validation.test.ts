import { describe, expect, it } from "vitest";
import { backtest, fundingBacktest, type Series } from "@/lib/backtest";
import { fundingTest, premiumBacktest } from "@/lib/validation";

const days = (ps: number[]) => ps.map((p, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, p }));

describe("backtest", () => {
  it("measures each exit assumption against what happened", () => {
    // Premium jumps to +0.3% and comes back: "unchanged" is wrong twice, "at NAV" once.
    const [h1] = backtest({ A: days([0, 0.003, 0]) }, [1]).horizons;
    expect(h1.unchanged.n).toBe(2);
    expect(h1.startDates).toBe(2);
    expect(h1.unchanged.median).toBeCloseTo(0.003);
    expect(h1.zero.median).toBeCloseTo(0.0015);
    expect(h1.best).toBe("zero");
  });

  it("gap between two funds ignores moves they share", () => {
    const [h1] = backtest({ A: days([0, 0.004, -0.002]), B: days([0.001, 0.005, -0.001]) }, [1]).horizons;
    expect(h1.unchanged.max).toBeCloseTo(0.006);
    expect(h1.pairwise.max).toBeCloseTo(0);
    expect(h1.pairwise.n).toBe(2);
  });

  it("uses one calendar: a missing session is skipped, not stretched over", () => {
    // B has no value on 11-02. With h=1 the window 11-01 → 11-03 must NOT count for B.
    const s: Series = {
      A: days([0, 0.001, 0.002]),
      B: [
        { date: "2026-11-01", p: 0 },
        { date: "2026-11-03", p: 0.009 },
      ],
    };
    const [h1] = backtest(s, [1]).horizons;
    expect(h1.unchanged.n).toBe(2); // only A's two windows
    expect(h1.unchanged.max).toBeCloseTo(0.001);
    expect(h1.pairwise.n).toBe(0);
    expect(backtest(s, [2]).horizons[0].unchanged.n).toBe(2); // A and B, both 11-01 → 11-03
  });

  it("a repeated date counts once", () => {
    const s: Series = { A: [...days([0, 0.001, 0.002]), { date: "2026-11-03", p: 0.002 }] };
    expect(backtest(s, [1]).horizons[0].unchanged.n).toBe(2);
    expect(backtest(s).sessions).toBe(3);
  });

  it("aligns funds by date, not by position", () => {
    const s: Series = {
      A: [
        { date: "2026-11-02", p: 0.001 },
        { date: "2026-11-03", p: 0.002 },
      ],
      B: days([0.009, 0.001, 0.002]),
    };
    expect(backtest(s, [1]).horizons[0].pairwise.max).toBeCloseTo(0);
  });
});

describe("frozen dataset", () => {
  it("covers every listed fund and reproduces the same numbers on every call", () => {
    for (const asset of ["BTC", "ETH"] as const) {
      const r = premiumBacktest(asset);
      expect(r.covered).toBe(r.listed);
      expect(r.sessions).toBeGreaterThanOrEqual(20);
      expect(r.longest?.days).toBe(10);
      expect(r.longest!.startDates).toBe(r.sessions - 10);
      expect(r.longest!.unchanged.n).toBe(r.covered * r.longest!.startDates);
    }
  });
});

// Hourly funding series in units of 1e-10, starting at midnight UTC.
const hours = (rates: (number | null)[], firstHour = "2026-01-01T00:00:00.000Z") => ({ firstHour, rates });

describe("funding backtest", () => {
  it("a constant rate is predicted exactly; 'no funding' misses by rate × hours", () => {
    const r = fundingBacktest(hours(Array(24 * 10).fill(100)), [1], 24 * 12 * 2, 24); // 1 month = 48 h here
    const [h] = r.horizons;
    expect(h.hours).toBe(48);
    expect(h.starts).toBe(8); // days 1..8 at 00:00, after a 24 h trailing window, with 48 h left
    expect(h.today.p90Abs).toBeCloseTo(0);
    expect(h.trailing30.p90Abs).toBeCloseTo(0);
    expect(h.zero.medianAbs).toBeCloseTo(48 * 100 * 1e-10);
    expect(h.actual.median).toBeCloseTo(48 * 100 * 1e-10);
  });

  it("uses the last settled hour as today's rate and counts under-predictions", () => {
    // The rate doubles at the start of day 2: a start at that midnight still sees the old rate.
    const rates = [...Array(24).fill(100), ...Array(72).fill(200)];
    const [h] = fundingBacktest(hours(rates), [1], 24 * 12, 24).horizons; // 1 month = 24 h
    expect(h.starts).toBe(3);
    expect(h.today.n).toBe(3);
    expect(h.today.under).toBeCloseTo(1 / 3); // only the first start paid more than predicted
    expect(h.today.p90Abs).toBeCloseTo(24 * 100 * 1e-10);
  });

  it("drops the leading stretch with multi-hour gaps and fills isolated missing hours", () => {
    const rates = [5, null, null, 5, ...Array(20).fill(0), ...Array(24).fill(100), null, ...Array(47).fill(100)];
    const r = fundingBacktest(hours(rates), [1], 24 * 12, 24);
    expect(r.dropped).toBe(3);
    expect(r.filled).toBe(1);
    expect(r.hours).toBe(rates.length - 3);
    expect(r.from).toBe("2026-01-01T03:00:00.000Z");
    expect(r.horizons[0].starts).toBeGreaterThan(0); // starts still fall on midnight UTC
  });
});

describe("frozen funding history", () => {
  it("covers both coins hour by hour over more than three years", () => {
    for (const asset of ["BTC", "ETH"] as const) {
      const r = fundingTest(asset);
      expect(r.venue).toBe("Hyperliquid");
      expect(r.from).toBe("2023-06-08T00:00:00.000Z");
      expect(r.hours).toBeGreaterThan(24 * 365 * 3);
      expect(r.filled).toBeLessThanOrEqual(3);
      expect(r.horizons.map((h) => h.months)).toEqual([1, 3, 6, 12, 24]);
      expect(r.horizons.every((h) => h.starts > 0 && h.today.n === h.starts)).toBe(true);
    }
  });
});
