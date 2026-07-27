import { formatUnits, getAddress, type Address } from "viem";
import product from "../../config/hoodiepad-v2.json";
import {
  unrealizedForStats,
  type HoodiePadLaunch,
} from "./launches";

// Published scoring weights. Realized profit dominates and raw volume is
// capped on purpose: wash trading inflates volume cheaply, but it cannot
// manufacture realized profit, win rate, or activity spread across markets
// and days.
export const TRADER_SCORE_WEIGHTS = {
  realizedProfit: 35,
  winRate: 20,
  roi: 15,
  volume: 15,
  consistency: 15,
} as const;

const WAD = 10n ** 18n;
const POOL_FEE_DENOMINATOR = 1_000_000n;

export type TraderRow = {
  rank: number;
  address: Address;
  score: number;
  realizedRaw: string;
  realizedHoodie: number;
  unrealizedRaw: string;
  unrealizedHoodie: number;
  roiPercent: number | null;
  winRatePercent: number | null;
  volumeHoodie: number;
  trades: number;
  markets: number;
  activeDays: number;
  bestTradeHoodie: number;
  badges: string[];
};

export type CreatorRow = {
  rank: number;
  address: Address;
  markets: number;
  activeMarkets: number;
  volumeHoodie: number;
  feesHoodie: number;
  trades: number;
  topSymbol: string;
  topImageUrl?: string;
  lastLaunchTimestamp: number;
};

function toHoodie(raw: bigint) {
  const value = Number(formatUnits(raw, 18));
  return Number.isFinite(value) ? value : 0;
}

function normalize(value: number, maximum: number) {
  if (!Number.isFinite(value) || maximum <= 0) return 0;
  return Math.max(0, Math.min(1, value / maximum));
}

export function buildTraderLeaderboard(launches: HoodiePadLaunch[]): TraderRow[] {
  type Accumulator = {
    address: Address;
    realized: bigint;
    unrealized: bigint;
    costDeployed: bigint;
    volume: bigint;
    trades: number;
    closes: number;
    wins: number;
    markets: Set<string>;
    days: Set<string>;
    bestTrade: bigint;
  };
  const accounts = new Map<string, Accumulator>();

  for (const launch of launches) {
    const price = launch.hoodiePerToken === "Unavailable"
      ? 0
      : Number(launch.hoodiePerToken.replaceAll(",", ""));
    for (const stats of launch.analytics.traders) {
      const key = stats.trader.toLowerCase();
      let account = accounts.get(key);
      if (!account) {
        account = {
          address: getAddress(stats.trader),
          realized: 0n,
          unrealized: 0n,
          costDeployed: 0n,
          volume: 0n,
          trades: 0,
          closes: 0,
          wins: 0,
          markets: new Set(),
          days: new Set(),
          bestTrade: 0n,
        };
        accounts.set(key, account);
      }
      const realized = BigInt(stats.realizedRaw);
      account.realized += realized;
      account.unrealized += unrealizedForStats(stats, price);
      account.costDeployed += BigInt(stats.costBasisRaw);
      account.volume += BigInt(stats.volumeRaw);
      account.trades += stats.buys + stats.sells;
      account.closes += stats.closes;
      account.wins += stats.wins;
      account.markets.add(launch.address.toLowerCase());
      for (const day of stats.days) account.days.add(day);
      if (realized > account.bestTrade) account.bestTrade = realized;
    }
  }

  const rows = [...accounts.values()];
  if (rows.length === 0) return [];

  const maximumRealized = Math.max(
    ...rows.map((row) => toHoodie(row.realized > 0n ? row.realized : 0n)),
    0,
  );
  const maximumVolume = Math.max(...rows.map((row) => toHoodie(row.volume)), 0);

  const scored = rows.map((row) => {
    const realizedHoodie = toHoodie(row.realized);
    const volumeHoodie = toHoodie(row.volume);
    // Total HOODIE the wallet has committed: still-open cost plus whatever it
    // has already recovered through closed positions.
    const investedHoodie = toHoodie(row.costDeployed) +
      Math.max(0, volumeHoodie - toHoodie(row.costDeployed));
    const winRate = row.closes > 0 ? row.wins / row.closes : null;
    const roi = investedHoodie > 0 ? realizedHoodie / investedHoodie : null;
    const consistency = Math.min(
      1,
      (row.markets.size + row.days.size) / 6,
    );
    const score =
      normalize(Math.max(0, realizedHoodie), maximumRealized) *
        TRADER_SCORE_WEIGHTS.realizedProfit +
      (winRate ?? 0) * TRADER_SCORE_WEIGHTS.winRate +
      normalize(Math.max(0, roi ?? 0), 1) * TRADER_SCORE_WEIGHTS.roi +
      normalize(volumeHoodie, maximumVolume) * TRADER_SCORE_WEIGHTS.volume +
      consistency * TRADER_SCORE_WEIGHTS.consistency;

    const badges: string[] = [];
    if (realizedHoodie > 0 && (roi ?? 0) >= 0.25) badges.push("Profit machine");
    if (row.closes >= 3 && (winRate ?? 0) >= 0.6) badges.push("Consistent");
    if (maximumVolume > 0 && volumeHoodie >= maximumVolume * 0.5) {
      badges.push("Volume");
    }
    if (row.markets.size >= 3) badges.push("Explorer");
    if (row.days.size >= 5) badges.push("Regular");

    return {
      address: row.address,
      score: Math.round(score),
      realizedRaw: row.realized.toString(),
      realizedHoodie,
      unrealizedRaw: row.unrealized.toString(),
      unrealizedHoodie: toHoodie(row.unrealized),
      roiPercent: roi === null ? null : roi * 100,
      winRatePercent: winRate === null ? null : winRate * 100,
      volumeHoodie,
      trades: row.trades,
      markets: row.markets.size,
      activeDays: row.days.size,
      bestTradeHoodie: toHoodie(row.bestTrade),
      badges,
    };
  });

  return scored
    .sort((first, second) =>
      second.score - first.score ||
      second.realizedHoodie - first.realizedHoodie ||
      second.volumeHoodie - first.volumeHoodie)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function buildCreatorLeaderboard(
  launches: HoodiePadLaunch[],
): CreatorRow[] {
  type Accumulator = {
    address: Address;
    markets: number;
    activeMarkets: number;
    volume: bigint;
    feeVolume: bigint;
    trades: number;
    topVolume: bigint;
    topSymbol: string;
    topImageUrl?: string;
    lastLaunchTimestamp: number;
  };
  const creators = new Map<string, Accumulator>();

  for (const launch of launches) {
    const key = launch.creator.toLowerCase();
    let creator = creators.get(key);
    if (!creator) {
      creator = {
        address: getAddress(launch.creator),
        markets: 0,
        activeMarkets: 0,
        volume: 0n,
        feeVolume: 0n,
        trades: 0,
        topVolume: -1n,
        topSymbol: launch.symbol,
        topImageUrl: launch.imageUrl,
        lastLaunchTimestamp: 0,
      };
      creators.set(key, creator);
    }
    const volume = BigInt(launch.analytics.hoodieVolumeRaw);
    creator.markets += 1;
    if (launch.hasSwapActivity) creator.activeMarkets += 1;
    creator.volume += volume;
    creator.feeVolume += BigInt(launch.analytics.hoodieFeeVolumeRaw);
    creator.trades += launch.analytics.swapCount;
    creator.lastLaunchTimestamp = Math.max(
      creator.lastLaunchTimestamp,
      launch.launchTimestamp,
    );
    if (volume > creator.topVolume) {
      creator.topVolume = volume;
      creator.topSymbol = launch.symbol;
      creator.topImageUrl = launch.imageUrl;
    }
  }

  return [...creators.values()]
    .map((creator) => {
      // Same estimate the analytics page uses: the HOODIE-side fee at the
      // immutable 80% creator share.
      const fees = creator.feeVolume *
        BigInt(product.market.lpFee) *
        BigInt(product.fees.creator) /
        POOL_FEE_DENOMINATOR /
        WAD;
      return {
        address: creator.address,
        markets: creator.markets,
        activeMarkets: creator.activeMarkets,
        volumeHoodie: toHoodie(creator.volume),
        feesHoodie: toHoodie(fees),
        trades: creator.trades,
        topSymbol: creator.topSymbol,
        topImageUrl: creator.topImageUrl,
        lastLaunchTimestamp: creator.lastLaunchTimestamp,
      };
    })
    .sort((first, second) =>
      second.feesHoodie - first.feesHoodie ||
      second.volumeHoodie - first.volumeHoodie ||
      second.markets - first.markets)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
