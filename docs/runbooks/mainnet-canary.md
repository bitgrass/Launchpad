# HoodiePad V1 Robinhood mainnet canary (legacy)

This runbook is retained only for historical V1 auditability. It must not be
used to authorize a new launch. All new mainnet launches use
`mainnet-v4-canary.md`; an owner waiver is not accepted for V2.

This runbook enables one human-confirmed canary launch. It never authorizes a
server-held signer or automated mainnet broadcast.

## 1. External review evidence

Give the reviewer the exact commit intended for release and, at minimum:

- `PRODUCT_DECISIONS.md`
- `config/hoodiepad-v1.json`
- `config/hoodie-curve-calibration.json`
- `app/lib/protocol.ts`
- `app/lib/calibration.ts`
- `app/api/launch/prepare/route.ts`
- `app/launch/LaunchWizard.tsx`
- `scripts/calibrate-robinhood.ts`
- `scripts/verify-release.ts`
- `docs/adr/0005-runtime-hash-snapshot.md`
- `docs/adr/0006-fork-calibration-and-wallet-deployment.md`
- `docs/adr/0007-child-token0-curve-orientation.md`

The approval record must identify the reviewer, review date, reviewed commit,
resolved findings, and an explicit mainnet-canary approval. Store that record
outside the public repository if it contains private contact information.

Do not set the review flag based only on self-review or a passing automated
test.

## 2. Enable the human-controlled gates

The recommended path is external review approval:

```dotenv
HOODIEPAD_EXTERNAL_REVIEW_APPROVED=true
HOODIEPAD_OWNER_RISK_WAIVER=false
HOODIEPAD_BROADCAST_ENABLED=true
```

If the owner explicitly accepts proceeding before external review, keep the
review flag false and record the waiver instead:

```dotenv
HOODIEPAD_EXTERNAL_REVIEW_APPROVED=false
HOODIEPAD_OWNER_RISK_WAIVER=true
HOODIEPAD_BROADCAST_ENABLED=true
```

An owner waiver does not represent or replace an external security review. It
only records who accepted the remaining risk and keeps that fact visible in
release output.

Restart the application after changing environment variables. Then run:

```powershell
npm run verify:release
```

Proceed only when it reports:

```text
Calibration              PASSED
Calibration config       MATCH
Review gate              APPROVED or OWNER WAIVER
Deployment policy        ENABLED
Robinhood RPC            CONNECTED
Dependency snapshot      VERIFIED
Launch simulation        SIMULATED
Release status           READY FOR METAMASK
```

## 3. Prepare the canary

- Keep public access closed.
- Connect the designated canary MetaMask account on chain `4663`.
- Fund that account only with the ETH required for gas.
- Use unmistakable canary metadata and record the intended name and symbol.
- Confirm the launch review displays one-billion fixed supply, HOODIE
  numeraire, 1% pool fee, 80/15/5 beneficiaries, 2% wallet limit for 24 hours,
  NoOp governance, and NoOp migration.
- Prepare a fresh transaction if the ten-minute preview expires.

## 4. Confirm in MetaMask

Before signing, verify:

- `from` is the connected creator and fee-recipient account;
- chain ID is `4663`;
- `to` is Airlock `0xeb7C034704eF8Dcd2D32324c1545f62fB4aD0862`;
- no unexpected native value is attached; and
- the predicted token and pool shown by HoodiePad are recorded.

MetaMask is the only production signer. Never paste a private key into the app,
terminal command, repository, or deployment service.

## 5. Validate the receipt

After confirmation:

1. Wait for a successful receipt.
2. Match the emitted token and pool to HoodiePad's predictions.
3. Verify the token and pool bytecode on Robinhood Blockscout.
4. Confirm the canonical pair is `CHILD/HOODIE` with the child as `token0`.
5. Confirm the 1% fee, locked pool status, and 80/15/5 beneficiaries.
6. Confirm the 20,000,000-token maximum wallet and its expiry timestamp.
7. Execute one minimal HOODIE buy and sell from a separate test wallet.
8. Confirm fees accrue to all three beneficiaries.
9. Confirm a migration/exit attempt remains unavailable.
10. Rebuild the canary record from onchain events before opening public launch.

Record the transaction hash, token, pool, block, timestamp, creator, curve
ticks, and verification results.

## 6. Kill switch

To stop preparing new launch transactions:

```dotenv
HOODIEPAD_BROADCAST_ENABLED=false
```

Restart the application and run `npm run verify:release`; it must report the
deployment policy as disabled. This does not and cannot modify an already
deployed immutable market.
