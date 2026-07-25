import { getAddress } from "viem";
import product from "../../../../../config/hoodiepad-v2.json";
import {
  readHoodiePadLaunches,
  readLegacyHoodiePadLaunches,
} from "../../../../lib/launches";

export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ address: string }> },
) {
  try {
    const { address: rawAddress } = await context.params;
    const address = getAddress(rawAddress);
    const publicLaunches = await readHoodiePadLaunches();
    let market = publicLaunches.find(
      (launch) => launch.address.toLowerCase() === address.toLowerCase(),
    );
    if (!market) {
      const legacyLaunches = await readLegacyHoodiePadLaunches();
      market = legacyLaunches.find(
        (launch) => launch.address.toLowerCase() === address.toLowerCase(),
      );
    }
    if (!market) {
      return Response.json({ error: "This is not an official HoodiePad market" }, { status: 404 });
    }
    const analytics = market.analytics;
    return Response.json(
      {
        token: market.address,
        pool: market.pool,
        currentPrice: market.hoodiePerToken,
        fdvHoodie: market.fdvHoodie,
        points: analytics.points,
        swapCount: analytics.swapCount,
        hoodieVolume: analytics.hoodieVolume,
        changePercent: analytics.changePercent,
        latestBlock: analytics.points.at(-1)?.blockNumber ?? null,
        holderCount: analytics.holderCount,
        holders: analytics.holders,
      },
      {
        headers: {
          "Cache-Control": `public, max-age=0, s-maxage=${product.discovery.refreshSeconds}, stale-while-revalidate=30`,
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Live market chart data is temporarily unavailable" },
      { status: 503 },
    );
  }
}
