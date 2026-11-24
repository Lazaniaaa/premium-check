export const pct = (x: number | null | undefined, digits = 2) =>
  x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`;

export const signedPct = (x: number | null | undefined, digits = 2) =>
  x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

export const usd = (x: number | null | undefined, digits = 0) =>
  x == null || !Number.isFinite(x)
    ? "—"
    : x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });

export const compactUsd = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x)
    ? "—"
    : x.toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

export const units = (x: number | null | undefined, asset: string, digits = 6) =>
  x == null || !Number.isFinite(x) ? "—" : `${x.toFixed(digits)} ${asset}`;

export const ratio = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : `${x.toFixed(2)}×`);

export const int = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : Math.round(x).toLocaleString("en-US"));

export const bps = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : `${(Math.abs(x) < 0.05 ? 0 : x).toFixed(1)} bps`;

export const timeUtc = (iso: string | null | undefined) =>
  iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
