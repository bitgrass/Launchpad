# ADR 0009: Live registry, chart, and in-app swaps

## Status

Accepted for HoodiePad V1.

## Context

The initial user interface rendered placeholder market cards on Home, Explore,
and Dashboard. A confirmed launch could be opened by its known token address,
but the application had no source of truth for discovering all HoodiePad
launches. Token pages also linked users to Uniswap instead of supporting a
canonical-pool trade inside HoodiePad.

## Decision

HoodiePad uses Robinhood Chain as the authoritative market registry:

1. Scan canonical Airlock `Create` events beginning at block `17630000`.
2. Filter indexed events to the immutable HOODIE numeraire.
3. Read every candidate token, Airlock asset record, and V3 pool.
4. Include the launch only if the existing HoodiePad validation proves the
   fixed supply, pool initializer, NoOp migration, CHILD/HOODIE ordering, 1%
   fee, and HoodiePad metadata provenance.
5. Attribute the creator to the transaction sender. HoodiePad V1 requires that
   same connected MetaMask account to be the immutable 80% fee beneficiary.
6. Read V3 `Swap` events for recent volume, price history, and chart points.

The token page polls a same-origin chart endpoint every 15 seconds. It renders
only observed V3 swap prices; no generated or placeholder series is used.

In-app swaps use this fail-closed sequence:

1. Validate that the selected token is an official HoodiePad market.
2. Quote exact-input execution through the canonical Doppler V3 Quoter.
3. Verify the input balance and active maximum-wallet restriction.
4. Request an exact-input ERC-20 approval for the official Robinhood
   `SwapRouter02` when required.
5. After approval confirmation, prepare the quote again and estimate the exact
   direct V3 swap against current Robinhood state.
6. Submit the simulated swap only after explicit MetaMask confirmation.

The app never receives a private key and never submits a swap from the server.

## Consequences

- Home, Explore, and Dashboard show only validated mainnet launches.
- A newly confirmed launch appears automatically without adding a database row.
- Initial registry reads perform multiple `eth_getLogs` calls; Railway must use
  the production Alchemy RPC rather than the rate-limited public endpoint.
- Exact-amount approvals reduce exposure and require one approval transaction
  before a wallet's first direct-router swap.
- Changing the V1 fee, curve, supply, numeraire, or creator allocation remains
  outside this ADR and still requires a separate economic decision.
