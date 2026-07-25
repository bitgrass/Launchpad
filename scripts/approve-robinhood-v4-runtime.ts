import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAddresses } from "@whetstone-research/doppler-sdk/evm";
import {
  getAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import product from "../config/hoodiepad-v2.json";
import {
  getHoodieReferencePoolId,
  isHoodieReferencePoolKeyValid,
} from "../app/lib/v4-policy";

const CONFIG_PATH = join(process.cwd(), "config", "hoodiepad-v2.json");
const REPORT_PATH = join(
  process.cwd(),
  "config",
  "hoodiepad-v2-runtime-proposed.json",
);

type DependencyObservation = {
  address: Address;
  byteLength: number;
  runtimeHash: Hex;
};

type RuntimeProposal = {
  version: number;
  marketVersion: string;
  status: string;
  chainId: number;
  observedAtBlock: string;
  observedAt: string;
  sdkVersion: string;
  airlockOwner: Address;
  dependencies: Record<string, DependencyObservation>;
  moduleStates: Record<string, { address: Address; state: number }>;
  hoodieReferencePool: {
    poolId: Hex;
    poolKey: unknown;
    sqrtPriceX96: string;
    tick: number;
    protocolFee: number;
    lpFee: number;
    liquidity: string;
  };
  proposalSha256: Hex;
};

type MutableV2Config = Omit<
  typeof product,
  "hoodieReferencePool" | "runtimeHashSnapshot"
> & {
  hoodieReferencePool: Omit<
    typeof product.hoodieReferencePool,
    "status"
  > & { status: string };
  runtimeHashSnapshot: {
    status: string;
    observedAtBlock: string | null;
    hashes: Record<string, string>;
  };
};

function argumentValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sameAddress(first: string, second: string) {
  return getAddress(first).toLowerCase() === getAddress(second).toLowerCase();
}

function assertProposal(report: RuntimeProposal, expectedChecksum: string) {
  const { proposalSha256, ...unsigned } = report;
  const calculated = keccak256(stringToHex(JSON.stringify(unsigned)));
  if (
    calculated.toLowerCase() !== proposalSha256.toLowerCase() ||
    calculated.toLowerCase() !== expectedChecksum.toLowerCase()
  ) {
    throw new Error(
      `Runtime proposal checksum mismatch: calculated ${calculated}; ` +
      `report ${proposalSha256}; approved ${expectedChecksum}`,
    );
  }
  if (
    report.version !== 2 ||
    report.marketVersion !== product.marketVersion ||
    report.status !== "proposed-explicit-review-required" ||
    report.chainId !== product.network.chainId ||
    report.sdkVersion !== product.dependencies.dopplerSdk
  ) {
    throw new Error("Runtime proposal identity does not match HoodiePad V2");
  }
  if (!isHoodieReferencePoolKeyValid()) {
    throw new Error("Configured HOODIE/WETH V4 PoolKey is invalid");
  }
  if (
    report.hoodieReferencePool.poolId.toLowerCase() !==
      getHoodieReferencePoolId().toLowerCase() ||
    BigInt(report.hoodieReferencePool.sqrtPriceX96) === 0n ||
    BigInt(report.hoodieReferencePool.liquidity) === 0n
  ) {
    throw new Error("Runtime proposal reference-pool observation is invalid");
  }

  const sdk = getAddresses(product.network.chainId);
  const sdkAddresses: Record<string, Address | undefined> = {
    airlock: sdk.airlock,
    dopplerERC20V1Factory: sdk.dopplerERC20V1Factory,
    dopplerHookInitializer: sdk.dopplerHookInitializer,
    rehypeDopplerHookInitializer: sdk.rehypeDopplerHookInitializer,
    noOpGovernanceFactory: sdk.noOpGovernanceFactory,
    noOpMigrator: sdk.noOpMigrator,
    uniswapV4PoolManager: sdk.poolManager,
    uniswapV4Quoter: sdk.uniswapV4Quoter,
    uniswapUniversalRouter: sdk.universalRouter,
    permit2: sdk.permit2,
    weth: sdk.weth,
  };
  const configured = product.contracts as Record<string, string>;
  for (const [name, observation] of Object.entries(report.dependencies)) {
    if (
      !configured[name] ||
      !sameAddress(observation.address, configured[name]) ||
      observation.byteLength <= 0 ||
      !/^0x[a-fA-F0-9]{64}$/.test(observation.runtimeHash)
    ) {
      throw new Error(`Invalid runtime observation for ${name}`);
    }
    const sdkAddress = sdkAddresses[name];
    if (sdkAddress && !sameAddress(sdkAddress, observation.address)) {
      throw new Error(`SDK runtime address mismatch for ${name}`);
    }
  }
  const requiredDependencies = [
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
  ];
  for (const name of requiredDependencies) {
    if (!report.dependencies[name]) {
      throw new Error(`Runtime proposal is missing ${name}`);
    }
  }
  for (const name of [
    "dopplerERC20V1Factory",
    "dopplerHookInitializer",
    "noOpGovernanceFactory",
    "noOpMigrator",
  ]) {
    const moduleEvidence = report.moduleStates[name];
    if (
      !moduleEvidence ||
      moduleEvidence.state === 0 ||
      !sameAddress(moduleEvidence.address, configured[name])
    ) {
      throw new Error(`Airlock module ${name} is not approved`);
    }
  }
}

async function main() {
  const expectedChecksum = argumentValue("--checksum");
  if (!expectedChecksum || !/^0x[a-fA-F0-9]{64}$/.test(expectedChecksum)) {
    throw new Error(
      "Pass the exact reviewed proposal checksum with --checksum 0x...",
    );
  }
  const [rawConfig, rawReport] = await Promise.all([
    readFile(CONFIG_PATH, "utf8"),
    readFile(REPORT_PATH, "utf8"),
  ]);
  const report = JSON.parse(rawReport) as RuntimeProposal;
  assertProposal(report, expectedChecksum);

  const nextConfig = JSON.parse(rawConfig) as MutableV2Config;
  nextConfig.hoodieReferencePool.status = "verified";
  nextConfig.runtimeHashSnapshot = {
    status: "approved",
    observedAtBlock: report.observedAtBlock,
    hashes: Object.fromEntries(
      Object.entries(report.dependencies).map(([name, observation]) => [
        name,
        observation.runtimeHash,
      ]),
    ),
  };
  await writeFile(CONFIG_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  process.stdout.write("V4 runtime snapshot APPROVED\n");
  process.stdout.write(`Block ${report.observedAtBlock}\n`);
  process.stdout.write(`Proposal checksum ${report.proposalSha256}\n`);
  process.stdout.write(
    "This does not approve fork calibration, external review, or mainnet broadcast.\n",
  );
}

await main();
