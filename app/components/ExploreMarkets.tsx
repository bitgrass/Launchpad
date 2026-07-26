"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { HoodiePadMarketSummary } from "../lib/launches";

type ExploreTab = "top" | "trending" | "new";
type SortKey = "mcap" | "volume" | "age" | "txns" | "change";

const TABS: Array<{ id: ExploreTab; label: string; icon: string }> = [
  { id: "top", label: "Top", icon: "🏆" },
  { id: "trending", label: "Trending", icon: "🔥" },
  { id: "new", label: "New", icon: "🌱" },
];

function usdCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function usdPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value >= 0.01) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: value >= 1_000 ? 2 : 4,
    }).format(value)}`;
  }
  return `$${value.toLocaleString("en-US", {
    maximumSignificantDigits: 3,
    useGrouping: false,
    maximumFractionDigits: 12,
  })}`;
}

function hoodieCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value)} HOODIE`;
}

function ageLabel(launchTimestamp: number, nowSeconds: number | null) {
  if (nowSeconds === null) return "—";
  const seconds = Math.max(0, nowSeconds - launchTimestamp);
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds < 30 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return `${Math.floor(seconds / (30 * 86_400))}mo`;
}

function changeCell(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <strong className="is-flat">—</strong>;
  }
  const rounded = `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  return (
    <strong className={value > 0 ? "is-up" : value < 0 ? "is-down" : "is-flat"}>
      {rounded}
    </strong>
  );
}

export function ExploreMarkets({
  markets: initialMarkets,
  hoodieUsd: initialHoodieUsd,
}: {
  markets: HoodiePadMarketSummary[];
  hoodieUsd: number | null;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ExploreTab>("top");
  const [sortOverride, setSortOverride] = useState<SortKey | null>(null);
  const [sortDescending, setSortDescending] = useState(true);
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
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? markets.filter((market) =>
          market.name.toLowerCase().includes(normalized) ||
          market.symbol.toLowerCase().includes(normalized) ||
          market.address.toLowerCase().includes(normalized))
      : [...markets];

    const metric = (market: HoodiePadMarketSummary, key: SortKey) => {
      switch (key) {
        case "mcap": return market.fdvHoodieNumber ?? 0;
        case "volume": return market.volume24hHoodieNumber > 0
          ? market.volume24hHoodieNumber
          : market.volumeHoodieNumber * 0.000001;
        case "age": return market.launchTimestamp;
        case "txns": return market.txns;
        case "change": return market.changePercent24h ?? -Infinity;
      }
    };

    const defaultKey: SortKey =
      tab === "top" ? "mcap" : tab === "trending" ? "volume" : "age";
    const key = sortOverride ?? defaultKey;
    const direction = sortOverride ? (sortDescending ? -1 : 1) : -1;
    filtered.sort((first, second) => {
      const difference = metric(first, key) - metric(second, key);
      if (difference !== 0) return difference * direction;
      // Stable tie-breaks: activity first, then the newest launch.
      if (first.txns24h !== second.txns24h) return second.txns24h - first.txns24h;
      return second.launchTimestamp - first.launchTimestamp;
    });
    return filtered;
  }, [markets, query, tab, sortOverride, sortDescending]);

  function headerSort(key: SortKey) {
    if (sortOverride === key) {
      setSortDescending((descending) => !descending);
    } else {
      setSortOverride(key);
      setSortDescending(true);
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortOverride !== key) return "";
    return sortDescending ? " ↓" : " ↑";
  }

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
        <div className="explore-tabs" role="tablist" aria-label="Market ranking">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? "is-active" : ""}
              onClick={() => {
                setTab(entry.id);
                setSortOverride(null);
                setSortDescending(true);
              }}
            >
              <span aria-hidden="true">{entry.icon}</span> {entry.label}
            </button>
          ))}
        </div>
        <div className="live-source-chip">
          <span />
          Robinhood onchain data
        </div>
      </section>
      <section className="market-section section-frame explore-markets">
        {rows.length > 0 ? (
          <div className="market-table-wrap">
            <table className="market-table">
              <thead>
                <tr>
                  <th className="is-rank">#</th>
                  <th>Token</th>
                  <th className="is-number">Price</th>
                  <th className="is-number is-sortable" onClick={() => headerSort("age")}>
                    Age{sortIndicator("age")}
                  </th>
                  <th className="is-number is-sortable" onClick={() => headerSort("txns")}>
                    Txns{sortIndicator("txns")}
                  </th>
                  <th className="is-number is-sortable" onClick={() => headerSort("change")}>
                    24H{sortIndicator("change")}
                  </th>
                  <th className="is-number is-sortable" onClick={() => headerSort("volume")}>
                    Vol.{sortIndicator("volume")}
                  </th>
                  <th className="is-number is-sortable" onClick={() => headerSort("mcap")}>
                    MCap{sortIndicator("mcap")}
                  </th>
                  <th className="is-number">Holders</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((market, index) => {
                  const priceUsd = hoodieUsd !== null && market.priceHoodie !== null
                    ? market.priceHoodie * hoodieUsd
                    : null;
                  const mcapUsd = hoodieUsd !== null && market.fdvHoodieNumber !== null
                    ? market.fdvHoodieNumber * hoodieUsd
                    : null;
                  const volumeSource = tab === "trending"
                    ? market.volume24hHoodieNumber
                    : market.volumeHoodieNumber;
                  const volumeUsd = hoodieUsd !== null
                    ? volumeSource * hoodieUsd
                    : null;
                  return (
                    <tr key={market.address}>
                      <td className="is-rank">{index + 1}</td>
                      <td>
                        <Link className="market-table-token" href={`/token/${market.address}`}>
                          <span
                            className="token-chip-logo"
                            aria-hidden="true"
                            style={market.imageUrl
                              ? { backgroundImage: `url("${market.imageUrl.replaceAll('"', "%22")}")` }
                              : undefined}
                          >
                            {market.imageUrl ? "" : market.symbol.slice(0, 2)}
                          </span>
                          <span className="market-table-name">
                            <strong>{market.name}</strong>
                            <small>
                              ${market.symbol}
                              {market.active
                                ? <em className="is-live"> · live</em>
                                : <em> · no trades yet</em>}
                            </small>
                          </span>
                        </Link>
                      </td>
                      <td className="is-number">
                        <strong>{hoodieUsd !== null ? usdPrice(priceUsd) : market.price}</strong>
                        <small>{market.price} HOODIE</small>
                      </td>
                      <td className="is-number">{ageLabel(market.launchTimestamp, nowSeconds)}</td>
                      <td className="is-number">{market.txns.toLocaleString("en-US")}</td>
                      <td className="is-number">{changeCell(market.changePercent24h)}</td>
                      <td className="is-number">
                        <strong>
                          {hoodieUsd !== null
                            ? usdCompact(volumeUsd)
                            : hoodieCompact(volumeSource)}
                        </strong>
                        {tab === "trending" && <small>24h</small>}
                      </td>
                      <td className="is-number">
                        <strong>
                          {hoodieUsd !== null
                            ? usdCompact(mcapUsd)
                            : hoodieCompact(market.fdvHoodieNumber)}
                        </strong>
                      </td>
                      <td className="is-number">{market.holderCount.toLocaleString("en-US")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
            {hoodieUsd === null &&
              " USD pricing is temporarily unavailable; amounts shown in HOODIE."}
          </p>
        </div>
      </section>
    </>
  );
}
