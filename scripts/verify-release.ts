import product from "../config/hoodiepad-v2.json";
import {
  getV4CalibrationConfigHash,
  getV4CalibrationReport,
  isV4CalibrationApproved,
} from "../app/lib/v4-calibration";
import {
  DECLARED_DOPPLER_SDK_VERSION,
  isHoodieReferencePoolKeyValid,
  isExactV4SdkInstalled,
  isV4RuntimeSnapshotApproved,
} from "../app/lib/v4-policy";
import { getReleasePolicy } from "../app/lib/release-policy";

function line(label: string, value: unknown) {
  process.stdout.write(`${label.padEnd(28)} ${String(value)}\n`);
}

const report = getV4CalibrationReport();
const calibrationApproved = isV4CalibrationApproved(report);
const runtimeApproved = isV4RuntimeSnapshotApproved();
const exactSdk = isExactV4SdkInstalled();
const poolKeyPinned =
  product.hoodieReferencePool.poolKey !== null &&
  isHoodieReferencePoolKeyValid();
const releasePolicy = getReleasePolicy();
const launchVersion =
  process.env.HOODIEPAD_LAUNCH_VERSION?.trim().toLowerCase();
const versionConfigured = launchVersion === "v2";

const v4ApprovalGatesPassed =
  calibrationApproved &&
  runtimeApproved &&
  exactSdk &&
  poolKeyPinned &&
  releasePolicy.externalReviewApproved &&
  versionConfigured;

line("Mode", "READ-ONLY V4 RELEASE CHECK");
line("Market version", product.marketVersion);
line("Launch version", versionConfigured ? "V2" : "NOT V2");
line("Required Doppler SDK", product.dependencies.dopplerSdk);
line("Declared Doppler SDK", DECLARED_DOPPLER_SDK_VERSION);
line("Runtime snapshot", runtimeApproved ? "APPROVED" : "NOT APPROVED");
line("Reference PoolKey", poolKeyPinned ? "VALID" : "MISSING/INVALID");
line("Calibration", calibrationApproved ? "PASSED" : report.status.toUpperCase());
line(
  "Calibration config",
  report.configHash === getV4CalibrationConfigHash() ? "MATCH" : "MISMATCH",
);
line(
  "External review",
  releasePolicy.externalReviewApproved ? "APPROVED" : "NOT APPROVED",
);
line(
  "Deployment policy",
  releasePolicy.broadcastEnabled ? "ENABLED" : "DISABLED",
);

const blockers = [
  ...(!versionConfigured
    ? ["HOODIEPAD_LAUNCH_VERSION must be v2; legacy V3 creation is disabled."]
    : []),
  ...(!exactSdk
    ? [`Exact Doppler SDK ${product.dependencies.dopplerSdk} is not locked.`]
    : []),
  ...(!runtimeApproved
    ? ["The reviewed V4 runtime bytecode snapshot is not approved."]
    : []),
  ...(!poolKeyPinned
    ? ["The complete HOODIE/WETH V4 PoolKey is missing or does not match its PoolId."]
    : []),
  ...(!calibrationApproved
    ? ["The complete Robinhood V4 fork calibration has not passed."]
    : []),
  ...(!releasePolicy.externalReviewApproved
    ? ["Independent external review approval is missing; owner waiver is not accepted for V2."]
    : []),
  ...(releasePolicy.broadcastEnabled && !v4ApprovalGatesPassed
    ? ["Mainnet broadcast is enabled before every V4 approval gate passed. Disable it immediately."]
    : []),
  ...(!releasePolicy.broadcastEnabled
    ? ["Mainnet deployment policy remains disabled."]
    : []),
];

line("Release status", blockers.length === 0 ? "READY FOR METAMASK" : "BLOCKED");
for (const blocker of blockers) line("Blocker", blocker);
if (blockers.length > 0) process.exitCode = 1;
