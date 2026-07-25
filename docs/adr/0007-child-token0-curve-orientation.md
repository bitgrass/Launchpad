# ADR 0007: Child-token0 curve orientation

## Status

Accepted, pending a fresh passing Robinhood fork calibration.

## Context

Doppler SDK `1.0.28` deterministically mines the launched asset's address order
from the numeraire address. Because the HOODIE address is greater than the
SDK's half-`uint160` threshold, every HoodiePad child token is mined below
HOODIE. The resulting Uniswap V3 pool therefore has:

```text
token0 = child token
token1 = HOODIE
tick price = HOODIE per child token
```

The initial HoodiePad curve translated the reviewed WETH reference ticks as if
HOODIE were `token0`. The first complete fork launch correctly exposed this
orientation mismatch before mainnet deployment was enabled.

## Decision

HoodiePad V1 freezes child-token0/HOODIE-token1 ordering. For a live
HOODIE-per-WETH reference tick `R` and reviewed child-per-WETH tick interval
`[S, E]`, the V3 child/HOODIE pool uses:

```text
tickLower = R - E
tickUpper = R - S
```

Both values are aligned to the 1% pool's 200-tick spacing. HoodiePad asserts
that the pinned Doppler SDK still selects this ordering before it builds a
launch. The calibration configuration hash includes both the ordering and tick
price meaning.

## Consequences

The intended WETH-relative launch curve is preserved while its tick encoding
matches the actual V3 token order. Any future SDK behavior or numeraire change
that produces the opposite order fails closed and requires a new ADR, a new
curve version, and fresh fork calibration.
