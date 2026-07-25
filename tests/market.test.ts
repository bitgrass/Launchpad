import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { createRobinhoodPublicClient } from "../app/lib/protocol";
import { readHoodiePadMarket } from "../app/lib/market";
import { putStoredObject } from "../app/lib/object-storage";
import product from "../config/hoodiepad-v1.json";

const token = "0x650716844ed8d82B1835C854fD56Fc9ADE772b42";
const pool = "0x0927b2751E1C75A9621a4b0da0071DA139252137";
const creator = "0x21f525424079017968A125c980dB5D5f01ca8E31";
const digest = "a".repeat(64);
const metadataKey = `token-metadata/${digest}.json`;
const artworkKey = `token-artwork/${"b".repeat(64)}.png`;

test("reads a confirmed HoodiePad market from canonical onchain state", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "hoodiepad-market-"));
  const previousStorageRoot = process.env.HOODIEPAD_STORAGE_DIR;
  process.env.HOODIEPAD_STORAGE_DIR = storageRoot;

  try {
    const metadata = {
      name: "Baby Hoodie",
      symbol: "BABYHOODIE",
      description: "The first HoodiePad market.",
      image: `https://hoodiepad-production.up.railway.app/api/artwork?key=${artworkKey}`,
      external_url: "https://hoodie.fun/",
      properties: {
        x_url: "https://x.com/hoodie",
        launchpad: "HoodiePad",
        chain_id: product.network.chainId,
        canonical_numeraire: product.contracts.hoodie,
      },
    };
    await putStoredObject(
      metadataKey,
      new TextEncoder().encode(JSON.stringify(metadata)),
      { contentType: "application/json" },
    );

    const totalSupply = 1_000_000_000n * 10n ** 18n;
    const maxBalance = 20_000_000n * 10n ** 18n;
    const fakeClient = {
      async getCode() {
        return "0x01";
      },
      async readContract(input: { address: string; functionName: string }) {
        if (input.address.toLowerCase() === product.contracts.airlock.toLowerCase()) {
          assert.equal(input.functionName, "getAssetData");
          return [
            product.contracts.hoodie,
            "0x0000000000000000000000000000000000000000",
            "0x0000000000000000000000000000000000000000",
            product.contracts.noOpMigrator,
            product.contracts.lockableV3Initializer,
            pool,
            product.pool.noOpMigrationPool,
            totalSupply,
            totalSupply,
            creator,
          ] as const;
        }
        if (input.address.toLowerCase() === pool.toLowerCase()) {
          const poolReads: Record<string, unknown> = {
            token0: token,
            token1: product.contracts.hoodie,
            fee: product.pool.fee,
            liquidity: 918534269428014366906674n,
            slot0: [1n, -24_200, 0, 0, 0, 0, true] as const,
            feeGrowthGlobal0X128: 0n,
            feeGrowthGlobal1X128: 1n,
          };
          return poolReads[input.functionName];
        }
        const tokenReads: Record<string, unknown> = {
          name: "Baby Hoodie",
          symbol: "BABYHOODIE",
          decimals: 18,
          totalSupply,
          tokenURI: `https://hoodiepad-production.up.railway.app/api/metadata?key=${metadataKey}`,
          maxBalanceLimit: maxBalance,
          balanceLimitEnd: 1_784_890_310,
          isBalanceLimitActive: false,
          isPoolLocked: true,
        };
        return tokenReads[input.functionName];
      },
    } as unknown as ReturnType<typeof createRobinhoodPublicClient>;

    const market = await readHoodiePadMarket(token, fakeClient);
    assert.equal(market.name, "Baby Hoodie");
    assert.equal(market.symbol, "BABYHOODIE");
    assert.equal(market.pool, pool);
    assert.equal(market.integrator, creator);
    assert.equal(market.totalSupply, "1000000000");
    assert.equal(market.maxBalance, "20000000");
    assert.equal(market.poolFee, 10_000);
    assert.equal(market.poolLocked, true);
    assert.equal(market.hasSwapActivity, true);
    assert.equal(market.official, true);
    assert.equal(market.imageUrl, `/api/artwork?key=${encodeURIComponent(artworkKey)}`);
  } finally {
    if (previousStorageRoot === undefined) {
      delete process.env.HOODIEPAD_STORAGE_DIR;
    } else {
      process.env.HOODIEPAD_STORAGE_DIR = previousStorageRoot;
    }
    await rm(storageRoot, { recursive: true, force: true });
  }
});
