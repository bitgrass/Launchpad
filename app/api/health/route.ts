import { checkObjectStorage } from "../../lib/object-storage";

export async function GET() {
  const storage = await checkObjectStorage();
  const status = storage.ready ? 200 : 503;

  return Response.json(
    {
      status: storage.ready ? "ok" : "unavailable",
      service: "hoodiepad",
      storage: storage.backend,
      ...(storage.detail ? { detail: storage.detail } : {}),
    },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}
