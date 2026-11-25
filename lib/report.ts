// Daily "Premium Report": a short note written by an LLM from numbered facts that
// our own code computed. A validator rejects any number that is not in the facts the
// sentence cites; on failure the model gets one retry with the errors, then we fall
// back to a template. The model never sees raw API data and cannot add numbers.
import { pct, ratio, usd } from "./format";
import { MODELS, structured } from "./llm";
import type { Snapshot } from "./snapshot";

export type Fact = { id: string; text: string };
export type NotePoint = { text: string; facts: string[] };
export type Note = { headline: string; headlineFacts: string[]; points: NotePoint[] };
export type Report = {
  schema: 1;
  day: string;
  generatedAt: string;
  by: string;
  snapshotTakenAt: string; // the snapshot this note's facts were computed from
  facts: Fact[];
  note: Note;
  author: { kind: "llm"; model: string; attempts: number; tokens: { input: number; output: number } } | { kind: "template"; reason: string };
  snapshot: Snapshot;
};

// "IBIT — iShares Bitcoin Trust" -> "iShares Bitcoin Trust (IBIT)"; SoDEX routes unchanged.
const name = (s: string) => {
  const [ticker, full] = s.split(" — ");
  return full ? `${full} (${ticker})` : s;
};

/** Deterministic facts from today's snapshot (and yesterday's, if available). */
export function buildFacts(today: Snapshot, prev: Snapshot | null): Fact[] {
  const f: Fact[] = [];
  const add = (text: string) => f.push({ id: `F${f.length + 1}`, text });
  const { btc, eth, params } = today;
  if (!btc) throw new Error("no BTC data in this snapshot");
  add(`Comparison basis: $${params.usd.toLocaleString("en-US")} held for ${params.months} months; costs include trading and recurring costs.`);
  add(
    btc.reference.deviationBps != null
      ? `BTC reference price ${usd(btc.reference.price)} (SoDEX BTC-USD index); the SoSoValue price differs by ${Math.abs(btc.reference.deviationBps).toFixed(1)} bps.`
      : `BTC reference price ${usd(btc.reference.price)} (SoDEX BTC-USD index); the SoSoValue cross-check was unavailable.`,
  );
  const btcRanked = btc.routes.filter((r) => r.ranked);
  if (btcRanked[0]) add(`Cheapest way to hold BTC: ${name(btcRanked[0].name)} at ${pct(btcRanked[0].cost)} total cost.`);
  if (btcRanked[1]) add(`Second cheapest BTC route: ${name(btcRanked[1].name)} at ${pct(btcRanked[1].cost)}.`);
  const ibit = btc.routes.find((r) => r.id === "etf-IBIT");
  if (ibit) add(`BlackRock IBIT total cost ${pct(ibit.cost)} (sponsor fee ${pct(ibit.annualCarry)}).`);
  if (btc.perpAnnualFunding != null) add(`SoDEX BTC-USD perp funding is ${pct(btc.perpAnnualFunding)} per year at the current hourly rate.`);
  const btcPerp = btc.routes.find((r) => r.id === "sodex-perp");
  if (btcPerp) add(`Holding BTC through the SoDEX perp costs ${pct(btcPerp.cost)} in total.`);
  const mstr = btc.companies.find((c) => c.ticker === "MSTR");
  if (mstr)
    add(
      `Strategy (MSTR): market cap is ${ratio(mstr.mnavEquity)} its BTC value; adding debt and subtracting cash it is ${ratio(mstr.mnavWithDebt)}. Price ${usd(mstr.price, 2)} from ${mstr.priceSource === "sodex_24_7" ? "the SoDEX MSTR-USD perp (24/7 proxy)" : "the exchange"}.`,
    );
  const pure = btc.companies.filter((c) => c.kind === "treasury" && c.mnavEquity != null);
  if (pure.length)
    add(`${pure.filter((c) => c.mnavEquity! < 1).length} of ${pure.length} treasury companies have a market cap below the value of their BTC (before debt).`);
  if (eth) {
    const ethRanked = eth.routes.filter((r) => r.ranked);
    if (ethRanked[0]) add(`Cheapest way to hold ETH: ${name(ethRanked[0].name)} at ${pct(ethRanked[0].cost)} total cost.`);
    if (eth.perpAnnualFunding != null) add(`SoDEX ETH-USD perp funding is ${pct(eth.perpAnnualFunding)} per year at the current hourly rate.`);
    const staking = eth.routes.filter((r) => r.flags.includes("staking_unmodeled")).length;
    if (staking) add(`${staking} ETH ETFs stake and pay distributions, which this comparison does not model, so they are not ranked.`);
  }
  if (prev?.btc && (prev.methodVersion ?? 1) === (today.methodVersion ?? 1)) {
    const pm = prev.btc.companies.find((c) => c.ticker === "MSTR");
    if (pm?.mnavEquity != null && mstr?.mnavEquity != null)
      add(`Previous snapshot (${prev.takenAt.slice(0, 10)}): Strategy's market cap was ${ratio(pm.mnavEquity)} its BTC value.`);
    if (prev.btc.perpAnnualFunding != null)
      add(`Previous snapshot (${prev.takenAt.slice(0, 10)}): SoDEX BTC perp funding was ${pct(prev.btc.perpAnnualFunding)} per year.`);
  }
  return f;
}

// ---------- validator ----------
// A number token keeps its sign, unit and, if stated right after it, its period:
// "+6.93% per year" and "-6.93% per hour" are different tokens.
export type Token = { n: string; sign: "+" | "-"; unit: "" | "%" | "x" | "$" | "bps" | "pp"; per: "" | "year" | "hour" };
const TOKEN = /(?<![\w.])([+\-−])?(\$)?(\d[\d,]*(?:\.\d+)?)(\s*(?:%|×|x\b|bps\b|pp\b))?/gi;
const norm = (s: string) => s.replace(/,/g, "").replace(/\.0+$|(\.\d*?)0+$/, "$1");
const PERIOD = /^\s*(?:per|a|an|\/|each)?\s*(year|yr|annum|hour|hr)\b/i;

export function tokensIn(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 16);
    const u = (m[4] ?? "").trim().toLowerCase();
    const per = PERIOD.exec(after)?.[1].toLowerCase() ?? "";
    out.push({
      n: norm(m[3]),
      sign: m[1] === "-" || m[1] === "−" ? "-" : "+",
      unit: m[2] ? "$" : u === "%" ? "%" : u === "×" || u === "x" ? "x" : u === "bps" ? "bps" : u === "pp" ? "pp" : "",
      per: per.startsWith("h") ? "hour" : per ? "year" : "",
    });
  }
  return out;
}
/** Numbers only, for quick checks in tests. */
export const numbersIn = (s: string) => tokensIn(s).map((t) => t.n);

const matches = (t: Token, f: Token) =>
  t.n === f.n &&
  t.sign === f.sign &&
  (t.unit === "" || t.unit === f.unit) && // a bare number may drop the unit, never change it
  (t.per === "" || f.per === "" || t.per === f.per); // a stated period must agree

/**
 * Every number in a sentence must match a number in a fact that sentence cites —
 * same value, same sign, same unit, and the same period if both state one.
 * It cannot tell whether a correct number was put next to the wrong label
 * (e.g. two ratios swapped); the note links every point to its facts so a reader can check.
 */
export function validate(note: Note, facts: Fact[]): string[] {
  const byId = new Map(facts.map((x) => [x.id, x.text]));
  const errors: string[] = [];
  const check = (text: string, cites: string[], where: string) => {
    const unknown = cites.filter((c) => !byId.has(c));
    if (unknown.length) errors.push(`${where}: cites unknown facts ${unknown.join(", ")}`);
    const allowed = cites.flatMap((c) => tokensIn(byId.get(c) ?? ""));
    for (const t of tokensIn(text))
      if (!allowed.some((f) => matches(t, f)))
        errors.push(`${where}: "${t.sign === "-" ? "-" : ""}${t.unit === "$" ? "$" : ""}${t.n}${t.unit && t.unit !== "$" ? t.unit : ""}${t.per ? " per " + t.per : ""}" does not match the cited facts`);
  };
  check(note.headline, note.headlineFacts, "headline");
  if (note.points.length < 2 || note.points.length > 5) errors.push(`expected 2-5 points, got ${note.points.length}`);
  note.points.forEach((p, i) => {
    if (!p.facts.length) errors.push(`point ${i + 1}: no facts cited`);
    check(p.text, p.facts, `point ${i + 1}`);
  });
  return errors;
}

// ---------- writer ----------
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "headlineFacts", "points"],
  properties: {
    headline: { type: "string" },
    headlineFacts: { type: "array", items: { type: "string" } },
    points: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "facts"],
        properties: { text: { type: "string" }, facts: { type: "array", items: { type: "string" } } },
      },
    },
  },
};

const SYSTEM = `You write the daily "Premium Check" note: what it costs today to hold BTC or ETH through SoDEX spot or perps, spot ETFs, or treasury stocks.
Write for a retail investor, in plain English, neutral tone, no advice ("buy", "sell", "should").
Rules:
- Use ONLY the numbered facts given. Every number you write must be copied exactly as it appears in a fact you cite in that sentence's "facts" list: same digits, decimals, sign, unit (%, ×, $, bps) and period (per year / per hour).
- Do not compute new numbers (no differences, sums, ratios, rounding, bps conversions). Compare with words ("lower than", "about the same") instead.
- Headline: one sentence, max 14 words, stating the single most useful finding of the day (it may contain a number from a fact it cites). Then 3 or 4 points, each one or two sentences.
- Cite fact ids like "F3" in the facts arrays, never in the text itself.`;

export function templateNote(facts: Fact[]): Note {
  const pick = (re: RegExp) => facts.find((x) => re.test(x.text));
  const pts = [pick(/^Cheapest way to hold BTC/), pick(/perp funding is .* BTC|BTC-USD perp funding/), pick(/^Strategy \(MSTR\)/), pick(/^Cheapest way to hold ETH/)].filter(
    (x): x is Fact => !!x,
  );
  return {
    headline: "Today's cost of holding BTC and ETH, route by route",
    headlineFacts: [],
    points: pts.map((x) => ({ text: x.text, facts: [x.id] })),
  };
}

export async function writeNote(facts: Fact[]): Promise<{ note: Note; author: Report["author"] }> {
  const factList = facts.map((x) => `${x.id}: ${x.text}`).join("\n");
  let feedback = "";
  let tokens = { input: 0, output: 0 };
  let model: string = MODELS.writer;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await structured<Note>({
        model: MODELS.writer,
        system: SYSTEM,
        user: `Facts:\n${factList}${feedback}`,
        schemaName: "premium_note",
        schema: SCHEMA,
        timeoutMs: 40_000,
        maxOutputTokens: 3000,
      });
      tokens = { input: tokens.input + r.usage.input, output: tokens.output + r.usage.output };
      model = r.model;
      const errors = validate(r.data, facts);
      if (!errors.length) return { note: r.data, author: { kind: "llm", model, attempts: attempt, tokens } };
      feedback = `\n\nYour previous draft was rejected by the validator:\n- ${errors.join("\n- ")}\nRewrite it so every number is copied exactly from a cited fact.`;
    } catch (e) {
      // Provider error text stays in server logs; the public report gets a generic reason.
      console.error("[report] writer failed:", e instanceof Error ? e.message : e);
      return { note: templateNote(facts), author: { kind: "template", reason: "AI writer unavailable" } };
    }
  }
  return { note: templateNote(facts), author: { kind: "template", reason: `validator rejected 2 drafts: ${feedback.slice(0, 300)}` } };
}
