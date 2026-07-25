# HoodiePad V2 Robinhood mainnet canary

This runbook authorizes at most one human-confirmed
`doppler-multicurve-v4-v2` canary after every release gate passes. It never
authorizes a server signer, automated broadcast, or use of a private key by the
application.

## 1. Start fail-closed

Railway and local verification must begin with:

```dotenv
HOODIEPAD_LAUNCH_VERSION=v2
HOODIEPAD_EXTERNAL_REVIEW_APPROVED=false
HOODIEPAD_OWNER_RISK_WAIVER=false
HOODIEPAD_BROADCAST_ENABLED=false
```

Run:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run verify:robinhood:v4
npm run verify:release
```

The release check must remain blocked at this stage.

## 2. Complete immutable evidence

Do not proceed until the intended release commit contains:

- exact Doppler SDK `1.0.32`;
- the complete HOODIE/WETH V4 PoolKey whose recomputed PoolId matches the
  pinned reference;
- an explicitly reviewed runtime hash for every V4 dependency;
- a current passing `hoodie-v4-calibration.json`;
- independent external-review evidence for the exact release commit.

The V4 calibration must prove the launch, direct and multihop swaps, slippage,
2% wallet lifecycle, holder accounting, 1% active LP fee, fee accrual,
80/15/5 fee claims, locked pool, and negligible dead-address balance.

## 3. Stage read-only production

Deploy the release commit with broadcast still disabled. Verify:

1. `/api/health` returns `200`.
2. `/api/markets` reports
   `marketVersion: doppler-multicurve-v4-v2`.
3. Explore, home, dashboard, and analytics show validated V4 launches only.
4. The canary candidate's direct page reconstructs its canonical PoolKey and
   PoolId.
5. A legacy V3 token remains available only at its direct historical URL.
6. Railway logs contain no `[HoodiePad V4 registry] Rejected ...` entry for the
   intended canary.

## 4. Enable one connected-wallet canary

Only after the independent review is recorded:

```dotenv
HOODIEPAD_EXTERNAL_REVIEW_APPROVED=true
HOODIEPAD_OWNER_RISK_WAIVER=false
HOODIEPAD_BROADCAST_ENABLED=true
```

Restart the service and run `npm run verify:release`. Proceed only when it
reports `READY FOR METAMASK` with no blocker.

Prepare a fresh launch and verify before signing:

- chain ID `4663`;
- connected MetaMask account is creator and 80% beneficiary;
- Airlock is `0xeb7C034704eF8Dcd2D32324c1545f62fB4aD0862`;
- HOODIE is the canonical numeraire;
- total supply and market inventory are both exactly one billion tokens;
- active V4 LP fee is 1%;
- Rehype hook fee is zero;
- fee beneficiaries are exactly 80% creator, 15% ecosystem Safe, and 5% live
  Airlock owner;
- maximum wallet is 20,000,000 tokens for 86,400 seconds with zero controller;
- governance and migration are NoOp;
- predicted token, complete PoolKey, and PoolId match the prepared simulation;
- transaction calldata, gas, expiry, and native value are expected.

MetaMask is the only signer. The human user makes the final confirmation.

## 5. Validate the canary receipt

Immediately after confirmation:

1. Match the receipt's token and PoolId to the simulation.
2. Re-run every V4 market invariant from canonical onchain state.
3. Verify creator, Airlock, initializer, and dead-address token balances.
4. Execute one minimal direct HOODIE buy and sell from a separate wallet.
5. Verify the chart records the exact PoolManager `Swap` events for the PoolId.
6. Verify holders exclude protocol inventory.
7. Accrue and claim both CHILD and HOODIE fees to all three beneficiaries.
8. Confirm locked liquidity cannot exit or migrate.
9. Record transaction hashes, blocks, PoolKey, PoolId, runtime hashes, fees,
   balances, and reviewer approval.

Do not open public creation until the complete record passes.

## 6. Kill switch

On any mismatch:

```dotenv
HOODIEPAD_BROADCAST_ENABLED=false
```

Restart Railway and run `npm run verify:release`. It must report the deployment
policy disabled. This stops new launch preparation; it cannot alter an existing
immutable market.
