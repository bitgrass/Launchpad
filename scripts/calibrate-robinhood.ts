import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  maxUint256,
  parseAbi,
  parseAbiParameters,
  parseEther,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEAD_ADDRESS,
  DopplerSDK,
  getAddresses,
  lockableUniswapV3InitializerAbi,
  quoterV2Abi,
  uniswapV3PoolAbi,
} from "@whetstone-research/doppler-sdk/evm";
import product from "../config/hoodiepad-v1.json";
import {
  getCalibrationConfigHash,
  type CalibrationCheck,
  type CalibrationReport,
} from "../app/lib/calibration";
import {
  buildStaticLaunchParams,
  inspectRobinhoodChain,
  robinhood,
} from "../app/lib/protocol";

const LOCAL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const LOCAL_PORT = Number(process.env.HOODIEPAD_FORK_PORT ?? "8547");
const LOCAL_RPC_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const REPORT_PATH = join(process.cwd(), "config", "hoodie-curve-calibration.json");

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
const universalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);
const exactInputParameters = parseAbiParameters(
  "address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser, uint256[] minHopPriceX36",
);
const exactOutputParameters = parseAbiParameters(
  "address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser, uint256[] minHopPriceX36",
);

function sourceRpcUrl() {
  const forkOverride = process.env.HOODIEPAD_FORK_RPC_URL?.trim();
  if (forkOverride) return forkOverride;
  const alchemyKey = process.env.Alchemy_API_KEY?.trim();
  if (alchemyKey) return `https://robinhood-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  const fallback = process.env.ROBINHOOD_RPC_URL?.trim();
  if (fallback) return fallback;
  throw new Error("Set Alchemy_API_KEY or HOODIEPAD_FORK_RPC_URL before calibration");
}

function redactError(error: unknown) {
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
    "--silent",
  ];
  const pinnedBlock = process.env.HOODIEPAD_FORK_BLOCK?.trim();
  if (pinnedBlock) args.push("--fork-block-number", pinnedBlock);

  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"] as const,
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const client = createPublicClient({ chain: robinhood, transport: http(LOCAL_RPC_URL) });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Anvil stopped before startup: ${redactError(stderr)}`);
    }
    try {
      if (await client.getChainId() === product.network.chainId) return { child, client };
    } catch {
      // The fork is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error("Anvil did not start within 60 seconds");
}

function addCheck(
  checks: CalibrationCheck[],
  name: string,
  passed: boolean,
  details?: string,
) {
  checks.push({ name, passed, ...(details ? { details } : {}) });
  assert.equal(passed, true, `${name} failed${details ? `: ${details}` : ""}`);
}

function v3Path(tokenIn: Address, tokenOut: Address) {
  return concatHex([
    tokenIn,
    toHex(product.pool.fee, { size: 3 }),
    tokenOut,
  ]);
}

function exactOutputPath(tokenIn: Address, tokenOut: Address) {
  return v3Path(tokenOut, tokenIn);
}

function withinFeeTolerance(actual: bigint, total: bigint, expectedShare: bigint) {
  const wad = BigInt(product.fees.wad);
  const difference = actual * wad >= total * expectedShare
    ? actual * wad - total * expectedShare
    : total * expectedShare - actual * wad;
  return difference <= total * 100_000_000_000_000n + 10n * wad;
}

async function main() {
  const checks: CalibrationCheck[] = [];
  const report: CalibrationReport = {
    version: 1,
    status: "pending",
    chainId: product.network.chainId,
    forkBlock: null,
    referenceTick: null,
    startTick: null,
    endTick: null,
    configHash: getCalibrationConfigHash(),
    completedAt: null,
    checks,
  };
  let fork: Awaited<ReturnType<typeof startFork>> | undefined;

  try {
    process.stdout.write("Starting disposable Robinhood fork...\n");
    fork = await startFork();
    const publicClient = fork.client;
    const testClient = createTestClient({
      chain: robinhood,
      mode: "anvil",
      transport: http(LOCAL_RPC_URL),
    });
    const creator = privateKeyToAccount(LOCAL_PRIVATE_KEY);
    const creatorWallet = createWalletClient({
      account: creator,
      chain: robinhood,
      transport: http(LOCAL_RPC_URL),
    });
    const buyer = privateKeyToAccount(
      "0x59c6995e998f97a5a0044976f7d7d2996287b1a65d13fbb0d4fbb6ab3b6f6f3e",
    );
    const buyerWallet = createWalletClient({
      account: buyer,
      chain: robinhood,
      transport: http(LOCAL_RPC_URL),
    });
    await testClient.setBalance({ address: creator.address, value: parseEther("100") });
    await testClient.setBalance({ address: buyer.address, value: parseEther("100") });

    const chainStatus = await inspectRobinhoodChain(publicClient);
    assert.equal(chainStatus.available, true, chainStatus.error);
    assert.ok(chainStatus.referencePool);
    assert.ok(chainStatus.airlockOwner);
    assert.ok(
      Object.values(chainStatus.dependencies ?? {}).every((dependency) =>
        dependency.matchesExpectedHash),
      "A fork dependency differs from the approved runtime hash snapshot",
    );

    const block = await publicClient.getBlock();
    process.stdout.write(`Fork ready at block ${block.number}\n`);
    report.forkBlock = block.number.toString();
    report.referenceTick = chainStatus.referencePool.tick;
    const built = buildStaticLaunchParams(
      {
        name: "HoodiePad Calibration",
        symbol: "HPCAL",
        tokenURI: "https://hoodie.fun/hoodiepad-calibration.json",
        creator: creator.address,
        chainStatus,
      },
      chainStatus,
      Number(block.timestamp),
    );
    report.startTick = built.curve.startTick;
    report.endTick = built.curve.endTick;

    const sdk = new DopplerSDK({
      publicClient,
      walletClient: creatorWallet,
      chainId: product.network.chainId,
    });
    process.stdout.write("Creating the exact HoodiePad launch on the fork...\n");
    const launch = await sdk.factory.simulateCreateStaticAuction(built.params);
    const executed = await launch.execute();
    await publicClient.waitForTransactionReceipt({ hash: executed.transactionHash as Hex });
    process.stdout.write("Launch created; validating token and locked pool...\n");
    addCheck(
      checks,
      "launch-created",
      executed.tokenAddress.toLowerCase() === launch.asset.toLowerCase() &&
        executed.poolAddress.toLowerCase() === launch.pool.toLowerCase(),
      `token ${executed.tokenAddress}; pool ${executed.poolAddress}`,
    );

    const token = executed.tokenAddress;
    const pool = executed.poolAddress;
    const [tokenCode, poolCode, token0, token1, poolFee, initializerState] =
      await Promise.all([
        publicClient.getCode({ address: token }),
        publicClient.getCode({ address: pool }),
        publicClient.readContract({
          address: pool,
          abi: uniswapV3PoolAbi,
          functionName: "token0",
        }),
        publicClient.readContract({
          address: pool,
          abi: uniswapV3PoolAbi,
          functionName: "token1",
        }),
        publicClient.readContract({
          address: pool,
          abi: uniswapV3PoolAbi,
          functionName: "fee",
        }),
        publicClient.readContract({
          address: product.contracts.lockableV3Initializer as Address,
          abi: lockableUniswapV3InitializerAbi,
          functionName: "getState",
          args: [pool],
        }),
      ]);
    assert.notEqual(tokenCode, "0x");
    assert.notEqual(poolCode, "0x");
    assert.equal(Number(poolFee), product.pool.fee);
    addCheck(
      checks,
      "token-ordering",
      token0.toLowerCase() === token.toLowerCase() &&
        token1.toLowerCase() === product.contracts.hoodie.toLowerCase(),
      `${token0} / ${token1}`,
    );
    addCheck(
      checks,
      "pool-locked",
      Number(initializerState[6]) === 2 &&
        Number(initializerState[2]) === built.curve.startTick &&
        Number(initializerState[3]) === built.curve.endTick,
      `status ${initializerState[6]}; ticks ${initializerState[2]} to ${initializerState[3]}`,
    );

    const tokenEntity = sdk.getDopplerERC20V1(token);
    const [
      maxBalance,
      balanceLimitEnd,
      balanceLimitActive,
      controller,
      tokenPool,
      tokenPoolLocked,
      canonicalPoolExcluded,
      noOpGovernanceExcluded,
    ] =
      await Promise.all([
        tokenEntity.getMaxBalanceLimit(),
        tokenEntity.getBalanceLimitEnd(),
        tokenEntity.isBalanceLimitActive(),
        tokenEntity.getController(),
        tokenEntity.getPool(),
        tokenEntity.isPoolLocked(),
        tokenEntity.isExcludedFromBalanceLimit(pool),
        tokenEntity.isExcludedFromBalanceLimit(DEAD_ADDRESS),
      ]);
    const expectedMaxBalance = parseEther(product.token.maxWalletTokens);
    const expectedBalanceLimitEnd =
      Number(block.timestamp) + product.token.maxWalletDurationSeconds;
    const tokenPolicyValid =
      maxBalance === expectedMaxBalance &&
      balanceLimitEnd === expectedBalanceLimitEnd &&
      balanceLimitActive &&
      controller.toLowerCase() === product.token.controller.toLowerCase() &&
      tokenPool.toLowerCase() === product.pool.noOpMigrationPool.toLowerCase() &&
      tokenPoolLocked &&
      canonicalPoolExcluded &&
      noOpGovernanceExcluded;
    addCheck(
      checks,
      "token-policy",
      tokenPolicyValid,
      [
        `maxBalance ${maxBalance} expected ${expectedMaxBalance}`,
        `balanceLimitEnd ${balanceLimitEnd} expected ${expectedBalanceLimitEnd}`,
        `active ${balanceLimitActive}`,
        `controller ${controller} expected ${product.token.controller}`,
        `NoOp migration pool ${tokenPool} expected ${product.pool.noOpMigrationPool}`,
        `pool lock active ${tokenPoolLocked}`,
        `canonical V3 pool excluded ${canonicalPoolExcluded}`,
        `NoOp governance excluded ${noOpGovernanceExcluded}`,
      ].join("; "),
    );

    const addresses = getAddresses(product.network.chainId);
    const tenMillionTokens = parseEther("10000000");
    const elevenMillionTokens = parseEther("11000000");
    const oneMillionTokens = parseEther("1000000");
    const quoteExactOutput = async (amountOut: bigint) => {
      const simulation = await publicClient.simulateContract({
        account: buyer.address,
        address: addresses.v3Quoter,
        abi: quoterV2Abi,
        functionName: "quoteExactOutputSingle",
        args: [{
          tokenIn: product.contracts.hoodie as Address,
          tokenOut: token,
          amount: amountOut,
          fee: product.pool.fee,
          sqrtPriceLimitX96: 0n,
        }],
      });
      return simulation.result[0];
    };
    const firstInput = await quoteExactOutput(tenMillionTokens);
    const secondInput = await quoteExactOutput(elevenMillionTokens);
    const fundingAmount = (firstInput + secondInput) * 3n;

    const poolManager = product.contracts.uniswapV4PoolManager as Address;
    const poolManagerHoodieBalance = await publicClient.readContract({
      address: product.contracts.hoodie as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [poolManager],
    });
    assert.ok(
      poolManagerHoodieBalance >= fundingAmount,
      "The fork PoolManager does not hold enough HOODIE for calibration",
    );
    await testClient.setBalance({ address: poolManager, value: parseEther("10") });
    await testClient.impersonateAccount({ address: poolManager });
    const poolManagerWallet = createWalletClient({
      account: poolManager,
      chain: robinhood,
      transport: http(LOCAL_RPC_URL),
    });
    const fundingHash = await poolManagerWallet.writeContract({
      address: product.contracts.hoodie as Address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [buyer.address, fundingAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: fundingHash });
    await testClient.stopImpersonatingAccount({ address: poolManager });

    const maxUint160 = (1n << 160n) - 1n;
    const approvalExpiration = Number(block.timestamp) + 7 * 86_400;
    const approveTokenForRouter = async (tokenAddress: Address) => {
      const approvalHash = await buyerWallet.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [addresses.permit2, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      const permitHash = await buyerWallet.writeContract({
        address: addresses.permit2,
        abi: permit2Abi,
        functionName: "approve",
        args: [tokenAddress, addresses.universalRouter, maxUint160, approvalExpiration],
      });
      await publicClient.waitForTransactionReceipt({ hash: permitHash });
    };
    await approveTokenForRouter(product.contracts.hoodie as Address);

    const exactOutputSwap = async (amountOut: bigint, amountInMaximum: bigint) => {
      const latest = await publicClient.getBlock();
      const input = encodeAbiParameters(exactOutputParameters, [
        buyer.address,
        amountOut,
        amountInMaximum,
        exactOutputPath(product.contracts.hoodie as Address, token),
        true,
        [],
      ]);
      const hash = await buyerWallet.writeContract({
        address: addresses.universalRouter,
        abi: universalRouterAbi,
        functionName: "execute",
        args: ["0x01", [input], latest.timestamp + 3_600n],
      });
      return publicClient.waitForTransactionReceipt({ hash });
    };

    process.stdout.write("Executing fork buy and maximum-wallet rejection...\n");
    await exactOutputSwap(tenMillionTokens, firstInput * 101n / 100n + 1n);
    const firstBalance = await tokenEntity.getBalanceOf(buyer.address);
    addCheck(checks, "buy", firstBalance === tenMillionTokens, `${firstBalance} wei received`);

    let capRejected = false;
    try {
      await exactOutputSwap(elevenMillionTokens, secondInput * 101n / 100n + 1n);
    } catch {
      capRejected = true;
    }
    const cappedBalance = await tokenEntity.getBalanceOf(buyer.address);
    addCheck(
      checks,
      "max-wallet-enforced",
      capRejected && cappedBalance === tenMillionTokens,
      `balance remained ${cappedBalance}`,
    );

    process.stdout.write("Advancing fork time beyond the 24-hour wallet limit...\n");
    await testClient.increaseTime({
      seconds: product.token.maxWalletDurationSeconds + 1,
    });
    await testClient.mine({ blocks: 1 });
    const secondInputAfterExpiry = await quoteExactOutput(elevenMillionTokens);
    await exactOutputSwap(
      elevenMillionTokens,
      secondInputAfterExpiry * 101n / 100n + 1n,
    );
    const expiredBalance = await tokenEntity.getBalanceOf(buyer.address);
    addCheck(
      checks,
      "max-wallet-expired",
      expiredBalance === tenMillionTokens + elevenMillionTokens &&
        !(await tokenEntity.isBalanceLimitActive()),
      `balance ${expiredBalance}`,
    );

    process.stdout.write("Executing reverse sell...\n");
    await approveTokenForRouter(token);
    const exactInputQuote = await publicClient.simulateContract({
      account: buyer.address,
      address: addresses.v3Quoter,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{
        tokenIn: token,
        tokenOut: product.contracts.hoodie as Address,
        amountIn: oneMillionTokens,
        fee: product.pool.fee,
        sqrtPriceLimitX96: 0n,
      }],
    });
    const latest = await publicClient.getBlock();
    const sellInput = encodeAbiParameters(exactInputParameters, [
      buyer.address,
      oneMillionTokens,
      exactInputQuote.result[0] * 99n / 100n,
      v3Path(token, product.contracts.hoodie as Address),
      true,
      [],
    ]);
    const sellHash = await buyerWallet.writeContract({
      address: addresses.universalRouter,
      abi: universalRouterAbi,
      functionName: "execute",
      args: ["0x00", [sellInput], latest.timestamp + 3_600n],
    });
    await publicClient.waitForTransactionReceipt({ hash: sellHash });
    const balanceAfterSell = await tokenEntity.getBalanceOf(buyer.address);
    addCheck(
      checks,
      "sell",
      balanceAfterSell === expiredBalance - oneMillionTokens,
      `balance ${balanceAfterSell}`,
    );

    process.stdout.write("Collecting and validating the 80/15/5 fee split...\n");
    const beneficiaries = [
      creator.address,
      product.contracts.hoodieEcosystemSafe as Address,
      chainStatus.airlockOwner,
    ] as const;
    const readBalances = async (tokenAddress: Address) =>
      Promise.all(beneficiaries.map((beneficiary) =>
        publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [beneficiary],
        })));
    const [hoodieBefore, tokenBefore] = await Promise.all([
      readBalances(product.contracts.hoodie as Address),
      readBalances(token),
    ]);
    const claimSimulation = await publicClient.simulateContract({
      account: creator.address,
      address: product.contracts.lockableV3Initializer as Address,
      abi: lockableUniswapV3InitializerAbi,
      functionName: "collectFees",
      args: [pool],
    });
    const claimHash = await creatorWallet.writeContract(claimSimulation.request);
    await publicClient.waitForTransactionReceipt({ hash: claimHash });
    const [hoodieAfter, tokenAfter] = await Promise.all([
      readBalances(product.contracts.hoodie as Address),
      readBalances(token),
    ]);
    const hoodieDeltas = hoodieAfter.map((value, index) => value - hoodieBefore[index]);
    const tokenDeltas = tokenAfter.map((value, index) => value - tokenBefore[index]);
    const hoodieTotal = hoodieDeltas.reduce((sum, value) => sum + value, 0n);
    const tokenTotal = tokenDeltas.reduce((sum, value) => sum + value, 0n);
    addCheck(
      checks,
      "fee-claim",
      hoodieTotal > 0n && tokenTotal > 0n,
      `HOODIE ${hoodieTotal}; token ${tokenTotal}`,
    );
    const expectedShares = [
      BigInt(product.fees.creator),
      BigInt(product.fees.hoodieEcosystem),
      BigInt(product.fees.doppler),
    ];
    const feeSplitValid = expectedShares.every((share, index) =>
      withinFeeTolerance(hoodieDeltas[index], hoodieTotal, share) &&
      withinFeeTolerance(tokenDeltas[index], tokenTotal, share));
    addCheck(
      checks,
      "fee-split-80-15-5",
      feeSplitValid,
      `HOODIE ${hoodieDeltas.join("/")}; token ${tokenDeltas.join("/")}`,
    );

    process.stdout.write("Proving locked liquidity cannot exit...\n");
    let exitRejected = false;
    try {
      await publicClient.simulateContract({
        account: creator.address,
        address: product.contracts.lockableV3Initializer as Address,
        abi: lockableUniswapV3InitializerAbi,
        functionName: "exitLiquidity",
        args: [pool],
      });
    } catch {
      exitRejected = true;
    }
    addCheck(checks, "noop-migration-locked", exitRejected);

    report.status = "passed";
    report.completedAt = new Date().toISOString();
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`Calibration PASSED at fork block ${report.forkBlock}\n`);
    process.stdout.write(`Curve ${report.startTick} -> ${report.endTick}\n`);
    process.stdout.write(`Report ${REPORT_PATH}\n`);
  } catch (error) {
    report.status = "failed";
    report.completedAt = new Date().toISOString();
    checks.push({ name: "calibration-run", passed: false, details: redactError(error) });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stderr.write(`Calibration FAILED: ${redactError(error)}\n`);
    process.exitCode = 1;
  } finally {
    fork?.child.kill();
  }
}

await main();
