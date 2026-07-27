import { readFuelSnapshot } from "../../lib/fuel";

export const revalidate = 0;

export async function GET() {
  try {
    return Response.json(await readFuelSnapshot(), {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
      },
    });
  } catch {
    return Response.json(
      { error: "Live fee transparency data is temporarily unavailable" },
      { status: 503 },
    );
  }
}
