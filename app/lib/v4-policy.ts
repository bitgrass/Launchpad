import {
  getAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { computePoolId } from "@whetstone-research/doppler-sdk/evm";
import type { MulticurveMarketCapRangeCurve } from "@whetstone-research/doppler-sdk/evm";
import product from "../../config/hoodiepad-v2.json";
import curve from "../../config/hoodie-v4-curve-v1.json";
import packageManifest from "../../package.json";

export const WAD = BigInt(product.fees.wad);
export const V4_LP_FEE = product.market.lpFee;
export const V4_TICK_SPACING = product.market.tickSpacing;
export const V4_DYNAMIC_FEE_FLAG = product.market.dynamicFeeFlag;
export const V4_TARGET_OPENING_FDV_USD = BigInt(product.market.targetOpeningFdvUsd);
export const V4_TOTAL_SUPPLY = BigInt(product.token.totalSupplyTokens) * 10n ** 18n;
export const V4_TOKENS_TO_SELL = BigInt(product.token.tokensToSell) * 10n ** 18n;
export const V4_MAX_WALLET = BigInt(product.token.maxWalletTokens) * 10n ** 18n;
export const DECLARED_DOPPLER_SDK_VERSION =
  packageManifest.dependencies["@whetstone-research/doppler-sdk"];
export const REQUIRED_V4_RUNTIME_DEPENDENCIES = [
  "hoodie",
  "weth",
  "airlock",
  "dopplerERC20V1Factory",
  "dopplerHookInitializer",
  "rehypeDopplerHookInitializer",
  "noOpGovernanceFactory",
  "noOpMigrator",
  "uniswapV4PoolManager",
  "uniswapV4StateView",
  "uniswapV4Quoter",
  "uniswapUniversalRouter",
  "permit2",
] as const;

export type V4Beneficiary = {
  beneficiary: Address;
  shares: bigint;
};

export function getHoodieReferencePoolKey() {
  const configured = product.hoodieReferencePool.poolKey;
  if (configured === null) {
    throw new Error("The complete HOODIE/WETH V4 PoolKey is not configured");
  }
  return {
    currency0: getAddress(configured.currency0),
    currency1: getAddress(configured.currency1),
    fee: configured.fee,
    tickSpacing: configured.tickSpacing,
    hooks: getAddress(configured.hooks),
  };
}

export function getHoodieReferencePoolId() {
  return computePoolId(getHoodieReferencePoolKey());
}

export function isHoodieReferencePoolKeyValid() {
  const key = getHoodieReferencePoolKey();
  return (
    key.currency0.toLowerCase() === product.contracts.weth.toLowerCase() &&
    key.currency1.toLowerCase() === product.contracts.hoodie.toLowerCase() &&
    key.fee === V4_DYNAMIC_FEE_FLAG &&
    key.tickSpacing === V4_TICK_SPACING &&
    key.hooks.toLowerCase() ===
      product.contracts.dopplerHookInitializer.toLowerCase() &&
    getHoodieReferencePoolId().toLowerCase() ===
      (product.hoodieReferencePool.poolId as Hex).toLowerCase()
  );
}

export function getV4Beneficiaries(
  creator: Address,
  airlockOwner: Address,
): V4Beneficiary[] {
  const beneficiaries = [
    {
      beneficiary: getAddress(creator),
      shares: BigInt(product.fees.creator),
    },
    {
      beneficiary: getAddress(product.contracts.hoodieEcosystemSafe),
      shares: BigInt(product.fees.hoodieEcosystem),
    },
    {
      beneficiary: getAddress(airlockOwner),
      shares: BigInt(product.fees.doppler),
    },
  ];

  const addresses = new Set(
    beneficiaries.map(({ beneficiary }) => beneficiary.toLowerCase()),
  );
  if (addresses.size !== beneficiaries.length) {
    throw new Error("V4 fee beneficiary addresses must be distinct");
  }
  if (
    beneficiaries.reduce((total, beneficiary) => total + beneficiary.shares, 0n) !==
    WAD
  ) {
    throw new Error("V4 fee beneficiary shares must total WAD");
  }

  return beneficiaries.sort((first, second) =>
    first.beneficiary.toLowerCase().localeCompare(second.beneficiary.toLowerCase()),
  );
}

export function getHoodieV4Curve() {
  const curves: MulticurveMarketCapRangeCurve[] = curve.curves.map((item) => {
    const end = item.marketCap.end === "max"
      ? "max"
      : Number(item.marketCap.end);
    if (end !== "max" && !Number.isFinite(end)) {
      throw new Error("HOODIE V4 curve has an invalid terminal market cap");
    }
    return {
      marketCap: {
        start: item.marketCap.start,
        end,
      },
      numPositions: item.numPositions,
      shares: BigInt(item.shares),
    };
  });
  if (curves.length === 0) throw new Error("HOODIE V4 curve is empty");
  if (curves[0]?.marketCap.start !== Number(product.market.targetOpeningFdvUsd)) {
    throw new Error("HOODIE V4 curve does not start at the target opening FDV");
  }
  if (curves.reduce((total, item) => total + item.shares, 0n) !== WAD) {
    throw new Error("HOODIE V4 curve shares must total WAD");
  }
  for (let index = 1; index < curves.length; index += 1) {
    const priorEnd = curves[index - 1]?.marketCap.end;
    if (priorEnd === "max" || priorEnd !== curves[index]?.marketCap.start) {
      throw new Error("HOODIE V4 curve ranges must be contiguous");
    }
  }
  if (curves.at(-1)?.marketCap.end !== "max") {
    throw new Error("HOODIE V4 curve must end at max");
  }
  return curves;
}

export function getV4ConfigHash() {
  return keccak256(stringToHex(JSON.stringify({
    marketVersion: product.marketVersion,
    chainId: product.network.chainId,
    contracts: product.contracts,
    hoodieReferencePool: product.hoodieReferencePool,
    token: product.token,
    market: product.market,
    fees: product.fees,
    rehype: product.rehype,
    pricing: product.pricing,
    curve,
    dependencies: product.dependencies,
  })));
}

export function isV4RuntimeSnapshotApproved() {
  const hashes = product.runtimeHashSnapshot.hashes as Record<string, string>;
  return (
    product.runtimeHashSnapshot.status === "approved" &&
    product.runtimeHashSnapshot.observedAtBlock !== null &&
    REQUIRED_V4_RUNTIME_DEPENDENCIES.every((name) =>
      /^0x[a-fA-F0-9]{64}$/.test(hashes[name] ?? ""))
  );
}

export async function verifyV4RuntimeSnapshot(client: PublicClient) {
  if (!isV4RuntimeSnapshotApproved()) return false;
  const hashes = product.runtimeHashSnapshot.hashes as Record<string, string>;
  const contracts = product.contracts as Record<string, string>;
  const codes = await Promise.all(
    REQUIRED_V4_RUNTIME_DEPENDENCIES.map((name) =>
      client.getCode({ address: getAddress(contracts[name]) })),
  );
  return REQUIRED_V4_RUNTIME_DEPENDENCIES.every((name, index) => {
    const code = codes[index];
    return code && code !== "0x" &&
      keccak256(code).toLowerCase() === hashes[name]?.toLowerCase();
  });
}

export function isExactV4SdkInstalled(
  declaredVersion = DECLARED_DOPPLER_SDK_VERSION,
) {
  return declaredVersion === product.dependencies.dopplerSdk;
}
