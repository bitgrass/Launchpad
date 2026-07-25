import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  airlockAbi,
  getAddresses,
} from "@whetstone-research/doppler-sdk/evm";
import {
  getAddress,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import product from "../config/hoodiepad-v2.json";
import { createRobinhoodPublicClient } from "../app/lib/protocol";
import {
  getHoodieReferencePoolId,
  getHoodieReferencePoolKey,
  isHoodieReferencePoolKeyValid,
} from "../app/lib/v4-policy";

const REPORT_PATH = join(
  process.cwd(),
  "config",
  "hoodiepad-v2-runtime-proposed.json",
);

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

const dependencyEntries = {
  hoodie: product.contracts.hoodie,
  weth: product.contracts.weth,
  airlock: product.contracts.airlock,
  dopplerERC20V1Factory: product.contracts.dopplerERC20V1Factory,
  dopplerHookInitializer: product.contracts.dopplerHookInitializer,
  rehypeDopplerHookInitializer:
    product.contracts.rehypeDopplerHookInitializer,
  noOpGovernanceFactory: product.contracts.noOpGovernanceFactory,
  noOpMigrator: product.contracts.noOpMigrator,
  uniswapV4PoolManager: product.contracts.uniswapV4PoolManager,
  uniswapV4StateView: product.contracts.uniswapV4StateView,
  uniswapV4Quoter: product.contracts.uniswapV4Quoter,
  uniswapUniversalRouter: product.contracts.uniswapUniversalRouter,
  permit2: product.contracts.permit2,
} as const;

const airlockModules = {
  dopplerERC20V1Factory: product.contracts.dopplerERC20V1Factory,
  dopplerHookInitializer: product.contracts.dopplerHookInitializer,
  noOpGovernanceFactory: product.contracts.noOpGovernanceFactory,
  noOpMigrator: product.contracts.noOpMigrator,
} as const;

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(" ")
    .replace(/https?:\/\/[^\s]+/g, "[redacted RPC]")
    .replace(/alch_[A-Za-z0-9_-]+/g, "[redacted key]")
    .slice(0, 2_000);
}

function assertSdkAddresses() {
  const sdk = getAddresses(product.network.chainId);
  const comparisons = {
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
  } as const;
  for (const [name, sdkAddress] of Object.entries(comparisons)) {
    const configured =
      product.contracts[name as keyof typeof product.contracts];
    if (
      !sdkAddress ||
      !configured ||
      sdkAddress.toLowerCase() !== configured.toLowerCase()
    ) {
      throw new Error(
        `SDK/config address mismatch for ${name}: ` +
        `${String(sdkAddress)} / ${String(configured)}`,
      );
    }
  }
}

async function main() {
  assertSdkAddresses();
  if (!isHoodieReferencePoolKeyValid()) {
    throw new Error("The configured HOODIE/WETH PoolKey does not match its PoolId");
  }

  const client = createRobinhoodPublicClient();
  const chainId = await client.getChainId();
  if (chainId !== product.network.chainId) {
    throw new Error(
      `RPC returned chain ${chainId}; expected ${product.network.chainId}`,
    );
  }
  const blockNumber = await client.getBlockNumber();
  const names = Object.keys(dependencyEntries) as Array<
    keyof typeof dependencyEntries
  >;
  const codes = await Promise.all(
    names.map((name) =>
      client.getCode({
        address: getAddress(dependencyEntries[name]),
        blockNumber,
      }),
    ),
  );
  const dependencies = Object.fromEntries(
    names.map((name, index) => {
      const code = codes[index] ?? "0x";
      if (code === "0x") {
        throw new Error(`No runtime bytecode at ${name}`);
      }
      return [
        name,
        {
          address: getAddress(dependencyEntries[name]),
          byteLength: (code.length - 2) / 2,
          runtimeHash: keccak256(code),
        },
      ];
    }),
  );

  const moduleNames = Object.keys(airlockModules) as Array<
    keyof typeof airlockModules
  >;
  const moduleStates = Object.fromEntries(
    await Promise.all(
      moduleNames.map(async (name) => {
        const state = await client.readContract({
          address: getAddress(product.contracts.airlock),
          abi: airlockAbi,
          functionName: "getModuleState",
          args: [getAddress(airlockModules[name])],
          blockNumber,
        });
        if (Number(state) === 0) {
          throw new Error(`Airlock module ${name} is not whitelisted`);
        }
        return [
          name,
          {
            address: getAddress(airlockModules[name]),
            state: Number(state),
          },
        ];
      }),
    ),
  );

  const poolId = getHoodieReferencePoolId() as Hex;
  const [owner, slot0, liquidity] = await Promise.all([
    client.readContract({
      address: getAddress(product.contracts.airlock),
      abi: airlockAbi,
      functionName: "owner",
      blockNumber,
    }),
    client.readContract({
      address: getAddress(product.contracts.uniswapV4StateView),
      abi: stateViewAbi,
      functionName: "getSlot0",
      args: [poolId],
      blockNumber,
    }),
    client.readContract({
      address: getAddress(product.contracts.uniswapV4StateView),
      abi: stateViewAbi,
      functionName: "getLiquidity",
      args: [poolId],
      blockNumber,
    }),
  ]);
  if (slot0[0] === 0n || liquidity === 0n) {
    throw new Error("The pinned HOODIE/WETH V4 reference pool is not initialized");
  }

  const report = {
    version: 2,
    marketVersion: product.marketVersion,
    status: "proposed-explicit-review-required",
    chainId,
    observedAtBlock: blockNumber.toString(),
    observedAt: new Date().toISOString(),
    sdkVersion: product.dependencies.dopplerSdk,
    airlockOwner: owner as Address,
    dependencies,
    moduleStates,
    hoodieReferencePool: {
      poolId,
      poolKey: getHoodieReferencePoolKey(),
      sqrtPriceX96: slot0[0].toString(),
      tick: Number(slot0[1]),
      protocolFee: Number(slot0[2]),
      lpFee: Number(slot0[3]),
      liquidity: liquidity.toString(),
    },
  };
  const proposalSha256 = keccak256(stringToHex(JSON.stringify(report)));
  const checksummedReport = { ...report, proposalSha256 };
  await writeFile(
    REPORT_PATH,
    `${JSON.stringify(checksummedReport, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write("V4 runtime proposal CREATED (not approved)\n");
  process.stdout.write(`Block ${blockNumber}\n`);
  process.stdout.write(`PoolId ${poolId}\n`);
  process.stdout.write(`Dependencies ${names.length}\n`);
  process.stdout.write(`Airlock modules ${moduleNames.length}\n`);
  process.stdout.write(`Proposal checksum ${proposalSha256}\n`);
  process.stdout.write(`Report ${REPORT_PATH}\n`);
  process.stdout.write(
    "Review every address, runtime hash, module state, and PoolKey before approval.\n",
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`V4 runtime report FAILED: ${safeError(error)}\n`);
  process.exitCode = 1;
}
