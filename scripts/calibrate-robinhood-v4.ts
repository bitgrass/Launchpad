import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  airlockAbi,
  DEAD_ADDRESS,
  DopplerSDK,
  dopplerERC20V1Abi,
  dopplerHookInitializerAbi,
  poolManagerAbi,
  rehypeDopplerHookAbi,
} from "@whetstone-research/doppler-sdk/evm";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  getAddress,
  http,
  maxUint256,
  parseAbi,
  parseAbiItem,
  parseEther,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import product from "../config/hoodiepad-v2.json";
import legacyProduct from "../config/hoodiepad-v1.json";
import {
  getV4CalibrationConfigHash,
  REQUIRED_V4_CALIBRATION_CHECKS,
  type V4CalibrationCheck,
  type V4CalibrationReport,
} from "../app/lib/v4-calibration";
import {
  buildV4LaunchParams,
  readV4PriceSnapshot,
} from "../app/lib/v4-launch";
import { v4PriceForMarket } from "../app/lib/market-v4";
import { robinhood } from "../app/lib/protocol";
import {
  encodeV4ChildToEthSwap,
  encodeV4EthToChildSwap,
  encodeV4ExactInputSwap,
} from "../app/lib/swap";
import {
  calculateFdv,
  formatRational,
  multiplyRationals,
  type Rational,
} from "../app/lib/v4-price";
import {
  getHoodieReferencePoolId,
  getHoodieReferencePoolKey,
  getV4Beneficiaries,
  isExactV4SdkInstalled,
  isHoodieReferencePoolKeyValid,
  isV4RuntimeSnapshotApproved,
  V4_LP_FEE,
  V4_MAX_WALLET,
  V4_TOKENS_TO_SELL,
  V4_TOTAL_SUPPLY,
  verifyV4RuntimeSnapshot,
} from "../app/lib/v4-policy";

const LOCAL_CREATOR_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const LOCAL_BUYER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044976f7d7d2996287b1a65d13fbb0d4fbb6ab3b6f6f3e";
const LOCAL_PORT = Number(process.env.HOODIEPAD_V4_FORK_PORT ?? "8548");
const LOCAL_RPC_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const REPORT_PATH = join(
  process.cwd(),
  "config",
  "hoodie-v4-calibration.json",
);
const LEGACY_V3_REFERENCE_TOKEN =
  "0x650716844ed8d82B1835C854fD56Fc9ADE772b42" as Address;

const erc20Abi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
]);
const permit2Abi = parseAbi([
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
]);
const feeClaimsAbi = parseAbi([
  "function getShares(bytes32 poolId,address user) view returns (uint256)",
]);
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
const universalRouterErrorsAbi = parseAbi([
  "error ExecutionFailed(uint256 commandIndex,bytes message)",
  "error TransactionDeadlinePassed()",
]);
const v4RouterErrorsAbi = parseAbi([
  "error V4TooLittleReceived(uint256 minAmountOutReceived,uint256 amountReceived)",
  "error V4TooMuchRequested(uint256 maxAmountInRequested,uint256 amountRequested)",
  "error V4TooLittleReceivedPerHop(uint256 hopIndex,uint256 minPrice,uint256 price)",
  "error V4TooMuchRequestedPerHop(uint256 hopIndex,uint256 minPrice,uint256 price)",
  "error V4TooLittleReceivedPerHopSingle(uint256 minPrice,uint256 price)",
  "error V4TooMuchRequestedPerHopSingle(uint256 minPrice,uint256 price)",
  "error InvalidHopPriceLength()",
  "error SliceOutOfBounds()",
  "error UnsupportedAction(uint256 action)",
]);
const permit2ErrorsAbi = parseAbi([
  "error AllowanceExpired(uint256 deadline)",
  "error InsufficientAllowance(uint256 amount)",
  "error InvalidAmount(uint160 maxAmount)",
  "error InvalidNonce()",
  "error InvalidSigner()",
  "error LengthMismatch()",
  "error SignatureExpired(uint256 signatureDeadline)",
]);
const knownSwapErrorAbis: readonly Abi[] = [
  universalRouterErrorsAbi,
  v4RouterErrorsAbi,
  dopplerERC20V1Abi,
  poolManagerAbi,
  rehypeDopplerHookAbi,
  permit2ErrorsAbi,
];
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
);

function sourceRpcUrl() {
  const forkOverride = process.env.HOODIEPAD_FORK_RPC_URL?.trim();
  if (forkOverride) return forkOverride;
  const alchemyKey = process.env.Alchemy_API_KEY?.trim();
  if (alchemyKey) {
    return `https://robinhood-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }
  const fallback = process.env.ROBINHOOD_RPC_URL?.trim();
  if (fallback) return fallback;
  throw new Error(
    "Set Alchemy_API_KEY, HOODIEPAD_FORK_RPC_URL, or ROBINHOOD_RPC_URL",
  );
}

function redactError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10)
    .join(" ")
    .replace(/https?:\/\/[^\s]+/g, "[redacted RPC]")
    .replace(/alch_[A-Za-z0-9_-]+/g, "[redacted key]")
    .slice(0, 2_500);
}

function getNestedRevertData(error: unknown): Hex | undefined {
  const visited = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (
        typeof value === "string" &&
        /^0x[0-9a-fA-F]{8,}$/.test(value)
      ) {
        return value as Hex;
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return undefined;
}

function formatErrorArgs(args: readonly unknown[] | undefined) {
  if (!args || args.length === 0) return "";
  return args
    .map((value) =>
      typeof value === "bigint" ? value.toString() : String(value))
    .join(", ");
}

function decodeKnownSwapError(data: Hex | undefined) {
  if (!data || data === "0x") return undefined;
  for (const abi of knownSwapErrorAbis) {
    try {
      const decoded = decodeErrorResult({ abi, data });
      return `${decoded.errorName}(${formatErrorArgs(decoded.args)})`;
    } catch {
      // Try the next deployed-contract ABI.
    }
  }
  return `selector ${data.slice(0, 10)}`;
}

interface TraceCallFrame {
  type?: string;
  from?: Address;
  to?: Address;
  input?: Hex;
  output?: Hex;
  error?: string;
  revertReason?: string;
  calls?: TraceCallFrame[];
}

interface StructTraceResult {
  failed?: boolean;
  returnValue?: Hex;
}

interface ParityTraceFrame {
  action?: {
    callType?: string;
    from?: Address;
    to?: Address;
    input?: Hex;
  };
  error?: string;
  result?: {
    output?: Hex;
  };
  traceAddress?: number[];
  type?: string;
}

async function localRpcRequest<T>(method: string, params: unknown[]) {
  const response = await fetch(LOCAL_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  const payload = await response.json() as {
    result?: T;
    error?: { code?: number; message?: string };
  };
  if (payload.error) {
    throw new Error(
      `${method} failed (${payload.error.code ?? "unknown"}): ${
        payload.error.message ?? "unknown error"
      }`,
    );
  }
  if (payload.result === undefined) {
    throw new Error(`${method} returned no result`);
  }
  return payload.result;
}

function traceAddressLabel(
  address: Address | undefined,
  additionalLabels: Readonly<Record<string, string>> = {},
) {
  if (!address) return "unknown";
  const normalized = address.toLowerCase();
  const labels: Record<string, string> = {
    [product.contracts.uniswapUniversalRouter.toLowerCase()]:
      "UniversalRouter",
    [product.contracts.uniswapV4PoolManager.toLowerCase()]: "PoolManager",
    [product.contracts.permit2.toLowerCase()]: "Permit2",
    [product.contracts.hoodie.toLowerCase()]: "HOODIE",
    [product.contracts.dopplerHookInitializer.toLowerCase()]:
      "DopplerHook",
    ...additionalLabels,
  };
  return labels[normalized] ?? address;
}

function failedTraceFrames(
  frame: TraceCallFrame,
  depth = 0,
): Array<{ frame: TraceCallFrame; depth: number }> {
  const nested = (frame.calls ?? []).flatMap((call) =>
    failedTraceFrames(call, depth + 1));
  if (frame.error || frame.revertReason) {
    nested.push({ frame, depth });
  }
  return nested;
}

async function traceRouterCall(input: {
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
  labels?: Readonly<Record<string, string>>;
}) {
  const transaction = {
    from: input.from,
    to: input.to,
    data: input.data,
    value: `0x${input.value.toString(16)}`,
  };
  try {
    const frame = await localRpcRequest<TraceCallFrame>(
      "debug_traceCall",
      [
        transaction,
        "latest",
        {
          tracer: "callTracer",
          tracerConfig: { onlyTopCall: false, withLog: false },
        },
      ],
    );
    const failures = failedTraceFrames(frame)
      .sort((left, right) => right.depth - left.depth)
      .slice(0, 8);
    if (failures.length > 0) {
      return failures
        .map(({ frame: failure, depth }) => {
          const decoded = decodeKnownSwapError(failure.output);
          return [
            `depth ${depth}`,
            traceAddressLabel(failure.to, input.labels),
            failure.error ?? failure.revertReason ?? "reverted",
            decoded ?? "no revert data",
          ].join(" · ");
        })
        .join(" | ");
    }
    return `top-level ${decodeKnownSwapError(frame.output) ?? "revert without data"}`;
  } catch (callTracerError) {
    try {
      const parityTrace = await localRpcRequest<ParityTraceFrame[]>(
        "trace_call",
        [transaction, ["trace"], "latest"],
      );
      const failures = parityTrace
        .filter((frame) => frame.error)
        .sort(
          (left, right) =>
            (right.traceAddress?.length ?? 0) -
            (left.traceAddress?.length ?? 0),
        )
        .slice(0, 8);
      if (failures.length > 0) {
        return failures
          .map((failure) => [
            `depth ${failure.traceAddress?.length ?? 0}`,
            traceAddressLabel(failure.action?.to, input.labels),
            failure.error ?? "reverted",
            decodeKnownSwapError(failure.result?.output) ?? "no revert data",
          ].join(" · "))
          .join(" | ");
      }
    } catch {
      // Fall through to the opcode-level geth trace.
    }
    try {
      const trace = await localRpcRequest<StructTraceResult>(
        "debug_traceCall",
        [
          transaction,
          "latest",
          {
            disableMemory: true,
            disableStorage: true,
            enableReturnData: true,
          },
        ],
      );
      return [
        `geth trace failed=${String(trace.failed)}`,
        decodeKnownSwapError(trace.returnValue) ?? "no revert data",
      ].join(" · ");
    } catch (structTraceError) {
      return `trace unavailable: ${redactError(callTracerError)}; fallback: ${
        redactError(structTraceError)
      }`;
    }
  }
}

async function resolveAnvilExecutable() {
  if (process.env.HOODIEPAD_ANVIL_PATH?.trim()) {
    return process.env.HOODIEPAD_ANVIL_PATH.trim();
  }
  if (process.platform === "win32" && process.arch === "x64") {
    const bundled = join(
      process.cwd(),
      "node_modules",
      "@foundry-rs",
      "anvil-win32-amd64",
      "bin",
      "anvil.exe",
    );
    await access(bundled);
    return bundled;
  }
  return "anvil";
}

async function startFork() {
  const executable = await resolveAnvilExecutable();
  const args = [
    "--fork-url",
    sourceRpcUrl(),
    "--chain-id",
    String(product.network.chainId),
    "--port",
    String(LOCAL_PORT),
    "--block-time",
    "1",
    "--steps-tracing",
    "--silent",
  ];
  const pinnedBlock = process.env.HOODIEPAD_FORK_BLOCK?.trim();
  if (pinnedBlock) args.push("--fork-block-number", pinnedBlock);
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const client = createPublicClient({
    chain: robinhood,
    transport: http(LOCAL_RPC_URL),
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Anvil stopped before startup: ${redactError(stderr)}`);
    }
    try {
      if (await client.getChainId() === product.network.chainId) {
        return { child, client };
      }
    } catch {
      // The disposable fork is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error("Anvil did not start within 60 seconds");
}

function addCheck(
  checks: V4CalibrationCheck[],
  name: typeof REQUIRED_V4_CALIBRATION_CHECKS[number],
  passed: boolean,
  details?: string,
) {
  checks.push({ name, passed, ...(details ? { details } : {}) });
  assert.equal(passed, true, `${name} failed${details ? `: ${details}` : ""}`);
}

function decimalToRational(value: string): Rational {
  assert.match(value, /^\d+(?:\.\d+)?$/);
  const [whole, fraction = ""] = value.split(".");
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator: 10n ** BigInt(fraction.length),
  };
}

function withinBps(
  actual: bigint,
  expected: bigint,
  toleranceBps: number,
) {
  const difference = actual >= expected ? actual - expected : expected - actual;
  return difference * 10_000n <= expected * BigInt(toleranceBps);
}

function withinFeeTolerance(
  actual: bigint,
  total: bigint,
  expectedShare: bigint,
) {
  if (total === 0n) return false;
  const wad = BigInt(product.fees.wad);
  const actualScaled = actual * wad;
  const expectedScaled = total * expectedShare;
  const difference = actualScaled >= expectedScaled
    ? actualScaled - expectedScaled
    : expectedScaled - actualScaled;
  return difference <= total * 2_000_000_000_000_000n + 10n * wad;
}

async function waitForSuccess(client: PublicClient, hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  assert.equal(receipt.status, "success", `transaction ${hash} reverted`);
  return receipt;
}

async function approvePermit2(input: {
  client: PublicClient;
  wallet: WalletClient;
  account: PrivateKeyAccount;
  token: Address;
  amount: bigint;
  expiration: number;
}) {
  const permit2 = getAddress(product.contracts.permit2);
  const router = getAddress(product.contracts.uniswapUniversalRouter);
  const tokenHash = await input.wallet.writeContract({
    account: input.account,
    address: input.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [permit2, maxUint256],
    chain: robinhood,
  });
  await waitForSuccess(input.client, tokenHash);
  const permitHash = await input.wallet.writeContract({
    account: input.account,
    address: permit2,
    abi: permit2Abi,
    functionName: "approve",
    args: [input.token, router, input.amount, input.expiration],
    chain: robinhood,
  });
  await waitForSuccess(input.client, permitHash);
}

async function sendRouterTransaction(input: {
  client: PublicClient;
  wallet: WalletClient;
  account: PrivateKeyAccount;
  data: Hex;
  value?: bigint;
  labels?: Readonly<Record<string, string>>;
}) {
  const router = getAddress(product.contracts.uniswapUniversalRouter);
  const value = input.value ?? 0n;
  await simulateRouterTransaction({
    client: input.client,
    account: input.account.address,
    data: input.data,
    value,
    labels: input.labels,
  });
  const hash = await input.wallet.sendTransaction({
    account: input.account,
    to: router,
    data: input.data,
    value,
    chain: robinhood,
  });
  return waitForSuccess(input.client, hash);
}

async function simulateRouterTransaction(input: {
  client: PublicClient;
  account: Address;
  data: Hex;
  value?: bigint;
  labels?: Readonly<Record<string, string>>;
}) {
  const router = getAddress(product.contracts.uniswapUniversalRouter);
  const value = input.value ?? 0n;
  try {
    await input.client.call({
      account: input.account,
      to: router,
      data: input.data,
      value,
    });
  } catch (error) {
    const data = getNestedRevertData(error);
    if (data) {
      try {
        const outer = decodeErrorResult({
          abi: universalRouterErrorsAbi,
          data,
        });
        if (outer.errorName === "ExecutionFailed") {
          const [commandIndex, message] = outer.args;
          const nested = decodeKnownSwapError(message);
          if (nested) {
            throw new Error(
              `Universal Router command ${commandIndex} reverted with ${nested}`,
            );
          }
        }
      } catch (decodedError) {
        if (
          decodedError instanceof Error &&
          decodedError.message.startsWith("Universal Router command")
        ) {
          throw decodedError;
        }
      }
    }
    const trace = await traceRouterCall({
      from: input.account,
      to: router,
      data: input.data,
      value,
      labels: input.labels,
    });
    throw new Error(`Universal Router simulation failed. Trace: ${trace}`);
  }
}

async function collectForBeneficiary(input: {
  client: PublicClient;
  wallet: WalletClient;
  account: Address;
  token: Address;
}) {
  const sdk = new DopplerSDK({
    publicClient: input.client,
    walletClient: input.wallet,
    chainId: product.network.chainId,
  });
  const pool = await sdk.getMulticurvePool(input.token);
  const result = await pool.collectFees();
  await waitForSuccess(input.client, result.transactionHash);
  return result;
}

async function main() {
  const checks: V4CalibrationCheck[] = [];
  const report: V4CalibrationReport = {
    version: 2,
    marketVersion: product.marketVersion,
    status: "pending",
    chainId: product.network.chainId,
    forkBlock: null,
    configHash: getV4CalibrationConfigHash(),
    curveVersion: product.market.curveVersion,
    completedAt: null,
    checks,
  };
  let fork: Awaited<ReturnType<typeof startFork>> | undefined;

  try {
    assert.equal(
      isExactV4SdkInstalled(),
      true,
      `Install exact Doppler SDK ${product.dependencies.dopplerSdk}`,
    );
    assert.equal(
      isHoodieReferencePoolKeyValid(),
      true,
      "The complete HOODIE/WETH V4 PoolKey is invalid",
    );
    assert.equal(
      isV4RuntimeSnapshotApproved(),
      true,
      "Approve the independently reviewed V4 runtime snapshot first",
    );

    process.stdout.write("Starting disposable Robinhood V4 fork...\n");
    fork = await startFork();
    const publicClient = fork.client;
    const testClient = createTestClient({
      chain: robinhood,
      mode: "anvil",
      transport: http(LOCAL_RPC_URL),
    });
    const creator = privateKeyToAccount(LOCAL_CREATOR_PRIVATE_KEY);
    const buyer = privateKeyToAccount(LOCAL_BUYER_PRIVATE_KEY);
    const creatorWallet = createWalletClient({
      account: creator,
      chain: robinhood,
      transport: http(LOCAL_RPC_URL),
    });
    const buyerWallet = createWalletClient({
      account: buyer,
      chain: robinhood,
      transport: http(LOCAL_RPC_URL),
    });
    await testClient.setBalance({
      address: creator.address,
      value: parseEther("100"),
    });
    await testClient.setBalance({
      address: buyer.address,
      value: parseEther("100"),
    });

    const forkBlock = await publicClient.getBlock();
    report.forkBlock = forkBlock.number.toString();
    process.stdout.write(`Fork ready at block ${forkBlock.number}\n`);

    addCheck(
      checks,
      "runtime-hashes",
      await verifyV4RuntimeSnapshot(publicClient),
      `${product.runtimeHashSnapshot.status} at block ${product.runtimeHashSnapshot.observedAtBlock}`,
    );

    const airlock = getAddress(product.contracts.airlock);
    const moduleAddresses = [
      product.contracts.dopplerERC20V1Factory,
      product.contracts.dopplerHookInitializer,
      product.contracts.noOpGovernanceFactory,
      product.contracts.noOpMigrator,
    ].map((address) => getAddress(address));
    const moduleStates = await Promise.all(
      moduleAddresses.map((module) =>
        publicClient.readContract({
          address: airlock,
          abi: airlockAbi,
          functionName: "getModuleState",
          args: [module],
        })),
    );
    addCheck(
      checks,
      "module-whitelisting",
      moduleStates.every((state) => Number(state) !== 0),
      moduleStates.map(Number).join(","),
    );

    const referencePoolKey = getHoodieReferencePoolKey();
    const referencePoolId = getHoodieReferencePoolId();
    const [referenceSlot0, referenceLiquidity, price, airlockOwner] =
      await Promise.all([
        publicClient.readContract({
          address: getAddress(product.contracts.uniswapV4StateView),
          abi: stateViewAbi,
          functionName: "getSlot0",
          args: [referencePoolId],
        }),
        publicClient.readContract({
          address: getAddress(product.contracts.uniswapV4StateView),
          abi: stateViewAbi,
          functionName: "getLiquidity",
          args: [referencePoolId],
        }),
        readV4PriceSnapshot(publicClient),
        publicClient.readContract({
          address: airlock,
          abi: airlockAbi,
          functionName: "owner",
        }),
      ]);
    addCheck(
      checks,
      "hoodie-reference-pool-key",
      isHoodieReferencePoolKeyValid() &&
        referenceSlot0[0] !== 0n &&
        referenceLiquidity !== 0n,
      JSON.stringify(referencePoolKey),
    );
    addCheck(
      checks,
      "hoodie-reference-pool-id",
      referencePoolId.toLowerCase() ===
        product.hoodieReferencePool.poolId.toLowerCase(),
      referencePoolId,
    );
    const sourceAgeMs = Date.now() - Date.parse(price.ethUsdTimestamp);
    addCheck(
      checks,
      "eth-usd-fresh",
      sourceAgeMs >= -5_000 &&
        sourceAgeMs <= product.pricing.maximumSourceAgeSeconds * 1_000,
      `${price.ethUsd} at ${price.ethUsdTimestamp}`,
    );
    addCheck(
      checks,
      "hoodie-usd-derived",
      Number.isFinite(price.hoodieUsdNumber) && price.hoodieUsdNumber > 0,
      `${price.hoodieUsd} USD; ${price.hoodiePerWeth} HOODIE/WETH`,
    );

    const sdk = new DopplerSDK({
      publicClient,
      walletClient: creatorWallet,
      chainId: product.network.chainId,
    });
    const launchTimestamp = Number(forkBlock.timestamp);
    const params = buildV4LaunchParams(
      sdk,
      {
        name: "HoodiePad V4 Calibration",
        symbol: "HPV4CAL",
        tokenURI: "https://hoodie.fun/hoodiepad-v4-calibration.json",
        creator: creator.address,
      },
      getAddress(airlockOwner),
      price.hoodieUsdNumber,
      launchTimestamp,
    );
    const simulation = await sdk.factory.simulateCreateMulticurve(params);
    assert.equal(
      simulation.createParams.governanceFactory.toLowerCase(),
      product.contracts.noOpGovernanceFactory.toLowerCase(),
    );
    assert.equal(
      simulation.createParams.liquidityMigrator.toLowerCase(),
      product.contracts.noOpMigrator.toLowerCase(),
    );
    assert.equal(
      simulation.createParams.poolInitializer.toLowerCase(),
      product.contracts.dopplerHookInitializer.toLowerCase(),
    );

    process.stdout.write("Creating exact HoodiePad V4 launch on the fork...\n");
    const launch = await simulation.execute();
    await waitForSuccess(publicClient, launch.transactionHash as Hex);
    const token = getAddress(launch.tokenAddress);
    const poolId = launch.poolId as Hex;
    addCheck(
      checks,
      "launch-created",
      token.toLowerCase() === simulation.tokenAddress.toLowerCase() &&
        poolId.toLowerCase() === simulation.poolId.toLowerCase(),
      `token ${token}; PoolId ${poolId}`,
    );

    const tokenEntity = sdk.getDopplerERC20V1(token);
    const pool = await sdk.getMulticurvePool(token);
    const [
      assetData,
      hookState,
      poolState,
      slot0BeforeTrading,
      totalSupply,
      vestingCount,
      vestedTotal,
      creatorBalanceAtLaunch,
      deadBalance,
      maxBalance,
      balanceLimitEnd,
      balanceLimitActive,
      controller,
      poolLocked,
    ] = await Promise.all([
      publicClient.readContract({
        address: airlock,
        abi: airlockAbi,
        functionName: "getAssetData",
        args: [token],
      }),
      publicClient.readContract({
        address: getAddress(product.contracts.dopplerHookInitializer),
        abi: dopplerHookInitializerAbi,
        functionName: "getState",
        args: [token],
      }),
      pool.getState(),
      publicClient.readContract({
        address: getAddress(product.contracts.uniswapV4StateView),
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [poolId],
      }),
      tokenEntity.getTotalSupply(),
      tokenEntity.getVestingScheduleCount(),
      tokenEntity.getVestedTotalAmount(),
      tokenEntity.getBalanceOf(creator.address),
      tokenEntity.getBalanceOf(DEAD_ADDRESS),
      tokenEntity.getMaxBalanceLimit(),
      tokenEntity.getBalanceLimitEnd(),
      tokenEntity.isBalanceLimitActive(),
      tokenEntity.getController(),
      tokenEntity.isPoolLocked(),
    ]);

    const childPoolKey = poolState.poolKey;
    const [feeSchedule, feeRoutingMode, feeDistribution] = await Promise.all([
      publicClient.readContract({
        address: getAddress(hookState[2]),
        abi: rehypeDopplerHookAbi,
        functionName: "getFeeSchedule",
        args: [poolId],
      }),
      publicClient.readContract({
        address: getAddress(hookState[2]),
        abi: rehypeDopplerHookAbi,
        functionName: "getFeeRoutingMode",
        args: [poolId],
      }),
      publicClient.readContract({
        address: getAddress(hookState[2]),
        abi: rehypeDopplerHookAbi,
        functionName: "getFeeDistributionInfo",
        args: [poolId],
      }),
    ]);
    assert.equal(poolState.asset.toLowerCase(), token.toLowerCase());
    assert.equal(poolState.numeraire.toLowerCase(), product.contracts.hoodie.toLowerCase());
    assert.equal(poolId.toLowerCase(), simulation.poolId.toLowerCase());

    const openingHoodiePerToken = v4PriceForMarket(
      childPoolKey,
      slot0BeforeTrading[0],
      token,
      product.token.decimals,
    );
    const openingFdvHoodie = calculateFdv(
      openingHoodiePerToken,
      totalSupply,
      product.token.decimals,
    );
    const openingFdvUsd = multiplyRationals(
      openingFdvHoodie,
      decimalToRational(price.hoodieUsd),
    );
    const openingFdvUsdWhole =
      openingFdvUsd.numerator / openingFdvUsd.denominator;
    const targetFdv = BigInt(product.market.targetOpeningFdvUsd);
    addCheck(
      checks,
      "opening-fdv-target",
      targetFdv === 30_000n,
      `$${targetFdv}`,
    );
    addCheck(
      checks,
      "opening-fdv-within-tolerance",
      withinBps(
        openingFdvUsdWhole,
        targetFdv,
        product.market.openingFdvToleranceBps,
      ),
      `$${formatRational(openingFdvUsd, 6)}`,
    );
    addCheck(
      checks,
      "total-supply-exact",
      totalSupply === V4_TOTAL_SUPPLY &&
        BigInt(assetData[8]) === V4_TOTAL_SUPPLY,
      totalSupply.toString(),
    );
    addCheck(
      checks,
      "market-allocation-exact",
      BigInt(assetData[7]) === V4_TOKENS_TO_SELL &&
        V4_TOKENS_TO_SELL === V4_TOTAL_SUPPLY,
      BigInt(assetData[7]).toString(),
    );
    addCheck(
      checks,
      "no-vesting",
      vestingCount === 0n && vestedTotal === 0n,
      `schedules ${vestingCount}; vested ${vestedTotal}`,
    );
    addCheck(
      checks,
      "zero-creator-liquid-allocation",
      creatorBalanceAtLaunch === 0n,
      creatorBalanceAtLaunch.toString(),
    );
    addCheck(
      checks,
      "no-material-dead-inventory",
      deadBalance <= parseEther("1"),
      deadBalance.toString(),
    );
    addCheck(
      checks,
      "pool-locked",
      Number(poolState.status) === 2 &&
        Number(hookState[4]) === 2 &&
        poolLocked,
      `pool ${poolState.status}; hook ${hookState[4]}; token ${poolLocked}`,
    );
    addCheck(
      checks,
      "noop-migration",
      simulation.createParams.liquidityMigrator.toLowerCase() ===
        product.contracts.noOpMigrator.toLowerCase() &&
        assetData[3].toLowerCase() ===
          product.contracts.noOpMigrator.toLowerCase(),
      assetData[3],
    );
    addCheck(
      checks,
      "noop-governance",
      simulation.createParams.governanceFactory.toLowerCase() ===
        product.contracts.noOpGovernanceFactory.toLowerCase(),
      simulation.createParams.governanceFactory,
    );
    addCheck(
      checks,
      "token-policy",
      maxBalance === V4_MAX_WALLET &&
        balanceLimitEnd ===
          launchTimestamp + product.token.maxWalletDurationSeconds &&
        balanceLimitActive &&
        controller.toLowerCase() === product.token.controller.toLowerCase(),
      `max ${maxBalance}; end ${balanceLimitEnd}; controller ${controller}`,
    );
    addCheck(
      checks,
      "v4-active-lp-fee-one-percent",
      Number(slot0BeforeTrading[3]) === V4_LP_FEE,
      String(slot0BeforeTrading[3]),
    );
    addCheck(
      checks,
      "rehype-hook-fee-zero",
      Number(feeSchedule[1]) === 0 &&
        Number(feeSchedule[2]) === 0 &&
        Number(feeSchedule[3]) === 0 &&
        Number(feeRoutingMode) === 1 &&
        BigInt(feeDistribution[2]) === BigInt(product.fees.wad) &&
        BigInt(feeDistribution[6]) === BigInt(product.fees.wad),
      `fees ${feeSchedule[1]}/${feeSchedule[2]}/${feeSchedule[3]}; mode ${feeRoutingMode}`,
    );

    const beneficiaries = getV4Beneficiaries(
      creator.address,
      getAddress(airlockOwner),
    );
    const configuredShares = await Promise.all(
      beneficiaries.map(({ beneficiary }) =>
        publicClient.readContract({
          address: getAddress(product.contracts.dopplerHookInitializer),
          abi: feeClaimsAbi,
          functionName: "getShares",
          args: [poolId, beneficiary],
        })),
    );
    assert.deepEqual(
      configuredShares,
      beneficiaries.map(({ shares }) => shares),
      "V4 beneficiary shares differ from 80/15/5",
    );

    const router = getAddress(product.contracts.uniswapUniversalRouter);
    const hoodie = getAddress(product.contracts.hoodie);
    const weth = getAddress(product.contracts.weth);
    const swapTraceLabels = {
      [token.toLowerCase()]: "HoodiePadChildToken",
      [childPoolKey.hooks.toLowerCase()]: "DopplerHook",
    };
    const firstTokens = parseEther("10000000");
    const secondTokens = parseEther("11000000");
    const sellTokens = parseEther("1000000");
    const firstQuote = await sdk.quoter.quoteExactOutputV4Quoter({
      poolKey: childPoolKey,
      zeroForOne:
        hoodie.toLowerCase() === childPoolKey.currency0.toLowerCase(),
      exactAmount: firstTokens,
      hookData: "0x",
    });
    const secondQuote = await sdk.quoter.quoteExactOutputV4Quoter({
      poolKey: childPoolKey,
      zeroForOne:
        hoodie.toLowerCase() === childPoolKey.currency0.toLowerCase(),
      exactAmount: secondTokens,
      hookData: "0x",
    });
    const firstInputQuote = await sdk.quoter.quoteExactInputV4Quoter({
      poolKey: childPoolKey,
      zeroForOne:
        hoodie.toLowerCase() === childPoolKey.currency0.toLowerCase(),
      exactAmount: firstQuote.amountIn,
      hookData: "0x",
    });
    assert.ok(firstInputQuote.amountOut > 0n);
    const fundingAmount =
      (firstQuote.amountIn + secondQuote.amountIn) * 4n +
      parseEther("1000000");
    const poolManager = getAddress(product.contracts.uniswapV4PoolManager);
    await testClient.setBalance({ address: poolManager, value: parseEther("10") });
    await testClient.impersonateAccount({ address: poolManager });
    const poolManagerWallet = createWalletClient({
      account: poolManager,
      chain: robinhood,
      transport: http(LOCAL_RPC_URL),
    });
    const fundingHash = await poolManagerWallet.writeContract({
      account: poolManager,
      address: hoodie,
      abi: erc20Abi,
      functionName: "transfer",
      args: [buyer.address, fundingAmount],
      chain: robinhood,
    });
    await waitForSuccess(publicClient, fundingHash);
    await testClient.stopImpersonatingAccount({ address: poolManager });

    const approvalExpiration =
      Number(forkBlock.timestamp) + 7 * 86_400;
    const maxUint160 = (1n << 160n) - 1n;
    await approvePermit2({
      client: publicClient,
      wallet: buyerWallet,
      account: buyer,
      token: hoodie,
      amount: maxUint160,
      expiration: approvalExpiration,
    });
    const [
      permitAllowance,
      hoodiePermit2Allowance,
      buyerHoodieBalance,
      buyerChildBalance,
      poolManagerChildBalance,
      poolManagerHoodieBalance,
      poolManagerExcluded,
      hookExcluded,
    ] = await Promise.all([
      publicClient.readContract({
        address: getAddress(product.contracts.permit2),
        abi: permit2Abi,
        functionName: "allowance",
        args: [buyer.address, hoodie, router],
      }),
      publicClient.readContract({
        address: hoodie,
        abi: erc20Abi,
        functionName: "allowance",
        args: [buyer.address, getAddress(product.contracts.permit2)],
      }),
      publicClient.readContract({
        address: hoodie,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [buyer.address],
      }),
      tokenEntity.getBalanceOf(buyer.address),
      tokenEntity.getBalanceOf(poolManager),
      publicClient.readContract({
        address: hoodie,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [poolManager],
      }),
      tokenEntity.isExcludedFromBalanceLimit(poolManager),
      tokenEntity.isExcludedFromBalanceLimit(
        getAddress(childPoolKey.hooks),
      ),
    ]);
    addCheck(
      checks,
      "permit2-approval",
      hoodiePermit2Allowance >= firstQuote.amountIn &&
        permitAllowance[0] >= firstQuote.amountIn &&
        Number(permitAllowance[1]) >= approvalExpiration &&
        buyerHoodieBalance >= firstQuote.amountIn,
      `ERC20 ${hoodiePermit2Allowance}; Permit2 ${permitAllowance[0]}; ` +
        `expiry ${permitAllowance[1]}; balance ${buyerHoodieBalance}`,
    );
    assert.equal(
      buyerChildBalance,
      0n,
      "fork buyer must start without child tokens",
    );
    assert.ok(
      firstInputQuote.amountOut <= V4_MAX_WALLET,
      "first calibration buy quote exceeds the wallet cap",
    );
    assert.ok(
      poolManagerChildBalance >= firstInputQuote.amountOut,
      "PoolManager child-token custody is below the quoted output",
    );
    assert.ok(
      poolManagerHoodieBalance > 0n,
      "PoolManager has no HOODIE custody",
    );
    assert.ok(
      poolManagerExcluded && hookExcluded,
      "DopplerERC20V1 protocol balance-limit exclusions are incomplete",
    );
    process.stdout.write(
      "Swap preflight passed: ERC20 approval, Permit2 allowance, custody, " +
        "hook exclusions, and buyer wallet cap.\n",
    );

    const currentBlock = await publicClient.getBlock();
    const firstDeadline = currentBlock.timestamp + 3_600n;
    const referenceProbeAmount = parseEther("1000000");
    const referenceProbeQuote = await sdk.quoter.quoteExactInputV4Quoter({
      poolKey: referencePoolKey,
      zeroForOne:
        hoodie.toLowerCase() === referencePoolKey.currency0.toLowerCase(),
      exactAmount: referenceProbeAmount,
      hookData: "0x",
    });
    assert.ok(
      referenceProbeQuote.amountOut > 0n,
      "known-live HOODIE/WETH V4 control quote returned zero",
    );
    await simulateRouterTransaction({
      client: publicClient,
      account: buyer.address,
      data: encodeV4ExactInputSwap({
        poolKey: referencePoolKey,
        tokenIn: hoodie,
        tokenOut: weth,
        amountIn: referenceProbeAmount,
        minimumOut: referenceProbeQuote.amountOut * 99n / 100n,
        deadline: firstDeadline,
      }),
      labels: swapTraceLabels,
    });
    addCheck(
      checks,
      "uniswap-v4-router-control",
      true,
      `known-live HOODIE/WETH exact-input simulation returned ${referenceProbeQuote.amountOut} WETH`,
    );
    process.stdout.write(
      "Known-live HOODIE/WETH Universal Router control simulation passed.\n",
    );
    process.stdout.write("Executing direct HOODIE buy and wallet-cap checks...\n");
    const firstMinimumOut = firstInputQuote.amountOut * 99n / 100n;
    const firstBuyData = encodeV4ExactInputSwap({
      poolKey: childPoolKey,
      tokenIn: hoodie,
      tokenOut: token,
      amountIn: firstQuote.amountIn,
      minimumOut: firstMinimumOut,
      deadline: firstDeadline,
    });
    await sendRouterTransaction({
      client: publicClient,
      wallet: buyerWallet,
      account: buyer,
      data: firstBuyData,
      labels: swapTraceLabels,
    });
    const firstBalance = await tokenEntity.getBalanceOf(buyer.address);
    addCheck(
      checks,
      "direct-hoodie-buy",
      firstBalance >= firstMinimumOut &&
        firstBalance <= V4_MAX_WALLET,
      `${firstBalance} received from exact-input swap`,
    );

    const capCrossingTokens =
      V4_MAX_WALLET - firstBalance + parseEther("1000000");
    const capCrossingQuote = await sdk.quoter.quoteExactOutputV4Quoter({
      poolKey: childPoolKey,
      zeroForOne:
        hoodie.toLowerCase() === childPoolKey.currency0.toLowerCase(),
      exactAmount: capCrossingTokens,
      hookData: "0x",
    });
    const capCrossingInputQuote = await sdk.quoter.quoteExactInputV4Quoter({
      poolKey: childPoolKey,
      zeroForOne:
        hoodie.toLowerCase() === childPoolKey.currency0.toLowerCase(),
      exactAmount: capCrossingQuote.amountIn,
      hookData: "0x",
    });
    assert.ok(
      firstBalance + capCrossingInputQuote.amountOut > V4_MAX_WALLET,
      "calibration buys must cross the 2% maximum-wallet threshold",
    );
    const secondBuyData = encodeV4ExactInputSwap({
      poolKey: childPoolKey,
      tokenIn: hoodie,
      tokenOut: token,
      amountIn: capCrossingQuote.amountIn,
      minimumOut: capCrossingInputQuote.amountOut * 99n / 100n,
      deadline: firstDeadline,
    });
    let capRejected = false;
    try {
      await sendRouterTransaction({
        client: publicClient,
        wallet: buyerWallet,
        account: buyer,
        data: secondBuyData,
      });
    } catch {
      capRejected = true;
    }
    addCheck(
      checks,
      "max-wallet-enforced",
      capRejected &&
        await tokenEntity.getBalanceOf(buyer.address) === firstBalance,
      "second exact-input buy rejected above the 2% balance limit",
    );

    await testClient.increaseTime({
      seconds: product.token.maxWalletDurationSeconds + 1,
    });
    await testClient.mine({ blocks: 1 });
    const secondQuoteAfterExpiry =
      await sdk.quoter.quoteExactInputV4Quoter({
        poolKey: childPoolKey,
        zeroForOne:
          hoodie.toLowerCase() === childPoolKey.currency0.toLowerCase(),
        exactAmount: capCrossingQuote.amountIn,
        hookData: "0x",
      });
    const afterExpiryBlock = await publicClient.getBlock();
    await sendRouterTransaction({
      client: publicClient,
      wallet: buyerWallet,
      account: buyer,
      data: encodeV4ExactInputSwap({
        poolKey: childPoolKey,
        tokenIn: hoodie,
        tokenOut: token,
        amountIn: capCrossingQuote.amountIn,
        minimumOut: secondQuoteAfterExpiry.amountOut * 99n / 100n,
        deadline: afterExpiryBlock.timestamp + 3_600n,
      }),
    });
    const balanceAfterExpiry = await tokenEntity.getBalanceOf(buyer.address);
    addCheck(
      checks,
      "max-wallet-expired",
      balanceAfterExpiry > V4_MAX_WALLET &&
        balanceAfterExpiry >=
          firstBalance + secondQuoteAfterExpiry.amountOut * 99n / 100n &&
        !(await tokenEntity.isBalanceLimitActive()),
      balanceAfterExpiry.toString(),
    );

    await approvePermit2({
      client: publicClient,
      wallet: buyerWallet,
      account: buyer,
      token,
      amount: maxUint160,
      expiration: approvalExpiration,
    });
    const sellQuote = await sdk.quoter.quoteExactInputV4Quoter({
      poolKey: childPoolKey,
      zeroForOne:
        token.toLowerCase() === childPoolKey.currency0.toLowerCase(),
      exactAmount: sellTokens,
      hookData: "0x",
    });
    await sendRouterTransaction({
      client: publicClient,
      wallet: buyerWallet,
      account: buyer,
      data: encodeV4ExactInputSwap({
        poolKey: childPoolKey,
        tokenIn: token,
        tokenOut: hoodie,
        amountIn: sellTokens,
        minimumOut: sellQuote.amountOut * 99n / 100n,
        deadline: afterExpiryBlock.timestamp + 3_600n,
      }),
    });
    addCheck(
      checks,
      "direct-hoodie-sell",
      await tokenEntity.getBalanceOf(buyer.address) ===
        balanceAfterExpiry - sellTokens,
      `${sellTokens} sold`,
    );

    let minOutRejected = false;
    try {
      await sendRouterTransaction({
        client: publicClient,
        wallet: buyerWallet,
        account: buyer,
        data: encodeV4ExactInputSwap({
          poolKey: childPoolKey,
          tokenIn: token,
          tokenOut: hoodie,
          amountIn: sellTokens,
          minimumOut: sellQuote.amountOut * 2n,
          deadline: afterExpiryBlock.timestamp + 3_600n,
        }),
      });
    } catch {
      minOutRejected = true;
    }
    addCheck(
      checks,
      "quote-minout-enforced",
      minOutRejected,
      "impossible minimum output reverted",
    );

    let expiredRejected = false;
    try {
      await sendRouterTransaction({
        client: publicClient,
        wallet: buyerWallet,
        account: buyer,
        data: encodeV4ExactInputSwap({
          poolKey: childPoolKey,
          tokenIn: token,
          tokenOut: hoodie,
          amountIn: sellTokens,
          minimumOut: 0n,
          deadline: 1n,
        }),
      });
    } catch {
      expiredRejected = true;
    }
    addCheck(
      checks,
      "expired-quote-rejected",
      expiredRejected,
      "deadline 1 reverted",
    );

    process.stdout.write("Executing ETH multihop buy and sell...\n");
    const nativeInput = parseEther("0.001");
    const referenceBuy = await sdk.quoter.quoteExactInputV4Quoter({
      poolKey: referencePoolKey,
      zeroForOne:
        product.contracts.weth.toLowerCase() ===
        referencePoolKey.currency0.toLowerCase(),
      exactAmount: nativeInput,
      hookData: "0x",
    });
    const childBuy = await sdk.quoter.quoteExactInputV4Quoter({
      poolKey: childPoolKey,
      zeroForOne:
        hoodie.toLowerCase() === childPoolKey.currency0.toLowerCase(),
      exactAmount: referenceBuy.amountOut * 995n / 1_000n,
      hookData: "0x",
    });
    const beforeNativeBuy = await tokenEntity.getBalanceOf(buyer.address);
    const nativeBuyReceipt = await sendRouterTransaction({
      client: publicClient,
      wallet: buyerWallet,
      account: buyer,
      value: nativeInput,
      data: encodeV4EthToChildSwap({
        referencePoolKey,
        childPoolKey,
        weth: getAddress(product.contracts.weth),
        hoodie,
        child: token,
        amountIn: nativeInput,
        minimumOut: childBuy.amountOut * 90n / 100n,
        deadline: (await publicClient.getBlock()).timestamp + 3_600n,
      }),
    });
    const afterNativeBuy = await tokenEntity.getBalanceOf(buyer.address);
    const nativeTokens = afterNativeBuy - beforeNativeBuy;
    addCheck(
      checks,
      "eth-multihop-buy",
      nativeBuyReceipt.status === "success" && nativeTokens > 0n,
      `${nativeTokens} child tokens received`,
    );

    const nativeSellTokens = nativeTokens / 2n;
    const childSellHop = await sdk.quoter.quoteExactInputV4Quoter({
      poolKey: childPoolKey,
      zeroForOne:
        token.toLowerCase() === childPoolKey.currency0.toLowerCase(),
      exactAmount: nativeSellTokens,
      hookData: "0x",
    });
    const referenceSellHop = await sdk.quoter.quoteExactInputV4Quoter({
      poolKey: referencePoolKey,
      zeroForOne:
        hoodie.toLowerCase() === referencePoolKey.currency0.toLowerCase(),
      exactAmount: childSellHop.amountOut * 995n / 1_000n,
      hookData: "0x",
    });
    const nativeSellReceipt = await sendRouterTransaction({
      client: publicClient,
      wallet: buyerWallet,
      account: buyer,
      data: encodeV4ChildToEthSwap({
        childPoolKey,
        referencePoolKey,
        child: token,
        hoodie,
        weth: getAddress(product.contracts.weth),
        amountIn: nativeSellTokens,
        minimumOut: referenceSellHop.amountOut * 90n / 100n,
        deadline: (await publicClient.getBlock()).timestamp + 3_600n,
      }),
    });
    addCheck(
      checks,
      "eth-multihop-sell",
      nativeSellReceipt.status === "success" &&
        await tokenEntity.getBalanceOf(buyer.address) ===
          afterNativeBuy - nativeSellTokens,
      `${nativeSellTokens} child tokens sold to ETH`,
    );

    const swaps = await publicClient.getLogs({
      address: getAddress(product.contracts.uniswapV4PoolManager),
      event: swapEvent,
      args: { id: poolId },
      fromBlock: BigInt(report.forkBlock),
      toBlock: "latest",
      strict: true,
    });
    addCheck(
      checks,
      "v4-swap-indexing",
      swaps.length >= 5 &&
        swaps.some((event) => event.args.amount0 < 0n) &&
        swaps.some((event) => event.args.amount0 > 0n),
      `${swaps.length} confirmed child-pool Swap events`,
    );

    process.stdout.write("Collecting and validating V4 80/15/5 fees...\n");
    const beneficiaryAccounts = [
      creator.address,
      getAddress(product.contracts.hoodieEcosystemSafe),
      getAddress(airlockOwner),
    ] as const;
    const readBeneficiaryBalances = async () =>
      Promise.all(
        beneficiaryAccounts.map(async (beneficiary) => ({
          token: await publicClient.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [beneficiary],
          }),
          hoodie: await publicClient.readContract({
            address: hoodie,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [beneficiary],
          }),
        })),
      );
    const beforeClaims = await readBeneficiaryBalances();
    const creatorClaim = await collectForBeneficiary({
      client: publicClient,
      wallet: creatorWallet,
      account: creator.address,
      token,
    });

    const impersonated = [
      getAddress(product.contracts.hoodieEcosystemSafe),
      getAddress(airlockOwner),
    ];
    for (const beneficiary of impersonated) {
      await testClient.setBalance({
        address: beneficiary,
        value: parseEther("10"),
      });
      await testClient.impersonateAccount({ address: beneficiary });
      const wallet = createWalletClient({
        account: beneficiary,
        chain: robinhood,
        transport: http(LOCAL_RPC_URL),
      });
      await collectForBeneficiary({
        client: publicClient,
        wallet,
        account: beneficiary,
        token,
      });
      await testClient.stopImpersonatingAccount({ address: beneficiary });
    }
    const afterClaims = await readBeneficiaryBalances();
    const tokenDeltas = afterClaims.map(
      (balance, index) => balance.token - beforeClaims[index].token,
    );
    const hoodieDeltas = afterClaims.map(
      (balance, index) => balance.hoodie - beforeClaims[index].hoodie,
    );
    addCheck(
      checks,
      "creator-pending-fees",
      creatorClaim.fees0 > 0n || creatorClaim.fees1 > 0n,
      `collectFees preview ${creatorClaim.fees0}/${creatorClaim.fees1}`,
    );
    addCheck(
      checks,
      "creator-fee-claim",
      tokenDeltas[0] > 0n || hoodieDeltas[0] > 0n,
      `${tokenDeltas[0]}/${hoodieDeltas[0]}`,
    );
    addCheck(
      checks,
      "ecosystem-fee-claim",
      tokenDeltas[1] > 0n || hoodieDeltas[1] > 0n,
      `${tokenDeltas[1]}/${hoodieDeltas[1]}`,
    );
    addCheck(
      checks,
      "protocol-fee-claim",
      tokenDeltas[2] > 0n || hoodieDeltas[2] > 0n,
      `${tokenDeltas[2]}/${hoodieDeltas[2]}`,
    );
    const tokenTotal = tokenDeltas.reduce((sum, value) => sum + value, 0n);
    const hoodieTotal = hoodieDeltas.reduce((sum, value) => sum + value, 0n);
    const feeSplitMatches = beneficiaries.every(({ beneficiary, shares }) => {
      const index = beneficiaryAccounts.findIndex(
        (candidate) =>
          candidate.toLowerCase() === beneficiary.toLowerCase(),
      );
      return (
        (tokenTotal === 0n ||
          withinFeeTolerance(tokenDeltas[index], tokenTotal, shares)) &&
        (hoodieTotal === 0n ||
          withinFeeTolerance(hoodieDeltas[index], hoodieTotal, shares))
      );
    });
    addCheck(
      checks,
      "fee-split-80-15-5",
      feeSplitMatches && (tokenTotal > 0n || hoodieTotal > 0n),
      `token ${tokenDeltas.join("/")}; HOODIE ${hoodieDeltas.join("/")}`,
    );

    const q96 = 1n << 96n;
    const lowChild = getAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const highChild = getAddress(
      "0xF111111111111111111111111111111111111111",
    );
    const token0Price = v4PriceForMarket(
      {
        currency0: lowChild,
        currency1: hoodie,
        fee: V4_LP_FEE,
        tickSpacing: product.market.tickSpacing,
        hooks: getAddress(product.contracts.dopplerHookInitializer),
      },
      q96,
      lowChild,
      18,
    );
    const token1Price = v4PriceForMarket(
      {
        currency0: hoodie,
        currency1: highChild,
        fee: V4_LP_FEE,
        tickSpacing: product.market.tickSpacing,
        hooks: getAddress(product.contracts.dopplerHookInitializer),
      },
      q96,
      highChild,
      18,
    );
    addCheck(
      checks,
      "price-orientation-token0",
      token0Price.numerator === token0Price.denominator,
      formatRational(token0Price, 2),
    );
    addCheck(
      checks,
      "price-orientation-token1",
      token1Price.numerator === token1Price.denominator,
      formatRational(token1Price, 2),
    );

    const legacyAssetData = await publicClient.readContract({
      address: getAddress(legacyProduct.contracts.airlock),
      abi: airlockAbi,
      functionName: "getAssetData",
      args: [LEGACY_V3_REFERENCE_TOKEN],
    });
    const legacyCode = await publicClient.getCode({
      address: LEGACY_V3_REFERENCE_TOKEN,
    });
    addCheck(
      checks,
      "legacy-v3-regression",
      !!legacyCode &&
        legacyCode !== "0x" &&
        legacyAssetData[4].toLowerCase() ===
          legacyProduct.contracts.lockableV3Initializer.toLowerCase(),
      `${LEGACY_V3_REFERENCE_TOKEN} remains readable through V3 initializer`,
    );

    const missing = REQUIRED_V4_CALIBRATION_CHECKS.filter(
      (name) => !checks.some((check) => check.name === name && check.passed),
    );
    assert.deepEqual(missing, [], `missing checks: ${missing.join(", ")}`);
    report.status = "passed";
    report.completedAt = new Date().toISOString();
    await writeFile(
      REPORT_PATH,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(
      `V4 calibration PASSED at fork block ${report.forkBlock}\n`,
    );
    process.stdout.write(`Checks ${checks.length}\n`);
    process.stdout.write(`Report ${REPORT_PATH}\n`);
  } catch (error) {
    report.status = "failed";
    report.completedAt = new Date().toISOString();
    await writeFile(
      REPORT_PATH,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ).catch(() => undefined);
    throw error;
  } finally {
    fork?.child.kill();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`V4 calibration FAILED: ${redactError(error)}\n`);
  process.exitCode = 1;
}
