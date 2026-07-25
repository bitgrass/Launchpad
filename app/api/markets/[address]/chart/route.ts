import { getAddress } from "viem";
import product from "../../../../../config/hoodiepad-v2.json";
import { readDisplayPrices } from "../../../../lib/display-prices";
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
    const prices = await readDisplayPrices().catch(
      () => ({ ethUsd: null, hoodieUsd: null }),
    );
    const priceHoodie = market.hoodiePerToken === "Unavailable"
      ? null
      : Number(market.hoodiePerToken.replaceAll(",", ""));
    const supply = Number(market.totalSupplyRaw) / 1e18;
    const priceUsd =
      prices.hoodieUsd !== null && priceHoodie !== null && Number.isFinite(priceHoodie)
        ? priceHoodie * prices.hoodieUsd
        : null;
    const fdvUsd = priceUsd !== null && Number.isFinite(supply)
      ? priceUsd * supply
      : null;
    const volumeUsd = prices.hoodieUsd !== null
      ? Number(analytics.hoodieVolumeRaw) / 1e18 * prices.hoodieUsd
      : null;
    return Response.json(
      {
        token: market.address,
        pool: market.pool,
        currentPrice: market.hoodiePerToken,
        fdvHoodie: market.fdvHoodie,
        hoodieUsd: prices.hoodieUsd,
        priceUsd,
        fdvUsd,
        volumeUsd,
        points: analytics.points,
        swapCount: analytics.swapCount,
        hoodieVolume: analytics.hoodieVolume,
        changePercent: analytics.changePercent,
        changePercent24h: analytics.changePercent24h,
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
