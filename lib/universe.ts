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

/** Ignore tiny holders: below this the ratio is noise, not a BTC exposure. */
export const MIN_BTC_HOLDING = 1000;

/** Holdings reported longer ago than this are flagged as stale in the UI. */
export const STALE_HOLDINGS_DAYS = 120;

/** Only US listings for now: SoSoValue snapshots don't state the quote currency for foreign tickers. */
export const LISTING = "United States";
