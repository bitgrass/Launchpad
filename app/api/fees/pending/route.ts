import { DopplerSDK, type V4PoolKey } from "@whetstone-research/doppler-sdk/evm";
import { formatUnits, getAddress } from "viem";
import { readHoodiePadLaunches } from "../../../lib/launches";
import { createRobinhoodPublicClient, ROBINHOOD_CHAIN_ID } from "../../../lib/protocol";

export const revalidate = 0;

type MulticurvePool = Awaited<ReturnType<DopplerSDK["getMulticurvePool"]>>;

declare global {
  var __hoodiepadFeePoolCache: Map<string, MulticurvePool> | undefined;
}

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

function formatFeeAmount(raw: bigint) {
  const value = Number(formatUnits(raw, 18));
  if (!Number.isFinite(value)) return "0";
  if (value === 0) return "0";
  if (value < 0.0001) return "<0.0001";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 4 : 6,
  }).format(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawAccount = url.searchParams.get("account") ?? "";
  if (!addressPattern.test(rawAccount)) {
    return Response.json({ error: "Invalid account address" }, { status: 422 });
  }
  const account = getAddress(rawAccount);

  // The SDK's pool discovery re-reads initializer state on every lookup;
  // pool objects are stateless wrappers, so cache them per token.
  const poolCache = globalThis.__hoodiepadFeePoolCache ??= new Map();

  try {
    const launches = await readHoodiePadLaunches();
    const client = createRobinhoodPublicClient();
    const sdk = new DopplerSDK({
      publicClient: client,
      chainId: ROBINHOOD_CHAIN_ID,
    });
    const entries = await Promise.all(launches.map(async (rawLaunch) => {
      if (!("poolKey" in rawLaunch)) return null;
      const launch = rawLaunch as typeof rawLaunch & {
        poolKey: V4PoolKey;
        poolId: string;
      };
      const isCreator =
        launch.creator.toLowerCase() === account.toLowerCase();
      try {
        const poolKey = launch.address.toLowerCase();
        let pool = poolCache.get(poolKey);
        if (!pool) {
          pool = await sdk.getMulticurvePool(getAddress(launch.address));
          poolCache.set(poolKey, pool);
        }
        const pending = await pool.getPendingFees(account);
        // fees0/fees1 follow poolKey currency order; map to token/HOODIE.
        const childIsCurrency0 =
          launch.poolKey.currency0.toLowerCase() ===
          launch.address.toLowerCase();
        const pendingToken = childIsCurrency0 ? pending.fees0 : pending.fees1;
        const pendingHoodie = childIsCurrency0 ? pending.fees1 : pending.fees0;
        if (!isCreator && pendingToken === 0n && pendingHoodie === 0n) {
          return null;
        }
        return {
          token: launch.address,
          symbol: launch.symbol,
          name: launch.name,
          imageUrl: launch.imageUrl,
          poolId: launch.poolId,
          isCreator,
          pendingTokenRaw: pendingToken.toString(),
          pendingToken: formatFeeAmount(pendingToken),
          pendingHoodieRaw: pendingHoodie.toString(),
          pendingHoodie: formatFeeAmount(pendingHoodie),
        };
      } catch {
        // A single unreadable pool must not hide the others.
        return isCreator
          ? {
              token: launch.address,
              symbol: launch.symbol,
              name: launch.name,
              imageUrl: launch.imageUrl,
              poolId: launch.poolId,
              isCreator,
              pendingTokenRaw: "0",
              pendingToken: "—",
              pendingHoodieRaw: "0",
              pendingHoodie: "—",
            }
          : null;
      }
    }));
    return Response.json(
      {
        account,
        markets: entries.filter((entry) => entry !== null),
        refreshedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Pending fee lookup is temporarily unavailable" },
      { status: 503 },
    );
  }
}
