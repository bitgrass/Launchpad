import Link from "next/link";
import { getAddress } from "viem";
import product from "../../../config/hoodiepad-v2.json";
import { AppShell } from "../../components/AppShell";
import { MarketActivity } from "../../components/MarketActivity";
import { MarketChart } from "../../components/MarketChart";
import { SwapPanel } from "../../components/SwapPanel";
import { CurveProgress } from "../../components/CurveProgress";
import { TokenMetaBar } from "../../components/TokenMetaBar";
import { readDisplayPrices } from "../../lib/display-prices";
import { type MarketAnalytics } from "../../lib/launches";
import { type HoodiePadMarket } from "../../lib/market";
import { readVersionedHoodiePadMarket } from "../../lib/market-v4";
import { PUBLIC_V4_MARKET_VERSION } from "../../lib/market-version";
import { isV4CalibrationApproved } from "../../lib/v4-calibration";

function formatUsdCompact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function formatUsdTinyPrice(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 0.01) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 4,
    }).format(value)}`;
  }
  return `$${value.toLocaleString("en-US", {
    maximumSignificantDigits: 3,
    useGrouping: false,
    maximumFractionDigits: 12,
  })}`;
}

export const revalidate = 0;

const transactionHashPattern = /^0x[a-fA-F0-9]{64}$/;

function shorten(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function MarketUnavailable({ address, message }: { address: string; message: string }) {
  return (
    <AppShell>
      <section className="token-head section-frame">
        <Link href="/explore">← All markets</Link>
        <div className="token-unavailable">
          <span>MARKET LOOKUP</span>
          <h1>Token details unavailable.</h1>
          <p>{message}</p>
          <code>{address}</code>
          <a
            href={`${product.network.explorerUrl}/address/${address}`}
            target="_blank"
            rel="noreferrer"
          >
            Check the address on Blockscout ↗
          </a>
        </div>
      </section>
    </AppShell>
  );
}

export default async function TokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ tx?: string }>;
}) {
  const [{ address }, query] = await Promise.all([params, searchParams]);
  let market: HoodiePadMarket;
  try {
    // Serve from the shared registry cache first — a direct chain read is
    // only needed for tokens the registry does not know about.
    const { readHoodiePadV4Launch } = await import("../../lib/launches-v4");
    const indexedMarket = await readHoodiePadV4Launch(getAddress(address))
      .catch(() => undefined);
    market = indexedMarket ?? await readVersionedHoodiePadMarket(address);
  } catch (error) {
    const missingContract =
      error instanceof Error && error.message === "No token contract exists at this address";
    return (
      <MarketUnavailable
        address={address}
        message={missingContract
          ? error.message
          : "HoodiePad could not read this market from Robinhood Chain. Try again shortly or verify the address on Blockscout."}
      />
    );
  }

  const transactionHash =
    typeof query.tx === "string" && transactionHashPattern.test(query.tx)
      ? query.tx
      : "";
  const explorerToken = `${product.network.explorerUrl}/token/${market.address}`;
  const isV4 = market.version === PUBLIC_V4_MARKET_VERSION;
  const uniswapPool = `https://app.uniswap.org/explore/pools/robinhood/${market.pool}`;
  // A V4 PoolId is a hash inside the PoolManager singleton, not an address —
  // Blockscout cannot resolve it, so link the Uniswap pool page instead.
  const explorerPool = isV4
    ? uniswapPool
    : `${product.network.explorerUrl}/address/${market.pool}`;
  const v4TradingEnabled = isV4 && isV4CalibrationApproved();

  // Display-only USD context for the price row and identity stats.
  const prices = await readDisplayPrices().catch(
    () => ({ ethUsd: null, hoodieUsd: null }),
  );
  const spotHoodie = market.hoodiePerToken === "Unavailable"
    ? null
    : Number(market.hoodiePerToken.replaceAll(",", ""));
  const priceUsd = prices.hoodieUsd !== null && spotHoodie !== null
    ? spotHoodie * prices.hoodieUsd
    : null;
  const supply = Number(market.totalSupplyRaw) / 1e18;
  const fdvUsd = priceUsd !== null && Number.isFinite(supply)
    ? priceUsd * supply
    : null;
  const priceUsdLabel = formatUsdTinyPrice(priceUsd);
  const fdvUsdLabel = formatUsdCompact(fdvUsd);
  const analytics = (market as HoodiePadMarket & { analytics?: MarketAnalytics }).analytics;
  const volumeHoodieNumber = analytics
    ? Number(analytics.hoodieVolumeRaw) / 1e18
    : null;
  const volumeUsdLabel = analytics && prices.hoodieUsd !== null && volumeHoodieNumber !== null
    ? formatUsdCompact(volumeHoodieNumber * prices.hoodieUsd) ?? undefined
    : undefined;
  // Net HOODIE the pool has accumulated: buys pay HOODIE in (minus the 1% LP
  // fee routed to beneficiaries), sells draw the full HOODIE amount back out.
  const hoodieRaisedRaw = analytics
    ? analytics.points.reduce((total, point) => {
        const volume = BigInt(point.hoodieVolumeRaw);
        return point.side === "buy"
          ? total + volume - (BigInt(point.hoodieFeeVolumeRaw) * BigInt(market.poolFee)) / 1_000_000n
          : total - volume;
      }, 0n).toString()
    : null;

  return (
    <AppShell>
      <section className="token-head section-frame">
        <Link href="/explore">← All markets</Link>
        {transactionHash && (
          <div className="launch-confirmed-banner">
            <strong>Launch confirmed on Robinhood Chain.</strong>
            <a
              href={`${product.network.explorerUrl}/tx/${transactionHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
          </div>
        )}
        <div className="token-identity">
          <div
            className={`token-avatar large${market.imageUrl ? " has-artwork" : ""}`}
            style={
              market.imageUrl
                ? { backgroundImage: `url("${market.imageUrl.replaceAll('"', "%22")}")` }
                : undefined
            }
          >
            {market.imageUrl ? "" : market.symbol.slice(0, 2)}
          </div>
          <div>
            <p>${market.symbol} / HOODIE</p>
            <h1>{market.name}</h1>
            <a href={explorerToken} target="_blank" rel="noreferrer">
              <code>{shorten(market.address)}</code> ↗
            </a>
          </div>
          <span className={`status-chip${isV4 && market.official && market.hasSwapActivity ? "" : " is-warning"}`}>
            {!isV4
              ? "Legacy V3 · historical"
              : !market.official
              ? "Unverified configuration"
              : market.hasSwapActivity
                ? "Market active"
                : "Pool ready · awaiting first trade"}
          </span>
        </div>
        {!isV4 && (
          <div className="market-activation-banner">
            <div>
              <strong>This is a historical HoodiePad V1 market.</strong>
              <p>
                HoodiePad V2 is V4-only. This immutable V3 market remains visible
                for transparency, but it is excluded from discovery, analytics,
                and in-app trading.
              </p>
            </div>
            <a href={uniswapPool} target="_blank" rel="noreferrer">
              View historical pool ↗
            </a>
          </div>
        )}
        {isV4 && market.official && !market.hasSwapActivity && (
          <div className="market-activation-banner">
            <div>
              <strong>The pool is funded and ready; it has not traded yet.</strong>
              <p>
                Buy directly on this page — the in-app swap targets the canonical
                V4 pool. External indexers (including the Uniswap interface) may
                not route a brand-new pool until it has traded.
              </p>
            </div>
            <a href={uniswapPool} target="_blank" rel="noreferrer">
              View pool on Uniswap ↗
            </a>
          </div>
        )}
        <TokenMetaBar
          address={market.address}
          dexscreenerUrl={isV4
            ? `https://dexscreener.com/robinhood/${market.pool}`
            : undefined}
          websiteUrl={market.websiteUrl}
          xUrl={market.xUrl}
          telegramUrl={market.telegramUrl}
          holderCount={analytics?.holderCount}
          volumeUsd={volumeUsdLabel}
          volumeHoodie={analytics
            ? `${analytics.hoodieVolume} HOODIE`
            : undefined}
        />
        {market.description && <p className="token-description">{market.description}</p>}
      </section>

      <section className="token-layout section-frame">
        <div className="chart-panel">
          <div className="price-row">
            <div>
              <span>Onchain spot price</span>
              <strong>{priceUsdLabel ?? `${market.hoodiePerToken} HOODIE`}</strong>
              {priceUsdLabel && <small>{market.hoodiePerToken} HOODIE</small>}
            </div>
            <div>
              <span>Market cap (FDV)</span>
              <strong>{fdvUsdLabel ?? `${market.fdvHoodie} HOODIE`}</strong>
              {fdvUsdLabel && <small>{market.fdvHoodie} HOODIE</small>}
            </div>
            <span className="live-chain-chip">
              {!isV4
                ? "LEGACY V3"
                : market.hasSwapActivity
                  ? "ACTIVE · ONCHAIN"
                  : "POOL READY"}
            </span>
          </div>
          {isV4 && <CurveProgress fdvUsd={fdvUsd} hoodieRaisedRaw={hoodieRaisedRaw} />}
          <MarketChart token={market.address} initialPrice={market.hoodiePerToken} />
          <div className="chart-pool-links">
            <a href={explorerPool} target="_blank" rel="noreferrer">
              {isV4 ? "Pool ID" : "Pool"} {shorten(market.pool)} ↗
            </a>
            <span>
              {isV4 ? "Live V4 Swap events" : "Historical V3 Swap events"} · Robinhood Chain
            </span>
          </div>
          <div className="token-stat-row">
            <div><span>Swap history</span><strong>{market.hasSwapActivity ? "Detected" : "None yet"}</strong></div>
            <div><span>Creator share</span><strong>80%</strong></div>
            <div><span>Pool fee</span><strong>{(market.poolFee / 10_000).toFixed(2)}%</strong></div>
            <div><span>Max wallet</span><strong>{market.balanceLimitActive ? "Active" : "Expired"}</strong></div>
          </div>
        </div>

        {isV4 ? (
          <SwapPanel
            token={market.address}
            symbol={market.symbol}
            poolUrl={uniswapPool}
            marketVersion={market.version}
            tradingEnabled={v4TradingEnabled}
            imageUrl={market.imageUrl}
            spotPrice={market.hoodiePerToken}
          />
        ) : (
          <aside className="trade-panel">
            <span className="preview-label">HISTORICAL V3 MARKET</span>
            <h2>In-app trading is unavailable.</h2>
            <p className="trade-warning">
              HoodiePad V2 supports canonical Multicurve V4 markets only. This
              page is retained as read-only history and does not contribute to
              public HoodiePad analytics.
            </p>
            <a
              className="button full-width"
              href={uniswapPool}
              target="_blank"
              rel="noreferrer"
            >
              View historical pool on Uniswap ↗
            </a>
          </aside>
        )}
      </section>

      <MarketActivity token={market.address} symbol={market.symbol} />
    </AppShell>
  );
}
