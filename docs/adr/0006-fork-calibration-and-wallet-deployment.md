# ADR 0006: Fork calibration and wallet-controlled deployment

## Status

Accepted. The deployment gate remains closed until a passing calibration report
and external review approval are recorded.

## Context

A successful `eth_call` simulation proves that `Airlock.create` accepts the
encoded launch, but it does not exercise the resulting pool. HoodiePad must also
prove token ordering, swaps in both directions, the temporary maximum-wallet
rule, locked liquidity, and beneficiary fee distribution.

The creator fee recipient is the connected MetaMask account. A server-held
private key would break that ownership model and introduce unnecessary custody
risk.

## Decision

HoodiePad uses a disposable Anvil fork of current Robinhood state for release
calibration. The suite:

1. verifies the approved runtime hashes on the fork;
2. creates the exact V1 launch;
3. checks the child/HOODIE ordering, ticks, fee, locked-liquidity status,
   DopplerERC20V1's permanent NoOp migration-pool lock
   (`0xdeaDDeADDEaDdeaDdEAddEADDEAdDeadDEADDEaD`), and the canonical V3
   pool's balance-limit exclusion;
4. buys exactly 1% of supply;
5. proves a purchase above the 2% wallet maximum fails;
6. advances fork time and proves the same restriction expires;
7. executes a reverse sell;
8. claims fees and verifies the 80/15/5 distribution in both assets; and
9. proves liquidity exit remains unavailable.

Robinhood's deployed Universal Router uses the six-field V3 command payload,
including the optional `uint256[] minHopPriceX36` field. Calibration encodes an
empty per-hop array for its single-pool buys and sells, leaving the explicit
aggregate `amountInMaximum` and `amountOutMinimum` limits in force.

The suite writes a block-pinned report whose configuration hash covers all
economic parameters, module addresses, dependency hashes, and the pinned
Doppler SDK version. Changing any covered value invalidates the report.

The production API returns exact deployment calldata only when:

- the calibration report passes and matches the current configuration;
- live runtime hashes still match the approved snapshot;
- the current Airlock owner is the 5% beneficiary;
- the exact launch transaction simulates;
- external review approval is explicitly configured; and
- the mainnet deployment policy switch is explicitly enabled.

The browser then asks the connected MetaMask account to submit the transaction.
There is no server-side signing or automated mainnet broadcast. A prepared
deployment expires after ten minutes.

## Consequences

Real deployment becomes available through an explicit creator wallet
confirmation while automated tooling remains read-only on mainnet. Any protocol
or economic change automatically closes the release gate until calibration and
review are repeated.

## Calibration result

The complete suite passed on a disposable Robinhood fork at block `17251944`
using reference tick `200879` and the aligned candidate curve
`-24200 -> 25800`. The committed report records every required check and config
hash `0x4ac3026c7ff6ced11c969437e1b084685235119a92582474bb514ceae620133a`.
These ticks are the block-pinned calibration snapshot; production preparation
continues to derive aligned ticks from the live HOODIE/WETH reference.
