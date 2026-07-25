import { keccak256, stringToHex } from "viem";
import product from "../../config/hoodiepad-v2.json";
import curve from "../../config/hoodie-v4-curve-v1.json";
import report from "../../config/hoodie-v4-calibration.json";

export const REQUIRED_V4_CALIBRATION_CHECKS = [
  "launch-created",
  "runtime-hashes",
  "module-whitelisting",
  "hoodie-reference-pool-key",
  "hoodie-reference-pool-id",
  "uniswap-v4-router-control",
  "eth-usd-fresh",
  "hoodie-usd-derived",
  "opening-fdv-target",
  "opening-fdv-within-tolerance",
  "total-supply-exact",
  "market-allocation-exact",
  "no-vesting",
  "zero-creator-liquid-allocation",
  "no-material-dead-inventory",
  "pool-locked",
  "noop-migration",
  "noop-governance",
  "token-policy",
  "max-wallet-enforced",
  "max-wallet-expired",
  "v4-active-lp-fee-one-percent",
  "rehype-hook-fee-zero",
  "direct-hoodie-buy",
  "direct-hoodie-sell",
  "eth-multihop-buy",
  "eth-multihop-sell",
  "quote-minout-enforced",
  "expired-quote-rejected",
  "permit2-approval",
  "creator-pending-fees",
  "creator-fee-claim",
  "ecosystem-fee-claim",
  "protocol-fee-claim",
  "fee-split-80-15-5",
  "v4-swap-indexing",
  "price-orientation-token0",
  "price-orientation-token1",
  "legacy-v3-regression",
] as const;

export type V4CalibrationCheck = {
  name: string;
  passed: boolean;
  details?: string;
};

export type V4CalibrationReport = {
  version: number;
  marketVersion: string;
  status: "pending" | "passed" | "failed";
  chainId: number;
  forkBlock: string | null;
  configHash: string | null;
  curveVersion: number;
  completedAt: string | null;
  checks: V4CalibrationCheck[];
};

export function getV4CalibrationConfigHash() {
  return keccak256(stringToHex(JSON.stringify({
    marketVersion: product.marketVersion,
    chainId: product.network.chainId,
    contracts: product.contracts,
    hoodieReferencePool: product.hoodieReferencePool,
    runtimeHashSnapshot: product.runtimeHashSnapshot,
    token: product.token,
    market: product.market,
    fees: product.fees,
    rehype: product.rehype,
    pricing: product.pricing,
    curve,
    dependencies: product.dependencies,
  })));
}

export function isV4CalibrationApproved(
  value: V4CalibrationReport = report as V4CalibrationReport,
) {
  if (
    value.version !== 2 ||
    value.marketVersion !== product.marketVersion ||
    value.status !== "passed" ||
    value.chainId !== product.network.chainId ||
    !value.forkBlock ||
    !value.completedAt ||
    value.curveVersion !== product.market.curveVersion ||
    value.configHash !== getV4CalibrationConfigHash()
  ) {
    return false;
  }
  const passed = new Set(
    value.checks.filter((check) => check.passed).map((check) => check.name),
  );
  return REQUIRED_V4_CALIBRATION_CHECKS.every((name) => passed.has(name));
}

export function getV4CalibrationReport() {
  return report as V4CalibrationReport;
}
