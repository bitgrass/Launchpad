import {
  airlockAbi,
  dopplerERC20V1Abi,
} from "@whetstone-research/doppler-sdk/evm";
import {
  formatUnits,
  getAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import product from "../../config/hoodiepad-v2.json";
import {
  change24hFromPoints,
  type HoodiePadLaunch,
  type MarketAnalytics,
  type MarketHolder,
  type MarketSwapPoint,
} from "./launches";
import {
  readHoodiePadV4Market,
  v4PriceForMarket,
  type HoodiePadV4Market,
  type V4MarketStatics,
} from "./market-v4";
import { createRobinhoodPublicClient } from "./protocol";
import {
  loadPersistedRegistryCaches,
  persistRegistryCaches,
} from "./registry-cache-store";
import { formatRational } from "./v4-price";

type RobinhoodClient = ReturnType<typeof createRobinhoodPublicClient>;
type HoodiePadV4Launch = HoodiePadV4Market & {
  creator: Address;
  launchBlock: string;
  launchTimestamp: number;
  launchTransactionHash: Hex;
  analytics: MarketAnalytics;
};

type DecodedChainEvent = {
  args: unknown;
  blockNumber: bigint | null;
  transactionHash: Hex | null;
  logIndex: number | null;
};

const v4SwapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
);
const erc20TransferEvent = parseAbiItem(
  "event Transfer(address indexed from,address indexed to,uint256 value)",
);
const zeroAddress = "0x0000000000000000000000000000000000000000";
const launchStartBlock = BigInt(product.discovery.launchStartBlock);
const logChunkSize = BigInt(product.discovery.logChunkSize);
// Rescan this many trailing blocks on every refresh so shallow reorgs cannot
// leave stale events in the incremental caches; duplicates are dropped by id.
const reorgSafetyBlocks = 5n;

type SwapLogCache = {
  lastScannedBlock: bigint;
  seen: Set<string>;
  logs: DecodedChainEvent[];
};

type TransferCache = {
  lastScannedBlock: bigint;
  seen: Set<string>;
  balances: Map<string, bigint>;
  checksumAddresses: Map<string, Address>;
};

export type V4RegistryCaches = {
  discovery?: {
    lastScannedBlock: bigint;
    creates: DecodedChainEvent[];
  };
  swapLogs: Map<string, SwapLogCache>;
  transfers: Map<string, TransferCache>;
  transactionSenders: Map<Hex, Address>;
  blockTimestamps: Map<string, number>;
  marketStatics: Map<string, V4MarketStatics>;
};

export type { SwapLogCache, TransferCache, DecodedChainEvent };

export function createV4RegistryCaches(): V4RegistryCaches {
  return {
    swapLogs: new Map(),
    transfers: new Map(),
    transactionSenders: new Map(),
    blockTimestamps: new Map(),
    marketStatics: new Map(),
  };
}

let globalRegistryCaches = createV4RegistryCaches();

let cachedV4Launches:
  | { expiresAt: number; promise: Promise<HoodiePadLaunch[]> }
  | undefined;

export function resetV4RegistryCaches() {
  globalRegistryCaches = createV4RegistryCaches();
  cachedV4Launches = undefined;
  persistedCachesLoaded = undefined;
}

function absolute(value: bigint) {
  return value < 0n ? -value : value;
}

function bigintMax(first: bigint, second: bigint) {
  return first > second ? first : second;
}

function eventId(log: DecodedChainEvent) {
  return `${log.transactionHash ?? "0x"}:${log.logIndex ?? -1}`;
}

function isRateLimitError(error: unknown) {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  const text = parts.join(" ").toLowerCase();
  return text.includes("429") || text.includes("too many requests") ||
    text.includes("rate limit");
}

// Long history scans can trip public-RPC rate limits; one throttled chunk
// must not abort the whole registry load. Exponential backoff with jitter.
async function withRateLimitRetry<T>(operation: () => Promise<T>): Promise<T> {
  let delay = 400;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 5 || !isRateLimitError(error)) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, delay + Math.floor(Math.random() * 200)));
      delay = Math.min(delay * 2, 5_000);
    }
  }
}

function compactAmount(raw: bigint, decimals = 18) {
  const value = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 4,
  }).format(value);
}

async function readCreateChunks(
  client: RobinhoodClient,
  input: {
    fromBlock: bigint;
    toBlock: bigint;
  },
) {
  const events: DecodedChainEvent[] = [];
  for (
    let fromBlock = input.fromBlock;
    fromBlock <= input.toBlock;
    fromBlock += logChunkSize
  ) {
    const toBlock =
      fromBlock + logChunkSize - 1n < input.toBlock
        ? fromBlock + logChunkSize - 1n
        : input.toBlock;
    const chunk = await withRateLimitRetry(() => client.getContractEvents({
      address: getAddress(product.contracts.airlock),
      abi: airlockAbi,
      eventName: "Create",
      args: { numeraire: getAddress(product.contracts.hoodie) },
      fromBlock,
      toBlock,
    } as Parameters<RobinhoodClient["getContractEvents"]>[0]));
    events.push(...chunk as unknown as DecodedChainEvent[]);
  }
  return events;
}

async function readV4SwapChunks(
  client: RobinhoodClient,
  poolId: Hex,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const events: DecodedChainEvent[] = [];
  for (
    let cursor = fromBlock;
    cursor <= toBlock;
    cursor += logChunkSize
  ) {
    const chunkEnd =
      cursor + logChunkSize - 1n < toBlock
        ? cursor + logChunkSize - 1n
        : toBlock;
    const chunk = await withRateLimitRetry(() => client.getLogs({
      address: getAddress(product.contracts.uniswapV4PoolManager),
      event: v4SwapEvent,
      args: { id: poolId },
      fromBlock: cursor,
      toBlock: chunkEnd,
    } as Parameters<RobinhoodClient["getLogs"]>[0]));
    events.push(...chunk as unknown as DecodedChainEvent[]);
  }
  return events;
}

async function readTransferChunks(
  client: RobinhoodClient,
  token: Address,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const events: DecodedChainEvent[] = [];
  for (
    let cursor = fromBlock;
    cursor <= toBlock;
    cursor += logChunkSize
  ) {
    const chunkEnd =
      cursor + logChunkSize - 1n < toBlock
        ? cursor + logChunkSize - 1n
        : toBlock;
    const chunk = await withRateLimitRetry(() => client.getLogs({
      address: token,
      event: erc20TransferEvent,
      fromBlock: cursor,
      toBlock: chunkEnd,
    } as Parameters<RobinhoodClient["getLogs"]>[0]));
    events.push(...chunk as unknown as DecodedChainEvent[]);
  }
  return events;
}

async function readCachedSwapLogs(
  client: RobinhoodClient,
  caches: V4RegistryCaches,
  poolId: Hex,
  fromBlock: bigint,
  latestBlock: bigint,
) {
  const key = poolId.toLowerCase();
  let cache = caches.swapLogs.get(key);
  if (!cache) {
    cache = { lastScannedBlock: fromBlock - 1n, seen: new Set(), logs: [] };
    caches.swapLogs.set(key, cache);
  }
  const scanFrom = bigintMax(
    fromBlock,
    cache.lastScannedBlock + 1n - reorgSafetyBlocks,
  );
  if (scanFrom <= latestBlock) {
    const fresh = await readV4SwapChunks(client, poolId, scanFrom, latestBlock);
    for (const log of fresh) {
      const id = eventId(log);
      if (cache.seen.has(id)) continue;
      cache.seen.add(id);
      cache.logs.push(log);
    }
    cache.lastScannedBlock = latestBlock;
  }
  return cache.logs;
}

async function readCachedTransferBalances(
  client: RobinhoodClient,
  caches: V4RegistryCaches,
  token: Address,
  fromBlock: bigint,
  latestBlock: bigint,
) {
  const key = token.toLowerCase();
  let cache = caches.transfers.get(key);
  if (!cache) {
    cache = {
      lastScannedBlock: fromBlock - 1n,
      seen: new Set(),
      balances: new Map(),
      checksumAddresses: new Map(),
    };
    caches.transfers.set(key, cache);
  }
  const scanFrom = bigintMax(
    fromBlock,
    cache.lastScannedBlock + 1n - reorgSafetyBlocks,
  );
  if (scanFrom <= latestBlock) {
    const fresh = await readTransferChunks(
      client,
      token,
      scanFrom,
      latestBlock,
    );
    for (const log of fresh) {
      const id = eventId(log);
      if (cache.seen.has(id)) continue;
      const args = log.args as {
        from?: Address;
        to?: Address;
        value?: bigint;
      };
      if (!args.from || !args.to || args.value === undefined) continue;
      cache.seen.add(id);
      const from = args.from.toLowerCase();
      const to = args.to.toLowerCase();
      cache.checksumAddresses.set(from, getAddress(args.from));
      cache.checksumAddresses.set(to, getAddress(args.to));
      if (from !== zeroAddress) {
        cache.balances.set(from, (cache.balances.get(from) ?? 0n) - args.value);
      }
      if (to !== zeroAddress) {
        cache.balances.set(to, (cache.balances.get(to) ?? 0n) + args.value);
      }
    }
    cache.lastScannedBlock = latestBlock;
  }
  return cache;
}

function formatHolderBalance(raw: bigint, decimals: number) {
  const value = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(value)) return formatUnits(raw, decimals);
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 4,
  }).format(value);
}

async function readV4Holders(
  market: HoodiePadV4Market,
  client: RobinhoodClient,
  caches: V4RegistryCaches,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const cache = await readCachedTransferBalances(
    client,
    caches,
    market.address,
    fromBlock,
    toBlock,
  );

  const excluded = new Set([
    zeroAddress,
    product.contracts.uniswapV4PoolManager.toLowerCase(),
    product.contracts.airlock.toLowerCase(),
    product.contracts.dopplerHookInitializer.toLowerCase(),
    product.contracts.rehypeDopplerHookInitializer.toLowerCase(),
    market.externalHook.toLowerCase(),
    product.contracts.noOpMigrator.toLowerCase(),
    product.contracts.noOpGovernanceFactory.toLowerCase(),
  ]);
  const totalSupply = BigInt(market.totalSupplyRaw);
  const walletBalances = [...cache.balances.entries()]
    .filter(([address, balance]) => balance > 0n && !excluded.has(address))
    .sort(([, first], [, second]) =>
      first === second ? 0 : first > second ? -1 : 1,
    );
  const holders: MarketHolder[] = walletBalances.slice(0, 20).map(
    ([address, balance]) => ({
      address: cache.checksumAddresses.get(address) ?? getAddress(address),
      balanceRaw: balance.toString(),
      balance: formatHolderBalance(balance, market.decimals),
      sharePercent: totalSupply > 0n
        ? Number(balance * 1_000_000n / totalSupply) / 10_000
        : 0,
    }),
  );
  return { holderCount: walletBalances.length, holders };
}

export async function readV4MarketAnalytics(
  market: HoodiePadV4Market,
  client = createRobinhoodPublicClient(),
  fromBlock = launchStartBlock,
  caches: V4RegistryCaches = createV4RegistryCaches(),
): Promise<MarketAnalytics> {
  const latestBlock = await client.getBlockNumber();
  const [logs, holderData] = await Promise.all([
    readCachedSwapLogs(client, caches, market.poolId, fromBlock, latestBlock),
    readV4Holders(market, client, caches, fromBlock, latestBlock),
  ]);

  const transactionHashes = [...new Set(
    logs
      .map((log) => log.transactionHash)
      .filter((hash): hash is Hex =>
        hash !== null && !caches.transactionSenders.has(hash)),
  )];
  await Promise.all(transactionHashes.map(async (hash) => {
    const transaction = await client.getTransaction({ hash });
    caches.transactionSenders.set(hash, getAddress(transaction.from));
  }));

  const childIsCurrency0 =
    market.poolKey.currency0.toLowerCase() === market.address.toLowerCase();
  const decodedPoints = logs.map((log) => {
    const args = log.args as {
      amount0?: bigint;
      amount1?: bigint;
      sqrtPriceX96?: bigint;
      tick?: number;
    };
    if (
      log.blockNumber === null ||
      !log.transactionHash ||
      args.amount0 === undefined ||
      args.amount1 === undefined ||
      args.sqrtPriceX96 === undefined ||
      args.tick === undefined
    ) {
      return null;
    }
    const childDelta = childIsCurrency0 ? args.amount0 : args.amount1;
    const hoodieDelta = childIsCurrency0 ? args.amount1 : args.amount0;
    const price = v4PriceForMarket(
      market.poolKey,
      args.sqrtPriceX96,
      market.address,
      market.decimals,
    );
    // Uniswap v4 Swap events report the swapper's balance deltas: a positive
    // amount is received by the swapper, a negative amount is paid in. (The
    // legacy V3 path uses the opposite, pool-perspective convention.)
    return {
      blockNumber: log.blockNumber.toString(),
      transactionHash: log.transactionHash,
      logIndex: log.logIndex ?? 0,
      timestamp: 0,
      side: childDelta > 0n ? "buy" : "sell",
      trader:
        caches.transactionSenders.get(log.transactionHash) ??
        getAddress(zeroAddress),
      price: Number(formatRational(price, 18)),
      hoodieVolumeRaw: absolute(hoodieDelta).toString(),
      hoodieFeeVolumeRaw: hoodieDelta < 0n ? (-hoodieDelta).toString() : "0",
      childVolumeRaw: absolute(childDelta).toString(),
    } satisfies MarketSwapPoint;
  }).filter((point): point is MarketSwapPoint => point !== null)
    .sort((first, second) => {
      const blockDifference =
        BigInt(first.blockNumber) - BigInt(second.blockNumber);
      return blockDifference === 0n
        ? first.logIndex - second.logIndex
        : blockDifference < 0n ? -1 : 1;
    });

  const uniqueBlocks = [...new Set(
    decodedPoints.map((point) => point.blockNumber),
  )].filter((blockNumber) => !caches.blockTimestamps.has(blockNumber));
  await Promise.all(uniqueBlocks.map(async (blockNumber) => {
    const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
    caches.blockTimestamps.set(blockNumber, Number(block.timestamp));
  }));
  const points = decodedPoints.map((point) => ({
    ...point,
    timestamp: caches.blockTimestamps.get(point.blockNumber) ?? 0,
  }));

  const hoodieVolumeRaw = points.reduce(
    (total, point) => total + BigInt(point.hoodieVolumeRaw),
    0n,
  );
  const hoodieFeeVolumeRaw = points.reduce(
    (total, point) => total + BigInt(point.hoodieFeeVolumeRaw),
    0n,
  );
  const cutoff24h = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const points24h = points.filter((point) => point.timestamp >= cutoff24h);
  const hoodieVolume24hRaw = points24h.reduce(
    (total, point) => total + BigInt(point.hoodieVolumeRaw),
    0n,
  );
  const hoodieFeeVolume24hRaw = points24h.reduce(
    (total, point) => total + BigInt(point.hoodieFeeVolumeRaw),
    0n,
  );

  const dailyActivity = new Map<string, {
    swaps: number;
    hoodieVolumeRaw: bigint;
    hoodieFeeVolumeRaw: bigint;
  }>();
  for (const point of points) {
    const date = new Date(point.timestamp * 1000).toISOString().slice(0, 10);
    const current = dailyActivity.get(date) ?? {
      swaps: 0,
      hoodieVolumeRaw: 0n,
      hoodieFeeVolumeRaw: 0n,
    };
    current.swaps += 1;
    current.hoodieVolumeRaw += BigInt(point.hoodieVolumeRaw);
    current.hoodieFeeVolumeRaw += BigInt(point.hoodieFeeVolumeRaw);
    dailyActivity.set(date, current);
  }
  const firstPrice = points[0]?.price;
  const latestPrice =
    points.at(-1)?.price ??
    (market.hoodiePerToken === "Unavailable"
      ? undefined
      : Number(market.hoodiePerToken.replaceAll(",", "")));
  const changePercent =
    firstPrice && latestPrice
      ? ((latestPrice / firstPrice) - 1) * 100
      : null;

  return {
    points: points.slice(-200),
    swapCount: points.length,
    swapCount24h: points24h.length,
    hoodieVolumeRaw: hoodieVolumeRaw.toString(),
    hoodieVolume24hRaw: hoodieVolume24hRaw.toString(),
    hoodieFeeVolumeRaw: hoodieFeeVolumeRaw.toString(),
    hoodieFeeVolume24hRaw: hoodieFeeVolume24hRaw.toString(),
    hoodieVolume: compactAmount(hoodieVolumeRaw),
    hoodieVolume24h: compactAmount(hoodieVolume24hRaw),
    changePercent,
    changePercent24h: change24hFromPoints(points, cutoff24h),
    holderCount: holderData.holderCount,
    holders: holderData.holders,
    daily: [...dailyActivity.entries()]
      .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
      .map(([date, activity]) => ({
        date,
        swaps: activity.swaps,
        hoodieVolumeRaw: activity.hoodieVolumeRaw.toString(),
        hoodieFeeVolumeRaw: activity.hoodieFeeVolumeRaw.toString(),
      })),
  };
}

async function readCachedCreateEvents(
  client: RobinhoodClient,
  caches: V4RegistryCaches,
  latestBlock: bigint,
) {
  if (!caches.discovery) {
    caches.discovery = {
      lastScannedBlock: launchStartBlock - 1n,
      creates: [],
    };
  }
  const discovery = caches.discovery;
  const scanFrom = bigintMax(
    launchStartBlock,
    discovery.lastScannedBlock + 1n - reorgSafetyBlocks,
  );
  if (scanFrom <= latestBlock) {
    const seen = new Set(discovery.creates.map(eventId));
    const fresh = await readCreateChunks(client, {
      fromBlock: scanFrom,
      toBlock: latestBlock,
    });
    for (const log of fresh) {
      if (seen.has(eventId(log))) continue;
      discovery.creates.push(log);
    }
    discovery.lastScannedBlock = latestBlock;
  }
  return discovery.creates;
}

async function loadV4Launches(
  client = createRobinhoodPublicClient(),
  caches: V4RegistryCaches = createV4RegistryCaches(),
): Promise<HoodiePadLaunch[]> {
  const latestBlock = await client.getBlockNumber();
  const logs = await readCachedCreateEvents(client, caches, latestBlock);

  const candidates = await Promise.allSettled(logs.map(async (log) => {
    const args = log.args as {
      asset?: Address;
      initializer?: Address;
    };
    if (
      !args.asset ||
      !args.initializer ||
      log.blockNumber === null ||
      !log.transactionHash ||
      args.initializer.toLowerCase() !==
        product.contracts.dopplerHookInitializer.toLowerCase()
    ) {
      throw new Error("Airlock Create event is not a HoodiePad V2 candidate");
    }
    // The launch sender and block timestamp never change; memoize them so a
    // refresh costs no per-launch receipt or block lookups.
    const blockKey = log.blockNumber.toString();
    const [market, creator, launchTimestamp] = await Promise.all([
      readHoodiePadV4Market(args.asset, client, caches.marketStatics),
      (async () => {
        const cached = caches.transactionSenders.get(log.transactionHash!);
        if (cached) return cached;
        const transaction = await client.getTransaction({
          hash: log.transactionHash!,
        });
        const sender = getAddress(transaction.from);
        caches.transactionSenders.set(log.transactionHash!, sender);
        return sender;
      })(),
      (async () => {
        const cached = caches.blockTimestamps.get(blockKey);
        if (cached !== undefined) return cached;
        const block = await client.getBlock({ blockNumber: log.blockNumber! });
        const timestamp = Number(block.timestamp);
        caches.blockTimestamps.set(blockKey, timestamp);
        return timestamp;
      })(),
    ]);
    if (!market.official) {
      throw new Error(
        `V4 launch failed HoodiePad V2 invariant validation: ${market.validationErrors.join(", ")}`,
      );
    }
    const analytics = await readV4MarketAnalytics(
      market,
      client,
      log.blockNumber,
      caches,
    );
    return {
      ...market,
      hasSwapActivity: analytics.swapCount > 0,
      creator,
      launchBlock: blockKey,
      launchTimestamp,
      launchTransactionHash: log.transactionHash,
      analytics,
    } satisfies HoodiePadV4Launch;
  }));

  candidates.forEach((candidate, index) => {
    if (candidate.status !== "rejected") return;
    const args = logs[index]?.args as { asset?: Address } | undefined;
    const asset = args?.asset ?? "unknown";
    const reason = candidate.reason instanceof Error
      ? candidate.reason.message.split("\n")[0]
      : "Unknown V4 registry validation error";
    console.warn(
      `[HoodiePad V4 registry] Rejected ${asset}: ${reason}`,
    );
  });

  return candidates
    .filter((candidate) => candidate.status === "fulfilled")
    .map((candidate) => candidate.value)
    .sort((first, second) =>
      BigInt(first.launchBlock) > BigInt(second.launchBlock) ? -1 : 1,
    );
}

let persistedCachesLoaded: Promise<void> | undefined;

export function readHoodiePadV4Launches() {
  const now = Date.now();
  if (cachedV4Launches && cachedV4Launches.expiresAt > now) {
    return cachedV4Launches.promise;
  }
  // Warm the incremental caches from the persisted snapshot exactly once per
  // process so a restart does not rescan the whole chain history.
  persistedCachesLoaded ??= loadPersistedRegistryCaches(globalRegistryCaches);
  const promise = persistedCachesLoaded
    .catch(() => undefined)
    .then(() => loadV4Launches(
      createRobinhoodPublicClient(),
      globalRegistryCaches,
    ))
    .then((launches) => {
      // Start the freshness window only once the scan has finished so a slow
      // scan is not already stale (and immediately re-triggered) on arrival.
      if (cachedV4Launches?.promise === promise) {
        cachedV4Launches.expiresAt =
          Date.now() + product.discovery.refreshSeconds * 1000;
      }
      void persistRegistryCaches(globalRegistryCaches);
      return launches;
    })
    .catch((error) => {
      if (cachedV4Launches?.promise === promise) {
        cachedV4Launches = undefined;
      }
      throw error;
    });
  cachedV4Launches = { expiresAt: Number.MAX_SAFE_INTEGER, promise };
  return promise;
}

export async function readHoodiePadV4Launch(
  address: Address,
  client?: RobinhoodClient,
) {
  const launches = client
    ? await loadV4Launches(client)
    : await readHoodiePadV4Launches();
  return launches.find(
    (launch) => launch.address.toLowerCase() === address.toLowerCase(),
  );
}

export async function readV4TokenSupply(address: Address) {
  return createRobinhoodPublicClient().readContract({
    address,
    abi: dopplerERC20V1Abi,
    functionName: "totalSupply",
  });
}
