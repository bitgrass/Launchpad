# HoodiePad

HoodiePad is a creator-first token launchpad for Robinhood Chain. Official markets pair every child token with HOODIE and use a fixed, transparent launch policy.

## V2 promise

- One billion fixed tokens, all allocated to the market.
- Canonical `CHILD/HOODIE` pair.
- 1% pool fee: 80% creator, 15% HOODIE ecosystem, 5% Doppler.
- 2% maximum wallet for the first 24 hours.
- No creator allocation, presale, initial creator buy, governance, or migration.
- Canonical Doppler Multicurve V4 with a locked PoolId-based market.
- MetaMask connection on Robinhood Chain; the connected account is the creator fee recipient.
- Direct JPG, PNG, or WebP artwork uploads up to 750 KB, backed by managed object storage.
- Fixed ecosystem Safe: `0xAB10Efe787DB2ef3700b94578aeC68b98e0446A7`.

## Local preview

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validation

```bash
npm run typecheck
npm run build
npm test
```

## Railway deployment

HoodiePad includes a production `railway.json` with a Railpack build, Vinext
start command, `/api/health` readiness check, and crash restart policy.

The Railway service requires:

- A persistent Volume mounted at `/data` for immutable artwork and metadata.
- `Alchemy_API_KEY` as a Railway secret.
- `VINEXT_TRUST_PROXY=1`.
- `VINEXT_TRUSTED_HOSTS=${{RAILWAY_PUBLIC_DOMAIN}}`.
- The reviewed release-policy variables described in the deployment runbook.

Railway supplies `PORT` and `RAILWAY_VOLUME_MOUNT_PATH`; do not define either
one manually. Do not configure or upload a private key—the connected MetaMask
wallet signs every mainnet launch.

Follow [`docs/runbooks/railway-deploy.md`](docs/runbooks/railway-deploy.md) for
the complete setup, health check, canary, rollback, and backup procedure.

## Robinhood fork calibration

The legacy V1 calibration remains available as regression evidence. V2 uses a
separate V4 calibration report and never accepts the old V3 report.

Configure `Alchemy_API_KEY` in `.env.local`, then run:

```bash
npm run report:robinhood:v4-runtime
```

The report is deliberately unapproved. Review its addresses, bytecode hashes,
Airlock module states, reference PoolKey, and PoolId. Only after that review,
copy the printed proposal checksum into:

```bash
npm run approve:robinhood:v4-runtime -- --checksum 0x...
npm run calibrate:robinhood:v4
```

Approval records the reviewed runtime evidence; it does not enable deployment.
A successful V2 calibration replaces `config/hoodie-v4-calibration.json` only
after every required launch, direct and ETH-routed swap, policy, indexing,
slippage, wallet-limit, and 80/15/5 fee-claim check passes.

## Live Robinhood verification

The app uses a V4-only public registry. It reconstructs each CHILD/HOODIE
PoolKey and PoolId, reads StateView, validates the per-launch Rehype hook,
indexes PoolManager Swap events, and excludes legacy V3 markets from public
home, Explore, dashboard, and analytics.

Configure `.env.local`, then run:

```bash
npm run verify:robinhood:v4
```

The verification command contains no write path and never uses a deployment
private key.

## Production gate

Check every gate with:

```bash
npm run verify:release
```

The API returns no V2 deployment calldata until the exact SDK, complete
HOODIE/WETH V4 PoolKey, reviewed runtime hashes, full V4 calibration,
independent external review, and deployment policy all pass. An owner risk
waiver is not sufficient for V2.

Mainnet submission is never performed by server tooling. The connected creator
must confirm the exact `Airlock.create` transaction in MetaMask. Prepared
transactions expire before signing. After submission, HoodiePad confirms the
canonical Airlock `Create` event and reconstructs the actual token, PoolKey,
PoolId, hook, fee, lock, supply, and token-policy state.

Never store a private key in this repository. Use a human-controlled wallet or Safe for approved production actions.

For the external-review evidence, activation gates, MetaMask canary, onchain
checks, and kill switch, follow
[`docs/runbooks/v4-production-cutover.md`](docs/runbooks/v4-production-cutover.md).
The only mainnet canary procedure for new launches is
[`docs/runbooks/mainnet-v4-canary.md`](docs/runbooks/mainnet-v4-canary.md).
