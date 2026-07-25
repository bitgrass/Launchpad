"use client";

import { useEffect, useMemo, useState } from "react";
import { MarketCard, type MarketCardProps } from "./MarketCard";

export function ExploreMarkets({ markets: initialMarkets }: { markets: MarketCardProps[] }) {
  const [query, setQuery] = useState("");
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
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return markets;
    return markets.filter((market) =>
      market.name.toLowerCase().includes(normalized) ||
      market.symbol.toLowerCase().includes(normalized) ||
      market.address.toLowerCase().includes(normalized),
    );
  }, [markets, query]);

  return (
    <>
      <section className="explore-toolbar section-frame">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search tokens"
            placeholder="Search name, ticker, or contract"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="live-source-chip">
          <span />
          Robinhood onchain data
        </div>
      </section>
      <section className="market-section section-frame explore-markets">
        {filtered.length > 0 ? (
          <div className="market-grid">
            {filtered.map((market) => <MarketCard key={market.address} {...market} />)}
          </div>
        ) : (
          <div className="live-empty-state">
            <strong>No matching HoodiePad markets.</strong>
            <p>Only validated Multicurve V4 launches emitted by the canonical Airlock appear here.</p>
          </div>
        )}
        <div className="empty-state-row">
          <span>Live registry</span>
          <p>
            {markets.length} validated HoodiePad {markets.length === 1 ? "market" : "markets"} found
            from Robinhood Chain V4 launch events.
          </p>
        </div>
      </section>
    </>
  );
}
