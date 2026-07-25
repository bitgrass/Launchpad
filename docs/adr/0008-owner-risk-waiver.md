# ADR 0008: Explicit owner risk waiver

- Status: Accepted by the owner
- Date: 2026-07-23

## Context

HoodiePad's Robinhood fork calibration, runtime dependency snapshot, exact
launch simulation, buy/sell coverage, wallet-limit checks, fee-split checks,
and locked-liquidity checks pass. An independent external review has not yet
been completed.

The owner explicitly authorized a production release before that review. The
release process must not misrepresent this authorization as external approval.

## Decision

The production review gate accepts exactly one of:

1. `HOODIEPAD_EXTERNAL_REVIEW_APPROVED=true`; or
2. `HOODIEPAD_OWNER_RISK_WAIVER=true`.

When the waiver is used, release tooling reports `OWNER WAIVER`, never
`APPROVED`. `HOODIEPAD_BROADCAST_ENABLED=true` remains a separate kill switch.
All calibration, dependency-hash, RPC, exact-simulation, connected-wallet, and
MetaMask confirmation requirements remain in force.

No server-side signer or automated Robinhood transaction is introduced.

## Consequences

The owner accepts the unresolved risk created by releasing without independent
review. The waiver records that decision; it does not reduce, transfer, or
eliminate the risk. External review remains recommended before opening launch
access broadly.
