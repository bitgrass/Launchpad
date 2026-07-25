# HoodiePad V4 production cutover

## Safe starting state

```text
HOODIEPAD_LAUNCH_VERSION=v2
HOODIEPAD_BROADCAST_ENABLED=false
HOODIEPAD_EXTERNAL_REVIEW_APPROVED=false
```

Do not configure a private key or server signer.

## Read-only rollout

1. Deploy the V4 registry build to staging.
2. Confirm home, Explore, dashboard, and analytics contain no legacy V3 cards.
3. Confirm the new V4 token appears and its direct token page reconstructs the
   same PoolKey and PoolId as Robinhood Chain.
4. Confirm the chart counts exact PoolManager `Swap` events for that PoolId.
5. Confirm an old V3 token remains reachable only through its direct historical
   URL.

## Launch enablement prerequisites

1. Install and lock the exact reviewed SDK and router versions. Robinhood's
   deployed Universal Router is version `2.1.1`. Its verified V4 command ABI
   defines `ExactInputSingleParams` as:

   ```text
   PoolKey, zeroForOne, amountIn, amountOutMinimum, minHopPriceX36, hookData
   ```

   Encode the complete struct as one dynamic ABI tuple. HoodiePad sets
   `minHopPriceX36` to zero and applies its exact quote bound through
   `amountOutMinimum`. Omitting the field shifts the dynamic `hookData` offset
   and causes the deployed router to pass malformed calldata into the swap.
2. Keep `HOODIEPAD_BROADCAST_ENABLED=false`.
3. Generate the read-only runtime proposal:

   ```text
   npm run report:robinhood:v4-runtime
   ```

4. Review every address, bytecode hash, Airlock module state, and the complete
   HOODIE/WETH V4 PoolKey. Confirm its recomputed PoolId is
   `0x590eb1069a71fe72e3470f094c324513da3691987868a2b355fd8f29713d889b`.
5. Approve only that exact reviewed proposal checksum:

   ```text
   npm run approve:robinhood:v4-runtime -- --checksum 0x...
   ```

6. Run `npm run calibrate:robinhood:v4` on a fresh disposable fork. It must
   pass every name in `REQUIRED_V4_CALIBRATION_CHECKS`, including the exact
   launch, direct HOODIE swaps, ETH multihop swaps, wallet-limit expiry,
   slippage/deadline rejection, PoolManager Swap indexing, and 80/15/5 claims.
   Fee evidence comes from the initializer's simulated and executed
   `collectFees` calls plus beneficiary token-balance deltas. Calibration does
   not depend on an unreviewed Multicall3 deployment merely to preview the same
   claim.
7. Obtain independent external review.
8. Run `npm run verify:robinhood:v4`.
9. Run `npm run verify:release` with broadcast still disabled.

Runtime approval and fork calibration are repository evidence. They do not
replace independent external review and they never authorize a mainnet
transaction by themselves.

## Canary

Only after the prerequisites pass:

1. enable the mainnet deployment policy in the canary environment;
2. prepare the exact V4 transaction;
3. review token, PoolKey, PoolId, fee beneficiaries, calldata, gas, and expiry;
4. submit with the connected MetaMask account;
5. verify the receipt and V4 invariant reconstruction;
6. execute small direct HOODIE buy and sell canaries;
7. verify chart, volume, holders, fee accrual, and claims;
8. disable creation immediately if any invariant differs.

Never reuse a V3 calibration, runtime snapshot, pool address assumption, or
swap encoder as V4 evidence.
