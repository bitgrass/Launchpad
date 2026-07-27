import product from "../../../config/hoodiepad-v2.json";
import { readDisplayPrices } from "../../lib/display-prices";
import { readHoodiePadLaunches } from "../../lib/launches";
import {
  buildCreatorLeaderboard,
  buildTraderLeaderboard,
  TRADER_SCORE_WEIGHTS,
} from "../../lib/leaderboard";

export const revalidate = 0;

export async function GET() {
  try {
    const [launches, prices] = await Promise.all([
      readHoodiePadLaunches(),
      readDisplayPrices().catch(() => ({ ethUsd: null, hoodieUsd: null })),
    ]);
    return Response.json(
      {
        traders: buildTraderLeaderboard(launches).slice(0, 50),
        creators: buildCreatorLeaderboard(launches).slice(0, 50),
        hoodieUsd: prices.hoodieUsd,
        weights: TRADER_SCORE_WEIGHTS,
        refreshedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": `public, max-age=0, s-maxage=${product.discovery.refreshSeconds}, stale-while-revalidate=30`,
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Live leaderboard data is temporarily unavailable" },
      { status: 503 },
    );
  }
}
