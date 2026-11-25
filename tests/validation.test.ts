import { describe, expect, it } from "vitest";
import { backtest, type Series } from "@/lib/backtest";
import { premiumBacktest } from "@/lib/validation";

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
