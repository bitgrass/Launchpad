# ADR 0010: Canonical V3 events and direct swap routing

## Status

Accepted for HoodiePad V1.

## Context

The first production CHILD/HOODIE pool traded successfully through Uniswap, but
HoodiePad reported zero trades and zero volume. The SDK export named
`uniswapV3PoolAbi` contains pool read functions but no `Swap` event, so an event
scan using that ABI can never decode production swaps.

The first in-app trading implementation also combined ERC-20 approval, Permit2,
and Universal Router commands. The canonical pool and Quoter worked, but the
additional authorization layer produced opaque estimation failures in the app.

## Decision

HoodiePad pins the standard Uniswap V3 event directly:

```text
Swap(
  address indexed sender,
  address indexed recipient,
  int256 amount0,
  int256 amount1,
  uint160 sqrtPriceX96,
  uint128 liquidity,
  int24 tick
)
```

The indexer calls `eth_getLogs` with that event topic, rather than relying on the
SDK's read-only pool ABI. It counts absolute HOODIE flow in both directions as
volume, derives buy/sell direction from `amount0`, and uses the observed tick for
the price chart. Wallet holders are reconstructed from canonical ERC-20
`Transfer` events while excluding the locked pool and known protocol contracts.

In-app execution keeps the canonical V3 Quoter but uses Uniswap's official
Robinhood `SwapRouter02` at:

```text
0xCaf681a66D020601342297493863E78C959E5cb2
```

The previously pinned `0x8bcE...7937f` address is the Robinhood
`UniswapV2Factory`, not `SwapRouter02`. HoodiePad now verifies that the router
has bytecode and reports the expected V3 factory and WETH dependencies before
preparing any approval or swap transaction.

The wallet approves only the exact input amount to that router. HoodiePad then
re-quotes, checks the active maximum-wallet rule, estimates the direct
`exactInputSingle` call wrapped in a deadline-protected router multicall, and
requires explicit MetaMask confirmation.

## Consequences

- Existing pools and tokens do not change and do not need migration.
- Historical swaps become visible as soon as the updated app indexes them.
- Two opposite-direction swaps both contribute to total volume.
- The token page can show observed trades, transfer-derived wallet holders, and
  HOODIE-denominated fully diluted value.
- A first-time trade needs one exact ERC-20 approval instead of an ERC-20 plus
  Permit2 approval sequence.
- Pool fee, curve, locked liquidity, beneficiaries, maximum-wallet policy, and
  all other launch economics remain unchanged.
