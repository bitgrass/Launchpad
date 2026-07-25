import assert from "node:assert/strict";
import test from "node:test";
import type { createRobinhoodPublicClient } from "../app/lib/protocol";
import { readMarketAnalytics } from "../app/lib/launches";

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
