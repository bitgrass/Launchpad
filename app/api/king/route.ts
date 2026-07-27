import product from "../../../config/hoodiepad-v2.json";
import { readDisplayPrices } from "../../lib/display-prices";
import { readCrownState } from "../../lib/king";
import { readHoodiePadLaunches } from "../../lib/launches";

export const revalidate = 0;

export async function GET() {
  try {
    const [launches, prices] = await Promise.all([
      readHoodiePadLaunches(),
      readDisplayPrices().catch(() => ({ ethUsd: null, hoodieUsd: null })),
    ]);
    const state = await readCrownState(launches, prices.hoodieUsd);
    return Response.json(
      { ...state, hoodieUsd: prices.hoodieUsd, refreshedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": `public, max-age=0, s-maxage=${product.discovery.refreshSeconds}, stale-while-revalidate=30`,
        },
      },
    );
  } catch {
    return Response.json(
      { error: "The crown is temporarily unavailable" },
      { status: 503 },
    );
  }
}
