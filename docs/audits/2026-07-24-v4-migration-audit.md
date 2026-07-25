# HoodiePad V4 migration audit

Date: 2026-07-24
Branch: `feat/doppler-v4-multicurve`
Starting commit: `1da247782a5ae39c979691b9ba77af62c18b2a33`

## Scope

This audit is the required first stage of the versioned migration from
`doppler-lockable-v3-v1` to `doppler-multicurve-v4-v2`.

Public home, Explore, dashboard, analytics, and API discovery now use the
versioned V4 registry. The V3 reader and swap path remain for direct historical
pages only. V2 launch preparation and mainnet broadcast remain fail-closed.

## Repository baseline

| Command | Result |
| --- | --- |
| `npm ci` | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm test` | Passed |
| `npm run verify:railway` | Passed |
| `npm run verify:release` | Blocked as designed |

The release verifier reported:

- the saved V1 fork calibration is present and matches V1 configuration;
- the owner-waiver review gate is active;
- local deployment policy is enabled;
- the Robinhood RPC was unavailable;
- the dependency runtime snapshot could not be verified;
- the exact launch simulation was unavailable.

No mainnet transaction was submitted.

## Current V1 architecture

The current production code is V3-only:

- `app/lib/protocol.ts` builds a Doppler Lockable Uniswap V3 static auction;
- `app/lib/market.ts` treats Airlock asset data as a V3 pool address;
- `app/lib/swap.ts` prepares direct Uniswap V3 quotes and SwapRouter02 calls;
- `app/lib/launches.ts` indexes the V3 `Swap` event;
- the launch confirmation path assumes the Airlock pool field is an address.

These assumptions must remain available for existing launches, but none can be
reused as the source of truth for a V4 PoolKey or PoolId.

The current V1 supply configuration sells the full one-billion-token supply,
but its V3 initializer mechanics can leave a material balance at the locked
pool sentinel. The V4 spike must independently prove that no material inventory
reaches a dead address.

## Secret and deployment-policy audit

- `.env`, `.env.local`, and `.env.production` are ignored by `.gitignore`.
- No environment or secret-bearing file is tracked by Git.
- No private key was read or printed during this audit.
- The local environment currently enables the mainnet deployment policy.
- Railway production variables could not be inspected because the available
  browser session was not authenticated.

Required safe state before staging or production verification:

```text
HOODIEPAD_BROADCAST_ENABLED=false
```

The production value is unconfirmed and must not be inferred from the local
environment.

## SDK and canonical address audit

The official `whetstoneresearch/doppler-sdk` source at tag `v1.0.32` confirms
the requested Robinhood deployment metadata:

| Module | Robinhood address |
| --- | --- |
| Airlock | `0xeb7C034704eF8Dcd2D32324c1545f62fB4aD0862` |
| DopplerERC20V1Factory | `0x1B37D3a72082029c44B35B604Ea473617580b69a` |
| DopplerHookInitializer | `0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544` |
| RehypeDopplerHookInitializer | `0x6f02324d20CC679d0E585290CAa6b16baCbC0F77` |
| NoOpGovernanceFactory | `0x85f37f74Ef2478A770318bc810177a9835911aD7` |
| NoOpMigrator | `0xba2F330EDb16cD8056f5988d8CE19BbC63475A0e` |

The v1.0.32 builder source also confirms:

- Robinhood Multicurve construction is supported;
- market-cap curves can be converted to ticks;
- pool beneficiaries are sorted before encoding;
- a no-op migration requires pool beneficiaries;
- Rehype `startFee: 0` and `endFee: 0` are valid SDK inputs;
- the legacy `buybackDestination` encoding remains supported;
- the fee-distribution rows must each total exactly one WAD.

The live Blockscout page identifies
`0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544` as
`DopplerHookInitializer`. Its explorer verification is classified as
`contracts/StubContract.sol`, so the V4 runtime audit must still fetch the
runtime bytecode, classify any delegation/proxy behavior, and compare reviewed
hashes before approval.

## Blocking conditions

The isolated fork spike cannot yet be executed in the current environment:

1. The exact reviewed SDK `1.0.32` is now installed and locked in
   `package.json` and `package-lock.json`.
2. Read-only Robinhood RPC requests still fail from the restricted local process and
   the browser-control runtime.
3. Without the RPC, runtime bytecode, Airlock module state, the full reference
   HOODIE/WETH PoolKey, the reference PoolId, live pricing, and fork execution
   cannot be verified.

These are stop conditions. The migration must not:

- build against SDK 1.0.28 and describe it as a 1.0.32 proof;
- invent or auto-approve runtime hashes;
- reuse the V3 calibration report;
- change the zero Rehype fee, 1% V4 LP fee, or 80/15/5 economics;
- enable V4 launch calldata, in-app V4 swaps, fee claims, or mainnet broadcast.

The user explicitly authorized the read-only public discovery cutover. Public
home, Explore, dashboard, analytics, and `/api/markets` therefore show only
validated V4 markets; direct V3 token URLs remain available for history.

## Exact resume point

When package-registry and Robinhood RPC access are available:

1. keep the existing exact SDK and `viem` versions;
2. add exact `doppler-router@1.0.15` only if its encoder is used;
3. connect a read-only Robinhood RPC;
4. complete the proposed V4 runtime-hash report without approving it;
5. discover and independently verify the full reference PoolKey;
6. implement every check in `scripts/calibrate-robinhood-v4.ts`;
7. run `npm run calibrate:robinhood:v4`;
8. stop on the first failed V4 acceptance gate.

The versioned V4 registry and analytics are read-only and can be staged now.
Only a complete calibration pass authorizes V4 launch calldata, in-app swaps,
fee claims, or mainnet creation.
