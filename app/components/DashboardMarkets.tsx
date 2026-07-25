"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarketCard, type MarketCardProps } from "./MarketCard";
import { useWallet } from "./WalletProvider";

export function DashboardMarkets({ markets: initialMarkets }: { markets: MarketCardProps[] }) {
  const { address } = useWallet();
  const [markets, setMarkets] = useState(initialMarkets);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const response = await fetch("/api/markets", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const payload = await response.json() as { markets?: MarketCardProps[] };
      if (active && Array.isArray(payload.markets)) setMarkets(payload.markets);
    };
    const interval = window.setInterval(refresh, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);
  const creatorMarkets = useMemo(
    () => address
      ? markets.filter((market) => market.creator.toLowerCase() === address.toLowerCase())
      : [],
    [address, markets],
  );
  const activeMarkets = creatorMarkets.filter((market) => market.active).length;

  return (
    <>
      <section className="dashboard-grid section-frame">
        <article className="dashboard-card dark-card">
          <span>Creator markets</span>
          <strong>{creatorMarkets.length}</strong>
          <p>Validated launches whose immutable creator recipient is this wallet.</p>
        </article>
        <article className="dashboard-card">
          <span>Active markets</span>
          <strong>{activeMarkets}</strong>
          <p>Markets with at least one confirmed canonical-pool swap.</p>
        </article>
        <article className="dashboard-card">
          <span>Registry total</span>
          <strong>{markets.length}</strong>
          <p>All official HoodiePad launches currently indexed from Robinhood Chain.</p>
        </article>
      </section>
      {address && creatorMarkets.length > 0 ? (
        <section className="market-section section-frame dashboard-market-list">
          <div className="section-heading">
            <div>
              <p className="eyebrow"><span /> Your onchain launches</p>
              <h2>Creator markets.</h2>
            </div>
          </div>
          <div className="market-grid">
            {creatorMarkets.map((market) => <MarketCard key={market.address} {...market} />)}
          </div>
        </section>
      ) : (
        <section className="dashboard-empty section-frame">
          <div className="empty-hood" aria-hidden="true">•‿•</div>
          <h2>{address ? "No launches for this wallet." : "Connect your creator wallet."}</h2>
          <p>
            {address
              ? "Launch a fixed-supply market with this connected account to see it here."
              : "HoodiePad matches the connected account against immutable Airlock creator data."}
          </p>
          <Link className="button button-primary" href="/launch">Launch a token ↗</Link>
        </section>
      )}
    </>
  );
}
