import {
  airlockAbi,
  computePoolId,
  dopplerERC20V1Abi,
  dopplerHookInitializerAbi,
  rehypeDopplerHookAbi,
  type V4PoolKey,
} from "@whetstone-research/doppler-sdk/evm";
import {
  formatUnits,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import product from "../../config/hoodiepad-v2.json";
import {
  formatCompactValue,
  formatPrice,
  isSameAddress,
  metadataImageUrl,
  readHoodiePadMetadata,
  safeHttpUrl,
  type HoodiePadMarket,
  type TokenMetadata,
} from "./market";
import { PUBLIC_V4_MARKET_VERSION } from "./market-version";
import { createRobinhoodPublicClient } from "./protocol";
import {
  calculateFdv,
  formatRational,
  invertRational,
  sqrtPriceX96ToCurrency1PerCurrency0,
} from "./v4-price";
import {
  V4_DYNAMIC_FEE_FLAG,
  V4_LP_FEE,
  V4_MAX_WALLET,
  V4_TICK_SPACING,
  V4_TOKENS_TO_SELL,
  V4_TOTAL_SUPPLY,
} from "./v4-policy";

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

const zeroAddress = "0x0000000000000000000000000000000000000000";

export type HoodiePadV4Market = HoodiePadMarket & {
  version: typeof PUBLIC_V4_MARKET_VERSION;
  poolId: Hex;
  poolKey: V4PoolKey;
  externalHook: Address;
  totalTokensOnBondingCurveRaw: string;
  rehypeStartFee: number;
  rehypeEndFee: number;
  validationErrors: string[];
};

// The Rehype hook stamps the pool-initialization timestamp into the fee
// schedule even when the launch requests startingTime 0, so a no-decay
// schedule is valid whenever the recorded time is not in the future. A
// non-zero configured value still requires an exact match.
export function isRehypeStartingTimeValid(
  configuredStartingTime: number,
  onChainStartingTime: number,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (configuredStartingTime === 0) {
    return onChainStartingTime >= 0 && onChainStartingTime <= nowSeconds + 300;
  }
  return onChainStartingTime === configuredStartingTime;
}

export function v4PriceForMarket(
  poolKey: V4PoolKey,
  sqrtPriceX96: bigint,
  child: Address,
  childDecimals: number,
) {
  const currency1PerCurrency0 = sqrtPriceX96ToCurrency1PerCurrency0(
    sqrtPriceX96,
    isSameAddress(poolKey.currency0, child) ? childDecimals : 18,
    isSameAddress(poolKey.currency1, child) ? childDecimals : 18,
  );
  if (
    isSameAddress(poolKey.currency0, child) &&
    isSameAddress(poolKey.currency1, product.contracts.hoodie)
  ) {
    return currency1PerCurrency0;
  }
  if (
    isSameAddress(poolKey.currency1, child) &&
    isSameAddress(poolKey.currency0, product.contracts.hoodie)
  ) {
    return invertRational(currency1PerCurrency0);
  }
  throw new Error("V4 PoolKey is not the canonical CHILD/HOODIE pair");
}

function compactRational(value: ReturnType<typeof calculateFdv>) {
  const decimal = formatRational(value, 8);
  return formatCompactValue(Number(decimal));
}

// Everything a validated market never changes after launch: token facts,
// Airlock and initializer state, the Rehype fee configuration, and the
// immutable content-addressed metadata. Reading this once per process (and
// only re-reading live pool state each refresh) is the main RPC saving.
async function readV4MarketStaticsInner(
  address: Address,
  client: ReturnType<typeof createRobinhoodPublicClient>,
) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    throw new Error("No token contract exists at this address");
  }

  const [
    name,
    symbol,
    decimals,
    totalSupply,
    tokenUri,
    maxBalance,
    balanceLimitEnd,
    controller,
    vestingScheduleCount,
    poolLocked,
    assetData,
    state,
  ] = await Promise.all([
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "name" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "symbol" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "decimals" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "totalSupply" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "tokenURI" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "maxBalanceLimit" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "balanceLimitEnd" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "controller" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "vestingScheduleCount" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "isPoolLocked" }),
    client.readContract({
      address: getAddress(product.contracts.airlock),
      abi: airlockAbi,
      functionName: "getAssetData",
      args: [address],
    }),
    client.readContract({
      address: getAddress(product.contracts.dopplerHookInitializer),
      abi: dopplerHookInitializerAbi,
      functionName: "getState",
      args: [address],
    }),
  ]);

  const poolKey = {
    currency0: getAddress(state[5].currency0),
    currency1: getAddress(state[5].currency1),
    fee: Number(state[5].fee),
    tickSpacing: Number(state[5].tickSpacing),
    hooks: getAddress(state[5].hooks),
  } satisfies V4PoolKey;
  const poolId = computePoolId(poolKey);
  const externalHook = getAddress(state[2]);
  const [
    feeSchedule,
    feeRoutingMode,
    feeDistributionInfo,
    hookPoolInfo,
    metadata,
  ] = await Promise.all([
    client.readContract({
      address: externalHook,
      abi: rehypeDopplerHookAbi,
      functionName: "getFeeSchedule",
      args: [poolId],
    }),
    client.readContract({
      address: externalHook,
      abi: rehypeDopplerHookAbi,
      functionName: "getFeeRoutingMode",
      args: [poolId],
    }),
    client.readContract({
      address: externalHook,
      abi: rehypeDopplerHookAbi,
      functionName: "getFeeDistributionInfo",
      args: [poolId],
    }),
    client.readContract({
      address: externalHook,
      abi: rehypeDopplerHookAbi,
      functionName: "getPoolInfo",
      args: [poolId],
    }),
    readHoodiePadMetadata(tokenUri) as Promise<TokenMetadata | null>,
  ]);

  return {
    name,
    symbol,
    decimals,
    totalSupply,
    tokenUri,
    maxBalance,
    balanceLimitEnd,
    controller,
    vestingScheduleCount,
    poolLocked,
    assetData,
    state,
    poolKey,
    poolId,
    externalHook,
    feeSchedule,
    feeRoutingMode,
    feeDistributionInfo,
    hookPoolInfo,
    metadata,
  };
}

export type V4MarketStatics = Awaited<ReturnType<typeof readV4MarketStaticsInner>>;

export async function readHoodiePadV4Market(
  rawAddress: string,
  client = createRobinhoodPublicClient(),
  staticsCache?: Map<string, V4MarketStatics>,
): Promise<HoodiePadV4Market> {
  const address = getAddress(rawAddress);
  const cacheKey = address.toLowerCase();
  let statics = staticsCache?.get(cacheKey);
  const staticsWereCached = statics !== undefined;
  if (!statics) {
    statics = await readV4MarketStaticsInner(address, client);
  }
  const {
    name,
    symbol,
    decimals,
    totalSupply,
    tokenUri,
    maxBalance,
    balanceLimitEnd,
    controller,
    vestingScheduleCount,
    poolLocked,
    assetData,
    state,
    poolKey,
    poolId,
    externalHook,
    feeSchedule,
    feeRoutingMode,
    feeDistributionInfo,
    hookPoolInfo,
    metadata,
  } = statics;

  const [slot0, poolLiquidity] = await Promise.all([
    client.readContract({
      address: getAddress(product.contracts.uniswapV4StateView),
      abi: stateViewAbi,
      functionName: "getSlot0",
      args: [poolId],
    }),
    client.readContract({
      address: getAddress(product.contracts.uniswapV4StateView),
      abi: stateViewAbi,
      functionName: "getLiquidity",
      args: [poolId],
    }),
  ]);
  // The balance limit has a zero controller (enforced below), so its active
  // window is purely time-derived and needs no per-refresh contract read.
  const balanceLimitActive =
    Math.floor(Date.now() / 1000) < Number(balanceLimitEnd);

  const hoodiePerToken = v4PriceForMarket(
    poolKey,
    slot0[0],
    address,
    decimals,
  );
  const fdvHoodie = calculateFdv(hoodiePerToken, totalSupply, decimals);
  const configuredDistribution = product.rehype.feeDistributionInfo;
  const rehypeStartingTimeValid = isRehypeStartingTimeValid(
    product.rehype.startingTime,
    Number(feeSchedule[0]),
  );
  const validationChecks: Array<[string, boolean]> = [
    ["Airlock numeraire", isSameAddress(assetData[0], product.contracts.hoodie)],
    ["NoOp migrator", isSameAddress(assetData[3], product.contracts.noOpMigrator)],
    [
      "Doppler V4 initializer",
      isSameAddress(assetData[4], product.contracts.dopplerHookInitializer),
    ],
    ["Airlock tokens to sell", BigInt(assetData[7]) === V4_TOKENS_TO_SELL],
    ["Airlock total supply", BigInt(assetData[8]) === V4_TOTAL_SUPPLY],
    ["Hook numeraire", isSameAddress(state[0], product.contracts.hoodie)],
    ["Hook market inventory", BigInt(state[1]) === V4_TOKENS_TO_SELL],
    ["Locked pool status", Number(state[4]) === 2],
    [
      "PoolKey hooks",
      isSameAddress(poolKey.hooks, product.contracts.dopplerHookInitializer),
    ],
    ["PoolKey dynamic fee flag", poolKey.fee === V4_DYNAMIC_FEE_FLAG],
    ["PoolKey tick spacing", poolKey.tickSpacing === V4_TICK_SPACING],
    ["Active LP fee", Number(slot0[3]) === V4_LP_FEE],
    ["Rehype starting time", rehypeStartingTimeValid],
    ["Rehype start fee", Number(feeSchedule[1]) === 0],
    ["Rehype end fee", Number(feeSchedule[2]) === 0],
    ["Rehype minimum fee", Number(feeSchedule[3]) === 0],
    [
      "Rehype fee duration",
      Number(feeSchedule[4]) === product.rehype.durationSeconds,
    ],
    ["Rehype beneficiary routing mode", Number(feeRoutingMode) === 1],
    [
      "Asset fee asset-buyback distribution",
      BigInt(feeDistributionInfo[0]) ===
        BigInt(configuredDistribution.assetFeesToAssetBuybackWad),
    ],
    [
      "Asset fee numeraire-buyback distribution",
      BigInt(feeDistributionInfo[1]) ===
        BigInt(configuredDistribution.assetFeesToNumeraireBuybackWad),
    ],
    [
      "Asset fee beneficiary distribution",
      BigInt(feeDistributionInfo[2]) ===
        BigInt(configuredDistribution.assetFeesToBeneficiaryWad),
    ],
    [
      "Asset fee LP distribution",
      BigInt(feeDistributionInfo[3]) ===
        BigInt(configuredDistribution.assetFeesToLpWad),
    ],
    [
      "Numeraire fee asset-buyback distribution",
      BigInt(feeDistributionInfo[4]) ===
        BigInt(configuredDistribution.numeraireFeesToAssetBuybackWad),
    ],
    [
      "Numeraire fee numeraire-buyback distribution",
      BigInt(feeDistributionInfo[5]) ===
        BigInt(configuredDistribution.numeraireFeesToNumeraireBuybackWad),
    ],
    [
      "Numeraire fee beneficiary distribution",
      BigInt(feeDistributionInfo[6]) ===
        BigInt(configuredDistribution.numeraireFeesToBeneficiaryWad),
    ],
    [
      "Numeraire fee LP distribution",
      BigInt(feeDistributionInfo[7]) ===
        BigInt(configuredDistribution.numeraireFeesToLpWad),
    ],
    ["Rehype asset", isSameAddress(hookPoolInfo[0], address)],
    [
      "Rehype numeraire",
      isSameAddress(hookPoolInfo[1], product.contracts.hoodie),
    ],
    ["Token total supply", totalSupply === V4_TOTAL_SUPPLY],
    ["Token maximum wallet", maxBalance === V4_MAX_WALLET],
    ["Zero balance-limit controller", isSameAddress(controller, zeroAddress)],
    ["No vesting schedules", vestingScheduleCount === 0n],
    ["Token pool lock", poolLocked],
    ["HoodiePad metadata provenance", metadata?.properties?.launchpad === "HoodiePad"],
    ["Metadata chain ID", metadata?.properties?.chain_id === product.network.chainId],
    [
      "Metadata canonical numeraire",
      typeof metadata?.properties?.canonical_numeraire === "string" &&
        isSameAddress(
          metadata.properties.canonical_numeraire,
          product.contracts.hoodie,
        ),
    ],
  ];
  const validationErrors = validationChecks
    .filter(([, passed]) => !passed)
    .map(([label]) => label);
  const official = validationErrors.length === 0;
  // Only fully validated markets are safe to serve from cached statics.
  if (official && staticsCache && !staticsWereCached) {
    staticsCache.set(cacheKey, statics);
  }

  return {
    version: PUBLIC_V4_MARKET_VERSION,
    address,
    name,
    symbol,
    decimals,
    totalSupply: formatUnits(totalSupply, decimals),
    totalSupplyRaw: totalSupply.toString(),
    tokenUri,
    description:
      typeof metadata?.description === "string" ? metadata.description : "",
    imageUrl: metadataImageUrl(metadata),
    websiteUrl: safeHttpUrl(metadata?.external_url),
    xUrl: safeHttpUrl(metadata?.properties?.x_url),
    telegramUrl: safeHttpUrl(metadata?.properties?.tg_url),
    integrator: getAddress(assetData[9]),
    pool: poolId,
    poolId,
    poolKey,
    initializer: getAddress(product.contracts.dopplerHookInitializer),
    externalHook,
    totalTokensOnBondingCurveRaw: BigInt(state[1]).toString(),
    poolFee: Number(slot0[3]),
    poolLiquidity: poolLiquidity.toString(),
    hasSwapActivity: false,
    tick: Number(slot0[1]),
    hoodiePerToken: formatPrice(Number(formatRational(hoodiePerToken, 18))),
    fdvHoodie: compactRational(fdvHoodie),
    maxBalance: formatUnits(maxBalance, decimals),
    maxBalanceRaw: maxBalance.toString(),
    balanceLimitEnd: Number(balanceLimitEnd),
    balanceLimitActive,
    poolLocked,
    rehypeStartFee: Number(feeSchedule[1]),
    rehypeEndFee: Number(feeSchedule[2]),
    validationErrors,
    official,
  };
}

export async function readVersionedHoodiePadMarket(
  rawAddress: string,
  client = createRobinhoodPublicClient(),
): Promise<HoodiePadV4Market | HoodiePadMarket> {
  const address = getAddress(rawAddress);
  const assetData = await client.readContract({
    address: getAddress(product.contracts.airlock),
    abi: airlockAbi,
    functionName: "getAssetData",
    args: [address],
  });
  if (isSameAddress(assetData[4], product.contracts.dopplerHookInitializer)) {
    return readHoodiePadV4Market(address, client);
  }
  const { readHoodiePadMarket } = await import("./market");
  return readHoodiePadMarket(address, client);
}

export { zeroAddress };
