# ADR 0013: V4 market activation fixes

Date: 2026-07-25

## Status

Accepted.

## Context

The first production V2 launch (BABY, `0x4AbE75d071a9c339D7930f43bB47Fa0eEB023b58`,
PoolId `0x1a5183887e1ae41f320ca8badc4be465923ee0742d9656895b6d850c072b8ab1`)
produced a healthy, quotable canonical pool, but the app rejected its own
market and no interface could buy the token:

1. The "Rehype starting time" invariant compared the on-chain fee schedule's
   `startingTime` to the configured `0`. The RehypeDopplerHook stamps the
   pool-initialization timestamp on-chain, so the check failed for every
   launch, flagging all V2 markets `official = false`. That single flag
   emptied `/api/markets`, 404'd the chart endpoint, showed "Unverified
   configuration", and blocked `/api/swap/prepare`.
2. `SwapPanel` unconditionally disabled in-app trading for V4 markets and
   linked to the Uniswap interface instead — but the Uniswap interface does
   not route Robinhood's Doppler-hooked pools (its routing hook allowlist has
   no chain-4663 entry), so launched tokens had no working buy path anywhere.
3. V4 `Swap` events were decoded with V3's pool-perspective sign convention;
   v4 PoolManager events are swapper-perspective, so buys displayed as sells
   and fee-bearing volume tracked the wrong side.
4. Every 15-second registry refresh rescanned the full chain from the
   discovery start block (hundreds of serial `eth_getLogs`), causing
   timeouts, rate limiting, and "temporarily unavailable" panels.

## Decision

Protocol economics are unchanged. The following behavioral fixes apply:

1. **Rehype starting time**: when the configured `startingTime` is `0`, the
   recorded on-chain value is valid if it is not in the future (300 s skew
   allowance). Non-zero configured values still require an exact match.
   (`app/lib/market-v4.ts`, `isRehypeStartingTimeValid`.)
2. **In-app V4 trading enabled, calibration-gated**: the token page passes
   `tradingEnabled = isV4CalibrationApproved()` to `SwapPanel`; the panel
   renders the full quote/approve/swap flow for V4 markets when the approved
   fork calibration is present, and a gated notice otherwise. Quotes use the
   canonical V4Quoter; execution uses the pinned Universal Router 2.1.1
   `V4_SWAP` encoders that passed fork calibration.
3. **ETH multihop routes exposed**: buys can pay ETH and sells can receive
   ETH through the already-calibrated `WRAP_ETH + V4_SWAP` /
   `V4_SWAP + UNWRAP_WETH` paths across the HOODIE/WETH reference pool.
   The prepared transaction carries `value = amountIn` for native buys.
4. **Approval flow**: `/api/swap/prepare` returns the ERC-20 → Permit2
   approval and the Permit2 → Universal Router authorization together, and
   the panel loops approve → re-prepare (bounded) until the simulated swap
   transaction is available, so a fresh wallet completes in one attempt.
5. **V4 event convention**: buys are `childDelta > 0`; HOODIE fee-bearing
   volume is HOODIE paid in (`hoodieDelta < 0`). Covered by unit tests with
   swapper-perspective fixtures.
6. **Incremental indexing**: Create discovery, per-pool Swap logs, and
   per-token Transfer balances are cached in-process and rescanned only from
   the last scanned block (with a 5-block reorg overlap and event-id dedupe);
   transaction senders and block timestamps are memoized; the registry cache
   expiry starts when a scan finishes. Analytics scans anchor at each
   launch's block.
7. **Launch-time robustness**: the wizard re-simulates immediately before
   signing so curve ticks, the max-wallet window, and validity reflect the
   current chain state; `pricing.maximumSourceDeviationBps` is now enforced
   against a secondary ETH/USD source (soft-skipped if unreachable); RPC
   resolution falls back to the public Robinhood RPC when env vars are
   missing; beneficiary ordering uses ordinal comparison.
8. **Sell-before-first-buy**: the quoter's `NotEnoughLiquidity` revert maps
   to an explanatory message instead of a raw error.

## Consequences

Launched V2 markets validate as official, appear in discovery, chart, and
analytics, and are tradeable in-app with HOODIE or ETH. The Uniswap interface
link remains informational only. Existing launched markets (including BABY)
recover retroactively because validation is derived live from chain state.
