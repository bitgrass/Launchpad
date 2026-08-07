import Link from "next/link";
import { formatUnits } from "viem";
import product from "../config/hoodiepad-v2.json";
import { AppShell } from "./components/AppShell";
import { HomeBoard } from "./components/HomeBoard";
import { estimatedBeneficiaryFee } from "./lib/analytics";
import { readDisplayPrices } from "./lib/display-prices";
import {
  readHoodiePadLaunches,
  summarizeHoodiePadLaunches,
} from "./lib/launches";

export const revalidate = 0;

function usdCompact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function hoodieCompact(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 0 : 2,
  }).format(value)} HOODIE`;
}

export default async function Home() {
  const [launches, prices] = await Promise.all([
    readHoodiePadLaunches().catch(() => []),
    readDisplayPrices().catch(() => ({ ethUsd: null, hoodieUsd: null })),
  ]);
  const markets = summarizeHoodiePadLaunches(launches);

  const totalVolumeHoodie = markets.reduce(
    (sum, market) => sum + market.volumeHoodieNumber,
    0,
  );
  const volume24hHoodie = markets.reduce(
    (sum, market) => sum + market.volume24hHoodieNumber,
    0,
  );
  const totalTrades = markets.reduce((sum, market) => sum + market.txns, 0);
  const trades24h = markets.reduce((sum, market) => sum + market.txns24h, 0);
  const devs = new Set(markets.map((market) => market.creator.toLowerCase())).size;
  // Same fee estimator the analytics and fuel pages use: HOODIE-side
  // fee-bearing volume at the immutable 80% creator share.
  const feeVolumeRaw = launches.reduce(
    (total, launch) => total + BigInt(launch.analytics.hoodieFeeVolumeRaw),
    0n,
  );
  const creatorFeesHoodie = Number(
    formatUnits(estimatedBeneficiaryFee(feeVolumeRaw, product.fees.creator), 18),
  );
  const usdFor = (hoodie: number) =>
    prices.hoodieUsd !== null ? usdCompact(hoodie * prices.hoodieUsd) : null;
  const creatorFeesUsd = usdFor(creatorFeesHoodie);
  const totalVolumeUsd = usdFor(totalVolumeHoodie);
  const volume24hUsd = usdFor(volume24hHoodie);

  return (
    <AppShell>
      <section className="home-hero section-frame">
        <div className="home-hero-copy">
          <p className="eyebrow"><span /> Built on Robinhood Chain</p>
          <h1>
            Launch it. <span>The hood stays on.</span>
          </h1>
          <p className="hero-lede">
            Fixed-supply markets paired with $HOODIE. Launches open at $2,500
            on the bonding curve — no presale, no free creator bag, no
            migration — and creators keep 80% of pool fees.
          </p>
        </div>
        <div className="home-hero-actions">
          <Link className="button button-primary" href="/launch">
            Launch a token <span>↗</span>
          </Link>
          <Link className="button button-secondary" href="/explore">
            Explore markets
          </Link>
          <a
            className="contract-strip"
            href="https://robinhoodchain.blockscout.com/address/0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3"
            target="_blank"
            rel="noreferrer"
          >
            <span>$HOODIE</span> <code>0xC72c…2Ba3</code> ↗
          </a>
        </div>
      </section>

      <section className="home-stats" aria-label="Live protocol stats and launch rules">
        <div className="home-stats-live">
          <div>
            <strong>{creatorFeesUsd ?? hoodieCompact(creatorFeesHoodie)}</strong>
            <span>Creator earnings</span>
            <small>
              {creatorFeesUsd
                ? hoodieCompact(creatorFeesHoodie)
                : "80% of every pool fee"}
            </small>
          </div>
          <div>
            <strong>{totalVolumeUsd ?? hoodieCompact(totalVolumeHoodie)}</strong>
            <span>Total volume</span>
            <small>
              {totalVolumeUsd
                ? hoodieCompact(totalVolumeHoodie)
                : "all canonical pools"}
            </small>
          </div>
          <div>
            <strong>{volume24hUsd ?? hoodieCompact(volume24hHoodie)}</strong>
            <span>24h volume</span>
            <small>
              {volume24hUsd
                ? hoodieCompact(volume24hHoodie)
                : "rolling window"}
            </small>
          </div>
          <div>
            <strong>{markets.length.toLocaleString("en-US")}</strong>
            <span>Tokens launched</span>
            <small>{devs.toLocaleString("en-US")} {devs === 1 ? "dev" : "devs"}</small>
          </div>
          <div>
            <strong>{totalTrades.toLocaleString("en-US")}</strong>
            <span>Trades</span>
            <small>{trades24h.toLocaleString("en-US")} in the last 24h</small>
          </div>
        </div>
        <div className="home-stats-rules">
          <span>$2.5K OPEN</span>
          <span>1B SUPPLY</span>
          <span>1% FEE</span>
          <span>80% TO CREATORS</span>
          <span>0 LAUNCH FEE</span>
          <span>2% MAX WALLET · 24H</span>
        </div>
      </section>

      <HomeBoard markets={markets} hoodieUsd={prices.hoodieUsd} />

      <section className="how-section section-frame">
        <div className="section-heading how-heading">
          <div>
            <p className="eyebrow"><span /> One market, no musical chairs</p>
            <h2>Three moves. One canonical pool.</h2>
          </div>
          <p>
            HoodiePad keeps the protocol choices fixed so creators can focus on
            the token, the story, and the community.
          </p>
        </div>
        <div className="steps-grid">
          <article>
            <span className="step-number">01</span>
            <div className="step-icon">✎</div>
            <h3>Make the token</h3>
            <p>Add a name, ticker, and artwork file. A description and links are optional. Your connected wallet receives the creator fees.</p>
          </article>
          <article>
            <span className="step-number">02</span>
            <div className="step-icon">↗</div>
            <h3>Open the market</h3>
            <p>One transaction creates the 1B supply and locked V4 CHILD/HOODIE pool, opening at $2,500 on the bonding curve.</p>
          </article>
          <article>
            <span className="step-number">03</span>
            <div className="step-icon">◎</div>
            <h3>Earn with the hood</h3>
            <p>Creators receive 80% of canonical pool fees in both market assets.</p>
          </article>
        </div>
      </section>

      <section className="split-section section-frame">
        <div>
          <p className="eyebrow"><span /> Creator-first economics</p>
          <h2>The split is the pitch.</h2>
          <p className="split-copy">
            Every launch uses the same transparent 1% fee. No hidden platform
            surcharge and no destinations you need a spreadsheet to explain.
          </p>
          <Link className="text-link" href="/about">Read the full rules ↗</Link>
        </div>
        <div className="split-card">
          <div className="split-bar" aria-label="80% creator, 15% HOODIE ecosystem, 5% Doppler">
            <span className="split-creator" />
            <span className="split-ecosystem" />
            <span className="split-doppler" />
          </div>
          <div className="split-row"><span><i className="dot-creator" /> Creator</span><strong>80%</strong></div>
          <div className="split-row"><span><i className="dot-ecosystem" /> HOODIE ecosystem</span><strong>15%</strong></div>
          <div className="split-row"><span><i className="dot-doppler" /> Doppler</span><strong>5%</strong></div>
          <p>Beneficiaries are fixed when the market launches.</p>
        </div>
      </section>

      <section className="cta-section section-frame">
        <p>THE HOOD IS WAITING</p>
        <h2>Got a ticker in mind?</h2>
        <Link className="button button-dark" href="/launch">Start your launch ↗</Link>
      </section>
    </AppShell>
  );
}
