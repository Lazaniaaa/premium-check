import { describe, expect, it } from "vitest";
import { backtest, type Series } from "@/lib/validation";

const days = (ps: number[]) => ps.map((p, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, p }));

describe("backtest", () => {
  it("measures each exit assumption against what happened", () => {
    // Premium jumps to +0.3% and comes back: "unchanged" is wrong twice, "zero" once.
    const s: Series = { A: days([0, 0.003, 0]) };
    const [h1] = backtest(s, [1]).horizons;
    expect(h1.unchanged.n).toBe(2);
    expect(h1.unchanged.max).toBeCloseTo(0.003);
    expect(h1.unchanged.median).toBeCloseTo(0.003);
    expect(h1.zero.median).toBeCloseTo(0.0015);
    expect(h1.meanSigned).toBeCloseTo(0);
  });

  it("gap between two funds ignores moves they share", () => {
    // Both funds move together: each premium moves, the gap between them does not.
    const s: Series = { A: days([0, 0.004, -0.002]), B: days([0.001, 0.005, -0.001]) };
    const [h1] = backtest(s, [1]).horizons;
    expect(h1.unchanged.max).toBeCloseTo(0.006);
    expect(h1.pairwise.max).toBeCloseTo(0);
  });

  it("aligns funds by date, not by position", () => {
    const s: Series = {
      A: [
        { date: "2026-11-02", p: 0.001 },
        { date: "2026-11-03", p: 0.002 },
      ],
      B: [
        { date: "2026-11-01", p: 0.009 },
        { date: "2026-11-02", p: 0.001 },
        { date: "2026-11-03", p: 0.002 },
      ],
    };
    expect(backtest(s, [1]).horizons[0].pairwise.max).toBeCloseTo(0);
  });

  it("gives no noise figure without enough samples", () => {
    const r = backtest({ A: days([0, 0.001, 0.002]) });
    expect(r.noise).toBeNull();
    expect(r.bestAssumption).toBeNull();
  });

  it("noise is the p90 of the longest usable horizon", () => {
    // 12 funds × 21 days: enough samples at 1, 5 and 10 days.
    const s: Series = {};
    for (let f = 0; f < 12; f++) s[`F${f}`] = days(Array.from({ length: 21 }, (_, i) => ((i * 7 + f * 3) % 11) / 10000 - 0.0005));
    const r = backtest(s);
    expect(r.noiseDays).toBe(10);
    expect(r.noise).toBe(r.horizons[2].unchanged.p90);
    expect(r.funds).toHaveLength(12);
  });
});
