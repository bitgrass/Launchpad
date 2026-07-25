import { formatUnits } from "viem";
import product from "../../config/hoodiepad-v2.json";
import {
  readHoodiePadLaunches,
  type HoodiePadLaunch,
} from "./launches";

const WAD = BigInt(product.fees.wad);
const POOL_FEE_DENOMINATOR = 1_000_000n;
const DAY_SECONDS = 24 * 60 * 60;

export type ProtocolAnalyticsMetrics = {
  hoodieVolumeRaw: string;
  hoodieVolume: string;
  launches: number;
  trades: number;
  activeMarkets: number;
  uniqueCreators: number;
  creatorFeesHoodieRaw: string;
  creatorFeesHoodie: string;
  ecosystemFeesHoodieRaw: string;
  ecosystemFeesHoodie: string;
  dopplerFeesHoodieRaw: string;
  dopplerFeesHoodie: string;
};

export type ProtocolDailyActivity = {
  date: string;
  hoodieVolumeRaw: string;
  hoodieVolume: string;
  launches: number;
  trades: number;
};

export type ProtocolAnalytics = {
  asOf: string;
  source: "Robinhood Chain RPC";
  allTime: ProtocolAnalyticsMetrics;
  rolling24h: ProtocolAnalyticsMetrics;
  daily: ProtocolDailyActivity[];
};

function formatTokenAmount(raw: bigint) {
  const value = Number(formatUnits(raw, 18));
  if (!Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 4,
  }).format(value);
}

function estimatedBeneficiaryFee(feeBearingVolume: bigint, shares: string) {
  return feeBearingVolume
    * BigInt(product.market.lpFee)
    * BigInt(shares)
    / POOL_FEE_DENOMINATOR
    / WAD;
}

function makeMetrics(
  launches: HoodiePadLaunch[],
  input: {
    hoodieVolumeRaw: bigint;
    hoodieFeeVolumeRaw: bigint;
    trades: number;
    activeMarkets: number;
  },
): ProtocolAnalyticsMetrics {
  const uniqueCreators = new Set(
    launches.map((launch) => launch.creator.toLowerCase()),
  ).size;
  const creatorFees = estimatedBeneficiaryFee(
    input.hoodieFeeVolumeRaw,
    product.fees.creator,
  );
  const ecosystemFees = estimatedBeneficiaryFee(
    input.hoodieFeeVolumeRaw,
    product.fees.hoodieEcosystem,
  );
  const dopplerFees = estimatedBeneficiaryFee(
    input.hoodieFeeVolumeRaw,
    product.fees.doppler,
  );

  return {
    hoodieVolumeRaw: input.hoodieVolumeRaw.toString(),
    hoodieVolume: formatTokenAmount(input.hoodieVolumeRaw),
    launches: launches.length,
    trades: input.trades,
    activeMarkets: input.activeMarkets,
    uniqueCreators,
    creatorFeesHoodieRaw: creatorFees.toString(),
    creatorFeesHoodie: formatTokenAmount(creatorFees),
    ecosystemFeesHoodieRaw: ecosystemFees.toString(),
    ecosystemFeesHoodie: formatTokenAmount(ecosystemFees),
    dopplerFeesHoodieRaw: dopplerFees.toString(),
    dopplerFeesHoodie: formatTokenAmount(dopplerFees),
  };
}

function utcDate(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export async function readProtocolAnalytics(): Promise<ProtocolAnalytics> {
  const launches = await readHoodiePadLaunches();
  const now = Math.floor(Date.now() / 1000);
  const cutoff24h = now - DAY_SECONDS;
  const recentLaunches = launches.filter(
    (launch) => launch.launchTimestamp >= cutoff24h,
  );
  const allTimeVolume = launches.reduce(
    (total, launch) => total + BigInt(launch.analytics.hoodieVolumeRaw),
    0n,
  );
  const recentVolume = launches.reduce(
    (total, launch) => total + BigInt(launch.analytics.hoodieVolume24hRaw),
    0n,
  );
  const allTimeFeeVolume = launches.reduce(
    (total, launch) => total + BigInt(launch.analytics.hoodieFeeVolumeRaw),
    0n,
  );
  const recentFeeVolume = launches.reduce(
    (total, launch) => total + BigInt(launch.analytics.hoodieFeeVolume24hRaw),
    0n,
  );

  const daily = new Map<string, {
    hoodieVolumeRaw: bigint;
    launches: number;
    trades: number;
  }>();
  for (let offset = 7; offset >= 0; offset -= 1) {
    const timestamp = now - offset * DAY_SECONDS;
    daily.set(utcDate(timestamp), {
      hoodieVolumeRaw: 0n,
      launches: 0,
      trades: 0,
    });
  }
  for (const launch of launches) {
    const launchDay = utcDate(launch.launchTimestamp);
    const launchActivity = daily.get(launchDay);
    if (launchActivity) launchActivity.launches += 1;
    for (const activity of launch.analytics.daily) {
      const day = daily.get(activity.date);
      if (!day) continue;
      day.hoodieVolumeRaw += BigInt(activity.hoodieVolumeRaw);
      day.trades += activity.swaps;
    }
  }

  return {
    asOf: new Date().toISOString(),
    source: "Robinhood Chain RPC",
    allTime: makeMetrics(launches, {
      hoodieVolumeRaw: allTimeVolume,
      hoodieFeeVolumeRaw: allTimeFeeVolume,
      trades: launches.reduce(
        (total, launch) => total + launch.analytics.swapCount,
        0,
      ),
      activeMarkets: launches.filter((launch) => launch.hasSwapActivity).length,
    }),
    rolling24h: makeMetrics(recentLaunches, {
      hoodieVolumeRaw: recentVolume,
      hoodieFeeVolumeRaw: recentFeeVolume,
      trades: launches.reduce(
        (total, launch) => total + launch.analytics.swapCount24h,
        0,
      ),
      activeMarkets: launches.filter(
        (launch) => launch.analytics.swapCount24h > 0,
      ).length,
    }),
    daily: [...daily.entries()].map(([date, activity]) => ({
      date,
      hoodieVolumeRaw: activity.hoodieVolumeRaw.toString(),
      hoodieVolume: formatTokenAmount(activity.hoodieVolumeRaw),
      launches: activity.launches,
      trades: activity.trades,
    })),
  };
}
