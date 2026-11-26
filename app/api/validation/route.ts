import { afterFile, datasetFile, fundingFile, fundingTest, premiumBacktest, premiumOutOfSample, trades } from "@/lib/validation";

// Everything behind /validation as JSON: the exit-premium backtest for BTC and ETH ETFs on
// the frozen SoSoValue dataset (raw inputs in the repo at datasetFile), the perp funding
// test on frozen Hyperliquid history (fundingFile) and recorded trades.
export function GET() {
  return Response.json(
    {
      dataset: datasetFile,
      premiumBacktest: [premiumBacktest("BTC"), premiumBacktest("ETH")],
      laterDataset: afterFile,
      premiumOutOfSample: [premiumOutOfSample("BTC"), premiumOutOfSample("ETH")],
      fundingDataset: fundingFile,
      fundingBacktest: [fundingTest("BTC"), fundingTest("ETH")],
      trades,
    },
    { headers: { "content-disposition": 'inline; filename="premium-check-validation.json"' } },
  );
}
