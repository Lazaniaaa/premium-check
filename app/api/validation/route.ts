import { premiumBacktest, type TradeRecord } from "@/lib/validation";
import trades from "@/data/validation/trades.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Everything behind /validation as JSON: the exit-premium backtest for BTC and ETH ETFs
// (from SoSoValue history, same cache as the main page) and recorded prediction-vs-fill trades.
export async function GET() {
  const [btc, eth] = await Promise.all([premiumBacktest("BTC"), premiumBacktest("ETH")]);
  return Response.json(
    { premiumBacktest: [btc, eth], trades: trades as TradeRecord[] },
    { headers: { "content-disposition": 'inline; filename="premium-check-validation.json"' } },
  );
}
