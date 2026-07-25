import product from "../../../config/hoodiepad-v2.json";
import { readProtocolAnalytics } from "../../lib/analytics";

export const revalidate = 0;

export async function GET() {
  try {
    const analytics = await readProtocolAnalytics();
    return Response.json(analytics, {
      headers: {
        "Cache-Control": `public, max-age=0, s-maxage=${product.discovery.refreshSeconds}, stale-while-revalidate=30`,
      },
    });
  } catch {
    return Response.json(
      { error: "Live protocol analytics are temporarily unavailable" },
      { status: 503 },
    );
  }
}
