import assert from "node:assert/strict";
import test from "node:test";
import type { createRobinhoodPublicClient } from "../app/lib/protocol";
import {
  aggregateTraderStats,
  readMarketAnalytics,
  unrealizedForStats,
  type MarketSwapPoint,
} from "../app/lib/launches";
import {
  createV4RegistryCaches,
  readV4MarketAnalytics,
  shouldLogRejection,
} from "../app/lib/launches-v4";
import type { HoodiePadV4Market } from "../app/lib/market-v4";

const pool = "0x0927b2751E1C75A9621a4b0da0071DA139252137";
const token = "0x650716844ed8d82B1835C854fD56Fc9ADE772b42";
const trader = "0xACb88B32E117e3995609cECf20aE5B061aDE8776";
const transactionHash =
  "0x7fc372b0b2832714c5184a9ac4cb72e70d68167254c4fb65a9e4343c04a73734";

test("indexes every canonical swap from the token launch block", async () => {
  const requestedRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  const launchBlock = 17_636_756n;
  const swapBlock = 17_636_800n;
  const fakeClient = {
    async getBlockNumber() {
      return 17_650_000n;
    },
    async getLogs(input: {
      address: string;
      fromBlock: bigint;
      toBlock: bigint;
    }) {
      requestedRanges.push({
        fromBlock: input.fromBlock,
        toBlock: input.toBlock,
      });
      if (input.fromBlock <= swapBlock && input.toBlock >= swapBlock) {
        return input.address.toLowerCase() === pool.toLowerCase()
          ? [{
              args: {
                sender: "0x8876789976decbfcbbbe364623c63652db8c0904",
                recipient: trader,
                amount0: -11_110_009n * 10n ** 18n,
                amount1: 1_111_111n * 10n ** 18n,
                tick: -20_548,
              },
              blockNumber: swapBlock,
              transactionHash,
              logIndex: 3,
            }]
          : [{
              args: {
                from: pool,
                to: trader,
                value: 11_110_009n * 10n ** 18n,
              },
              blockNumber: swapBlock,
              transactionHash,
              logIndex: 2,
            }];
      }
      return [];
    },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      assert.equal(blockNumber, swapBlock);
      return { timestamp: 1_785_000_000n };
    },
  } as unknown as ReturnType<typeof createRobinhoodPublicClient>;

  const analytics = await readMarketAnalytics(
    {
      address: token,
      pool,
      decimals: 18,
      hoodiePerToken: "0.128",
      totalSupplyRaw: (1_000_000_000n * 10n ** 18n).toString(),
    },
    fakeClient,
    launchBlock,
  );

  assert.equal(requestedRanges[0]?.fromBlock, launchBlock);
  assert.equal(analytics.swapCount, 1);
  assert.equal(analytics.hoodieVolumeRaw, (1_111_111n * 10n ** 18n).toString());
  assert.equal(analytics.hoodieFeeVolumeRaw, analytics.hoodieVolumeRaw);
  assert.equal(analytics.points[0]?.blockNumber, swapBlock.toString());
  assert.equal(analytics.points[0]?.timestamp, 1_785_000_000);
  assert.equal(analytics.points[0]?.side, "buy");
  assert.equal(analytics.points[0]?.trader, trader);
  assert.equal(analytics.holderCount, 1);
  assert.equal(analytics.holders[0]?.address, trader);
  assert.equal(analytics.daily[0]?.swaps, 1);
});

// --- V4 analytics: swapper-perspective decoding and incremental scanning ---

const v4Hoodie = "0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3";
const v4Child = "0x4AbE75d071a9c339D7930f43bB47Fa0eEB023b58";
const v4PoolManager = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const v4SqrtPrice = 233288952920473746033372153489n;
const v4BuyHash = `0x${"1".repeat(64)}` as const;
const v4SellHash = `0x${"2".repeat(64)}` as const;
const v4LateHash = `0x${"3".repeat(64)}` as const;

function v4Market() {
  return {
    address: v4Child,
    decimals: 18,
    poolId: "0x1a5183887e1ae41f320ca8badc4be465923ee0742d9656895b6d850c072b8ab1",
    poolKey: {
      currency0: v4Child,
      currency1: v4Hoodie,
      fee: 8388608,
      tickSpacing: 200,
      hooks: "0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544",
    },
    externalHook: "0x6f02324d20CC679d0E585290CAa6b16baCbC0F77",
    hoodiePerToken: "8.6702",
    totalSupplyRaw: (1_000_000_000n * 10n ** 18n).toString(),
  } as unknown as HoodiePadV4Market;
}

test("labels V4 swaps from the swapper's perspective and prices fees on paid-in HOODIE", async () => {
  const launchBlock = 18_537_579n;
  const swapBlock = 18_539_998n;
  const requestedRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  const fakeClient = {
    async getBlockNumber() {
      return 18_540_000n;
    },
    async getLogs(input: {
      address: string;
      fromBlock: bigint;
      toBlock: bigint;
    }) {
      requestedRanges.push({
        fromBlock: input.fromBlock,
        toBlock: input.toBlock,
      });
      if (input.fromBlock > swapBlock || input.toBlock < swapBlock) return [];
      if (input.address.toLowerCase() === v4PoolManager) {
        return [
          {
            // Buy: the swapper received child tokens and paid HOODIE in.
            args: {
              amount0: 100n * 10n ** 18n,
              amount1: -900n * 10n ** 18n,
              sqrtPriceX96: v4SqrtPrice,
              tick: 21_700,
            },
            blockNumber: swapBlock,
            transactionHash: v4BuyHash,
            logIndex: 1,
          },
          {
            // Sell: the swapper paid child tokens in and received HOODIE.
            args: {
              amount0: -50n * 10n ** 18n,
              amount1: 400n * 10n ** 18n,
              sqrtPriceX96: v4SqrtPrice,
              tick: 21_600,
            },
            blockNumber: swapBlock,
            transactionHash: v4SellHash,
            logIndex: 2,
          },
        ];
      }
      return [{
        args: {
          from: v4PoolManager,
          to: trader,
          value: 100n * 10n ** 18n,
        },
        blockNumber: swapBlock,
        transactionHash: v4BuyHash,
        logIndex: 1,
      }];
    },
    async getTransaction() {
      return { from: trader };
    },
    async getBlock() {
      return { timestamp: 1_785_000_000n };
    },
  } as unknown as ReturnType<typeof createRobinhoodPublicClient>;

  const analytics = await readV4MarketAnalytics(
    v4Market(),
    fakeClient,
    launchBlock,
  );

  assert.equal(requestedRanges[0]?.fromBlock, launchBlock);
  assert.equal(analytics.swapCount, 2);
  assert.equal(analytics.points[0]?.side, "buy");
  assert.equal(analytics.points[0]?.hoodieVolumeRaw, (900n * 10n ** 18n).toString());
  assert.equal(analytics.points[0]?.hoodieFeeVolumeRaw, (900n * 10n ** 18n).toString());
  assert.equal(analytics.points[0]?.trader, trader);
  assert.equal(analytics.points[1]?.side, "sell");
  assert.equal(analytics.points[1]?.hoodieFeeVolumeRaw, "0");
  assert.equal(
    analytics.hoodieVolumeRaw,
    (1_300n * 10n ** 18n).toString(),
  );
  assert.equal(
    analytics.hoodieFeeVolumeRaw,
    (900n * 10n ** 18n).toString(),
  );
  assert.equal(analytics.holderCount, 1);
});

test("V4 analytics rescans only new blocks and never double-counts overlap", async () => {
  const launchBlock = 18_537_579n;
  const firstSwapBlock = 18_539_998n;
  const lateSwapBlock = 18_540_050n;
  let latestBlock = 18_540_000n;
  const scans: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  const fakeClient = {
    async getBlockNumber() {
      return latestBlock;
    },
    async getLogs(input: {
      address: string;
      fromBlock: bigint;
      toBlock: bigint;
    }) {
      scans.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
      if (input.address.toLowerCase() !== v4PoolManager) return [];
      const logs = [];
      if (input.fromBlock <= firstSwapBlock && input.toBlock >= firstSwapBlock) {
        logs.push({
          args: {
            amount0: 100n * 10n ** 18n,
            amount1: -900n * 10n ** 18n,
            sqrtPriceX96: v4SqrtPrice,
            tick: 21_700,
          },
          blockNumber: firstSwapBlock,
          transactionHash: v4BuyHash,
          logIndex: 1,
        });
      }
      if (input.fromBlock <= lateSwapBlock && input.toBlock >= lateSwapBlock) {
        logs.push({
          args: {
            amount0: 10n * 10n ** 18n,
            amount1: -90n * 10n ** 18n,
            sqrtPriceX96: v4SqrtPrice,
            tick: 21_800,
          },
          blockNumber: lateSwapBlock,
          transactionHash: v4LateHash,
          logIndex: 1,
        });
      }
      return logs;
    },
    async getTransaction() {
      return { from: trader };
    },
    async getBlock() {
      return { timestamp: 1_785_000_000n };
    },
  } as unknown as ReturnType<typeof createRobinhoodPublicClient>;

  const caches = createV4RegistryCaches();
  const first = await readV4MarketAnalytics(
    v4Market(),
    fakeClient,
    launchBlock,
    caches,
  );
  assert.equal(first.swapCount, 1);
  assert.equal(scans[0]?.fromBlock, launchBlock);

  latestBlock = 18_540_100n;
  const scansBeforeSecond = scans.length;
  const second = await readV4MarketAnalytics(
    v4Market(),
    fakeClient,
    launchBlock,
    caches,
  );
  // The overlap window re-covers the first swap; dedupe must keep one copy.
  assert.equal(second.swapCount, 2);
  for (const scan of scans.slice(scansBeforeSecond)) {
    assert.ok(scan.fromBlock >= 18_540_000n - 5n);
  }
});

// --- Trader PnL accounting -------------------------------------------------

function swapPoint(overrides: Partial<MarketSwapPoint>): MarketSwapPoint {
  return {
    blockNumber: "1",
    transactionHash: `0x${"a".repeat(64)}` as `0x${string}`,
    logIndex: 0,
    timestamp: 1_785_000_000,
    side: "buy",
    trader: trader as `0x${string}`,
    price: 1,
    hoodieVolumeRaw: "0",
    hoodieFeeVolumeRaw: "0",
    childVolumeRaw: "0",
    ...overrides,
  };
}

test("books realized profit with average-cost accounting on partial exits", () => {
  const one = 10n ** 18n;
  // Buy 100 tokens for 100 HOODIE, buy 100 more for 300 HOODIE
  // (average cost 2 HOODIE), then sell half the stack for 400 HOODIE.
  const points: MarketSwapPoint[] = [
    swapPoint({
      side: "buy",
      childVolumeRaw: (100n * one).toString(),
      hoodieVolumeRaw: (100n * one).toString(),
      timestamp: 1_784_900_000,
    }),
    swapPoint({
      side: "buy",
      childVolumeRaw: (100n * one).toString(),
      hoodieVolumeRaw: (300n * one).toString(),
      timestamp: 1_784_950_000,
    }),
    swapPoint({
      side: "sell",
      childVolumeRaw: (100n * one).toString(),
      hoodieVolumeRaw: (400n * one).toString(),
      timestamp: 1_785_000_000,
    }),
  ];

  const [stats] = aggregateTraderStats(points);
  // Sold 100 of 200 tokens carrying 400 HOODIE of cost: 200 cost released,
  // 400 received, so 200 HOODIE realized and 200 HOODIE still deployed.
  assert.equal(stats.realizedRaw, (200n * one).toString());
  assert.equal(stats.costBasisRaw, (200n * one).toString());
  assert.equal(stats.positionRaw, (100n * one).toString());
  assert.equal(stats.closes, 1);
  assert.equal(stats.wins, 1);
  assert.equal(stats.buys, 2);
  assert.equal(stats.sells, 1);
  // The three fills land on two distinct UTC days.
  assert.equal(stats.days.length, 2);

  // The open half is valued at the live price, not at cost.
  assert.equal(unrealizedForStats(stats, 4), 200n * one);
  assert.equal(unrealizedForStats(stats, 2), 0n);
});

test("books a loss and never lets a sell without inventory create profit", () => {
  const one = 10n ** 18n;
  const losing = aggregateTraderStats([
    swapPoint({
      side: "buy",
      childVolumeRaw: (100n * one).toString(),
      hoodieVolumeRaw: (500n * one).toString(),
    }),
    swapPoint({
      side: "sell",
      childVolumeRaw: (100n * one).toString(),
      hoodieVolumeRaw: (300n * one).toString(),
    }),
  ])[0];
  assert.equal(losing.realizedRaw, (-200n * one).toString());
  assert.equal(losing.wins, 0);
  assert.equal(losing.closes, 1);

  // Tokens acquired outside the pool (airdrop, transfer) have no cost basis
  // here; selling them must not book phantom profit.
  const noInventory = aggregateTraderStats([
    swapPoint({
      side: "sell",
      childVolumeRaw: (100n * one).toString(),
      hoodieVolumeRaw: (900n * one).toString(),
    }),
  ])[0];
  assert.equal(noInventory.realizedRaw, "0");
  assert.equal(noInventory.closes, 0);
});

test("reports a registry rejection once per asset until its reason changes", () => {
  const reported = new Map<string, string>();
  const asset = "0x4AbE75d071a9c339D7930f43bB47Fa0eEB023b58";
  const reason = "V4 launch failed HoodiePad V2 invariant validation: Rehype starting time";

  // First failure is reported; repeats on later refreshes stay quiet.
  assert.equal(shouldLogRejection(reported, asset, reason), true);
  assert.equal(shouldLogRejection(reported, asset, reason), false);
  assert.equal(shouldLogRejection(reported, asset.toLowerCase(), reason), false);

  // A different failure for the same asset is new information.
  assert.equal(
    shouldLogRejection(reported, asset, "V4 launch failed HoodiePad V2 invariant validation: Locked pool status"),
    true,
  );

  // Recovery clears the memo, so a future failure reports again.
  reported.delete(asset.toLowerCase());
  assert.equal(shouldLogRejection(reported, asset, reason), true);
});
