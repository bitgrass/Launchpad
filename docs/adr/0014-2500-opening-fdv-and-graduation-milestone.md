# ADR 0014: $2,500 opening FDV, discovery curve segment, graduation milestone

Date: 2026-07-29

## Status

Accepted.

## Context

HoodiePad's V2 curve (`HOODIE_CURVE_V1`) opened every launch at exactly
$30,000 FDV. Competing Robinhood Chain launchpads open far lower — Pons
Family opens near $2,500 and renders a bonding-curve-style progress bar
toward a fixed graduation threshold (4.2 WETH paired in its locked pool),
and that framing now dominates creator expectations on the chain. A
$30,000 entry makes HoodiePad launches feel 12x more expensive to early
buyers than the competition while offering no early price-discovery
"trench" phase.

Pons's graduation is the same NoOp model HoodiePad already froze in V1
("Graduation: UI milestone only; never migrates"): reaching the threshold
changes a badge, nothing moves pools, trading continues in the same locked
pool. HoodiePad can adopt the same readout without touching migration
policy.

## Decision

1. **Target opening FDV becomes exactly $2,500** (tolerance unchanged at
   2.5%), recorded in `config/hoodiepad-v2.json` and the new curve file.
2. **`HOODIE_CURVE_V2`** (`config/hoodie-v4-curve-v2.json`,
   `curveVersion: 2`) replaces `HOODIE_CURVE_V1` for new launches, adding
   a discovery segment so early buys move price quickly before liquidity
   deepens:

   | Segment | Market cap range | Supply share | Positions |
   | --- | --- | --- | --- |
   | 1 (discovery) | $2,500 → $30,000 | 15% | 6 |
   | 2 | $30,000 → $250,000 | 25% | 8 |
   | 3 | $250,000 → $5,000,000 | 35% | 12 |
   | 4 | $5,000,000 → max | 25% | 16 |

   Supply, fees, tick spacing, max wallet, beneficiaries, migration, and
   governance are unchanged. `HOODIE_CURVE_V1` remains in the repository
   for auditability; markets launched with it validate exactly as before
   because live-market validation derives from on-chain state, not from
   the curve file.
3. **Graduation milestone (UI only): 420,000,000 HOODIE accumulated in
   the canonical pool.** Net pool HOODIE is derived from the already
   indexed swapper-perspective V4 swap flows (HOODIE paid in, minus HOODIE
   paid out, minus the 1% LP fee routed to beneficiaries). Reaching the
   threshold renders a graduated state. Nothing migrates, nothing
   unlocks, no economics change — identical in kind to the V1 graduation
   milestone.
4. Per the frozen-value rules, this change requires a fresh Robinhood
   fork calibration. The `calibrate:robinhood:v4` suite must pass at the
   new configuration hash and the regenerated report ships in the same
   commit as the configuration, so the calibration gate never opens a
   window where trading or launches run against unverified parameters.

## Consequences

New launches open at $2,500 FDV with a thin discovery segment; existing
markets (BABY onward) keep their original curve and validation. The
docs, launch wizard, and token pages read the target FDV and curve from
configuration, so surfaces update with no further copy edits. The token
page replaces the abstract "curve segment" readout with a
bonding-curve-style progress bar toward 420M HOODIE raised. The
opening-FDV tick granularity argument from calibration still holds: one
200-tick spacing step is ~2% of price, inside the 2.5% tolerance, at any
absolute FDV.
