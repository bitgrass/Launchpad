import Link from "next/link";
import { getAddress } from "viem";
import product from "../../../config/hoodiepad-v2.json";
import { AppShell } from "../../components/AppShell";
import { MarketActivity } from "../../components/MarketActivity";
import { MarketChart } from "../../components/MarketChart";
import { SwapPanel } from "../../components/SwapPanel";
import { type HoodiePadMarket } from "../../lib/market";
import { readVersionedHoodiePadMarket } from "../../lib/market-v4";
import { PUBLIC_V4_MARKET_VERSION } from "../../lib/market-version";

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
    market = await readVersionedHoodiePadMarket(address);
    if (market.version === PUBLIC_V4_MARKET_VERSION) {
      const { readHoodiePadV4Launch } = await import("../../lib/launches-v4");
      const indexedMarket = await readHoodiePadV4Launch(getAddress(address));
      if (indexedMarket) market = indexedMarket;
    }
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
  const explorerPool = isV4
    ? `${product.network.explorerUrl}/search?q=${market.pool}`
    : `${product.network.explorerUrl}/address/${market.pool}`;
  const uniswapPool = `https://app.uniswap.org/explore/pools/robinhood/${market.pool}`;

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
                Token search and market indexers may not discover a new pool until its first
                swap. Use the canonical pool link for the first trade.
              </p>
            </div>
            <a href={uniswapPool} target="_blank" rel="noreferrer">
              Open canonical pool ↗
            </a>
          </div>
        )}
        {market.description && <p className="token-description">{market.description}</p>}
        {(market.websiteUrl || market.xUrl) && (
          <div className="token-links">
            {market.websiteUrl && <a href={market.websiteUrl} target="_blank" rel="noreferrer">Website ↗</a>}
            {market.xUrl && <a href={market.xUrl} target="_blank" rel="noreferrer">X / Twitter ↗</a>}
          </div>
        )}
      </section>

      <section className="token-layout section-frame">
        <div className="chart-panel">
          <div className="price-row">
            <div>
              <span>Onchain spot price</span>
              <strong>{market.hoodiePerToken} HOODIE</strong>
            </div>
            <div>
              <span>Market cap (FDV)</span>
              <strong>{market.fdvHoodie} HOODIE</strong>
            </div>
            <span className="live-chain-chip">
              {!isV4
                ? "LEGACY V3"
                : market.hasSwapActivity
                  ? "ACTIVE · ONCHAIN"
                  : "POOL READY"}
            </span>
          </div>
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
