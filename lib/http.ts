import fs from "node:fs/promises";
import path from "node:path";
import { unstable_cache } from "next/cache";
import { fixtureKey, toQueryString } from "./slug.js";

export type Source = "sosovalue" | "sosovalue-v3" | "sodex";
type Query = Record<string, string | number | undefined>;

const BASES: Record<Source, string> = {
  sosovalue: "https://openapi.sosovalue.com/openapi/v1",
  "sosovalue-v3": "https://openapi.sosovalue.com/openapi/v3",
  sodex: "https://mainnet-gw.sodex.dev/api/v1",
};

export const dataMode = (): "live" | "fixture" =>
  process.env.DATA_SOURCE === "fixture" ? "fixture" : "live";

/** One record per real upstream request (cache hits are not recorded), kept in memory for /diag. */
export type CallRecord = { source: Source; path: string; status: number; ms: number; at: string; error?: string };
const calls: CallRecord[] = [];
let quota: { minuteRemaining?: number; monthRemaining?: number; at?: string } = {};
const noteQuota = (q?: Quota) => {
  if (q?.at && (!quota.at || q.at > quota.at)) quota = q;
};
export const recentCalls = () => calls.slice(-200);
export const sosoQuota = () => quota;

export class UpstreamError extends Error {
  constructor(
    public source: Source,
    public path: string,
    public status: number,
    message: string,
  ) {
    super(`${source} ${path}: ${status} ${message}`);
  }
}

// ---- SoSoValue pacing: the key allows 100 requests per minute. A cold cache needs
// ~80 requests, so instead of spacing every call (which took > 60 s and timed the
// page out) we allow a burst of up to WINDOW_MAX starts in any rolling 60 s window,
// at most MAX_ACTIVE in flight, and only wait once the window is full.
const WINDOW_MS = 60_000;
const WINDOW_MAX = 85;
const MAX_ACTIVE = 6;
const starts: number[] = [];
let active = 0;
const waiters: (() => void)[] = [];
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_ACTIVE) await new Promise<void>((r) => waiters.push(r));
  active++;
  for (;;) {
    const now = Date.now();
    while (starts.length && starts[0] <= now - WINDOW_MS) starts.shift();
    if (starts.length < WINDOW_MAX) break;
    await new Promise((r) => setTimeout(r, starts[0] + WINDOW_MS - now + 5));
  }
  starts.push(Date.now());
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

// What we store in the cache: either data, or a remembered "not found" (so a ticker
// SoSoValue doesn't cover is not re-requested on every render). Rate limits and
// server errors are thrown instead, and unstable_cache never stores a throw.
type Quota = { minuteRemaining?: number; monthRemaining?: number; at?: string };
type Cached = ({ ok: true; data: unknown } | { ok: false; status: number; message: string }) & { quota?: Quota };

async function fetchUpstream(source: Source, p: string, query: Query): Promise<Cached> {
  const url = BASES[source] + p + toQueryString(query);
  const headers: Record<string, string> = { "User-Agent": "premium-check/0.1" };
  if (source !== "sodex") {
    const key = process.env.SOSO_API_KEY;
    if (!key) throw new UpstreamError(source, p, 0, "SOSO_API_KEY is not set");
    headers["x-soso-api-key"] = key;
  }
  const run = async (): Promise<Cached> => {
    const t0 = Date.now();
    let status = 0;
    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      status = res.status;
      if (source !== "sodex") {
        const m = res.headers.get("x-ratelimit-remaining-month");
        const n = res.headers.get("x-ratelimit-remaining-minute");
        if (m) noteQuota({ monthRemaining: Number(m), minuteRemaining: Number(n), at: new Date().toISOString() });
      }
      const q = source !== "sodex" ? { ...quota } : undefined;
      const body = await res.json().catch(() => null);
      const record = (error?: string) =>
        calls.push({ source, path: p, status, ms: Date.now() - t0, at: new Date().toISOString(), error });
      if (res.ok && body && body.code === 0) {
        record();
        return { ok: true, data: body.data, quota: q };
      }
      const message = String(body?.message ?? body?.error ?? res.statusText);
      record(message);
      if (status === 404) return { ok: false, status, message, quota: q }; // cacheable "not covered"
      throw new UpstreamError(source, p, status, message); // 429 / 5xx / bad envelope: not cached
    } catch (e) {
      if (e instanceof UpstreamError) throw e;
      const error = e instanceof Error ? e.message : String(e);
      calls.push({ source, path: p, status, ms: Date.now() - t0, at: new Date().toISOString(), error });
      throw new UpstreamError(source, p, status, error);
    }
  };
  return source === "sodex" ? run() : paced(run);
}

// Identical requests that are in flight at the same time share one upstream call.
const inflight = new Map<string, Promise<Cached>>();

/**
 * GET JSON from SoSoValue or SoDEX, unwrap the `{ code: 0, data }` envelope, and
 * cache it for `revalidate` seconds (stale-while-revalidate via Next's data cache).
 * Caching is what keeps us inside the 10,000 requests/month SoSoValue quota.
 */
export async function getJson<T>(source: Source, p: string, query: Query = {}, revalidate = 1800): Promise<T> {
  if (dataMode() === "fixture") return readFixture<T>(source, p, query);

  const key = fixtureKey(source, p, query);
  let pending = inflight.get(key);
  if (!pending) {
    const cached = unstable_cache(() => fetchUpstream(source, p, query), ["upstream-v1", key], {
      revalidate,
      tags: [source],
    });
    pending = cached().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const r = await pending;
  noteQuota(r.quota); // last known quota, even when served from cache
  if (!r.ok) throw new UpstreamError(source, p, r.status, r.message);
  return r.data as T;
}

async function readFixture<T>(source: Source, p: string, query: Query): Promise<T> {
  const file = path.join(process.cwd(), "fixtures", fixtureKey(source, p, query));
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    throw new UpstreamError(source, p, 404, `no fixture ${fixtureKey(source, p, query)}`);
  }
  const { status, body } = JSON.parse(raw);
  if (status !== 200 || body?.code !== 0) throw new UpstreamError(source, p, status, body?.message ?? "fixture error");
  calls.push({ source, path: p, status, ms: 0, at: new Date().toISOString() });
  return body.data as T;
}

/** Resolve to null instead of throwing — for optional data (404 tickers etc.). */
export async function maybe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}
