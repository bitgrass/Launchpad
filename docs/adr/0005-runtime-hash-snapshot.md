# ADR 0005: Robinhood runtime-hash snapshot

## Status

Accepted for HoodiePad V1 verification.

## Context

HoodiePad depends on canonical HOODIE, Doppler, and Uniswap contracts on
Robinhood Chain. A configured address alone is insufficient because code at an
address can be missing or can differ from the code reviewed during integration.

The first successful read-only `Airlock.create` simulation completed against
Robinhood block `17157669`. The verification output included the runtime
bytecode hashes for every dependency used by the launch preparation path.

## Decision

Record those hashes in `config/hoodiepad-v1.json` and compare every live runtime
hash before encoding or simulating a launch.

HoodiePad fails closed when:

- runtime bytecode is empty;
- a runtime hash differs from the snapshot; or
- the snapshot lacks an entry for a configured dependency.

Updating a hash requires a new ADR, a fresh successful simulation, and renewed
fork tests. A hash mismatch must never be bypassed with an environment flag.

## Consequences

Protocol upgrades or redeployments intentionally stop HoodiePad simulations
until reviewed. This is safer than silently trusting mutable offchain address
configuration.
