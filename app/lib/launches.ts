import {
  airlockAbi,
} from "@whetstone-research/doppler-sdk/evm";
import {
  formatUnits,
  getAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import product from "../../config/hoodiepad-v1.json";
import {
  readHoodiePadMarket,
  type HoodiePadMarket,
} from "./market";
import { createRobinhoodPublicClient } from "./protocol";

type RobinhoodClient = ReturnType<typeof createRobinhoodPublicClient>;

export type MarketSwapPoint = {
  blockNumber: string;
  transactionHash: Hex;
  logIndex: number;
  timestamp: number;
  side: "buy" | "sell";
  trader: Address;
  price: number;
  hoodieVolumeRaw: string;
  hoodieFeeVolumeRaw: string;
  childVolumeRaw: string;
};

export type MarketHolder = {
  address: Address;
  balanceRaw: string;
  balance: string;
  sharePercent: number;
};

export type MarketDailyActivity = {
  date: string;
  swaps: number;
  hoodieVolumeRaw: string;
  hoodieFeeVolumeRaw: string;
};

export type MarketAnalytics = {
  points: MarketSwapPoint[];
  swapCount: number;
  swapCount24h: number;
  hoodieVolumeRaw: string;
  hoodieVolume24hRaw: string;
  hoodieFeeVolumeRaw: string;
  hoodieFeeVolume24hRaw: string;
  hoodieVolume: string;
  hoodieVolume24h: string;
  changePercent: number | null;
  changePercent24h: number | null;
  holderCount: number;
  holders: MarketHolder[];
  daily: MarketDailyActivity[];
};

// Price change over the trailing 24h window: latest trade price versus the
// last trade at or before the window start (a market with no trades inside
// the window reads 0% — its price has not moved).
export function change24hFromPoints(
  points: MarketSwapPoint[],
  cutoff: number,
) {
  if (points.length === 0) return null;
  const latest = points.at(-1)?.price;
  let baseline: number | undefined;
  for (const point of points) {
    if (point.timestamp <= cutoff) baseline = point.price;
    else break;
  }
  const reference = baseline ?? points[0]?.price;
  if (
    latest === undefined ||
    reference === undefined ||
    !Number.isFinite(latest) ||
    !Number.isFinite(reference) ||
    reference <= 0
  ) {
    return null;
  }
  return (latest / reference - 1) * 100;
}

export type HoodiePadLaunch = HoodiePadMarket & {
  creator: Address;
  launchBlock: string;
  launchTimestamp: number;
  launchTransactionHash: Hex;
  analytics: MarketAnalytics;
};

export type HoodiePadMarketSummary = {
  address: string;
  symbol: string;
  name: string;
  creator: string;
  price: string;
  fdv: string;
  volume: string;
  change: string;
  imageUrl?: string;
  active: boolean;
  launchBlock: string;
  tone: "green" | "peach" | "blue" | "violet";
  // Numeric fields (HOODIE-denominated where applicable) for USD conversion,
  // sorting, and the explore table.
  priceHoodie: number | null;
  fdvHoodieNumber: number | null;
  volumeHoodieNumber: number;
  volume24hHoodieNumber: number;
  txns: number;
  txns24h: number;
  changePercent: number | null;
  changePercent24h: number | null;
  holderCount: number;
  launchTimestamp: number;
};

type DecodedChainEvent = {
  args: unknown;
  blockNumber: bigint | null;
  transactionHash: Hex | null;
  logIndex: number | null;
};

const v3SwapEvent = parseAbiItem(
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
);
const erc20TransferEvent = parseAbiItem(
  "event Transfer(address indexed from,address indexed to,uint256 value)",
);
const zeroAddress = "0x0000000000000000000000000000000000000000";
const launchStartBlock = BigInt(product.discovery.launchStartBlock);
const logChunkSize = BigInt(product.discovery.logChunkSize);
let cachedLaunches:
  | { expiresAt: number; promise: Promise<HoodiePadLaunch[]> }
  | undefined;

function absolute(value: bigint) {
  return value < 0n ? -value : value;
}

function compactAmount(raw: bigint, decimals = 18) {
  const value = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 4,
  }).format(value);
}

async function readEventChunks(
  client: RobinhoodClient,
  input: {
    address: Address;
    abi: typeof airlockAbi;
    eventName: "Create";
    fromBlock: bigint;
    toBlock: bigint;
    args?: Record<string, Address>;
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
    const chunk = await client.getContractEvents({
      address: input.address,
      abi: input.abi,
      eventName: input.eventName,
      args: input.args,
      fromBlock,
      toBlock,
    } as Parameters<RobinhoodClient["getContractEvents"]>[0]);
    events.push(...chunk as unknown as DecodedChainEvent[]);
  }
  return events;
}

async function readLogChunks(
  client: RobinhoodClient,
  input: {
    address: Address;
    event: typeof v3SwapEvent | typeof erc20TransferEvent;
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
    const chunk = await client.getLogs({
      address: input.address,
      event: input.event,
      fromBlock,
      toBlock,
    } as Parameters<RobinhoodClient["getLogs"]>[0]);
    events.push(...chunk as unknown as DecodedChainEvent[]);
  }
  return events;
}

function formatHolderBalance(raw: bigint, decimals: number) {
  const value = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(value)) return formatUnits(raw, decimals);
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 4,
  }).format(value);
}

async function readMarketHolders(
  market: Pick<HoodiePadMarket, "address" | "pool" | "decimals" | "totalSupplyRaw">,
  client: RobinhoodClient,
  fromBlock: bigint,
  toBlock: bigint,
) {
  const logs = await readLogChunks(client, {
    address: market.address,
    event: erc20TransferEvent,
    fromBlock,
    toBlock,
  });
  const balances = new Map<string, bigint>();
  const checksumAddresses = new Map<string, Address>();
  for (const log of logs) {
    const args = log.args as {
      from?: Address;
      to?: Address;
      value?: bigint;
    };
    if (!args.from || !args.to || args.value === undefined) continue;
    const from = args.from.toLowerCase();
    const to = args.to.toLowerCase();
    checksumAddresses.set(from, getAddress(args.from));
    checksumAddresses.set(to, getAddress(args.to));
    if (from !== zeroAddress) {
      balances.set(from, (balances.get(from) ?? 0n) - args.value);
    }
    if (to !== zeroAddress) {
      balances.set(to, (balances.get(to) ?? 0n) + args.value);
    }
  }

  const excluded = new Set([
    zeroAddress,
    market.pool.toLowerCase(),
    product.contracts.airlock.toLowerCase(),
    product.contracts.lockableV3Initializer.toLowerCase(),
    product.contracts.noOpMigrator.toLowerCase(),
    product.pool.noOpMigrationPool.toLowerCase(),
  ]);
  const totalSupply = BigInt(market.totalSupplyRaw);
  const walletBalances = [...balances.entries()]
    .filter(([address, balance]) => balance > 0n && !excluded.has(address))
    .sort(([, first], [, second]) => first === second ? 0 : first > second ? -1 : 1);

  return {
    holderCount: walletBalances.length,
    holders: walletBalances.slice(0, 20).map(([address, balance]) => ({
      address: checksumAddresses.get(address) ?? getAddress(address),
      balanceRaw: balance.toString(),
      balance: formatHolderBalance(balance, market.decimals),
      sharePercent: totalSupply > 0n
        ? Number(balance * 1_000_000n / totalSupply) / 10_000
        : 0,
    })),
  };
}

export async function readMarketAnalytics(
  market: Pick<
    HoodiePadMarket,
    "address" | "pool" | "decimals" | "hoodiePerToken" | "totalSupplyRaw"
  >,
  client = createRobinhoodPublicClient(),
  fromBlock = launchStartBlock,
): Promise<MarketAnalytics> {
  const latestBlock = await client.getBlockNumber();
  const [logs, holderData] = await Promise.all([
    readLogChunks(client, {
      address: market.pool,
      event: v3SwapEvent,
      fromBlock,
      toBlock: latestBlock,
    }),
    readMarketHolders(market, client, fromBlock, latestBlock),
  ]);

  const decodedPoints = logs
    .map((log) => {
      const args = log.args as {
        amount0?: bigint;
        amount1?: bigint;
        tick?: number;
        recipient?: Address;
      };
      if (
        log.blockNumber === null ||
        !log.transactionHash ||
        args.amount0 === undefined ||
        args.amount1 === undefined ||
        args.tick === undefined ||
        !args.recipient
      ) {
        return null;
      }
      return {
        blockNumber: log.blockNumber.toString(),
        transactionHash: log.transactionHash,
        logIndex: log.logIndex ?? 0,
        timestamp: 0,
        side: args.amount0 < 0n ? "buy" : "sell",
        trader: getAddress(args.recipient),
        price: Math.pow(1.0001, Number(args.tick)),
        hoodieVolumeRaw: absolute(args.amount1).toString(),
        hoodieFeeVolumeRaw: args.amount1 > 0n ? args.amount1.toString() : "0",
        childVolumeRaw: absolute(args.amount0).toString(),
      } satisfies MarketSwapPoint;
    })
    .filter((point): point is MarketSwapPoint => point !== null)
    .sort((first, second) => {
      const blockDifference =
        BigInt(first.blockNumber) - BigInt(second.blockNumber);
      return blockDifference === 0n
        ? first.logIndex - second.logIndex
        : blockDifference < 0n ? -1 : 1;
    });

  const uniqueBlocks = [...new Set(decodedPoints.map((point) => point.blockNumber))];
  const timestamps = new Map<string, number>();
  await Promise.all(uniqueBlocks.map(async (blockNumber) => {
    const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
    timestamps.set(blockNumber, Number(block.timestamp));
  }));
  const points = decodedPoints.map((point) => ({
    ...point,
    timestamp: timestamps.get(point.blockNumber) ?? 0,
  }));

  const hoodieVolumeRaw = points.reduce(
    (total, point) => total + BigInt(point.hoodieVolumeRaw),
    0n,
  );
  const hoodieFeeVolumeRaw = points.reduce(
    (total, point) => total + BigInt(point.hoodieFeeVolumeRaw),
    0n,
  );
  const latestTimestamp = Math.max(
    Math.floor(Date.now() / 1000),
    ...points.map((point) => point.timestamp),
  );
  const cutoff24h = latestTimestamp - 24 * 60 * 60;
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
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([date, activity]) => ({
        date,
        swaps: activity.swaps,
        hoodieVolumeRaw: activity.hoodieVolumeRaw.toString(),
        hoodieFeeVolumeRaw: activity.hoodieFeeVolumeRaw.toString(),
      })),
  };
}

async function loadHoodiePadLaunches(
  client = createRobinhoodPublicClient(),
): Promise<HoodiePadLaunch[]> {
  const latestBlock = await client.getBlockNumber();
  const logs = await readEventChunks(client, {
    address: getAddress(product.contracts.airlock),
    abi: airlockAbi,
    eventName: "Create",
    args: { numeraire: getAddress(product.contracts.hoodie) },
    fromBlock: launchStartBlock,
    toBlock: latestBlock,
  });

  const candidates = await Promise.allSettled(
    logs.map(async (log) => {
      const args = log.args as {
        asset?: Address;
        numeraire?: Address;
        poolOrHook?: Address;
      };
      if (
        !args.asset ||
        !args.numeraire ||
        !args.poolOrHook ||
        log.blockNumber === null ||
        !log.transactionHash
      ) {
        throw new Error("Incomplete Airlock Create event");
      }
      const [market, receipt, launchBlock] = await Promise.all([
        readHoodiePadMarket(args.asset, client),
        client.getTransactionReceipt({ hash: log.transactionHash }),
        client.getBlock({ blockNumber: log.blockNumber }),
      ]);
      if (!market.official || market.pool.toLowerCase() !== args.poolOrHook.toLowerCase()) {
        throw new Error("Create event is not an official HoodiePad market");
      }
      const analytics = await readMarketAnalytics(market, client, log.blockNumber);
      return {
        ...market,
        creator: getAddress(receipt.from),
        launchBlock: log.blockNumber.toString(),
        launchTimestamp: Number(launchBlock.timestamp),
        launchTransactionHash: log.transactionHash,
        analytics,
      } satisfies HoodiePadLaunch;
    }),
  );

  return candidates
    .filter(
      (candidate): candidate is PromiseFulfilledResult<HoodiePadLaunch> =>
        candidate.status === "fulfilled",
    )
    .map((candidate) => candidate.value)
    .sort((first, second) =>
      BigInt(first.launchBlock) > BigInt(second.launchBlock) ? -1 : 1,
    );
}

export function readLegacyHoodiePadLaunches() {
  const now = Date.now();
  if (cachedLaunches && cachedLaunches.expiresAt > now) {
    return cachedLaunches.promise;
  }
  const promise = loadHoodiePadLaunches().catch((error) => {
    cachedLaunches = undefined;
    throw error;
  });
  cachedLaunches = {
    expiresAt: now + product.discovery.refreshSeconds * 1000,
    promise,
  };
  return promise;
}

export async function readHoodiePadLaunches() {
  const { readHoodiePadV4Launches } = await import("./launches-v4");
  return readHoodiePadV4Launches();
}

export function formatMarketChange(changePercent: number | null) {
  if (changePercent === null || !Number.isFinite(changePercent)) return "New";
  const prefix = changePercent > 0 ? "+" : "";
  return `${prefix}${changePercent.toFixed(2)}%`;
}

export function summarizeHoodiePadLaunches(
  launches: HoodiePadLaunch[],
): HoodiePadMarketSummary[] {
  const tones: HoodiePadMarketSummary["tone"][] = ["green", "peach", "blue", "violet"];
  return launches.map((market, index) => {
    const priceHoodie = market.hoodiePerToken === "Unavailable"
      ? null
      : Number(market.hoodiePerToken.replaceAll(",", ""));
    const supply = Number(market.totalSupplyRaw) / 1e18;
    const fdvHoodieNumber =
      priceHoodie !== null && Number.isFinite(priceHoodie) && Number.isFinite(supply)
        ? priceHoodie * supply
        : null;
    return {
      address: market.address,
      symbol: market.symbol,
      name: market.name,
      creator: market.creator,
      price: market.hoodiePerToken,
      fdv: `${market.fdvHoodie} HOODIE`,
      volume: `${market.analytics.hoodieVolume} HOODIE`,
      change: formatMarketChange(market.analytics.changePercent),
      imageUrl: market.imageUrl,
      active: market.hasSwapActivity,
      launchBlock: market.launchBlock,
      tone: tones[index % tones.length],
      priceHoodie: priceHoodie !== null && Number.isFinite(priceHoodie) ? priceHoodie : null,
      fdvHoodieNumber,
      volumeHoodieNumber: Number(market.analytics.hoodieVolumeRaw) / 1e18,
      volume24hHoodieNumber: Number(market.analytics.hoodieVolume24hRaw) / 1e18,
      txns: market.analytics.swapCount,
      txns24h: market.analytics.swapCount24h,
      changePercent: market.analytics.changePercent,
      changePercent24h: market.analytics.changePercent24h,
      holderCount: market.analytics.holderCount,
      launchTimestamp: market.launchTimestamp,
    };
  });
}
