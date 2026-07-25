# ADR 0011: Versioned V4 public registry

Date: 2026-07-24

## Status

Accepted for the staged V2 read-only rollout.

## Decision

HoodiePad public discovery is V4-only:

- home, Explore, dashboard, and protocol analytics call
  `readHoodiePadV4Launches`;
- discovery starts from the configured V2 Airlock block and filters canonical
  Airlock `Create` events by HOODIE and `DopplerHookInitializer`;
- every candidate is reconstructed from `getAssetData`, initializer state, the
  complete V4 PoolKey, computed PoolId, StateView, the per-launch Rehype hook,
  and token policy reads;
- legacy V3 launches are excluded from public lists and aggregate analytics.

The legacy V3 reader remains available for direct, read-only historical token
pages, regression tests, audit evidence, and rollback. Historical pages are
clearly labelled, expose no HoodiePad trading controls, and remain excluded
from discovery and analytics. HoodiePad does not delete or misrepresent those
immutable markets.

## Required V4 public invariants

A market is public only when it has the fixed V2 numeraire, modules, supply,
market allocation, lock status, active LP fee, zero Rehype hook fee, fee
routing, controller, vesting count, max-wallet value, and HoodiePad metadata
provenance.

The per-launch Rehype hook is a clone. It must be validated through its
PoolId-scoped reads; it must not be compared to the Rehype initializer address.

## Consequences

The public site can display an already-confirmed V4 launch without enabling new
mainnet creation. New creation remains fail-closed until every V4 release gate
passes.
