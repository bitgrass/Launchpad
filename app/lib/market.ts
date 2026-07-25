import {
  airlockAbi,
  dopplerERC20V1Abi,
  uniswapV3PoolAbi,
} from "@whetstone-research/doppler-sdk/evm";
import {
  formatUnits,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import product from "../../config/hoodiepad-v1.json";
import {
  getStoredObject,
  ObjectStorageUnavailableError,
} from "./object-storage";
import { createRobinhoodPublicClient } from "./protocol";
import {
  LEGACY_V3_MARKET_VERSION,
  type HoodiePadMarketVersion,
} from "./market-version";

const metadataKeyPattern = /^token-metadata\/[a-f0-9]{64}\.json$/;
const artworkKeyPattern = /^token-artwork\/[a-f0-9]{64}\.(jpg|png|webp)$/;
const poolActivityAbi = parseAbi([
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
]);

export type TokenMetadata = {
  name?: unknown;
  symbol?: unknown;
  description?: unknown;
  image?: unknown;
  external_url?: unknown;
  properties?: {
    x_url?: unknown;
    launchpad?: unknown;
    chain_id?: unknown;
    canonical_numeraire?: unknown;
    market_version?: unknown;
    curve_version?: unknown;
    config_hash?: unknown;
    target_opening_fdv_usd?: unknown;
  };
};

export type HoodiePadMarket = {
  version: HoodiePadMarketVersion;
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  totalSupplyRaw: string;
  tokenUri: string;
  description: string;
  imageUrl?: string;
  websiteUrl?: string;
  xUrl?: string;
  integrator: Address;
  pool: Hex;
  poolId?: Hex;
  initializer: Address;
  externalHook?: Address;
  poolFee: number;
  poolLiquidity: string;
  hasSwapActivity: boolean;
  tick: number;
  hoodiePerToken: string;
  fdvHoodie: string;
  maxBalance: string;
  maxBalanceRaw: string;
  balanceLimitEnd: number;
  balanceLimitActive: boolean;
  poolLocked: boolean;
  official: boolean;
};

export function isSameAddress(first: string, second: string) {
  return first.toLowerCase() === second.toLowerCase();
}

export function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "Unavailable";
  if (value < 0.000001) return value.toExponential(4);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 1 ? 8 : 4,
  }).format(value);
}

export function formatCompactValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

export async function readHoodiePadMetadata(tokenUri: string): Promise<TokenMetadata | null> {
  try {
    const parsed = new URL(tokenUri);
    const key = parsed.pathname === "/api/metadata"
      ? parsed.searchParams.get("key") ?? ""
      : "";
    if (!metadataKeyPattern.test(key)) return null;

    const object = await getStoredObject(key);
    if (!object) return null;
    return JSON.parse(await new Response(object.body).text()) as TokenMetadata;
  } catch (error) {
    if (error instanceof ObjectStorageUnavailableError) return null;
    return null;
  }
}

export function metadataImageUrl(metadata: TokenMetadata | null) {
  const value = safeHttpUrl(metadata?.image);
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    const key = parsed.pathname === "/api/artwork"
      ? parsed.searchParams.get("key") ?? ""
      : "";
    return artworkKeyPattern.test(key)
      ? `/api/artwork?key=${encodeURIComponent(key)}`
      : undefined;
  } catch {
    return undefined;
  }
}

export async function readHoodiePadMarket(
  rawAddress: string,
  client = createRobinhoodPublicClient(),
): Promise<HoodiePadMarket> {
  const address = getAddress(rawAddress);
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error("No token contract exists at this address");

  const [
    name,
    symbol,
    decimals,
    totalSupply,
    tokenUri,
    maxBalance,
    balanceLimitEnd,
    balanceLimitActive,
    poolLocked,
    assetData,
  ] = await Promise.all([
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "name" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "symbol" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "decimals" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "totalSupply" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "tokenURI" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "maxBalanceLimit" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "balanceLimitEnd" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "isBalanceLimitActive" }),
    client.readContract({ address, abi: dopplerERC20V1Abi, functionName: "isPoolLocked" }),
    client.readContract({
      address: getAddress(product.contracts.airlock),
      abi: airlockAbi,
      functionName: "getAssetData",
      args: [address],
    }),
  ]);

  const pool = getAddress(assetData[5]);
  const [
    token0,
    token1,
    poolFee,
    poolLiquidity,
    slot0,
    feeGrowthToken,
    feeGrowthHoodie,
  ] = await Promise.all([
    client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: "token0" }),
    client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: "token1" }),
    client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: "fee" }),
    client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: "liquidity" }),
    client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: "slot0" }),
    client.readContract({ address: pool, abi: poolActivityAbi, functionName: "feeGrowthGlobal0X128" }),
    client.readContract({ address: pool, abi: poolActivityAbi, functionName: "feeGrowthGlobal1X128" }),
  ]);

  const metadata = await readHoodiePadMetadata(tokenUri);
  const hoodiePerToken = Math.pow(1.0001, Number(slot0[1]));
  const fdvHoodie =
    hoodiePerToken * Number(formatUnits(totalSupply, decimals));
  const official =
    isSameAddress(assetData[0], product.contracts.hoodie) &&
    isSameAddress(assetData[3], product.contracts.noOpMigrator) &&
    isSameAddress(assetData[4], product.contracts.lockableV3Initializer) &&
    isSameAddress(token0, address) &&
    isSameAddress(token1, product.contracts.hoodie) &&
    Number(poolFee) === product.pool.fee &&
    totalSupply === BigInt(product.token.totalSupplyTokens) * 10n ** BigInt(decimals) &&
    metadata?.properties?.launchpad === "HoodiePad" &&
    metadata?.properties?.chain_id === product.network.chainId &&
    typeof metadata?.properties?.canonical_numeraire === "string" &&
    isSameAddress(metadata.properties.canonical_numeraire, product.contracts.hoodie);

  return {
    version: LEGACY_V3_MARKET_VERSION,
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
    integrator: getAddress(assetData[9]),
    pool,
    initializer: getAddress(product.contracts.lockableV3Initializer),
    poolFee: Number(poolFee),
    poolLiquidity: poolLiquidity.toString(),
    hasSwapActivity: feeGrowthToken > 0n || feeGrowthHoodie > 0n,
    tick: Number(slot0[1]),
    hoodiePerToken: formatPrice(hoodiePerToken),
    fdvHoodie: formatCompactValue(fdvHoodie),
    maxBalance: formatUnits(maxBalance, decimals),
    maxBalanceRaw: maxBalance.toString(),
    balanceLimitEnd: Number(balanceLimitEnd),
    balanceLimitActive,
    poolLocked,
    official,
  };
}
