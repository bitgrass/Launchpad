import type { Address, Hex } from "viem";
import type { DecodedChainEvent, V4RegistryCaches } from "./launches-v4";

// Best-effort persistence for the incremental registry caches. Without it,
// every deployment restart rescans the full Create/Swap/Transfer history
// (hundreds of eth_getLogs chunks); with it, a restart only scans the delta
// since the last snapshot. Market statics are deliberately not persisted —
// they rebuild with one batched multicall per market.

const STORE_VERSION = 1;
const PERSIST_THROTTLE_MS = 120_000;

let lastPersistAt = 0;
let persistInFlight = false;

type PersistedEvent = {
  args: Record<string, unknown>;
  blockNumber: string | null;
  transactionHash: string | null;
  logIndex: number | null;
};

type PersistedStore = {
  version: number;
  discovery: { lastScannedBlock: string; creates: PersistedEvent[] } | null;
  swapLogs: Array<[string, { lastScannedBlock: string; logs: PersistedEvent[] }]>;
  transfers: Array<[string, {
    lastScannedBlock: string;
    balances: Array<[string, string]>;
    checksums: Array<[string, string]>;
    seen: string[];
  }]>;
  transactionSenders: Array<[string, string]>;
  blockTimestamps: Array<[string, number]>;
};

function storePath() {
  const configured = process.env.HOODIEPAD_STORAGE_DIR?.trim();
  const railwayVolume = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const root = configured ||
    (railwayVolume ? `${railwayVolume.replace(/[\\/]+$/, "")}/hoodiepad` : "");
  if (!root) return null;
  return `${root}/state/registry-cache.json`;
}

function encodeValue(value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  return value;
}

function decodeValue(value: unknown): unknown {
  if (
    typeof value === "object" && value !== null && "$bigint" in value &&
    typeof (value as { $bigint: unknown }).$bigint === "string"
  ) {
    return BigInt((value as { $bigint: string }).$bigint);
  }
  return value;
}

function encodeEvent(event: DecodedChainEvent): PersistedEvent {
  const args: Record<string, unknown> = {};
  if (typeof event.args === "object" && event.args !== null) {
    for (const [key, value] of Object.entries(event.args)) {
      args[key] = encodeValue(value);
    }
  }
  return {
    args,
    blockNumber: event.blockNumber?.toString() ?? null,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
  };
}

function decodeEvent(event: PersistedEvent): DecodedChainEvent {
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.args ?? {})) {
    args[key] = decodeValue(value);
  }
  return {
    args,
    blockNumber: event.blockNumber === null ? null : BigInt(event.blockNumber),
    transactionHash: event.transactionHash as Hex | null,
    logIndex: event.logIndex,
  };
}

function eventId(event: DecodedChainEvent) {
  return `${event.transactionHash ?? "0x"}:${event.logIndex ?? -1}`;
}

export async function persistRegistryCaches(caches: V4RegistryCaches) {
  const path = storePath();
  if (!path || persistInFlight) return;
  const now = Date.now();
  if (now - lastPersistAt < PERSIST_THROTTLE_MS) return;
  persistInFlight = true;
  try {
    const snapshot: PersistedStore = {
      version: STORE_VERSION,
      discovery: caches.discovery
        ? {
            lastScannedBlock: caches.discovery.lastScannedBlock.toString(),
            creates: caches.discovery.creates.map(encodeEvent),
          }
        : null,
      swapLogs: [...caches.swapLogs.entries()].map(([key, cache]) => [key, {
        lastScannedBlock: cache.lastScannedBlock.toString(),
        logs: cache.logs.map(encodeEvent),
      }]),
      transfers: [...caches.transfers.entries()].map(([key, cache]) => [key, {
        lastScannedBlock: cache.lastScannedBlock.toString(),
        balances: [...cache.balances.entries()].map(
          ([address, balance]) => [address, balance.toString()] as [string, string],
        ),
        checksums: [...cache.checksumAddresses.entries()],
        seen: [...cache.seen],
      }]),
      transactionSenders: [...caches.transactionSenders.entries()],
      blockTimestamps: [...caches.blockTimestamps.entries()],
    };
    const { mkdir, rename, writeFile } = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const resolved = nodePath.resolve(path);
    await mkdir(nodePath.dirname(resolved), { recursive: true });
    const temporary = `${resolved}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot), "utf8");
    await rename(temporary, resolved);
    lastPersistAt = now;
  } catch {
    // Persistence is an optimization; never let it break the registry.
  } finally {
    persistInFlight = false;
  }
}

export async function loadPersistedRegistryCaches(caches: V4RegistryCaches) {
  const path = storePath();
  if (!path) return;
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(path, "utf8");
    const snapshot = JSON.parse(raw) as PersistedStore;
    if (snapshot.version !== STORE_VERSION) return;
    if (snapshot.discovery) {
      caches.discovery = {
        lastScannedBlock: BigInt(snapshot.discovery.lastScannedBlock),
        creates: snapshot.discovery.creates.map(decodeEvent),
      };
    }
    for (const [key, cache] of snapshot.swapLogs ?? []) {
      const logs = cache.logs.map(decodeEvent);
      caches.swapLogs.set(key, {
        lastScannedBlock: BigInt(cache.lastScannedBlock),
        seen: new Set(logs.map(eventId)),
        logs,
      });
    }
    for (const [key, cache] of snapshot.transfers ?? []) {
      caches.transfers.set(key, {
        lastScannedBlock: BigInt(cache.lastScannedBlock),
        seen: new Set(cache.seen ?? []),
        balances: new Map(cache.balances.map(
          ([address, balance]) => [address, BigInt(balance)] as [string, bigint],
        )),
        checksumAddresses: new Map(cache.checksums as Array<[string, Address]>),
      });
    }
    for (const [hash, sender] of snapshot.transactionSenders ?? []) {
      caches.transactionSenders.set(hash as Hex, sender as Address);
    }
    for (const [block, timestamp] of snapshot.blockTimestamps ?? []) {
      caches.blockTimestamps.set(block, timestamp);
    }
  } catch {
    // Missing or unreadable snapshot: fall back to a full scan.
  }
}
