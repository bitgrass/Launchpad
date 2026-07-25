import {
  getStoredObject,
  ObjectStorageUnavailableError,
  putStoredObject,
} from "../../lib/object-storage";

const MAX_ARTWORK_BYTES = 750 * 1024;
const artworkError = "Artwork must be a JPG, PNG, or WebP file no larger than 750 KB.";
const supportedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

async function sha256(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function originalArtworkName(request: Request) {
  const encodedName = request.headers.get("x-hoodiepad-artwork-name") ?? "artwork";
  try {
    return decodeURIComponent(encodedName).slice(0, 160);
  } catch {
    return "artwork";
  }
}

export async function POST(request: Request) {
  const contentType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const extension = supportedTypes.get(contentType);
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (!extension || (Number.isFinite(declaredSize) && declaredSize > MAX_ARTWORK_BYTES)) {
    return Response.json(
      { error: artworkError },
      { status: 422 },
    );
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARTWORK_BYTES) {
    return Response.json(
      { error: artworkError },
      { status: 422 },
    );
  }

  const digest = await sha256(bytes);
  const key = `token-artwork/${digest}.${extension}`;

  try {
    await putStoredObject(key, bytes, {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
      customMetadata: { originalName: originalArtworkName(request), sha256: digest },
    });
  } catch (error) {
    if (error instanceof ObjectStorageUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  const artworkUrl = new URL("/api/artwork", request.url);
  artworkUrl.searchParams.set("key", key);

  return Response.json({
    key,
    url: artworkUrl.toString(),
    sha256: digest,
    contentType,
    size: bytes.byteLength,
  });
}

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!/^token-artwork\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(key)) {
    return new Response("Invalid artwork key", { status: 400 });
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
  if (!object) return new Response("Artwork not found", { status: 404 });

  const headers = new Headers({
    "content-type": object.contentType,
    "cache-control": object.cacheControl,
    etag: object.etag,
  });
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
