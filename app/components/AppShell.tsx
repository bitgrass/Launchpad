import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./Brand";
import { HeaderNav } from "./HeaderNav";
import { LiveTicker } from "./LiveTicker";
import { WalletButton } from "./WalletButton";

const tickerItems = [
  "CREATORS KEEP 80%",
  "EVERY MARKET PAIRS WITH $HOODIE",
  "NO PRESALE",
  "NO MIGRATION",
  "2% MAX WALLET · 24H",
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell">
      <div className="ticker" aria-label="HoodiePad launch rules">
        <div className="ticker-track">
          {[...tickerItems, ...tickerItems].map((item, index) => (
            <span key={`${item}-${index}`}>
              <i /> {item}
            </span>
          ))}
        </div>
      </div>
      <LiveTicker />
      <header className="site-header">
        <Brand />
        <HeaderNav />
        <div className="header-actions">
          <Link className="button button-primary header-launch" href="/launch">
            Launch a token <span aria-hidden="true">↗</span>
          </Link>
          <WalletButton />
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <div>
          <Brand />
          <p>Fair markets for the Robinhood Chain trenches.</p>
        </div>
        <div className="footer-links">
          <Link href="/about">How it works</Link>
          <Link href="/analytics">Analytics</Link>
          <Link href="/fuel">HOODIE Fuel</Link>
          <a href="https://hoodie.fun" target="_blank" rel="noreferrer">
            $HOODIE ↗
          </a>
          <a
            href="https://robinhoodchain.blockscout.com/address/0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3"
            target="_blank"
            rel="noreferrer"
          >
            Contract ↗
          </a>
          <span>Chain 4663</span>
        </div>
        <p className="risk-copy">
          User-created tokens are experimental and can lose all value. HoodiePad
          is non-custodial software, not investment advice.
        </p>
      </footer>
    </div>
  );
}
