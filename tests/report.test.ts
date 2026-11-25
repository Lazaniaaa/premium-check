import { beforeAll, describe, expect, it } from "vitest";
import { buildFacts, renderNote, templateNote, validate, type Fact, type Note } from "@/lib/report";
import { normalize } from "@/lib/query";
import { takeSnapshot, type Snapshot } from "@/lib/snapshot";

const fact = (id: string, template: string, vars: Record<string, string>): Fact => {
  const v = Object.fromEntries(Object.entries(vars).map(([k, value]) => [k, { value, label: k }]));
  return { id, template, text: template.replace(/\{(\w+)\}/g, (_, k) => v[k].value), vars: v };
};
const facts: Fact[] = [
  fact("F1", "Cheapest way to hold BTC: {btc_best_name} at {btc_best_cost} total cost.", {
    btc_best_name: "SoDEX spot vBTC/vUSDC",
    btc_best_cost: "0.13%",
  }),
  fact("F2", "SoDEX BTC-USD perp funding is {btc_funding_year} a year.", { btc_funding_year: "6.93%" }),
  fact("F3", "Strategy: {mstr_ratio_equity} on equity, {mstr_ratio_debt} with debt.", {
    mstr_ratio_equity: "0.62×",
    mstr_ratio_debt: "0.70×",
  }),
];
const note = (headline: string, headlineFacts: string[], points: [string, string[]][]): Note => ({
  headline,
  headlineFacts,
  points: points.map(([text, f]) => ({ text, facts: f })),
});

describe("note validator: the AI may not type a digit", () => {
  it("accepts text that uses only {variables} of the cited facts, and code fills the values", () => {
    const n = note("{btc_best_name} is the cheapest way to hold BTC", ["F1"], [
      ["It costs {btc_best_cost} over the period.", ["F1"]],
      ["Perp funding runs at {btc_funding_year} a year.", ["F2"]],
    ]);
    expect(validate(n, facts)).toEqual([]);
    const r = renderNote(n, facts);
    expect(r.headline).toBe("SoDEX spot vBTC/vUSDC is the cheapest way to hold BTC");
    expect(r.points[1].text).toBe("Perp funding runs at 6.93% a year.");
  });

  it("rejects any typed number — invented, copied, rounded, sign-flipped or converted", () => {
    for (const bad of ["Spot costs 0.13%.", "Funding is -6.93% per hour.", "Spot costs 13 bps.", "Ratio 0.6x."]) {
      const errs = validate(note("x", [], [[bad, ["F1", "F2", "F3"]], ["Fine {btc_best_cost}.", ["F1"]]]), facts).join();
      expect(errs).toMatch(/digit outside a \{variable\}/);
    }
  });

  it("rejects a variable from a fact the sentence does not cite", () => {
    const n = note("x", [], [["Funding is {btc_funding_year}.", ["F1"]], ["Spot {btc_best_cost}.", ["F1"]]]);
    expect(validate(n, facts).join()).toMatch(/\{btc_funding_year\} is not a variable of the facts it cites/);
  });

  it("rejects unknown variables, unknown fact ids, malformed braces and too few points", () => {
    const errs = validate(note("x {made_up}", ["F9"], [["Spot {btc_best_cost", ["F1"]]]), facts).join();
    expect(errs).toMatch(/unknown facts F9/);
    expect(errs).toMatch(/\{made_up\} is not a variable/);
    expect(errs).toMatch(/malformed/);
    expect(errs).toMatch(/2-5 points/);
  });

  it("cannot stop a misleading sentence: swapped variables pass, which is why each point lists its facts", () => {
    const swapped = note("x", [], [["With debt it is {mstr_ratio_equity}.", ["F3"]], ["Spot {btc_best_cost}.", ["F1"]]]);
    expect(validate(swapped, facts)).toEqual([]); // documented limit
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
    // every number in every fact comes from a variable: the template itself has no digits
    for (const x of f) expect(x.template.replace(/\{\w+\}/g, "")).not.toMatch(/\d/);
    expect(f.find((x) => x.text.startsWith("Strategy (MSTR)"))).toBeTruthy();
    // ETF names are spelled out with the ticker in brackets, so e.g. the "BTC" ticker can't be mistaken for the coin
    const etfFacts = f.filter((x) => /^(Cheapest|Second cheapest)/.test(x.text) && /Trust|ETF|Fund/.test(x.text));
    expect(etfFacts.length).toBeGreaterThan(0);
    for (const x of etfFacts) expect(x.text).toMatch(/[A-Za-z][A-Za-z ]+ \([A-Z]{2,5}\)/);
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

describe("third review (Astra) cases", () => {
  it("rejects a fund ticker typed outside a variable ('IBIT is the cheapest' while citing MSBT)", () => {
    const f2 = [
      { id: "F1", template: "Cheapest: {btc_best_name} at {btc_best_cost}.", text: "", vars: { btc_best_name: { value: "Morgan Stanley Bitcoin Trust (MSBT)", label: "" }, btc_best_cost: { value: "0.14%", label: "" } } },
    ];
    const n = { headline: "IBIT is the cheapest", headlineFacts: ["F1"], points: [{ text: "x {btc_best_cost}", facts: ["F1"] }, { text: "y", facts: ["F1"] }] };
    expect(validate(n, f2, ["IBIT", "MSBT"]).join()).toMatch(/names IBIT outside a \{variable\}/);
  });

  it("tells the two stored formats apart: 24 Nov (premium counted) vs 25 Nov (fee only)", async () => {
    const fs = await import("node:fs");
    const { methodOf } = await import("@/lib/snapshot");
    const read = (d: string) => JSON.parse(fs.readFileSync(`data/snapshots/${d}.json`, "utf8"));
    expect(methodOf(read("2026-11-24"))).toBe(1);
    expect(methodOf(read("2026-11-25"))).toBe(2);
  });
});
