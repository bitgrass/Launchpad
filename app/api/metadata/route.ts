import {
  getStoredObject,
  ObjectStorageUnavailableError,
} from "../../lib/object-storage";

const metadataKeyPattern = /^token-metadata\/[a-f0-9]{64}\.json$/;

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!metadataKeyPattern.test(key)) {
    return new Response("Invalid metadata key", { status: 400 });
  }

  let object;
  try {
    object = await getStoredObject(key);
  } catch (error) {
    if (error instanceof ObjectStorageUnavailableError) {
      return new Response(error.message, { status: 503 });
    }
    throw error;
  }
  if (!object) return new Response("Metadata not found", { status: 404 });

  const headers = new Headers({
    "content-type": object.contentType,
    "cache-control": object.cacheControl,
    etag: object.etag,
  });
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
