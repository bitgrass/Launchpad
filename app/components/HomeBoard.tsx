"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HoodiePadMarketSummary } from "../lib/launches";
import { MarketCard } from "./MarketCard";

type BoardTab = "trending" | "top" | "new" | "curve";
type BoardView = "grid" | "list";
type SortKey = "mcap" | "volume" | "age" | "txns" | "change";

const TABS: Array<{ id: BoardTab; label: string; icon: string; hint: string }> = [
  { id: "trending", label: "Trending", icon: "🔥", hint: "Most 24h volume" },
  { id: "top", label: "Top", icon: "🏆", hint: "Largest market cap" },
  { id: "new", label: "New", icon: "🌱", hint: "Newest launches" },
  { id: "curve", label: "Curve", icon: "📈", hint: "Closest to graduation" },
];

const BOARD_SIZE = 12;
const LIST_SIZE = 25;
const RAIL_SIZE = 8;
const GRAD_SIZE = 6;

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

function hoodieCompact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value)} HOODIE`;
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

// 24h volume ranks first; markets with no 24h trades fall back to a heavily
// discounted all-time volume so a fresh board still has an order.
function trendingScore(market: HoodiePadMarketSummary) {
  return market.volume24hHoodieNumber > 0
    ? market.volume24hHoodieNumber
    : market.volumeHoodieNumber * 0.000001;
}

function changeChip(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return (
    <em className={value < 0 ? "change-down" : "change-up"}>
      {value > 0 ? "+" : ""}{value.toFixed(2)}%
    </em>
  );
}

function changeCell(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <strong className="is-flat">—</strong>;
  }
  return (
    <strong className={value > 0 ? "is-up" : value < 0 ? "is-down" : "is-flat"}>
      {value > 0 ? "+" : ""}{value.toFixed(2)}%
    </strong>
  );
}

export function HomeBoard({
  markets: initialMarkets,
  hoodieUsd: initialHoodieUsd,
}: {
  markets: HoodiePadMarketSummary[];
  hoodieUsd: number | null;
}) {
  const [tab, setTab] = useState<BoardTab>("trending");
  const [view, setView] = useState<BoardView>("grid");
  const [query, setQuery] = useState("");
  const [sortOverride, setSortOverride] = useState<SortKey | null>(null);
  const [sortDescending, setSortDescending] = useState(true);
  const [markets, setMarkets] = useState(initialMarkets);
  const [hoodieUsd, setHoodieUsd] = useState<number | null>(initialHoodieUsd);
  const [nowSeconds, setNowSeconds] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rail = useMemo(
    () =>
      [...markets]
        .sort((first, second) =>
          trendingScore(second) - trendingScore(first) ||
          second.launchTimestamp - first.launchTimestamp)
        .slice(0, RAIL_SIZE),
    [markets],
  );

  const graduated = useMemo(
    () =>
      markets
        .filter((market) => (market.graduationPercent ?? 0) >= 100)
        .sort((first, second) => second.launchTimestamp - first.launchTimestamp),
    [markets],
  );

  const rows = useMemo(() => {
    // Graduated markets have their own shelf below the board.
    const climbing = markets.filter(
      (market) => (market.graduationPercent ?? 0) < 100,
    );
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? climbing.filter((market) =>
          market.name.toLowerCase().includes(normalized) ||
          market.symbol.toLowerCase().includes(normalized) ||
          market.address.toLowerCase().includes(normalized))
      : climbing;

    const scoped = tab === "curve"
      ? filtered.filter((market) => market.graduationPercent !== null)
      : [...filtered];

    const metric = (market: HoodiePadMarketSummary, key: SortKey) => {
      switch (key) {
        case "mcap": return market.fdvHoodieNumber ?? 0;
        case "volume": return trendingScore(market);
        case "age": return market.launchTimestamp;
        case "txns": return market.txns;
        case "change": return market.changePercent24h ?? -Infinity;
      }
    };

    if (sortOverride) {
      const direction = sortDescending ? -1 : 1;
      scoped.sort((first, second) => {
        const difference = metric(first, sortOverride) - metric(second, sortOverride);
        if (difference !== 0) return difference * direction;
        return second.launchTimestamp - first.launchTimestamp;
      });
    } else if (tab === "curve") {
      scoped.sort((first, second) =>
        (second.graduationPercent ?? 0) - (first.graduationPercent ?? 0) ||
        second.volume24hHoodieNumber - first.volume24hHoodieNumber);
    } else if (tab === "trending") {
      scoped.sort((first, second) =>
        trendingScore(second) - trendingScore(first) ||
        second.launchTimestamp - first.launchTimestamp);
    } else if (tab === "top") {
      scoped.sort((first, second) =>
        (second.fdvHoodieNumber ?? 0) - (first.fdvHoodieNumber ?? 0) ||
        second.volumeHoodieNumber - first.volumeHoodieNumber);
    } else {
      scoped.sort((first, second) => second.launchTimestamp - first.launchTimestamp);
    }
    return scoped.slice(0, view === "list" ? LIST_SIZE : BOARD_SIZE);
  }, [markets, query, tab, view, sortOverride, sortDescending]);

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

  const activeTab = TABS.find((entry) => entry.id === tab);
  const usdOf = (hoodie: number | null) =>
    hoodieUsd !== null && hoodie !== null ? usdCompact(hoodie * hoodieUsd) : null;

  return (
    <>
      {rail.length > 0 && (
        <section className="trend-rail-section section-frame" aria-label="Trending launches">
          <div className="trend-rail-head">
            <p className="eyebrow"><span /> Trending</p>
            <Link href="/explore">All markets ↗</Link>
          </div>
          <div className="trend-rail">
            {rail.map((market, index) => {
              const mcap = usdOf(market.fdvHoodieNumber) ?? market.fdv;
              const volume24h = market.volume24hHoodieNumber > 0
                ? `24H ${usdOf(market.volume24hHoodieNumber) ?? hoodieCompact(market.volume24hHoodieNumber)}`
                : `VOL ${usdOf(market.volumeHoodieNumber) ?? hoodieCompact(market.volumeHoodieNumber)}`;
              const age = ageLabel(market.launchTimestamp, nowSeconds);
              const percent = market.graduationPercent;
              return (
                <Link className="trend-card" key={market.address} href={`/token/${market.address}`}>
                  <span
                    className={`trend-art tone-${market.tone}${market.imageUrl ? " has-artwork" : ""}`}
                    aria-hidden="true"
                    style={market.imageUrl
                      ? { backgroundImage: `url("${market.imageUrl.replaceAll('"', "%22")}")` }
                      : undefined}
                  >
                    {market.imageUrl ? "" : market.symbol.slice(0, 2)}
                    <i className="trend-rank">{String(index + 1).padStart(2, "0")}</i>
                  </span>
                  <span className="trend-main">
                    <span className="trend-title">
                      <strong>${market.symbol}</strong>
                      {changeChip(market.changePercent24h)}
                    </span>
                    <span className="trend-mcap"><small>MCAP</small> {mcap}</span>
                    <span className="trend-meta">
                      <span>{volume24h}</span>
                      <span>{market.holderCount.toLocaleString("en-US")} holders</span>
                      {age && <span>{age}</span>}
                    </span>
                    {percent !== null && (
                      <span className="trend-curve">
                        {percent >= 100 ? (
                          <em className="mini-curve-grad">GRADUATED</em>
                        ) : (
                          <>
                            <span className="mini-curve-bar">
                              <i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
                            </span>
                            <small>{percent.toFixed(percent < 10 ? 1 : 0)}%</small>
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="market-section section-frame home-board">
        <div className="section-heading home-board-heading">
          <div>
            <p className="eyebrow"><span /> Live from the trenches</p>
            <h2>The board.</h2>
            {activeTab && <small className="board-hint">{activeTab.hint} · still climbing the curve</small>}
          </div>
          <Link href="/explore">View all markets ↗</Link>
        </div>
        <div className="board-toolbar">
          <label className="search-field board-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              aria-label="Search tokens"
              placeholder="Search name, ticker, or contract"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </label>
          <div className="explore-tabs board-tabs" role="tablist" aria-label="Launch board">
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
          <div className="view-toggle" role="group" aria-label="Board layout">
            <button
              type="button"
              aria-pressed={view === "grid"}
              aria-label="Card grid"
              className={view === "grid" ? "is-active" : ""}
              onClick={() => setView("grid")}
            >
              ⊞
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              aria-label="Trader list"
              className={view === "list" ? "is-active" : ""}
              onClick={() => setView("list")}
            >
              ☰
            </button>
          </div>
        </div>
        {rows.length > 0 && view === "grid" ? (
          <div className="market-grid">
            {rows.map((market) => {
              const priceUsd = hoodieUsd !== null && market.priceHoodie !== null
                ? usdTinyPrice(market.priceHoodie * hoodieUsd)
                : null;
              return (
                <MarketCard
                  key={market.address}
                  {...market}
                  price={priceUsd ?? `${market.price} HOODIE`}
                  fdv={usdOf(market.fdvHoodieNumber) ?? market.fdv}
                  volume={usdOf(market.volumeHoodieNumber) ?? market.volume}
                  ageLabel={ageLabel(market.launchTimestamp, nowSeconds)}
                />
              );
            })}
          </div>
        ) : rows.length > 0 ? (
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
                  <th className="is-number">Curve</th>
                  <th className="is-number">Holders</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((market, index) => {
                  const priceUsd = hoodieUsd !== null && market.priceHoodie !== null
                    ? usdTinyPrice(market.priceHoodie * hoodieUsd)
                    : null;
                  const volumeSource = tab === "trending"
                    ? market.volume24hHoodieNumber
                    : market.volumeHoodieNumber;
                  const seconds = nowSeconds !== null
                    ? Math.max(0, nowSeconds - market.launchTimestamp)
                    : null;
                  const age = seconds === null
                    ? "—"
                    : seconds < 3_600
                      ? `${Math.max(1, Math.floor(seconds / 60))}m`
                      : seconds < 86_400
                        ? `${Math.floor(seconds / 3_600)}h`
                        : `${Math.floor(seconds / 86_400)}d`;
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
                        <strong>{priceUsd ?? market.price}</strong>
                        <small>{market.price} HOODIE</small>
                      </td>
                      <td className="is-number">{age}</td>
                      <td className="is-number">{market.txns.toLocaleString("en-US")}</td>
                      <td className="is-number">{changeCell(market.changePercent24h)}</td>
                      <td className="is-number">
                        <strong>{usdOf(volumeSource) ?? hoodieCompact(volumeSource)}</strong>
                        {tab === "trending" && <small>24h</small>}
                      </td>
                      <td className="is-number">
                        <strong>
                          {usdOf(market.fdvHoodieNumber) ?? hoodieCompact(market.fdvHoodieNumber)}
                        </strong>
                      </td>
                      <td className="is-number">
                        {market.graduationPercent === null ? (
                          "—"
                        ) : (
                          <span
                            className="mini-curve"
                            title={`${market.graduationPercent.toFixed(1)}% to graduation`}
                          >
                            <span className="mini-curve-bar">
                              <i style={{ width: `${market.graduationPercent}%` }} />
                            </span>
                            <small>
                              {market.graduationPercent.toFixed(market.graduationPercent < 10 ? 1 : 0)}%
                            </small>
                          </span>
                        )}
                      </td>
                      <td className="is-number">{market.holderCount.toLocaleString("en-US")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : query.trim() ? (
          <div className="live-empty-state">
            <strong>Nothing on the board matches “{query.trim()}”.</strong>
            <p>Try a ticker, a token name, or a contract address.</p>
          </div>
        ) : tab === "curve" ? (
          <div className="live-empty-state">
            <strong>No markets on the curve right now.</strong>
            <p>Every validated launch appears here while it fills toward graduation.</p>
          </div>
        ) : (
          <div className="live-empty-state">
            <strong>No validated HoodiePad launches found yet.</strong>
            <p>Validated V4 markets appear here automatically after their Airlock launch confirms.</p>
          </div>
        )}
      </section>

      <section className="section-frame grad-section" aria-label="Graduated markets">
        <div className="grad-panel">
          <div className="grad-head">
            <div>
              <p className="eyebrow"><span /> Cleared 420M HOODIE raised</p>
              <h2>
                Graduated
                <em className="grad-count">{graduated.length.toLocaleString("en-US")}</em>
              </h2>
              <small className="board-hint">Pools stay locked — trading never stops</small>
            </div>
            {graduated.length > 0 && <Link href="/explore">View all markets ↗</Link>}
          </div>
          {graduated.length > 0 ? (
            <>
              <div className="market-grid">
                {graduated.slice(0, GRAD_SIZE).map((market) => {
                  const priceUsd = hoodieUsd !== null && market.priceHoodie !== null
                    ? usdTinyPrice(market.priceHoodie * hoodieUsd)
                    : null;
                  return (
                    <MarketCard
                      key={market.address}
                      {...market}
                      price={priceUsd ?? `${market.price} HOODIE`}
                      fdv={usdOf(market.fdvHoodieNumber) ?? market.fdv}
                      volume={usdOf(market.volumeHoodieNumber) ?? market.volume}
                      ageLabel={ageLabel(market.launchTimestamp, nowSeconds)}
                    />
                  );
                })}
              </div>
              {graduated.length > GRAD_SIZE && (
                <p className="grad-more">
                  …and {(graduated.length - GRAD_SIZE).toLocaleString("en-US")} more on{" "}
                  <Link href="/explore">explore</Link>.
                </p>
              )}
            </>
          ) : (
            <div className="live-empty-state">
              <strong>No graduations yet.</strong>
              <p>
                The first market to accumulate 420M HOODIE in its locked pool
                graduates — the pool stays locked and trading continues.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
