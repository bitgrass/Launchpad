import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import {
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  maxUint256,
  parseAbi,
  parseAbiParameters,
} from "viem";
import {
  getCalibrationConfigHash,
  isCalibrationReportApproved,
  REQUIRED_CALIBRATION_CHECKS,
} from "../app/lib/calibration";
import {
  deriveHoodieCurve,
  deriveHoodieCurveForOrdering,
  getBeneficiaryConflict,
  runtimeHashMatches,
} from "../app/lib/protocol";
import { getReleasePolicy } from "../app/lib/release-policy";
import {
  encodeV4ChildToEthSwap,
  encodeV4EthToChildSwap,
  encodeV4ExactInputSwap,
  encodeV3ExactInputSwap,
  estimateMaxInputAtSpot,
  routerDeploymentMatches,
} from "../app/lib/swap";
import {
  checkObjectStorage,
  getStoredObject,
  headStoredObject,
  putStoredObject,
} from "../app/lib/object-storage";

test("derives the HOODIE curve for Doppler's child-token0 ordering", () => {
  const curve = deriveHoodieCurve(198_200);
  assert.deepEqual(curve, {
    startTick: -26_800,
    endTick: 23_200,
    referenceTick: 198_200,
    tickSpacing: 200,
    status: "calibrated",
  });
});

test("inverts and swaps the tick range when token ordering changes", () => {
  const childToken0 = deriveHoodieCurveForOrdering(
    198_200,
    "child-token0-hoodie-token1",
  );
  const hoodieToken0 = deriveHoodieCurveForOrdering(
    198_200,
    "hoodie-token0-child-token1",
  );

  assert.deepEqual(
    [childToken0.startTick, childToken0.endTick],
    [-hoodieToken0.endTick, -hoodieToken0.startTick],
  );
  assert.deepEqual(
    [childToken0.startTick, childToken0.endTick],
    [-26_800, 23_200],
  );
  assert.deepEqual(
    [hoodieToken0.startTick, hoodieToken0.endTick],
    [-23_200, 26_800],
  );
});

test("always aligns candidate ticks to the 1% V3 tick spacing", () => {
  for (const referenceTick of [197_901, 198_000, 198_199, 198_401]) {
    const curve = deriveHoodieCurve(referenceTick);
    assert.equal(Math.abs(curve.startTick % curve.tickSpacing), 0);
    assert.equal(Math.abs(curve.endTick % curve.tickSpacing), 0);
    assert.ok(curve.startTick < curve.endTick);
    assert.equal(curve.endTick - curve.startTick, 50_000);
  }
});

test("rejects creator wallets that duplicate a fixed fee beneficiary", () => {
  const ecosystemSafe = "0xAB10Efe787DB2ef3700b94578aeC68b98e0446A7";
  const protocolOwner = "0xEDeAa06E2eB42A5c19ce27c6cfFb36fd4fE1eDa8";
  const creator = "0x1111111111111111111111111111111111111111";

  assert.match(getBeneficiaryConflict(ecosystemSafe) ?? "", /ecosystem Safe/);
  assert.match(getBeneficiaryConflict(protocolOwner, protocolOwner) ?? "", /protocol beneficiary/);
  assert.equal(getBeneficiaryConflict(creator, protocolOwner), undefined);
});

test("matches runtime hashes case-insensitively and fails closed when absent", () => {
  const hash = "0xf10f86b05965a827a332e6c73086f18026fbe3917f4bffbec3f938b3b5397b56" as const;
  assert.equal(runtimeHashMatches(hash, hash), true);
  assert.equal(
    runtimeHashMatches(hash.toUpperCase().replace("0X", "0x") as `0x${string}`, hash),
    true,
  );
  assert.equal(runtimeHashMatches(undefined, hash), false);
  assert.equal(runtimeHashMatches(`0x${"0".repeat(64)}`, hash), false);
});

test("requires a matching, complete fork-calibration report", () => {
  const passedReport = {
    version: 1,
    status: "passed" as const,
    chainId: 4663,
    forkBlock: "17170000",
    referenceTick: 201_200,
    startTick: -23_800,
    endTick: 26_200,
    configHash: getCalibrationConfigHash(),
    completedAt: "2026-07-23T10:00:00.000Z",
    checks: REQUIRED_CALIBRATION_CHECKS.map((name) => ({ name, passed: true })),
  };

  assert.equal(isCalibrationReportApproved(passedReport), true);
  assert.equal(
    isCalibrationReportApproved({ ...passedReport, configHash: `0x${"0".repeat(64)}` }),
    false,
  );
  assert.equal(
    isCalibrationReportApproved({
      ...passedReport,
      checks: passedReport.checks.filter((check) => check.name !== "sell"),
    }),
    false,
  );
});

test("records an owner waiver without mislabeling it as external review", () => {
  const policy = getReleasePolicy({
    HOODIEPAD_EXTERNAL_REVIEW_APPROVED: "false",
    HOODIEPAD_OWNER_RISK_WAIVER: "true",
    HOODIEPAD_BROADCAST_ENABLED: "true",
  });

  assert.equal(policy.externalReviewApproved, false);
  assert.equal(policy.ownerRiskWaiver, true);
  assert.equal(policy.reviewGateApproved, true);
  assert.equal(policy.reviewGateLabel, "OWNER WAIVER");
  assert.equal(policy.broadcastEnabled, true);
});

test("persists immutable uploads in the Railway filesystem storage backend", async (context) => {
  const storageRoot = await mkdtemp(join(tmpdir(), "hoodiepad-storage-"));
  const resolvedTemporaryRoot = resolve(tmpdir());
  assert.ok(resolve(storageRoot).startsWith(`${resolvedTemporaryRoot}${sep}`));

  const originalStorageDir = process.env.HOODIEPAD_STORAGE_DIR;
  const originalVolumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  process.env.HOODIEPAD_STORAGE_DIR = storageRoot;
  delete process.env.RAILWAY_VOLUME_MOUNT_PATH;

  context.after(async () => {
    if (originalStorageDir === undefined) delete process.env.HOODIEPAD_STORAGE_DIR;
    else process.env.HOODIEPAD_STORAGE_DIR = originalStorageDir;
    if (originalVolumePath === undefined) delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
    else process.env.RAILWAY_VOLUME_MOUNT_PATH = originalVolumePath;
    await rm(storageRoot, { recursive: true, force: true });
  });

  const digest = "a".repeat(64);
  const key = `token-artwork/${digest}.png`;
  const payload = new Uint8Array([137, 80, 78, 71, 13, 10]);

  assert.deepEqual(await checkObjectStorage(), {
    ready: true,
    backend: "filesystem",
  });

  await putStoredObject(key, payload, {
    contentType: "image/png",
    customMetadata: { sha256: digest },
  });
  // Content-addressed objects are idempotent and never overwritten.
  await putStoredObject(key, payload, {
    contentType: "image/png",
    customMetadata: { sha256: digest },
  });

  const head = await headStoredObject(key);
  assert.equal(head?.customMetadata.sha256, digest);

  const object = await getStoredObject(key);
  assert.equal(object?.contentType, "image/png");
  assert.match(object?.cacheControl ?? "", /immutable/);
  assert.equal(object?.etag, `"${digest}"`);
  assert.deepEqual(
    new Uint8Array(await new Response(object?.body).arrayBuffer()),
    payload,
  );
});

test("keeps Railway clean installs compatible with the pinned Doppler peer", async () => {
  const npmConfig = await readFile(new URL("../.npmrc", import.meta.url), "utf8");
  const railway = JSON.parse(
    await readFile(new URL("../railway.json", import.meta.url), "utf8"),
  );

  assert.match(npmConfig, /^legacy-peer-deps=true$/m);
  assert.equal(railway.build.builder, "RAILPACK");
  assert.equal(railway.build.buildCommand, "npm run build");
  assert.equal(railway.deploy.startCommand, "npm run start");
  assert.equal(railway.deploy.healthcheckPath, "/api/health");
});

test("encodes an exact-input HoodiePad V3 swap with recipient and slippage protection", () => {
  const recipient = getAddress("0x1111111111111111111111111111111111111111");
  const hoodie = getAddress("0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3");
  const child = getAddress("0x650716844ed8d82B1835C854fD56Fc9ADE772b42");
  const data = encodeV3ExactInputSwap({
    recipient,
    tokenIn: hoodie,
    tokenOut: child,
    amountIn: 1_000_000n,
    minimumOut: 9_000_000n,
    fee: 10_000,
    deadline: 1_800_000_000n,
  });
  const decoded = decodeFunctionData({
    abi: parseAbi(["function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)"]),
    data,
  });
  assert.equal(decoded.functionName, "multicall");
  assert.equal(decoded.args[0], 1_800_000_000n);
  const exactInput = decodeFunctionData({
    abi: parseAbi([
      "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
    ]),
    data: decoded.args[1][0],
  });
  assert.equal(exactInput.functionName, "exactInputSingle");
  assert.equal(exactInput.args[0].tokenIn, hoodie);
  assert.equal(exactInput.args[0].tokenOut, child);
  assert.equal(exactInput.args[0].fee, 10_000);
  assert.equal(exactInput.args[0].recipient, recipient);
  assert.equal(exactInput.args[0].amountIn, 1_000_000n);
  assert.equal(exactInput.args[0].amountOutMinimum, 9_000_000n);
  assert.equal(exactInput.args[0].sqrtPriceLimitX96, 0n);
});

test("encodes the reverse child-token sell through the same verified V3 router", () => {
  const recipient = getAddress("0x1111111111111111111111111111111111111111");
  const hoodie = getAddress("0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3");
  const child = getAddress("0x5E6440a7f4c82a10Fee94568C17cD07A4eA8F515");
  const data = encodeV3ExactInputSwap({
    recipient,
    tokenIn: child,
    tokenOut: hoodie,
    amountIn: 20_000_000n,
    minimumOut: 1_000_000n,
    fee: 10_000,
    deadline: 1_800_000_000n,
  });
  const multicall = decodeFunctionData({
    abi: parseAbi(["function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)"]),
    data,
  });
  const exactInput = decodeFunctionData({
    abi: parseAbi([
      "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
    ]),
    data: multicall.args[1][0],
  });
  assert.equal(exactInput.args[0].tokenIn, child);
  assert.equal(exactInput.args[0].tokenOut, hoodie);
  assert.equal(exactInput.args[0].amountIn, 20_000_000n);
  assert.equal(exactInput.args[0].amountOutMinimum, 1_000_000n);
});

const universalRouterExecuteAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
const v4RouterInputParameters = parseAbiParameters(
  "bytes actions,bytes[] params",
);
const v4ExactInputSingleParameters = parseAbiParameters(
  "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) swap",
);
const v4ExactInputParameters = parseAbiParameters(
  "(address currencyIn,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint256[] minHopPriceX36,uint128 amountIn,uint128 amountOutMinimum) swap",
);
const v4SettleAllParameters = parseAbiParameters(
  "address currency,uint256 maxAmount",
);
const v4TakeAllParameters = parseAbiParameters(
  "address currency,uint256 minAmount",
);

function v4PoolKeys() {
  const weth = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
  const hoodie = getAddress("0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3");
  const child = getAddress("0xF111111111111111111111111111111111111111");
  const hook = getAddress("0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544");
  return {
    weth,
    hoodie,
    child,
    referencePoolKey: {
      currency0: weth,
      currency1: hoodie,
      fee: 8_388_608,
      tickSpacing: 200,
      hooks: hook,
    },
    childPoolKey: {
      currency0: hoodie,
      currency1: child,
      fee: 8_388_608,
      tickSpacing: 200,
      hooks: hook,
    },
  };
}

test("encodes a bounded direct V4 exact-input swap", () => {
  const { hoodie, child, childPoolKey } = v4PoolKeys();
  const exactInput = decodeFunctionData({
    abi: universalRouterExecuteAbi,
    data: encodeV4ExactInputSwap({
      poolKey: childPoolKey,
      tokenIn: hoodie,
      tokenOut: child,
      amountIn: 1_000n,
      minimumOut: 900n,
      deadline: 1_800_000_000n,
    }),
  });
  assert.equal(exactInput.args[0], "0x10");
  assert.equal(exactInput.args[2], 1_800_000_000n);
  const [inputActions, inputParams] = decodeAbiParameters(
    v4RouterInputParameters,
    exactInput.args[1][0],
  );
  assert.equal(inputActions, "0x060c0f");
  assert.equal(inputParams.length, 3);
  assert.equal(BigInt(inputParams[0].slice(0, 66)), 32n);
  const [decodedSwap] = decodeAbiParameters(
    v4ExactInputSingleParameters,
    inputParams[0],
  );
  assert.deepEqual(decodedSwap.poolKey, {
    currency0: childPoolKey.currency0,
    currency1: childPoolKey.currency1,
    fee: childPoolKey.fee,
    tickSpacing: childPoolKey.tickSpacing,
    hooks: childPoolKey.hooks,
  });
  assert.equal(decodedSwap.zeroForOne, true);
  assert.equal(decodedSwap.amountIn, 1_000n);
  assert.equal(decodedSwap.amountOutMinimum, 900n);
  assert.equal(decodedSwap.minHopPriceX36, 0n);
  assert.equal(decodedSwap.hookData, "0x");
  assert.deepEqual(
    decodeAbiParameters(v4SettleAllParameters, inputParams[1]),
    [hoodie, maxUint256],
  );
  assert.deepEqual(
    decodeAbiParameters(v4TakeAllParameters, inputParams[2]),
    [child, 0n],
  );
});

test("encodes atomic ETH-to-child and child-to-ETH V4 multihop routes", () => {
  const {
    weth,
    hoodie,
    child,
    referencePoolKey,
    childPoolKey,
  } = v4PoolKeys();
  const buy = decodeFunctionData({
    abi: universalRouterExecuteAbi,
    data: encodeV4EthToChildSwap({
      referencePoolKey,
      childPoolKey,
      weth,
      hoodie,
      child,
      amountIn: 1_000n,
      minimumOut: 900n,
      deadline: 1_800_000_000n,
    }),
  });
  assert.equal(buy.args[0], "0x0b10");
  assert.equal(buy.args[1].length, 2);
  const [buyActions, buyParams] = decodeAbiParameters(
    v4RouterInputParameters,
    buy.args[1][1],
  );
  assert.equal(buyActions, "0x070b0f");
  assert.equal(buyParams.length, 3);
  assert.equal(BigInt(buyParams[0].slice(0, 66)), 32n);
  const [decodedBuySwap] = decodeAbiParameters(
    v4ExactInputParameters,
    buyParams[0],
  );
  assert.equal(decodedBuySwap.currencyIn, weth);
  assert.deepEqual(decodedBuySwap.path, [
    {
      intermediateCurrency: hoodie,
      fee: referencePoolKey.fee,
      tickSpacing: referencePoolKey.tickSpacing,
      hooks: referencePoolKey.hooks,
      hookData: "0x",
    },
    {
      intermediateCurrency: child,
      fee: childPoolKey.fee,
      tickSpacing: childPoolKey.tickSpacing,
      hooks: childPoolKey.hooks,
      hookData: "0x",
    },
  ]);
  assert.deepEqual(decodedBuySwap.minHopPriceX36, []);
  assert.equal(decodedBuySwap.amountIn, 1_000n);
  assert.equal(decodedBuySwap.amountOutMinimum, 900n);

  const sell = decodeFunctionData({
    abi: universalRouterExecuteAbi,
    data: encodeV4ChildToEthSwap({
      childPoolKey,
      referencePoolKey,
      child,
      hoodie,
      weth,
      amountIn: 900n,
      minimumOut: 800n,
      deadline: 1_800_000_000n,
    }),
  });
  assert.equal(sell.args[0], "0x100c");
  assert.equal(sell.args[1].length, 2);
  const [sellActions, sellParams] = decodeAbiParameters(
    v4RouterInputParameters,
    sell.args[1][0],
  );
  assert.equal(sellActions, "0x070c0e");
  assert.equal(sellParams.length, 3);
  assert.equal(BigInt(sellParams[0].slice(0, 66)), 32n);
  const [decodedSellSwap] = decodeAbiParameters(
    v4ExactInputParameters,
    sellParams[0],
  );
  assert.equal(decodedSellSwap.currencyIn, child);
  assert.deepEqual(decodedSellSwap.path, [
    {
      intermediateCurrency: hoodie,
      fee: childPoolKey.fee,
      tickSpacing: childPoolKey.tickSpacing,
      hooks: childPoolKey.hooks,
      hookData: "0x",
    },
    {
      intermediateCurrency: weth,
      fee: referencePoolKey.fee,
      tickSpacing: referencePoolKey.tickSpacing,
      hooks: referencePoolKey.hooks,
      hookData: "0x",
    },
  ]);
  assert.deepEqual(decodedSellSwap.minHopPriceX36, []);
  assert.equal(decodedSellSwap.amountIn, 900n);
  assert.equal(decodedSellSwap.amountOutMinimum, 800n);
});

test("pins the verified Robinhood SwapRouter02 instead of the V2 factory", async () => {
  const product = JSON.parse(
    await readFile(new URL("../config/hoodiepad-v1.json", import.meta.url), "utf8"),
  );
  assert.equal(
    product.contracts.uniswapSwapRouter02,
    "0xCaf681a66D020601342297493863E78C959E5cb2",
  );
  assert.equal(
    product.contracts.uniswapV3Factory,
    "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  );
  assert.notEqual(
    product.contracts.uniswapSwapRouter02.toLowerCase(),
    "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f",
  );
});

test("verifies the router bytecode, V3 factory, and wrapped-native dependency", () => {
  const factory = getAddress("0x1f7d7550B1b028f7571E69A784071F0205FD2EfA");
  const weth = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
  assert.equal(routerDeploymentMatches({
    code: "0x60006000",
    factory,
    weth,
    expectedFactory: factory,
    expectedWeth: weth,
  }), true);
  assert.equal(routerDeploymentMatches({
    code: "0x",
    factory,
    weth,
    expectedFactory: factory,
    expectedWeth: weth,
  }), false);
  assert.equal(routerDeploymentMatches({
    code: "0x60006000",
    factory: getAddress("0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f"),
    weth,
    expectedFactory: factory,
    expectedWeth: weth,
  }), false);
});

test("prevents oversized buys before invoking the V3 quoter during the 2% wallet window", () => {
  const token = 10n ** 18n;
  const maximumInput = estimateMaxInputAtSpot({
    childBalance: 11_000_000n * token,
    maxBalance: 20_000_000n * token,
    hoodiePerToken: "0.065",
  });
  assert.equal(maximumInput, 585_000n * token);
  assert.equal(
    estimateMaxInputAtSpot({
      childBalance: 20_000_000n * token,
      maxBalance: 20_000_000n * token,
      hoodiePerToken: "0.065",
    }),
    0n,
  );
  assert.equal(
    estimateMaxInputAtSpot({
      childBalance: 0n,
      maxBalance: 20_000_000n * token,
      hoodiePerToken: "Unavailable",
    }),
    null,
  );
});
