import Image from "next/image";
import Link from "next/link";
import { AppShell } from "./components/AppShell";
import { MarketCard } from "./components/MarketCard";
import {
  readHoodiePadLaunches,
  summarizeHoodiePadLaunches,
} from "./lib/launches";

export const revalidate = 0;

export default async function Home() {
  const launches = await readHoodiePadLaunches().catch(() => []);
  const markets = summarizeHoodiePadLaunches(launches).slice(0, 3);

  return (
    <AppShell>
      <section className="hero section-frame">
        <div className="hero-copy">
          <p className="eyebrow"><span /> Built on Robinhood Chain</p>
          <h1>
            Launch it.
            <br />
            <span>The hood stays on.</span>
          </h1>
          <p className="hero-lede">
            Fixed-supply token markets paired with $HOODIE. No presale, no free
            creator bag, no migration—and creators keep 80% of pool fees.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/launch">
              Launch a token <span>↗</span>
            </Link>
            <Link className="button button-secondary" href="/explore">
              Explore markets
            </Link>
          </div>
          <div className="contract-strip">
            <span>Canonical pair token</span>
            <code>0xC72c…2Ba3</code>
            <a
              href="https://robinhoodchain.blockscout.com/address/0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3"
              target="_blank"
              rel="noreferrer"
            >
              Verify ↗
            </a>
          </div>
        </div>
        <div className="hero-art" aria-label="HoodiePad launch market illustration">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="hero-logo-card">
            <Image src="/hoodie-logo.jpg" alt="$HOODIE character" width={400} height={400} priority unoptimized />
            <div className="hero-logo-caption"><strong>80%</strong><span>CREATOR FEES</span></div>
          </div>
          <div className="art-tag tag-left">NO PRESALE</div>
          <div className="art-tag tag-right">PAIRED W/ $HOODIE</div>
          <div className="curve-line" />
        </div>
      </section>

      <section className="stats-bar" aria-label="HoodiePad fixed launch rules">
        <div><strong>1B</strong><span>Fixed supply</span></div>
        <div><strong>1%</strong><span>Pool fee</span></div>
        <div><strong>80%</strong><span>To creators</span></div>
        <div><strong>2%</strong><span>Max wallet · 24h</span></div>
        <div><strong>0</strong><span>Free creator tokens</span></div>
      </section>

      <section className="market-section section-frame">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span /> Fresh from the hood</p>
            <h2>Markets taking shape.</h2>
          </div>
          <Link href="/explore">View all markets ↗</Link>
        </div>
        {markets.length > 0 ? (
          <div className="market-grid">
            {markets.map((market) => <MarketCard key={market.address} {...market} />)}
          </div>
        ) : (
          <div className="live-empty-state">
            <strong>No validated HoodiePad launches found yet.</strong>
            <p>Validated V4 markets appear here automatically after their Airlock launch confirms.</p>
          </div>
        )}
      </section>

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
            <p>Add a name, ticker, and artwork file. A description and links are optional. Your connected MetaMask account receives the creator fees.</p>
          </article>
          <article>
            <span className="step-number">02</span>
            <div className="step-icon">↗</div>
            <h3>Open the market</h3>
            <p>One transaction creates the 1B supply and locked V4 CHILD/HOODIE pool.</p>
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
