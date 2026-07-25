# ADR 0001: Robinhood V1 market mechanism

Status: accepted for implementation, fork calibration pending.

## Context

HoodiePad needs a no-migration market on Robinhood Chain with a 1% fee split 80/15/5 between the creator, the HOODIE ecosystem, and Doppler. The earlier design selected standard Doppler Multicurve.

The current pinned SDK (`@whetstone-research/doppler-sdk@1.0.28`) supports Robinhood as chain ID 4663, but its canonical Robinhood address map does not expose `v4MulticurveInitializer`. It does expose `LockableUniswapV3Initializer`, `DopplerERC20V1Factory`, `NoOpGovernanceFactory`, and `NoOpMigrator`.

## Decision

HoodiePad V1 uses Doppler's Lockable Uniswap V3 static-auction path with HOODIE as the numeraire, immutable beneficiaries, NoOp governance, and NoOp migration.

The UI and launch engine fail closed until the calibrated tick range and ecosystem Safe are configured. Standard Multicurve may become a versioned V2 mechanism only after Doppler publishes a canonical Robinhood initializer and it passes HoodiePad's fork tests.

## Consequences

- The V1 architecture uses a deployed, SDK-addressed Robinhood module.
- The canonical market remains the original `CHILD/HOODIE` pool.
- Fee reinvestment and Rehype are not present.
- Price-distribution behavior must be calibrated and snapshot-tested before mainnet broadcast.

