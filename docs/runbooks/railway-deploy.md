# Railway production deployment

This runbook deploys HoodiePad's Node production server from the public
`bitgrass/HoodiePad` repository. It does not use or require a server-side
private key. Mainnet launch transactions are prepared by the server, simulated,
and signed by the connected MetaMask account.

## 1. Create the Railway service

1. Create a new Railway project from `https://github.com/bitgrass/HoodiePad`.
2. Select the `main` branch and repository root.
3. Keep the checked-in `railway.json` as the service configuration source.
4. Generate a Railway public domain after the first successful deployment.

Railpack installs the locked dependencies and then runs `npm run build`;
Railway starts the resulting Vinext server with `npm run start`. The server
reads Railway's injected `PORT` and binds to `0.0.0.0`.

The checked-in `.npmrc` enables npm's legacy peer resolver because the pinned
Doppler SDK `1.0.32` declares an optional React 18 peer while the pinned Vinext
runtime requires React `19.2.6`. This does not change either dependency version;
it tells clean `npm ci` installs to honor the reviewed `package-lock.json`.

## 2. Attach persistent storage

Before the first deploy:

1. Add a Railway Volume to the HoodiePad web service.
2. Mount it at `/data`.
3. Do not manually create `RAILWAY_VOLUME_MOUNT_PATH`; Railway supplies it.

HoodiePad stores immutable, content-addressed artwork and token metadata under
`$RAILWAY_VOLUME_MOUNT_PATH/hoodiepad`. The `/api/health` check returns `503`
until this storage is mounted and writable, preventing an incomplete
deployment from becoming active.

Use one web replica while the Volume backend is active. Schedule Railway Volume
backups before opening public launches. A later horizontal-scaling release
should move the same storage adapter to a shared object-storage bucket.

## 3. Configure production variables

Add these variables to the Railway service. Keep secrets in Railway; never
commit an `.env` file.

| Variable | Production value | Secret |
| --- | --- | --- |
| `NODE_ENV` | `production` | No |
| `VINEXT_TRUST_PROXY` | `1` | No |
| `VINEXT_TRUSTED_HOSTS` | `${{RAILWAY_PUBLIC_DOMAIN}}` | No |
| `Alchemy_API_KEY` | The Robinhood Alchemy API key | Yes |
| `HOODIEPAD_LAUNCH_VERSION` | `v2` | No |
| `HOODIEPAD_EXTERNAL_REVIEW_APPROVED` | `false` until an external review is recorded | No |
| `HOODIEPAD_OWNER_RISK_WAIVER` | `false`; V2 does not accept this as external review | No |
| `HOODIEPAD_BROADCAST_ENABLED` | `false` until every V4 gate and canary prerequisite passes | No |

Do not set `PORT`; Railway injects it. Do not set `EVM_RH_PK` or any other
private key. The production server has no signing path.

While runtime review, fork calibration, or external review remains incomplete,
the correct Railway values are:

```text
HOODIEPAD_LAUNCH_VERSION=v2
HOODIEPAD_EXTERNAL_REVIEW_APPROVED=false
HOODIEPAD_OWNER_RISK_WAIVER=false
HOODIEPAD_BROADCAST_ENABLED=false
```

The launch page will show a draft and its remaining blockers in this state.
Do not change the last three values merely to hide that message.

`ROBINHOOD_RPC_URL` is optional. When it is absent, HoodiePad derives the
Robinhood Alchemy endpoint from `Alchemy_API_KEY`. If it is configured, it
overrides the Alchemy endpoint.

`VINEXT_TRUST_PROXY=1` lets the server honor Railway's forwarded HTTPS protocol
when it creates immutable artwork and metadata URLs.
`VINEXT_TRUSTED_HOSTS=${{RAILWAY_PUBLIC_DOMAIN}}` permits Vinext to use only
Railway's own forwarded public hostname and protects generated URLs against
host-header poisoning.

## 4. Verify the deployment

Before pushing a release, run the Railway-style production smoke test:

```bash
npm run verify:railway
```

It builds the app, starts the production server with Railway's runtime
variables, verifies the storage-backed health endpoint, uploads and reads an
immutable image, and confirms forwarded HTTPS URLs.

After Railway reports the service active:

```text
GET https://<your-domain>/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "hoodiepad",
  "storage": "filesystem"
}
```

Then complete these checks:

1. Open the app and connect MetaMask.
2. Confirm the wallet switches to Robinhood Chain `4663`.
3. Upload a JPG, PNG, or WebP no larger than 750 KB and reload its returned
   artwork URL. HoodiePad keeps this limit below Railway's observed request
   ceiling so the platform does not reject the request before the app receives it.
4. Open `/explore` and confirm only validated V4 markets appear. No legacy V3
   card may appear on home, Explore, dashboard, or analytics.
5. Open the new V4 token page and confirm its token, PoolKey, PoolId, active LP
   fee, hook fee, supply, lock state, and metadata match Robinhood Chain.
6. Confirm a direct historical V3 URL remains readable but is absent from all
   public lists and aggregate analytics.
7. Confirm the V4 chart, recent trades, holder table, volume, and FDV are
   derived from the exact PoolManager `Swap` events for the reconstructed
   PoolId.
8. Run `npm run verify:robinhood:v4` and confirm it stays blocked until the
   runtime snapshot, full reference PoolKey, and fork calibration are approved.
9. Run `npm run verify:release`. Enabling broadcast while any V4 gate is
   incomplete must be reported as a release blocker.
10. Follow `docs/runbooks/v4-production-cutover.md` and then
    `docs/runbooks/mainnet-v4-canary.md` before any V4 mainnet canary. Do not
    reuse the V1 canary as V4 evidence.

## 5. Custom domain (Cloudflare)

Order matters: add the domain in Railway first, then point DNS, then widen the
trusted-host allowlist.

1. Railway service → Settings → Networking → Public Networking →
   **+ Custom Domain** → enter the apex domain (for example `hoodiepad.fun`).
   Add `www.<domain>` as a second custom domain if it should also serve the
   app. Railway displays the exact CNAME target value to use.
2. Cloudflare → the domain → DNS → Records:
   - `CNAME` `@` → the target Railway displayed (Cloudflare flattens the
     apex CNAME automatically). Proxied (orange cloud) is fine.
   - `CNAME` `www` → same target (only if added in Railway), or use a
     Cloudflare redirect rule from `www` to the apex instead.
3. Cloudflare → SSL/TLS → Overview → set encryption mode to **Full (strict)**.
   The default "Flexible" mode causes redirect loops against Railway, which
   terminates TLS with its own Let's Encrypt certificate.
4. Railway → Variables → `VINEXT_TRUSTED_HOSTS`: the production server
   rejects any Host header not in this comma-separated, exact-match list, so
   every serving hostname must be listed explicitly:
   `hoodiepad.fun,www.hoodiepad.fun,${{RAILWAY_PUBLIC_DOMAIN}}`.
   Apply the variable change so the service redeploys.
5. Wait for Railway's domain status to show the certificate as issued, then
   verify `https://<domain>/api/health` returns `{"status":"ok", ...}` and
   the home page renders. Previously minted token URIs keep resolving on the
   Railway domain; both hostnames serve the same storage.

## 6. RPC usage and cost control

The read path is optimized to keep RPC compute-unit consumption low:

- Concurrent contract reads batch through the canonical Multicall3 and
  JSON-RPC batching (production Node server only; the workerd dev runtime
  cancels cross-request timers, so batching is disabled there).
- Immutable market data (token facts, Airlock/initializer state, Rehype
  configuration, metadata) is read once per process; refreshes re-read only
  pool price and liquidity.
- Event scans are incremental and snapshotted to
  `$RAILWAY_VOLUME_MOUNT_PATH/hoodiepad/state/registry-cache.json`; a restart
  scans only the delta since the snapshot instead of the full history.
  History scans retry with backoff on RPC rate limits.
- Registry refresh and client polling run on a 30–60 s cadence.

Provider strategy: keep `Alchemy_API_KEY` configured as the primary. The
pinned public Robinhood RPC serves as automatic runtime failover but
rate-limits long history scans, so it cannot bootstrap a fresh environment
by itself. Post-optimization steady-state usage is a small fraction of
Alchemy's free monthly allowance.

## 7. Rollback and operations

- Turn off launch preparation immediately by setting
  `HOODIEPAD_BROADCAST_ENABLED=false`.
- Roll back application code with Railway's deployment history.
- Never delete or detach the Volume while published metadata URLs reference it.
- Restore stored artwork and metadata from a Railway Volume backup if needed.
- Monitor Railway logs for `413` upload responses and `503` responses from
  metadata, chain confirmation, or health endpoints.

An attached Railway Volume prevents the old and new deployment from mounting
the same data simultaneously, so brief deployment downtime is expected. Plan
updates during low-traffic periods.
