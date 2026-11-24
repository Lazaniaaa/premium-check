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
  add(`Comparison basis: $${params.usd.toLocaleString("en-US")} held for ${params.months} months; costs include trading and recurring costs.`);
  add(`BTC reference price ${usd(btc.reference.price)} (SoDEX BTC-USD index); SoSoValue price differs by ${Math.abs(btc.reference.deviationBps ?? 0).toFixed(1)} bps.`);
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
      `Strategy (MSTR) mNAV is ${ratio(mstr.mnavEquity)} on equity and ${ratio(mstr.mnavWithDebt)} with debt; price ${usd(mstr.price, 2)} from ${mstr.priceSource === "sodex_24_7" ? "SoDEX MSTR-USD (24/7)" : "the exchange"}.`,
    );
  const pure = btc.companies.filter((c) => c.kind === "treasury" && c.mnavEquity != null);
  if (pure.length) add(`${pure.filter((c) => c.mnavEquity! < 1).length} of ${pure.length} treasury companies trade below 1.00× mNAV on equity.`);
  const ethRanked = eth.routes.filter((r) => r.ranked);
  if (ethRanked[0]) add(`Cheapest way to hold ETH: ${name(ethRanked[0].name)} at ${pct(ethRanked[0].cost)} total cost.`);
  if (eth.perpAnnualFunding != null) add(`SoDEX ETH-USD perp funding is ${pct(eth.perpAnnualFunding)} per year at the current hourly rate.`);
  const small = eth.routes.filter((r) => r.flags.includes("small_fund")).length;
  if (small) add(`${small} ETH ETFs are under $100M in net assets and are not ranked.`);
  if (prev) {
    const pm = prev.btc.companies.find((c) => c.ticker === "MSTR");
    if (pm?.mnavEquity != null && mstr?.mnavEquity != null)
      add(`Previous snapshot (${prev.takenAt.slice(0, 10)}): MSTR mNAV on equity was ${ratio(pm.mnavEquity)}.`);
    if (prev.btc.perpAnnualFunding != null)
      add(`Previous snapshot (${prev.takenAt.slice(0, 10)}): SoDEX BTC perp funding was ${pct(prev.btc.perpAnnualFunding)} per year.`);
  }
  return f;
}

// ---------- validator ----------
const NUM = /\d[\d,]*(?:\.\d+)?/g;
const norm = (s: string) => s.replace(/,/g, "").replace(/\.0+$|(\.\d*?)0+$/, "$1");
export const numbersIn = (s: string) => (s.match(NUM) ?? []).map(norm);

/** Every number in `text` must appear in one of the cited facts. Returns error strings. */
export function validate(note: Note, facts: Fact[]): string[] {
  const byId = new Map(facts.map((x) => [x.id, x.text]));
  const errors: string[] = [];
  const check = (text: string, cites: string[], where: string) => {
    const unknown = cites.filter((c) => !byId.has(c));
    if (unknown.length) errors.push(`${where}: cites unknown facts ${unknown.join(", ")}`);
    const allowed = new Set(cites.flatMap((c) => numbersIn(byId.get(c) ?? "")));
    for (const n of numbersIn(text)) if (!allowed.has(n)) errors.push(`${where}: number "${n}" is not in the cited facts`);
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
- Use ONLY the numbered facts given. Every number you write must be copied exactly as it appears in a fact you cite in that sentence's "facts" list (same digits, same decimals).
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
      });
      tokens = { input: tokens.input + r.usage.input, output: tokens.output + r.usage.output };
      model = r.model;
      const errors = validate(r.data, facts);
      if (!errors.length) return { note: r.data, author: { kind: "llm", model, attempts: attempt, tokens } };
      feedback = `\n\nYour previous draft was rejected by the validator:\n- ${errors.join("\n- ")}\nRewrite it so every number is copied exactly from a cited fact.`;
    } catch (e) {
      return { note: templateNote(facts), author: { kind: "template", reason: e instanceof Error ? e.message : String(e) } };
    }
  }
  return { note: templateNote(facts), author: { kind: "template", reason: `validator rejected 2 drafts: ${feedback.slice(0, 300)}` } };
}
