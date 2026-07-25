# HoodiePad versioned product decisions

This file is authoritative for HoodiePad. Changes to a frozen value require a
new ADR and fresh Robinhood fork tests.

## Public market policy

- Public Explore, analytics, dashboard, and home discovery show only validated
  `doppler-multicurve-v4-v2` markets during the staged V2 rollout.
- Legacy V1 readers remain in the codebase for direct historical pages,
  regression tests, rollback, and auditability.
- HoodiePad never creates another V1 market after V2 activation.
- The V2 launch path remains read-only until its separate V4 calibration
  report, runtime-hash snapshot, pricing checks, swaps, and fee claims pass.

## HoodiePad V1 (legacy)

| Decision | V1 value |
| --- | --- |
| Network | Robinhood Chain mainnet |
| Chain ID | `4663` |
| Canonical quote token | HOODIE |
| HOODIE address | `0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3` |
| HOODIE ecosystem Safe | `0xAB10Efe787DB2ef3700b94578aeC68b98e0446A7` |
| Launch mechanism | Doppler Lockable Uniswap V3 static auction |
| Why not Multicurve | Doppler SDK `1.0.28` does not expose a canonical Robinhood V4 Multicurve initializer |
| Token template | `DopplerERC20V1` |
| Total supply | `1,000,000,000` tokens, 18 decimals |
| Market allocation | 100% |
| Creator token allocation | 0% |
| Creator initial buy | Disabled |
| Pool fee | 1% (`10000`) |
| Canonical V3 token ordering | Child token is `token0`; HOODIE is `token1` |
| V3 tick price | HOODIE per child token |
| Creator fee share | 80% (`0.80e18`) |
| HOODIE ecosystem share | 15% (`0.15e18`) |
| Doppler fee share | 5% (`0.05e18`) |
| Rehype | Not used |
| Migration | NoOp |
| NoOp migration pool lock | `0xdeaDDeADDEaDdeaDdEAddEADDEAdDeadDEADDEaD` |
| Governance | NoOp |
| Maximum wallet | 2% of supply (`20,000,000` tokens) |
| Maximum-wallet duration | 24 hours |
| Balance-limit controller | Zero address |
| Launch surcharge | None |
| Graduation | UI milestone only; never migrates |
| Token artwork | Creator uploads JPG, PNG, or WebP; HoodiePad stores it in managed object storage |
| Token description | Optional, maximum 280 characters |
| Creator fee recipient | Connected MetaMask account; not independently editable |
| Production signer | Connected MetaMask account; no server-side deployment key |
| Deployment authorization | Exact simulation, passing fork report, external review or explicit owner risk waiver, policy switch, then explicit MetaMask confirmation |
| Metadata | HoodiePad generates the immutable production metadata URI |
| Market registry | Canonical Airlock `Create` events, then full HoodiePad invariant validation |
| Market chart | Canonical V3 `Swap` topic decoded with HoodiePad's pinned event ABI; no generated price series |
| Market activity | Canonical V3 swaps plus ERC-20 transfer-derived wallet holders |
| In-app trading | Exact-input canonical V3 quote, exact-amount ERC-20 approval, direct official `SwapRouter02` execution, connected MetaMask confirmation |
| Base | Out of scope |

## HoodiePad V2 (new launches)

| Decision | V2 value |
| --- | --- |
| Market version | `doppler-multicurve-v4-v2` |
| Network | Robinhood Chain mainnet, chain ID `4663` |
| Canonical quote | HOODIE, `0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3` |
| Launch mechanism | Canonical Doppler V4 Multicurve through `DopplerHookInitializer` |
| Curve | `HOODIE_CURVE_V1` from `config/hoodie-v4-curve-v1.json` |
| Target opening FDV | Exactly `$30,000`, accepted within `2.5%` after initialization |
| Supply | Exactly 1,000,000,000 tokens; 100% on the market |
| Creator token allocation | 0 |
| Vesting / presale / airdrop / dev buy | None |
| V4 active LP fee | 1% (`10000`) |
| Rehype hook fee | 0 |
| LP-fee beneficiaries | Creator 80%, ecosystem Safe 15%, live Airlock owner 5% |
| Maximum wallet | 20,000,000 tokens for exactly 86,400 seconds |
| Controller | Zero address |
| Migration / governance | NoOp / NoOp; locked market |
| New-launch dependency | Exact Doppler SDK `1.0.32` |
| Public discovery | V4-only after V2 activation |

The V2 runtime-hash snapshot and calibration file deliberately start
unapproved. Values are filled only from an explicitly reviewed current
Robinhood fork report.

## Required launch blockers

Mainnet broadcasting stays disabled until all of these are true:

1. The exact V4 SDK and any router dependency are locked to their reviewed versions.
2. Every canonical Doppler and Uniswap V4 dependency has non-empty bytecode and
   an explicitly reviewed runtime hash.
3. The complete HOODIE/WETH V4 PoolKey recomputes to the pinned reference PoolId.
4. The V4 launch, direct and multihop swaps, slippage protection, max-wallet
   lifecycle, holder accounting, fee accrual, and 80/15/5 claims pass on a
   current disposable Robinhood fork.
5. The live Airlock owner resolves to the 5% beneficiary used by the launch.
6. An independent external reviewer signs off on the V2 launch adapter and
   operational runbook. An owner waiver is not sufficient for V2.

## Runtime hash snapshot

The legacy V1 snapshot remains evidence for V1 only. V2 has a separate,
initially unapproved snapshot in `config/hoodiepad-v2.json`. Every V2
preparation and simulation must match the reviewed V4 snapshot exactly. Any
missing bytecode or hash change blocks simulation and mainnet broadcast until
a reviewed ADR updates the snapshot.

## User promise

> Launch a fixed-supply token market on Robinhood Chain, paired with HOODIE. No presale, no free creator allocation, no migration. Creators receive 80% of canonical-pool trading fees.
