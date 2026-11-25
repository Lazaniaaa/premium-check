import { unstable_cache } from "next/cache";
import { MODELS, structured } from "./llm";

export const ROUTE_GROUPS = ["sodex_spot", "sodex_perp", "etf", "treasury_stock"] as const;
export type RouteGroup = (typeof ROUTE_GROUPS)[number];
export const HORIZONS = [1, 3, 6, 12, 24] as const;

export type QueryParams = { asset: "BTC" | "ETH"; usd: number; months: number; exclude: RouteGroup[] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["asset", "usd", "months", "exclude", "understood"],
  properties: {
    asset: { type: "string", enum: ["BTC", "ETH"] },
    usd: { type: "number", description: "amount in US dollars; 1000 if not stated" },
    months: { type: "integer", description: "holding period in months; 12 if not stated" },
    exclude: { type: "array", items: { type: "string", enum: [...ROUTE_GROUPS] } },
    understood: { type: "boolean", description: "false if the text is not about holding BTC or ETH" },
  },
};

const SYSTEM = `You convert a user's request about holding bitcoin or ether into parameters. Output only the schema.
Rules:
- "bitcoin", "btc", "біткоїн" -> BTC; "ether", "ethereum", "eth", "ефір" -> ETH.
- Amounts like "5k", "5 тисяч", "$800", "2к" are US dollars.
- Periods: "a year" = 12, "half a year"/"пів року" = 6, "a quarter" = 3.
- Exclusions only when the user asks for them: "no broker"/"без брокера" excludes etf and treasury_stock;
  "no perps"/"без ф'ючерсів" excludes sodex_perp; "no stocks" excludes treasury_stock; "only ETFs" excludes the other three.
- Never invent exclusions the user did not ask for.`;

/** Snap free-text output to the values the page supports. */
export function normalize(p: Omit<QueryParams, "exclude"> & { exclude: string[] }): QueryParams {
  const usd = Math.min(Math.max(Math.round(Number(p.usd) || 1000), 10), 1_000_000);
  const months = [...HORIZONS].reduce((best, h) => (Math.abs(h - p.months) < Math.abs(best - p.months) ? h : best), 12);
  const exclude = [...new Set(p.exclude.filter((x): x is RouteGroup => (ROUTE_GROUPS as readonly string[]).includes(x)))];
  return { asset: p.asset === "ETH" ? "ETH" : "BTC", usd, months, exclude };
}

const parseUncached = async (q: string) => {
  const r = await structured<QueryParams & { understood: boolean }>({
    model: MODELS.fast,
    system: SYSTEM,
    user: q,
    schemaName: "holding_query",
    schema: SCHEMA,
    timeoutMs: 20_000,
    maxOutputTokens: 1000,
  });
  return { understood: r.data.understood, params: normalize(r.data), model: r.model };
};

// Spend guard for the public ask box: at most this many uncached OpenAI parses per UTC
// day per server instance; after that the ask box asks people to use the form.
const DAILY_PARSE_BUDGET = 300;
let budget = { day: "", used: 0 };
export class BudgetExceeded extends Error {}

/** Same question -> same answer for a day, and no repeated OpenAI cost. */
export async function parseQuery(q: string) {
  const clean = q.replace(/\s+/g, " ").trim().slice(0, 200);
  return unstable_cache(
    () => {
      const day = new Date().toISOString().slice(0, 10);
      if (budget.day !== day) budget = { day, used: 0 };
      if (budget.used >= DAILY_PARSE_BUDGET) throw new BudgetExceeded("daily AI parse budget reached");
      budget.used++;
      return parseUncached(clean);
    },
    ["parse-v1", clean.toLowerCase()],
    { revalidate: 86400 },
  )();
}

export function toSearch(p: QueryParams, q?: string): string {
  const s = new URLSearchParams({ asset: p.asset, usd: String(p.usd), months: String(p.months) });
  if (p.exclude.length) s.set("exclude", p.exclude.join(","));
  if (q) s.set("q", q);
  return s.toString();
}
