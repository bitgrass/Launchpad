import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const objects = new Map();
const artworkBucket = {
  async put(key, value, options = {}) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(await new Response(value).arrayBuffer());
    objects.set(key, { bytes, options });
  },
  async head(key) {
    const object = objects.get(key);
    if (!object) return null;
    return { customMetadata: object.options.customMetadata ?? {} };
  },
  async get(key) {
    const object = objects.get(key);
    if (!object) return null;
    return {
      body: object.bytes,
      httpEtag: `"${key.slice(-20)}"`,
      writeHttpMetadata(headers) {
        headers.set("content-type", object.options.httpMetadata?.contentType ?? "application/octet-stream");
      },
    };
  },
};

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  ARTWORK: artworkBucket,
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function uploadArtwork(app) {
  const response = await app.fetch(new Request("http://localhost/api/artwork", {
    method: "POST",
    headers: {
      "content-type": "image/png",
      "x-hoodiepad-artwork-name": "hoodie.png",
    },
    body: new Uint8Array([137, 80, 78, 71, 13, 10]),
  }), env, ctx);
  assert.equal(response.status, 200);
  return response.json();
}

test("server-renders the finished HoodiePad home page with the supplied logo", async () => {
  const app = await worker();
  const response = await app.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), env, ctx);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /HoodiePad — Launch on Robinhood Chain/);
  assert.match(html, /Launch it\./);
  assert.match(html, /creators keep 80%/i);
  assert.match(html, /hoodie-logo\.jpg/);
  assert.match(html, /rel="icon"[^>]+hoodie-logo\.jpg/);
  assert.match(html, /href="\/analytics"/);
  assert.doesNotMatch(html, /_vinext\/image[^\"]*hoodie-logo/);
  assert.doesNotMatch(html, />HOODIEPAD</);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps legacy V3 token pages read-only and out of V2 trading", async () => {
  const source = await readFile(
    new URL("../app/token/[address]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Legacy V3 · historical/);
  assert.match(source, /excluded from discovery, analytics,\s+and in-app trading/);
  assert.match(source, /isV4 \? \(\s+<SwapPanel/);
  assert.match(source, /HISTORICAL V3 MARKET/);
});

test("freezes the V1 economic, wallet, and Safe invariants", async () => {
  const product = JSON.parse(await readFile(new URL("../config/hoodiepad-v1.json", import.meta.url), "utf8"));
  const shares = BigInt(product.fees.creator) + BigInt(product.fees.hoodieEcosystem) + BigInt(product.fees.doppler);
  assert.equal(shares, BigInt(product.fees.wad));
  assert.equal(product.fees.creator, "800000000000000000");
  assert.equal(product.fees.hoodieEcosystem, "150000000000000000");
  assert.equal(product.fees.doppler, "50000000000000000");
  assert.equal(product.network.chainId, 4663);
  assert.equal(product.contracts.hoodie, "0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3");
  assert.equal(product.contracts.hoodieEcosystemSafe, "0xAB10Efe787DB2ef3700b94578aeC68b98e0446A7");
  assert.equal(product.contracts.permit2, "0x000000000022D473030F116dDEE9F6B43aC78BA3");
  assert.equal(product.contracts.uniswapV3Quoter, "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7");
  assert.equal(product.contracts.uniswapSwapRouter02, "0xCaf681a66D020601342297493863E78C959E5cb2");
  assert.equal(product.contracts.uniswapV3Factory, "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA");
  assert.equal(product.contracts.weth, "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
  assert.equal(product.hoodieReferencePool.poolId, "0x590eb1069a71fe72e3470f094c324513da3691987868a2b355fd8f29713d889b");
  assert.equal(product.hoodieReferencePool.currency0, product.contracts.weth);
  assert.equal(product.hoodieReferencePool.currency1, product.contracts.hoodie);
  assert.equal(product.runtimeHashSnapshot.chainId, 4663);
  assert.equal(product.runtimeHashSnapshot.observedAtBlock, "17157669");
  assert.deepEqual(
    Object.keys(product.runtimeHashSnapshot.hashes).sort(),
    [
      "airlock",
      "dopplerERC20V1Factory",
      "hoodie",
      "lockableV3Initializer",
      "noOpGovernanceFactory",
      "noOpMigrator",
      "uniswapUniversalRouter",
      "uniswapV4PoolManager",
      "uniswapV4StateView",
    ].sort(),
  );
  for (const hash of Object.values(product.runtimeHashSnapshot.hashes)) {
    assert.match(hash, /^0x[a-f0-9]{64}$/);
  }
  assert.equal(product.token.totalSupplyTokens, "1000000000");
  assert.equal(product.token.tokensToSell, product.token.totalSupplyTokens);
  assert.equal(product.token.maxWalletTokens, "20000000");
  assert.equal(product.token.maxWalletDurationSeconds, 86400);
  assert.equal(product.pool.mechanism, "doppler-lockable-v3");
  assert.equal(product.pool.migration, "noOp");
  assert.equal(
    product.pool.noOpMigrationPool,
    "0xdeaDDeADDEaDdeaDdEAddEADDEAdDeadDEADDEaD",
  );
  assert.equal(product.pool.governance, "noOp");
  assert.equal(product.pool.curveStatus, "fork-calibration-required");
});

test("accepts a token artwork file and serves the immutable uploaded object", async () => {
  const app = await worker();
  const uploaded = await uploadArtwork(app);
  assert.match(uploaded.key, /^token-artwork\/[a-f0-9]{64}\.png$/);
  assert.match(uploaded.url, /^http:\/\/localhost\/api\/artwork\?key=/);

  const response = await app.fetch(new Request(uploaded.url), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control") ?? "", /immutable/);
});

test("rejects multipart artwork requests before the production proxy must parse them", async () => {
  const app = await worker();
  const response = await app.fetch(new Request("http://localhost/api/artwork", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=unused" },
    body: "--unused--",
  }), env, ctx);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /JPG, PNG, or WebP/);
});

test("rejects artwork above HoodiePad's Railway-safe 750 KB limit", async () => {
  const app = await worker();
  const response = await app.fetch(new Request("http://localhost/api/artwork", {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: new Uint8Array(750 * 1024 + 1),
  }), env, ctx);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /750 KB/);
});

test("rejects malformed deployment confirmation requests without reading the chain", async () => {
  const app = await worker();
  const response = await app.fetch(new Request("http://localhost/api/launch/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      transactionHash: "0x1234",
      predictedToken: "0x1111111111111111111111111111111111111111",
      predictedPool: "0x2222222222222222222222222222222222222222",
    }),
  }), env, ctx);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /Invalid deployment confirmation/);
});

test("rejects malformed in-app swap requests without reading the chain", async () => {
  const app = await worker();
  const response = await app.fetch(new Request("http://localhost/api/swap/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: "not-an-address",
      account: "0x1111111111111111111111111111111111111111",
      side: "buy",
      amount: "1",
      slippageBps: 100,
    }),
  }), env, ctx);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Address|address/);
});

test("reports a healthy runtime when persistent object storage is available", async () => {
  const app = await worker();
  const response = await app.fetch(
    new Request("http://localhost/api/health"),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "hoodiepad",
    storage: "r2",
  });
});

test("prepares a connected-wallet launch draft but fails closed on protocol blockers", async () => {
  const app = await worker();
  const uploaded = await uploadArtwork(app);
  const response = await app.fetch(new Request("http://localhost/api/launch/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Hoodie Hug",
      symbol: "HUG",
      description: "",
      artworkKey: uploaded.key,
      artworkUrl: uploaded.url,
      artworkSha256: uploaded.sha256,
      website: "https://example.com",
      xUrl: "https://x.com/example",
      payoutWallet: "0x1111111111111111111111111111111111111111",
    }),
  }), env, ctx);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.productionReady, false);
  assert.match(payload.checksum, /^0x[a-f0-9]{64}$/);
  assert.equal(payload.config.marketVersion, "doppler-multicurve-v4-v2");
  assert.equal(payload.config.numeraire, "0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3");
  assert.equal(payload.config.creatorFeeRecipient, "0x1111111111111111111111111111111111111111");
  assert.equal(payload.config.ecosystemFeeRecipient, "0xAB10Efe787DB2ef3700b94578aeC68b98e0446A7");
  assert.equal(payload.config.supply, "1000000000");
  assert.equal(payload.config.tokensToSell, "1000000000");
  assert.equal(payload.config.activeLpFee, 10000);
  assert.equal(payload.config.rehypeFee, 0);
  assert.equal(payload.simulation.status, "unavailable");
  assert.equal(payload.chainStatus.available, false);
  assert.match(payload.metadata.key, /^token-metadata\/[a-f0-9]{64}\.json$/);
  assert.match(payload.metadata.url, /^http:\/\/localhost\/api\/metadata\?key=/);
  assert.ok(!payload.blockers.includes("Calibrate and snapshot the Robinhood V3 curve on a mainnet fork."));
  assert.ok(payload.blockers.includes("Record independent external review approval for HoodiePad V2."));
  assert.ok(payload.blockers.includes("Live Robinhood RPC verification is unavailable."));
  assert.ok(payload.blockers.includes("Mainnet broadcast remains disabled by policy."));
  assert.ok(!payload.blockers.includes("Complete every HoodiePad V2 Robinhood fork calibration check."));
  assert.ok(!payload.blockers.some((blocker) => blocker.includes("ecosystem Safe")));
  assert.equal(payload.calibration.status, "passed");
  assert.equal(payload.calibration.approved, true);
  assert.equal(payload.deployment, null);

  const metadataResponse = await app.fetch(new Request(payload.metadata.url), env, ctx);
  assert.equal(metadataResponse.status, 200);
  assert.equal(metadataResponse.headers.get("content-type"), "application/json");
  assert.match(metadataResponse.headers.get("cache-control") ?? "", /immutable/);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.name, "Hoodie Hug");
  assert.equal(metadata.symbol, "HUG");
  assert.equal(metadata.properties.chain_id, 4663);
  assert.equal(metadata.properties.canonical_numeraire, "0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3");
  assert.equal(metadata.properties.market_version, "doppler-multicurve-v4-v2");
});

test("rejects a creator wallet that duplicates the ecosystem beneficiary", async () => {
  const app = await worker();
  const uploaded = await uploadArtwork(app);
  const response = await app.fetch(new Request("http://localhost/api/launch/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Conflicting Hoodie",
      symbol: "NOPE",
      description: "",
      artworkKey: uploaded.key,
      artworkUrl: uploaded.url,
      artworkSha256: uploaded.sha256,
      payoutWallet: "0xAB10Efe787DB2ef3700b94578aeC68b98e0446A7",
    }),
  }), env, ctx);

  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.match(payload.error, /different from the HOODIE ecosystem Safe/);
});
