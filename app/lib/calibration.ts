import { keccak256, stringToHex } from "viem";
import product from "../../config/hoodiepad-v1.json";
import calibrationReport from "../../config/hoodie-curve-calibration.json";

export const REQUIRED_CALIBRATION_CHECKS = [
  "launch-created",
  "token-ordering",
  "pool-locked",
  "token-policy",
  "buy",
  "max-wallet-enforced",
  "max-wallet-expired",
  "sell",
  "fee-claim",
  "fee-split-80-15-5",
  "noop-migration-locked",
] as const;

export type CalibrationCheck = {
  name: string;
  passed: boolean;
  details?: string;
};

export type CalibrationReport = {
  version: number;
  status: "pending" | "passed" | "failed";
  chainId: number;
  forkBlock: string | null;
  referenceTick: number | null;
  startTick: number | null;
  endTick: number | null;
  configHash: string | null;
  completedAt: string | null;
  checks: CalibrationCheck[];
};

export function getCalibrationConfigHash() {
  const frozenCalibrationInput = {
    chainId: product.network.chainId,
    hoodie: product.contracts.hoodie,
    ecosystemSafe: product.contracts.hoodieEcosystemSafe,
    airlock: product.contracts.airlock,
    tokenFactory: product.contracts.dopplerERC20V1Factory,
    initializer: product.contracts.lockableV3Initializer,
    governanceFactory: product.contracts.noOpGovernanceFactory,
    migrator: product.contracts.noOpMigrator,
    referencePool: product.hoodieReferencePool,
    runtimeHashes: product.runtimeHashSnapshot.hashes,
    token: product.token,
    pool: {
      mechanism: product.pool.mechanism,
      fee: product.pool.fee,
      tickSpacing: product.pool.tickSpacing,
      numPositions: product.pool.numPositions,
      tokenOrdering: product.pool.tokenOrdering,
      tickPriceMeaning: product.pool.tickPriceMeaning,
      noOpMigrationPool: product.pool.noOpMigrationPool,
      referenceStartTickWeth: product.pool.referenceStartTickWeth,
      referenceEndTickWeth: product.pool.referenceEndTickWeth,
      migration: product.pool.migration,
      governance: product.pool.governance,
    },
    fees: product.fees,
    dopplerSdk: product.dependencies.dopplerSdk,
  };

  return keccak256(stringToHex(JSON.stringify(frozenCalibrationInput)));
}

export function isCalibrationReportApproved(
  value: CalibrationReport = calibrationReport as CalibrationReport,
) {
  if (
    value.version !== 1 ||
    value.status !== "passed" ||
    value.chainId !== product.network.chainId ||
    !value.forkBlock ||
    !value.completedAt ||
    value.configHash !== getCalibrationConfigHash()
  ) {
    return false;
  }

  const passedChecks = new Set(
    value.checks.filter((check) => check.passed).map((check) => check.name),
  );
  return REQUIRED_CALIBRATION_CHECKS.every((name) => passedChecks.has(name));
}

export function getCalibrationReport() {
  return calibrationReport as CalibrationReport;
}
