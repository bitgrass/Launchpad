import product from "../../../config/hoodiepad-v2.json";
import { readDisplayPrices } from "../../lib/display-prices";
import { readHoodiePadLaunches } from "../../lib/launches";

export const revalidate = 0;

export type ActivityEvent = {
  kind: "launch" | "buy" | "sell";
  token: string;
  symbol: string;
  imageUrl?: string;
  actor: string;
  timestamp: number;
  hoodieAmount: number;
  transactionHash: string;
};

export async function GET() {
  try {
    const [launches, prices] = await Promise.all([
      readHoodiePadLaunches(),
      readDisplayPrices().catch(() => ({ ethUsd: null, hoodieUsd: null })),
    ]);

    const events: ActivityEvent[] = [];
    for (const launch of launches) {
      events.push({
        kind: "launch",
        token: launch.address,
        symbol: launch.symbol,
        imageUrl: launch.imageUrl,
        actor: launch.creator,
        timestamp: launch.launchTimestamp,
        hoodieAmount: 0,
        transactionHash: launch.launchTransactionHash,
      });
      // Analytics keeps the most recent points; the tail is what a ticker
      // needs, so no extra chain reads are required here.
      for (const point of launch.analytics.points.slice(-25)) {
        events.push({
          kind: point.side,
          token: launch.address,
          symbol: launch.symbol,
          imageUrl: launch.imageUrl,
          actor: point.trader,
          timestamp: point.timestamp,
          hoodieAmount: Number(point.hoodieVolumeRaw) / 1e18,
          transactionHash: point.transactionHash,
        });
      }
    }

    events.sort((first, second) => second.timestamp - first.timestamp);

    return Response.json(
      {
        events: events.slice(0, 20),
        hoodieUsd: prices.hoodieUsd,
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
      { error: "Live activity is temporarily unavailable" },
      { status: 503 },
    );
  }
}
