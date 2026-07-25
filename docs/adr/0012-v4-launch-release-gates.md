# ADR 0012: V4 launch and release gates

Date: 2026-07-24

## Status

Accepted; gates are not yet satisfied.

## Decision

The V1 launch builder is not a fallback for V2. The production preparation API
returns no deployment calldata until all V4 prerequisites are independently
verified:

1. `HOODIEPAD_LAUNCH_VERSION=v2`;
2. exact Doppler SDK `1.0.32`;
3. approved V4 runtime bytecode snapshot;
4. complete verified HOODIE/WETH V4 PoolKey;
5. complete V4 disposable-fork calibration;
6. independent external review;
7. explicit mainnet deployment policy.

An owner risk waiver cannot replace independent review for V2. Enabling
mainnet broadcast before the other gates pass is itself a release failure.

## Consequences

The staged app may index and display validated V4 markets while launch
preparation remains read-only. No private key or server signer is used. A
future approved deployment must still be submitted explicitly by the connected
MetaMask account.
