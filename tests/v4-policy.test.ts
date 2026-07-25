import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import product from "../config/hoodiepad-v2.json";
import curve from "../config/hoodie-v4-curve-v1.json";
import {
  getV4CalibrationConfigHash,
  isV4CalibrationApproved,
  REQUIRED_V4_CALIBRATION_CHECKS,
} from "../app/lib/v4-calibration";
import {
  DECLARED_DOPPLER_SDK_VERSION,
  getHoodieV4Curve,
  getHoodieReferencePoolId,
  getHoodieReferencePoolKey,
  getV4Beneficiaries,
  isHoodieReferencePoolKeyValid,
  isExactV4SdkInstalled,
  V4_DYNAMIC_FEE_FLAG,
  V4_LP_FEE,
  V4_MAX_WALLET,
  V4_TICK_SPACING,
  V4_TOKENS_TO_SELL,
  V4_TOTAL_SUPPLY,
  WAD,
} from "../app/lib/v4-policy";
import {
  Q96,
  calculateDeviationBps,
  calculateFdv,
  formatRational,
  invertRational,
  quoteRawAmount,
  sqrtPriceX96ToCurrency1PerCurrency0,
} from "../app/lib/v4-price";

test("freezes HoodiePad V2 supply, wallet, fee, and curve policy", () => {
  assert.equal(product.marketVersion, "doppler-multicurve-v4-v2");
  assert.equal(V4_TOTAL_SUPPLY, 1_000_000_000n * 10n ** 18n);
  assert.equal(V4_TOKENS_TO_SELL, V4_TOTAL_SUPPLY);
  assert.equal(V4_MAX_WALLET, 20_000_000n * 10n ** 18n);
  assert.equal(product.token.maxWalletDurationSeconds, 86_400);
  assert.equal(product.token.controller, "0x0000000000000000000000000000000000000000");
  assert.equal(product.token.creatorAllocationTokens, "0");
  assert.equal(V4_LP_FEE, 10_000);
  assert.equal(V4_TICK_SPACING, 200);
  assert.equal(V4_DYNAMIC_FEE_FLAG, 8_388_608);
  assert.equal(product.rehype.startFee, 0);
  assert.equal(product.rehype.endFee, 0);
  assert.equal(product.market.targetOpeningFdvUsd, "30000");

  const reviewedCurve = getHoodieV4Curve();
  assert.equal(reviewedCurve.length, 3);
  assert.equal(reviewedCurve[0]?.marketCap.start, 30_000);
  assert.equal(reviewedCurve.at(-1)?.marketCap.end, "max");
  assert.equal(
    reviewedCurve.reduce((total, item) => total + item.shares, 0n),
    WAD,
  );
  assert.deepEqual(
    reviewedCurve.map((item) => item.numPositions),
    [8, 12, 16],
  );
  assert.equal(curve.tickSpacing, 200);
});

test("pins the complete HOODIE/WETH V4 PoolKey to the live PoolId", () => {
  const key = getHoodieReferencePoolKey();
  assert.equal(
    getAddress(product.contracts.uniswapV4StateView),
    getAddress("0xf3334192d15450cdd385c8b70e03f9a6bd9e673b"),
  );
  assert.equal(key.currency0, getAddress(product.contracts.weth));
  assert.equal(key.currency1, getAddress(product.contracts.hoodie));
  assert.equal(key.fee, V4_DYNAMIC_FEE_FLAG);
  assert.equal(key.tickSpacing, V4_TICK_SPACING);
  assert.equal(key.hooks, getAddress(product.contracts.dopplerHookInitializer));
  assert.equal(
    getHoodieReferencePoolId(),
    "0x590eb1069a71fe72e3470f094c324513da3691987868a2b355fd8f29713d889b",
  );
  assert.equal(isHoodieReferencePoolKeyValid(), true);
});

test("sorts the distinct 80/15/5 V4 beneficiaries", () => {
  const creator = getAddress("0x1111111111111111111111111111111111111111");
  const owner = getAddress("0xEDeAa06E2eB42A5c19ce27c6cfFb36fd4fE1eDa8");
  const beneficiaries = getV4Beneficiaries(creator, owner);
  assert.equal(
    beneficiaries.reduce((total, item) => total + item.shares, 0n),
    WAD,
  );
  assert.deepEqual(
    [...beneficiaries].map((item) => item.beneficiary.toLowerCase()),
    [...beneficiaries]
      .map((item) => item.beneficiary.toLowerCase())
      .sort(),
  );
  assert.throws(
    () => getV4Beneficiaries(
      getAddress(product.contracts.hoodieEcosystemSafe),
      owner,
    ),
    /distinct/,
  );
});

test("uses exact bigint sqrtPriceX96 price math in both orientations", () => {
  const one = sqrtPriceX96ToCurrency1PerCurrency0(Q96, 18, 18);
  assert.equal(formatRational(one), "1");
  const four = sqrtPriceX96ToCurrency1PerCurrency0(Q96 * 2n, 18, 18);
  assert.equal(formatRational(four), "4");
  assert.equal(formatRational(invertRational(four)), "0.25");
  assert.equal(
    quoteRawAmount(2n * 10n ** 18n, 18, 18, four),
    8n * 10n ** 18n,
  );
  assert.equal(
    formatRational(calculateFdv(
      { numerator: 3n, denominator: 2n },
      1_000_000_000n * 10n ** 18n,
      18,
    )),
    "1500000000",
  );
  assert.equal(
    calculateDeviationBps(
      { numerator: 30_600n, denominator: 1n },
      { numerator: 30_000n, denominator: 1n },
    ),
    200n,
  );
});

test("V2 never accepts a V1 calibration report", () => {
  const passed = {
    version: 2,
    marketVersion: product.marketVersion,
    status: "passed" as const,
    chainId: 4663,
    forkBlock: "17700000",
    configHash: getV4CalibrationConfigHash(),
    curveVersion: 1,
    completedAt: "2026-07-24T00:00:00.000Z",
    checks: REQUIRED_V4_CALIBRATION_CHECKS.map((name) => ({
      name,
      passed: true,
    })),
  };
  assert.equal(isV4CalibrationApproved(passed), true);
  assert.equal(isV4CalibrationApproved({ ...passed, version: 1 }), false);
  assert.equal(
    isV4CalibrationApproved({
      ...passed,
      checks: passed.checks.filter((check) => check.name !== "eth-multihop-buy"),
    }),
    false,
  );
});

test("records the exact required SDK independently of the installed blocker", () => {
  assert.equal(product.dependencies.dopplerSdk, "1.0.32");
  assert.equal(
    isExactV4SdkInstalled(),
    DECLARED_DOPPLER_SDK_VERSION === product.dependencies.dopplerSdk,
  );
});
