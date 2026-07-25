import { readChainStatus } from "../../../lib/protocol";

export async function GET() {
  const status = await readChainStatus();
  return Response.json(status, {
    status: status.available ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
