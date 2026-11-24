import { beforeAll, describe, expect, it } from "vitest";
import { buildFacts, numbersIn, templateNote, validate, type Fact } from "@/lib/report";
import { normalize } from "@/lib/query";
import { takeSnapshot, type Snapshot } from "@/lib/snapshot";

const facts: Fact[] = [
  { id: "F1", text: "Cheapest way to hold BTC: SoDEX spot vBTC/vUSDC at 0.13% total cost." },
  { id: "F2", text: "SoDEX BTC-USD perp funding is 6.93% per year at the current hourly rate." },
  { id: "F3", text: "Strategy (MSTR) mNAV is 0.62× on equity and 0.70× with debt; price $77.86." },
  { id: "F4", text: "7 of 7 treasury companies trade below 1.00× mNAV on equity." },
];
const note = (headline: string, headlineFacts: string[], points: [string, string[]][]) => ({
  headline,
  headlineFacts,
  points: points.map(([text, f]) => ({ text, facts: f })),
});

describe("note validator", () => {
  it("accepts numbers copied exactly from cited facts", () => {
    const n = note("Spot is cheapest at 0.13%", ["F1"], [
      ["Perp funding runs at 6.93% a year.", ["F2"]],
      ["Strategy sits at 0.62× on equity, 0.70× with debt.", ["F3"]],
    ]);
    expect(validate(n, facts)).toEqual([]);
  });

  it("treats 1.00× and 1× as the same number", () => {
    expect(numbersIn("below 1.00×")).toEqual(numbersIn("below 1×"));
    const n = note("All seven trade below 1×", ["F4"], [["7 of 7 are below 1.00×.", ["F4"]], ["Spot costs 0.13%.", ["F1"]]]);
    expect(validate(n, facts)).toEqual([]);
  });

  it("rejects a number the facts do not contain", () => {
    const n = note("Spot is cheapest", [], [["Spot costs 0.12%.", ["F1"]], ["Perp: 6.93%.", ["F2"]]]);
    expect(validate(n, facts).join()).toMatch(/0\.12/);
  });

  it("rejects derived numbers (a computed difference or a bps conversion)", () => {
    const diff = note("x", [], [["Perps cost 6.8 points more than spot.", ["F1", "F2"]], ["Spot 0.13%.", ["F1"]]]);
    expect(validate(diff, facts).join()).toMatch(/6\.8/);
    const bpsNote = note("x", [], [["Spot costs 13 bps.", ["F1"]], ["Perp 6.93%.", ["F2"]]]);
    expect(validate(bpsNote, facts).join()).toMatch(/"13"/);
  });

  it("rejects a correct number attributed to the wrong fact", () => {
    const n = note("x", [], [["Spot costs 0.13%.", ["F2"]], ["Perp 6.93%.", ["F2"]]]);
    expect(validate(n, facts).join()).toMatch(/0\.13/);
  });

  it("rejects unknown fact ids and too few points", () => {
    const n = note("x", ["F9"], [["Spot.", ["F1"]]]);
    const errs = validate(n, facts).join();
    expect(errs).toMatch(/unknown facts F9/);
    expect(errs).toMatch(/2-5 points/);
  });
});

describe("facts from a real (recorded) snapshot", () => {
  let snap: Snapshot;
  beforeAll(async () => {
    process.env.DATA_SOURCE = "fixture";
    snap = await takeSnapshot("test");
  });

  it("are deterministic text with numbered ids", () => {
    const f = buildFacts(snap, null);
    expect(f.map((x) => x.id)).toEqual(f.map((_, i) => `F${i + 1}`));
    expect(f.find((x) => x.text.startsWith("Cheapest way to hold BTC"))).toBeTruthy();
    expect(f.find((x) => x.text.startsWith("Strategy (MSTR)"))).toBeTruthy();
    // ETF names are spelled out, so the "BTC" ticker can't be mistaken for the coin
    expect(f.some((x) => /Grayscale Bitcoin Mini Trust \(BTC\)/.test(x.text))).toBe(true);
  });

  it("the template fallback always passes the validator", () => {
    const f = buildFacts(snap, snap);
    expect(validate(templateNote(f), f)).toEqual([]);
  });
});

describe("query normalisation", () => {
  it("snaps to supported values and drops unknown exclusions", () => {
    expect(normalize({ asset: "ETH", usd: 5000.4, months: 13, exclude: ["etf", "bogus", "etf"] })).toEqual({
      asset: "ETH",
      usd: 5000,
      months: 12,
      exclude: ["etf"],
    });
    expect(normalize({ asset: "BTC", usd: 3, months: 0, exclude: [] }).usd).toBe(10);
  });
});
