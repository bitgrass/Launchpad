import { getR2Bucket } from "../runtime-env";

const immutableCacheControl = "public, max-age=31536000, immutable";
const storedKeyPattern =
  /^(token-artwork\/[a-f0-9]{64}\.(jpg|png|webp)|token-metadata\/[a-f0-9]{64}\.json)$/;

type StoredObjectOptions = {
  contentType: string;
  cacheControl?: string;
  customMetadata?: Record<string, string>;
};

export type StoredObject = {
  body: BodyInit;
  contentType: string;
  cacheControl: string;
  etag: string;
};

export type StoredObjectHead = {
  customMetadata: Record<string, string>;
};

export type StorageStatus = {
  ready: boolean;
  backend: "r2" | "filesystem" | "unavailable";
  detail?: string;
};

export class ObjectStorageUnavailableError extends Error {
  constructor(message = "HoodiePad persistent object storage is unavailable") {
    super(message);
    this.name = "ObjectStorageUnavailableError";
  }
}

function validateKey(key: string) {
  if (!storedKeyPattern.test(key)) {
    throw new Error("Invalid object storage key");
  }
}

function digestFromKey(key: string) {
  const digest = key.match(/[a-f0-9]{64}/)?.[0];
  if (!digest) throw new Error("Object storage key has no content digest");
  return digest;
}

function contentTypeForKey(key: string) {
  if (key.endsWith(".jpg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function filesystemRoot() {
  const configuredRoot = process.env.HOODIEPAD_STORAGE_DIR?.trim();
  if (configuredRoot) return configuredRoot;

  const railwayVolume = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (railwayVolume) return `${railwayVolume.replace(/[\\/]+$/, "")}/hoodiepad`;

  return undefined;
}

async function resolveFilesystemObject(key: string) {
  validateKey(key);
  const root = filesystemRoot();
  if (!root) throw new ObjectStorageUnavailableError();

  const path = await import("node:path");
  const resolvedRoot = path.resolve(root);
  const resolvedObject = path.resolve(resolvedRoot, ...key.split("/"));
  if (!resolvedObject.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Object storage path escaped its configured root");
  }

  return { resolvedRoot, resolvedObject };
}

function isMissingFile(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isExistingFile(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

export async function putStoredObject(
  key: string,
  value: ArrayBuffer | Uint8Array,
  options: StoredObjectOptions,
) {
  validateKey(key);
  const bucket = getR2Bucket();
  if (bucket) {
    await bucket.put(key, value, {
      httpMetadata: {
        contentType: options.contentType,
        cacheControl: options.cacheControl ?? immutableCacheControl,
      },
      customMetadata: options.customMetadata,
    });
    return;
  }

  const { resolvedObject } = await resolveFilesystemObject(key);
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  await mkdir(path.dirname(resolvedObject), { recursive: true });
  try {
    await writeFile(
      resolvedObject,
      value instanceof ArrayBuffer ? new Uint8Array(value) : value,
      { flag: "wx" },
    );
  } catch (error) {
    // Keys are content-addressed. An existing object with the same key is the
    // same immutable payload and does not need to be overwritten.
    if (!isExistingFile(error)) throw error;
  }
}

export async function getStoredObject(key: string): Promise<StoredObject | null> {
  validateKey(key);
  const bucket = getR2Bucket();
  if (bucket) {
    const object = await bucket.get(key);
    if (!object) return null;

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    return {
      body: object.body,
      contentType: headers.get("content-type") ?? contentTypeForKey(key),
      cacheControl: headers.get("cache-control") ?? immutableCacheControl,
      etag: object.httpEtag,
    };
  }

  const { resolvedObject } = await resolveFilesystemObject(key);
  const { readFile } = await import("node:fs/promises");
  try {
    const body = await readFile(resolvedObject);
    return {
      body,
      contentType: contentTypeForKey(key),
      cacheControl: immutableCacheControl,
      etag: `"${digestFromKey(key)}"`,
    };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function headStoredObject(key: string): Promise<StoredObjectHead | null> {
  validateKey(key);
  const bucket = getR2Bucket();
  if (bucket) {
    const object = await bucket.head(key);
    if (!object) return null;
    return { customMetadata: object.customMetadata ?? {} };
  }

  const { resolvedObject } = await resolveFilesystemObject(key);
  const { stat } = await import("node:fs/promises");
  try {
    const object = await stat(resolvedObject);
    if (!object.isFile()) return null;
    return { customMetadata: { sha256: digestFromKey(key) } };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function checkObjectStorage(): Promise<StorageStatus> {
  if (getR2Bucket()) return { ready: true, backend: "r2" };

  const root = filesystemRoot();
  if (!root) {
    return {
      ready: false,
      backend: "unavailable",
      detail: "Attach a Railway Volume or configure HOODIEPAD_STORAGE_DIR.",
    };
  }

  try {
    const [{ access, mkdir }, { constants }, path] = await Promise.all([
      import("node:fs/promises"),
      import("node:fs"),
      import("node:path"),
    ]);
    const resolvedRoot = path.resolve(root);
    await mkdir(resolvedRoot, { recursive: true });
    await access(resolvedRoot, constants.R_OK | constants.W_OK);
    return { ready: true, backend: "filesystem" };
  } catch {
    return {
      ready: false,
      backend: "unavailable",
      detail: "The configured persistent storage directory is not readable and writable.",
    };
  }
}
