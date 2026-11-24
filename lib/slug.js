// Shared by the app (lib/http.ts) and scripts/record-fixtures.mjs so that a
// recorded fixture is found by exactly the same key the live client uses.

/**
 * @param {string} source  e.g. "sosovalue", "sosovalue-v3", "sodex"
 * @param {string} path    e.g. "/etfs/IBIT/history"
 * @param {Record<string, string | number | undefined>} [query]
 * @returns {string} relative fixture path, e.g. "sosovalue/etfs_IBIT_history.json"
 */
export function fixtureKey(source, path, query = {}) {
  const clean = (s) => String(s).replace(/[^A-Za-z0-9.-]+/g, "_").replace(/^_+|_+$/g, "");
  const q = Object.keys(query)
    .filter((k) => query[k] !== undefined && query[k] !== "")
    .sort()
    .map((k) => `__${clean(k)}-${clean(query[k])}`)
    .join("");
  return `${source}/${clean(path)}${q}.json`;
}

/**
 * @param {Record<string, string | number | undefined>} [query]
 */
export function toQueryString(query = {}) {
  const params = new URLSearchParams();
  for (const k of Object.keys(query).sort()) {
    const v = query[k];
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}
