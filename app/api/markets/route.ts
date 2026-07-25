import product from "../../../config/hoodiepad-v2.json";
import {
  readHoodiePadLaunches,
  summarizeHoodiePadLaunches,
} from "../../lib/launches";

export const revalidate = 0;

export async function GET() {
  try {
    const markets = summarizeHoodiePadLaunches(await readHoodiePadLaunches());
    return Response.json(
      {
        marketVersion: product.marketVersion,
        markets,
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
      { error: "Live Robinhood market discovery is temporarily unavailable" },
      { status: 503 },
    );
  }
}
