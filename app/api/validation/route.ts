import { datasetFile, premiumBacktest, trades } from "@/lib/validation";

// Everything behind /validation as JSON: the exit-premium backtest for BTC and ETH ETFs on
// the frozen SoSoValue dataset (raw inputs in the repo at datasetFile) and recorded trades.
export function GET() {
  return Response.json(
    { dataset: datasetFile, premiumBacktest: [premiumBacktest("BTC"), premiumBacktest("ETH")], trades },
    { headers: { "content-disposition": 'inline; filename="premium-check-validation.json"' } },
  );
}
