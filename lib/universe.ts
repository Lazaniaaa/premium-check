// Which listed companies we treat as what. mNAV only means something for companies
// whose main asset is the BTC treasury; for operating companies we show the share of
// market cap that their BTC represents instead.
export type CompanyKind = "treasury" | "miner" | "operating";

export const COMPANY_KIND: Record<string, CompanyKind> = {
  MSTR: "treasury",
  ASST: "treasury",
  NAKA: "treasury",
  CEP: "treasury",
  BSTR: "treasury",
  NXTT: "treasury",
  DDC: "treasury",
  EMPD: "treasury",
  ZOOZ: "treasury",
  NA: "treasury",
  MARA: "miner",
  RIOT: "miner",
  CLSK: "miner",
  HUT: "miner",
  ABTC: "miner",
  CIFR: "miner",
  CAN: "miner",
  CANG: "miner",
  FUFU: "miner",
  BITF: "miner",
  BTDR: "miner",
  CORZ: "miner",
  COIN: "operating",
  TSLA: "operating",
  XYZ: "operating",
  GLXY: "operating",
  BLSH: "operating",
  SPCX: "operating",
  GME: "operating",
  BMNR: "operating",
};

/**
 * US-listed tickers that held >= 1,000 BTC in SoSoValue's treasury data (checked 25 Nov 2026).
 * Only these are queried, which keeps a cold-cache render inside the 100 req/min key limit.
 * The page reports how many listed companies were left out and why.
 */
export const CANDIDATES = [
  "MSTR", "CEP", "ASST", "MARA", "BSTR", "BLSH", "SPCX", "GLXY", "COIN", "HUT", "RIOT", "CLSK", "TSLA", "XYZ",
  "ABTC", "NXTT", "NAKA", "DDC", "CAN", "FUFU", "CIFR", "IMG", "EMPD", "ZOOZ", "CANG", "BITF", "NA",
];
/** Tickers SoSoValue has no stock snapshot for (HTTP 404, checked 25 Nov 2026): not queried, listed as uncovered. */
export const NO_STOCK_DATA = new Set(["CEP", "BSTR", "IMG", "ZOOZ", "BITF"]);

/** Ignore tiny holders: below this the ratio is noise, not a BTC exposure. */
export const MIN_BTC_HOLDING = 1000;

/** Holdings reported longer ago than this are flagged as stale in the UI. */
export const STALE_HOLDINGS_DAYS = 120;

/** Only US listings for now: SoSoValue snapshots don't state the quote currency for foreign tickers. */
export const LISTING = "United States";
