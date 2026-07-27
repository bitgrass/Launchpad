import { DopplerSDK, type V4PoolKey } from "@whetstone-research/doppler-sdk/evm";
import { formatUnits, getAddress, parseAbi, type Address } from "viem";
import product from "../../config/hoodiepad-v2.json";
import ledger from "../../config/hoodie-fuel-distributions.json";
import { readDisplayPrices } from "./display-prices";
import { readHoodiePadLaunches, type HoodiePadLaunch } from "./launches";
import { createRobinhoodPublicClient, ROBINHOOD_CHAIN_ID } from "./protocol";

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

const WAD = 10n ** 18n;
const POOL_FEE_DENOMINATOR = 1_000_000n;

export type FuelDistribution = {
  date: string;
  kind: string;
  amount: string;
  asset: string;
  transactionHash: string;
  note?: string;
};

export type FuelSnapshot = {
  hoodieUsd: number | null;
  volume: { allTimeHoodie: number; last24hHoodie: number };
  fees: {
    totalHoodie: number;
    creatorHoodie: number;
    ecosystemHoodie: number;
    protocolHoodie: number;
  };
  ecosystemSafe: {
    address: Address;
    hoodieBalance: number;
    claimableHoodie: number;
    claimableTokens: Array<{ symbol: string; amount: number }>;
    tokenPositions: Array<{ symbol: string; token: string; amount: number }>;
  };
  markets: number;
  trades: number;
  distributions: FuelDistribution[];
  refreshedAt: string;
};

let cached: { expiresAt: number; promise: Promise<FuelSnapshot> } | undefined;

function toNumber(raw: bigint) {
  const value = Number(formatUnits(raw, 18));
  return Number.isFinite(value) ? value : 0;
}

async function loadFuelSnapshot(): Promise<FuelSnapshot> {
  const [launches, prices] = await Promise.all([
    readHoodiePadLaunches().catch(() => [] as HoodiePadLaunch[]),
    readDisplayPrices().catch(() => ({ ethUsd: null, hoodieUsd: null })),
  ]);

  const feeVolume = launches.reduce(
    (total, launch) => total + BigInt(launch.analytics.hoodieFeeVolumeRaw),
    0n,
  );
  const volumeAllTime = launches.reduce(
    (total, launch) => total + BigInt(launch.analytics.hoodieVolumeRaw),
    0n,
  );
  const volume24h = launches.reduce(
    (total, launch) => total + BigInt(launch.analytics.hoodieVolume24hRaw),
    0n,
  );
  const trades = launches.reduce(
    (total, launch) => total + launch.analytics.swapCount,
    0,
  );

  // Same estimator the analytics page uses: HOODIE-side fee-bearing volume at
  // the immutable share weights. Token-side fees accrue separately and are not
  // converted here.
  const shareOf = (share: string) =>
    feeVolume * BigInt(product.market.lpFee) * BigInt(share) /
    POOL_FEE_DENOMINATOR / WAD;
  const totalFees = feeVolume * BigInt(product.market.lpFee) /
    POOL_FEE_DENOMINATOR;

  const safe = getAddress(product.contracts.hoodieEcosystemSafe);
  let hoodieBalance = 0n;
  const tokenPositions: FuelSnapshot["ecosystemSafe"]["tokenPositions"] = [];
  const claimableTokens: FuelSnapshot["ecosystemSafe"]["claimableTokens"] = [];
  let claimableHoodie = 0n;

  try {
    const client = createRobinhoodPublicClient();
    const sdk = new DopplerSDK({
      publicClient: client,
      chainId: ROBINHOOD_CHAIN_ID,
    });
    const [safeHoodie, ...balances] = await Promise.all([
      client.readContract({
        address: getAddress(product.contracts.hoodie),
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [safe],
      }),
      ...launches.map((launch) =>
        client.readContract({
          address: getAddress(launch.address),
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [safe],
        })),
    ]);
    hoodieBalance = safeHoodie;
    balances.forEach((balance, index) => {
      const launch = launches[index];
      if (!launch || balance <= 0n) return;
      tokenPositions.push({
        symbol: launch.symbol,
        token: launch.address,
        amount: toNumber(balance),
      });
    });

    // Fees already earned by the Safe but not yet released from the pools.
    const pending = await Promise.all(launches.map(async (launch) => {
      if (!("poolKey" in launch)) return null;
      const typed = launch as HoodiePadLaunch & { poolKey: V4PoolKey };
      try {
        const pool = await sdk.getMulticurvePool(getAddress(launch.address));
        const fees = await pool.getPendingFees(safe);
        const childIsCurrency0 =
          typed.poolKey.currency0.toLowerCase() ===
          launch.address.toLowerCase();
        return {
          symbol: launch.symbol,
          token: childIsCurrency0 ? fees.fees0 : fees.fees1,
          hoodie: childIsCurrency0 ? fees.fees1 : fees.fees0,
        };
      } catch {
        return null;
      }
    }));
    for (const entry of pending) {
      if (!entry) continue;
      claimableHoodie += entry.hoodie;
      if (entry.token > 0n) {
        claimableTokens.push({
          symbol: entry.symbol,
          amount: toNumber(entry.token),
        });
      }
    }
  } catch {
    // Balance and pending reads are enrichment: the fee and volume totals
    // above still render if the chain read fails.
  }

  return {
    hoodieUsd: prices.hoodieUsd,
    volume: {
      allTimeHoodie: toNumber(volumeAllTime),
      last24hHoodie: toNumber(volume24h),
    },
    fees: {
      totalHoodie: toNumber(totalFees),
      creatorHoodie: toNumber(shareOf(product.fees.creator)),
      ecosystemHoodie: toNumber(shareOf(product.fees.hoodieEcosystem)),
      protocolHoodie: toNumber(shareOf(product.fees.doppler)),
    },
    ecosystemSafe: {
      address: safe,
      hoodieBalance: toNumber(hoodieBalance),
      claimableHoodie: toNumber(claimableHoodie),
      claimableTokens,
      tokenPositions,
    },
    markets: launches.length,
    trades,
    distributions: (ledger.distributions ?? []) as FuelDistribution[],
    refreshedAt: new Date().toISOString(),
  };
}

export function readFuelSnapshot() {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = loadFuelSnapshot().catch((error) => {
    cached = undefined;
    throw error;
  });
  cached = { expiresAt: now + 60_000, promise };
  return promise;
}
