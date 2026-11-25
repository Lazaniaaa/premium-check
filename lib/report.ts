// Daily "Premium Report". Our code computes facts; every number and fund name in a
// fact is a named variable (e.g. {mstr_ratio_debt} = "0.70×"). The LLM writes the
// sentences using those {variables} only — it may not type a single digit — and code
// inserts the values. So the AI cannot invent, round, flip or convert a number.
// What it could still do is put a variable in a misleading sentence; every point
// lists the facts it used so a reader can check.
import { pct, ratio, usd } from "./format";
import { MODELS, structured } from "./llm";
import { methodOf, type Snapshot } from "./snapshot";

export type Var = { value: string; label: string };
export type Fact = { id: string; template: string; text: string; vars: Record<string, Var> };
export type NotePoint = { text: string; template?: string; facts: string[] };
export type Note = { headline: string; headlineTemplate?: string; headlineFacts: string[]; points: NotePoint[] };
export type Report = {
  schema: 1 | 2;
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

const VAR = /\{([a-z][a-z0-9_]*)\}/g;
export const render = (template: string, vars: Record<string, Var>) =>
  template.replace(VAR, (m, k: string) => (k in vars ? vars[k].value : m));

/** Deterministic facts from today's snapshot (and yesterday's, if available). */
export function buildFacts(today: Snapshot, prev: Snapshot | null): Fact[] {
  const f: Fact[] = [];
  const add = (template: string, vars: Record<string, [value: string, label: string]>) => {
    const v: Record<string, Var> = Object.fromEntries(Object.entries(vars).map(([k, [value, label]]) => [k, { value, label }]));
    f.push({ id: `F${f.length + 1}`, template, text: render(template, v), vars: v });
  };
  const { btc, eth, params } = today;
  if (!btc) throw new Error("no BTC data in this snapshot");

  add("Comparison basis: {basis_usd} held for {basis_months} months; costs include trading and recurring costs.", {
    basis_usd: [usd(params.usd), "amount compared"],
    basis_months: [String(params.months), "holding period in months"],
  });
  add(
    btc.reference.deviationBps != null
      ? "BTC reference price {btc_price} (SoDEX BTC-USD index); the SoSoValue price differs by {btc_soso_diff}."
      : "BTC reference price {btc_price} (SoDEX BTC-USD index); the SoSoValue cross-check was unavailable.",
    {
      btc_price: [usd(btc.reference.price), "BTC reference price"],
      ...(btc.reference.deviationBps != null
        ? { btc_soso_diff: [`${Math.abs(btc.reference.deviationBps).toFixed(1)} bps`, "gap between SoSoValue and SoDEX prices"] as [string, string] }
        : {}),
    },
  );
  const btcRanked = btc.routes.filter((r) => r.ranked);
  if (btcRanked[0])
    add("Cheapest way to hold BTC: {btc_best_name} at {btc_best_cost} total cost.", {
      btc_best_name: [name(btcRanked[0].name), "cheapest BTC route"],
      btc_best_cost: [pct(btcRanked[0].cost), "its total cost over the period"],
    });
  if (btcRanked[1])
    add("Second cheapest BTC route: {btc_second_name} at {btc_second_cost}.", {
      btc_second_name: [name(btcRanked[1].name), "second cheapest BTC route"],
      btc_second_cost: [pct(btcRanked[1].cost), "its total cost over the period"],
    });
  const ibit = btc.routes.find((r) => r.id === "etf-IBIT");
  if (ibit?.cost != null)
    add("BlackRock IBIT total cost {ibit_cost} (sponsor fee {ibit_fee} a year).", {
      ibit_cost: [pct(ibit.cost), "IBIT total cost over the period"],
      ibit_fee: [pct(ibit.annualCarry), "IBIT yearly sponsor fee"],
    });
  if (btc.perpAnnualFunding != null)
    add("SoDEX BTC-USD perp funding is {btc_funding_year} a year at the current hourly rate.", {
      btc_funding_year: [pct(btc.perpAnnualFunding), "BTC perp funding per year if today's rate stayed"],
    });
  const btcPerp = btc.routes.find((r) => r.id === "sodex-perp");
  if (btcPerp?.cost != null)
    add("Holding BTC through the SoDEX perp costs {btc_perp_cost} in total.", {
      btc_perp_cost: [pct(btcPerp.cost), "BTC perp total cost over the period"],
    });
  const mstr = btc.companies.find((c) => c.ticker === "MSTR");
  if (mstr?.mnavEquity != null)
    add(
      "Strategy (MSTR): market cap is {mstr_ratio_equity} its BTC value; adding debt and subtracting cash it is {mstr_ratio_debt}. Price {mstr_price} from {mstr_price_source}.",
      {
        mstr_ratio_equity: [ratio(mstr.mnavEquity), "Strategy market cap ÷ BTC value"],
        mstr_ratio_debt: [ratio(mstr.mnavWithDebt), "Strategy (market cap + debt − cash) ÷ BTC value"],
        mstr_price: [usd(mstr.price, 2), "Strategy share price used"],
        mstr_price_source: [mstr.priceSource === "sodex_24_7" ? "the SoDEX MSTR-USD perp (24/7 proxy)" : "the exchange", "where that price came from"],
      },
    );
  const pure = btc.companies.filter((c) => c.kind === "treasury" && c.mnavEquity != null);
  if (pure.length)
    add("{treasuries_below} of {treasuries_total} treasury companies have a market cap below the value of their BTC (before debt).", {
      treasuries_below: [String(pure.filter((c) => c.mnavEquity! < 1).length), "treasury companies with market cap below their BTC value"],
      treasuries_total: [String(pure.length), "treasury companies compared"],
    });
  if (eth) {
    const ethRanked = eth.routes.filter((r) => r.ranked);
    if (ethRanked[0])
      add("Cheapest way to hold ETH: {eth_best_name} at {eth_best_cost} total cost.", {
        eth_best_name: [name(ethRanked[0].name), "cheapest ETH route"],
        eth_best_cost: [pct(ethRanked[0].cost), "its total cost over the period"],
      });
    if (eth.perpAnnualFunding != null)
      add("SoDEX ETH-USD perp funding is {eth_funding_year} a year at the current hourly rate.", {
        eth_funding_year: [pct(eth.perpAnnualFunding), "ETH perp funding per year if today's rate stayed"],
      });
    const staking = eth.routes.filter((r) => r.flags.includes("staking_unmodeled")).length;
    if (staking)
      add("{eth_staking_count} ETH ETFs stake and pay distributions, which this comparison does not model, so they are not ranked.", {
        eth_staking_count: [String(staking), "staking ETH ETFs left out of the ranking"],
      });
  }
  if (prev?.btc && methodOf(prev) === methodOf(today)) {
    const pm = prev.btc.companies.find((c) => c.ticker === "MSTR");
    const day = prev.takenAt.slice(0, 10);
    if (pm?.mnavEquity != null && mstr?.mnavEquity != null)
      add("Previous snapshot ({prev_day}): Strategy's market cap was {prev_mstr_ratio_equity} its BTC value.", {
        prev_day: [day, "date of the previous snapshot"],
        prev_mstr_ratio_equity: [ratio(pm.mnavEquity), "Strategy market cap ÷ BTC value on that day"],
      });
    if (prev.btc.perpAnnualFunding != null)
      add("Previous snapshot ({prev_day}): SoDEX BTC perp funding was {prev_btc_funding_year} a year.", {
        prev_day: [day, "date of the previous snapshot"],
        prev_btc_funding_year: [pct(prev.btc.perpAnnualFunding), "BTC perp funding per year on that day"],
      });
  }
  return f;
}

// ---------- validator ----------
/**
 * The model's text may contain no digits at all. Numbers and names appear only as
 * {variables}, and each variable must belong to a fact that sentence cites.
 */
export function validate(note: Note, facts: Fact[], protectedTerms: string[] = []): string[] {
  const byId = new Map(facts.map((x) => [x.id, x]));
  const errors: string[] = [];
  const check = (template: string, cites: string[], where: string) => {
    const unknown = cites.filter((c) => !byId.has(c));
    if (unknown.length) errors.push(`${where}: cites unknown facts ${unknown.join(", ")}`);
    const allowed = new Set(cites.flatMap((c) => Object.keys(byId.get(c)?.vars ?? {})));
    for (const m of template.matchAll(VAR))
      if (!allowed.has(m[1])) errors.push(`${where}: {${m[1]}} is not a variable of the facts it cites`);
    const rest = template.replace(VAR, "");
    if (/\d/.test(rest)) errors.push(`${where}: contains a digit outside a {variable}: "${rest.match(/[^\s]*\d[^\s]*/)?.[0]}"`);
    if (/[{}]/.test(rest)) errors.push(`${where}: malformed {variable}`);
    // Fund and company tickers may appear only through variables, so a sentence can't name the wrong fund.
    for (const t of protectedTerms) if (new RegExp(`\\b${t}\\b`).test(rest)) errors.push(`${where}: names ${t} outside a {variable}`);
  };
  check(note.headlineTemplate ?? note.headline, note.headlineFacts, "headline");
  if (note.points.length < 2 || note.points.length > 5) errors.push(`expected 2-5 points, got ${note.points.length}`);
  note.points.forEach((p, i) => {
    if (!p.facts.length) errors.push(`point ${i + 1}: no facts cited`);
    check(p.template ?? p.text, p.facts, `point ${i + 1}`);
  });
  return errors;
}

/** Fill in the values: what readers see. */
export function renderNote(note: Note, facts: Fact[]): Note {
  const vars = Object.assign({}, ...facts.map((f) => f.vars)) as Record<string, Var>;
  return {
    headline: render(note.headlineTemplate ?? note.headline, vars),
    headlineTemplate: note.headlineTemplate ?? note.headline,
    headlineFacts: note.headlineFacts,
    points: note.points.map((p) => ({ text: render(p.template ?? p.text, vars), template: p.template ?? p.text, facts: p.facts })),
  };
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
- Use ONLY the numbered facts given. Each fact lists its variables with their current values so you understand them.
- NEVER type a digit or a fund ticker. Every number, date and fund or route name must be written as its {variable} from a fact you cite in that sentence's "facts" list, e.g. "Strategy trades at {mstr_ratio_equity} its BTC value". Code fills in the values.
- Do not describe differences as numbers; compare with words ("lower than", "about the same").
- Headline: one sentence, max 14 words, stating the single most useful finding of the day. Then 3 or 4 points, each one or two sentences.
- Cite fact ids like "F3" in the facts arrays, never in the text itself.`;

export function templateNote(facts: Fact[]): Note {
  const pick = (re: RegExp) => facts.find((x) => re.test(x.template));
  const pts = [pick(/^Cheapest way to hold BTC/), pick(/BTC-USD perp funding/), pick(/^Strategy \(MSTR\)/), pick(/^Cheapest way to hold ETH/)].filter(
    (x): x is Fact => !!x,
  );
  return renderNote(
    {
      headline: "Today's cost of holding BTC and ETH, route by route",
      headlineFacts: [],
      points: pts.map((x) => ({ text: x.template, template: x.template, facts: [x.id] })),
    },
    facts,
  );
}

export async function writeNote(facts: Fact[], protectedTerms: string[] = []): Promise<{ note: Note; author: Report["author"] }> {
  const factList = facts
    .map((x) => `${x.id}: ${x.template}\n    ${Object.entries(x.vars).map(([k, v]) => `{${k}} = "${v.value}" (${v.label})`).join("; ")}`)
    .join("\n");
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
      const draft: Note = {
        headline: r.data.headline,
        headlineTemplate: r.data.headline,
        headlineFacts: r.data.headlineFacts,
        points: r.data.points.map((p) => ({ text: p.text, template: p.text, facts: p.facts })),
      };
      const errors = validate(draft, facts, protectedTerms);
      if (!errors.length) return { note: renderNote(draft, facts), author: { kind: "llm", model, attempts: attempt, tokens } };
      feedback = `\n\nYour previous draft was rejected by the validator:\n- ${errors.join("\n- ")}\nRewrite it using only {variables} for every number and name.`;
    } catch (e) {
      // Provider error text stays in server logs; the public report gets a generic reason.
      console.error("[report] writer failed:", e instanceof Error ? e.message : e);
      return { note: templateNote(facts), author: { kind: "template", reason: "AI writer unavailable" } };
    }
  }
  return { note: templateNote(facts), author: { kind: "template", reason: "validator rejected 2 drafts" } };
}
