"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { HoodiePadMarketSummary } from "../lib/launches";
import { MarketCard } from "./MarketCard";

type BoardTab = "trending" | "new" | "graduated";

const TABS: Array<{ id: BoardTab; label: string; icon: string }> = [
  { id: "trending", label: "Trending", icon: "🔥" },
  { id: "new", label: "New", icon: "🌱" },
  { id: "graduated", label: "Graduated", icon: "🎓" },
];

const BOARD_SIZE = 12;

function usdCompact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function usdTinyPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  if (value >= 0.01) {
    return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value)}`;
  }
  return `$${value.toLocaleString("en-US", {
    maximumSignificantDigits: 3,
    useGrouping: false,
    maximumFractionDigits: 12,
  })}`;
}

function ageLabel(launchTimestamp: number, nowSeconds: number | null) {
  if (nowSeconds === null) return undefined;
  const seconds = Math.max(0, nowSeconds - launchTimestamp);
  if (seconds < 60) return "launched now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds < 30 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  return `${Math.floor(seconds / (30 * 86_400))}mo ago`;
}

export function HomeBoard({
  markets: initialMarkets,
  hoodieUsd: initialHoodieUsd,
}: {
  markets: HoodiePadMarketSummary[];
  hoodieUsd: number | null;
}) {
  const [tab, setTab] = useState<BoardTab>("trending");
  const [markets, setMarkets] = useState(initialMarkets);
  const [hoodieUsd, setHoodieUsd] = useState<number | null>(initialHoodieUsd);
  const [nowSeconds, setNowSeconds] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const response = await fetch("/api/markets", { cache: "no-store" }).catch(() => null);
      if (!active) return;
      setNowSeconds(Math.floor(Date.now() / 1000));
      if (!response?.ok) return;
      const payload = await response.json() as {
        markets?: HoodiePadMarketSummary[];
        hoodieUsd?: number | null;
      };
      if (!active) return;
      if (Array.isArray(payload.markets)) setMarkets(payload.markets);
      if (payload.hoodieUsd !== undefined) setHoodieUsd(payload.hoodieUsd);
    };
    const initial = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);

  const rows = useMemo(() => {
    if (tab === "graduated") {
      return markets
        .filter((market) => (market.graduationPercent ?? 0) >= 100)
        .sort((first, second) => second.launchTimestamp - first.launchTimestamp)
        .slice(0, BOARD_SIZE);
    }
    const ranked = [...markets];
    if (tab === "trending") {
      ranked.sort((first, second) => {
        const firstVolume = first.volume24hHoodieNumber > 0
          ? first.volume24hHoodieNumber
          : first.volumeHoodieNumber * 0.000001;
        const secondVolume = second.volume24hHoodieNumber > 0
          ? second.volume24hHoodieNumber
          : second.volumeHoodieNumber * 0.000001;
        if (firstVolume !== secondVolume) return secondVolume - firstVolume;
        return second.launchTimestamp - first.launchTimestamp;
      });
    } else {
      ranked.sort((first, second) => second.launchTimestamp - first.launchTimestamp);
    }
    return ranked.slice(0, BOARD_SIZE);
  }, [markets, tab]);

  return (
    <section className="market-section section-frame home-board">
      <div className="section-heading">
        <div>
          <p className="eyebrow"><span /> Live from the trenches</p>
          <h2>The board.</h2>
        </div>
        <div className="explore-tabs board-tabs" role="tablist" aria-label="Launch board">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? "is-active" : ""}
              onClick={() => setTab(entry.id)}
            >
              <span aria-hidden="true">{entry.icon}</span> {entry.label}
            </button>
          ))}
        </div>
        <Link href="/explore">View all markets ↗</Link>
      </div>
      {rows.length > 0 ? (
        <div className="market-grid">
          {rows.map((market) => {
            const priceUsd = hoodieUsd !== null && market.priceHoodie !== null
              ? usdTinyPrice(market.priceHoodie * hoodieUsd)
              : null;
            const mcapUsd = hoodieUsd !== null && market.fdvHoodieNumber !== null
              ? usdCompact(market.fdvHoodieNumber * hoodieUsd)
              : null;
            const volumeUsd = hoodieUsd !== null
              ? usdCompact(market.volumeHoodieNumber * hoodieUsd)
              : null;
            return (
              <MarketCard
                key={market.address}
                {...market}
                price={priceUsd ?? `${market.price} HOODIE`}
                fdv={mcapUsd ?? market.fdv}
                volume={volumeUsd ?? market.volume}
                ageLabel={ageLabel(market.launchTimestamp, nowSeconds)}
              />
            );
          })}
        </div>
      ) : tab === "graduated" ? (
        <div className="live-empty-state">
          <strong>No graduations yet.</strong>
          <p>
            The first market to accumulate 420M HOODIE in its locked pool
            graduates — the pool stays locked and trading continues.
          </p>
        </div>
      ) : (
        <div className="live-empty-state">
          <strong>No validated HoodiePad launches found yet.</strong>
          <p>Validated V4 markets appear here automatically after their Airlock launch confirms.</p>
        </div>
      )}
    </section>
  );
}
