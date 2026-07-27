"use client";

import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import type { CreatorRow, TraderRow } from "../lib/leaderboard";

type LeaderboardData = {
  traders: TraderRow[];
  creators: CreatorRow[];
  hoodieUsd: number | null;
  weights: Record<string, number>;
};

function shorten(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function usd(value: number, hoodieUsd: number | null) {
  if (hoodieUsd === null) {
    return `${new Intl.NumberFormat("en-US", {
      notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
      maximumFractionDigits: 2,
    }).format(value)} H`;
  }
  const dollars = value * hoodieUsd;
  const sign = dollars < 0 ? "-" : "";
  const magnitude = Math.abs(dollars);
  if (magnitude === 0) return "$0";
  if (magnitude < 0.01) return `${sign}<$0.01`;
  return `${sign}$${new Intl.NumberFormat("en-US", {
    notation: magnitude >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(magnitude)}`;
}

function signedClass(value: number) {
  return value > 0 ? "is-up" : value < 0 ? "is-down" : "is-flat";
}

function medal(rank: number) {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
}

export function LeaderboardTables({
  initial,
}: {
  initial: LeaderboardData;
}) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<"traders" | "creators">("traders");
  const [methodOpen, setMethodOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const response = await fetch("/api/leaderboard", { cache: "no-store" })
        .catch(() => null);
      if (!response?.ok || !active) return;
      const payload = await response.json() as LeaderboardData & { error?: string };
      if (active && Array.isArray(payload.traders)) setData(payload);
    };
    const initialLoad = window.setTimeout(load, 0);
    const interval = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, []);

  const leader = data.traders[0];

  return (
    <>
      {leader && (
        <section className="section-frame leaderboard-hero">
          <article className="leader-card">
            <div className="leader-head">
              <Avatar address={leader.address} size={54} className="leader-avatar" />
              <div>
                <code>{shorten(leader.address)}</code>
                <strong className={signedClass(leader.realizedHoodie)}>
                  {leader.realizedHoodie >= 0 ? "+" : ""}
                  {usd(leader.realizedHoodie, data.hoodieUsd)}
                </strong>
                <small>realized PnL · on-chain verified</small>
              </div>
              <span className="leader-rank">⚡ #1 TRADER</span>
            </div>
            <dl className="leader-stats">
              <div><dt>Score</dt><dd>{leader.score}</dd></div>
              <div>
                <dt>Win rate</dt>
                <dd>{leader.winRatePercent === null ? "—" : `${leader.winRatePercent.toFixed(0)}%`}</dd>
              </div>
              <div>
                <dt>Best trade</dt>
                <dd>{usd(leader.bestTradeHoodie, data.hoodieUsd)}</dd>
              </div>
              <div><dt>Volume</dt><dd>{usd(leader.volumeHoodie, data.hoodieUsd)}</dd></div>
            </dl>
            {leader.badges.length > 0 && (
              <div className="badge-row">
                {leader.badges.map((badge) => (
                  <span className="badge-chip" key={badge}>{badge}</span>
                ))}
              </div>
            )}
          </article>
        </section>
      )}

      <section className="explore-toolbar section-frame">
        <div className="explore-tabs" role="tablist" aria-label="Leaderboard">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "traders"}
            className={tab === "traders" ? "is-active" : ""}
            onClick={() => setTab("traders")}
          >
            <span aria-hidden="true">📈</span> Traders
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "creators"}
            className={tab === "creators" ? "is-active" : ""}
            onClick={() => setTab("creators")}
          >
            <span aria-hidden="true">🎨</span> Creators
          </button>
        </div>
        <button
          type="button"
          className="token-meta-chip"
          onClick={() => setMethodOpen((open) => !open)}
        >
          Methodology
        </button>
      </section>

      {methodOpen && (
        <section className="section-frame">
          <div className="methodology-card">
            <strong>How the score works</strong>
            <p>
              Every number is derived from canonical PoolManager Swap events on
              Robinhood Chain using average-cost accounting. Realized profit is
              booked only when a position is closed; open positions are valued
              at the current pool price and shown separately as unrealized.
            </p>
            <ul>
              <li>Realized profit — {data.weights.realizedProfit}%</li>
              <li>Win rate across closed positions — {data.weights.winRate}%</li>
              <li>Return on capital deployed — {data.weights.roi}%</li>
              <li>Volume — {data.weights.volume}%</li>
              <li>Consistency (markets and days active) — {data.weights.consistency}%</li>
            </ul>
            <p>
              Volume is deliberately capped at {data.weights.volume}% of the
              score: wash trading can inflate volume, but it cannot manufacture
              realized profit, win rate, or activity spread across markets and
              days. Rankings are informational, not investment advice.
            </p>
          </div>
        </section>
      )}

      <section className="market-section section-frame explore-markets">
        <div className="market-table-wrap">
          {tab === "traders" ? (
            data.traders.length > 0 ? (
              <table className="market-table">
                <thead>
                  <tr>
                    <th className="is-rank">Rank</th>
                    <th>Trader</th>
                    <th className="is-number">Score</th>
                    <th className="is-number">Realized</th>
                    <th className="is-number">Unrealized</th>
                    <th className="is-number">ROI</th>
                    <th className="is-number">Win rate</th>
                    <th className="is-number">Volume</th>
                    <th>Badges</th>
                  </tr>
                </thead>
                <tbody>
                  {data.traders.map((row) => (
                    <tr key={row.address}>
                      <td className="is-rank">{medal(row.rank)}</td>
                      <td>
                        <a
                          className="market-table-token"
                          href={`https://robinhoodchain.blockscout.com/address/${row.address}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Avatar address={row.address} size={30} />
                          <span className="market-table-name">
                            <strong>{shorten(row.address)}</strong>
                            <small>{row.trades} trades · {row.markets} markets</small>
                          </span>
                        </a>
                      </td>
                      <td className="is-number"><strong>{row.score}</strong></td>
                      <td className="is-number">
                        <strong className={signedClass(row.realizedHoodie)}>
                          {row.realizedHoodie > 0 ? "+" : ""}
                          {usd(row.realizedHoodie, data.hoodieUsd)}
                        </strong>
                      </td>
                      <td className="is-number">
                        <strong className={signedClass(row.unrealizedHoodie)}>
                          {row.unrealizedHoodie > 0 ? "+" : ""}
                          {usd(row.unrealizedHoodie, data.hoodieUsd)}
                        </strong>
                      </td>
                      <td className="is-number">
                        <strong className={signedClass(row.roiPercent ?? 0)}>
                          {row.roiPercent === null ? "—" : `${row.roiPercent.toFixed(1)}%`}
                        </strong>
                      </td>
                      <td className="is-number">
                        {row.winRatePercent === null ? "—" : `${row.winRatePercent.toFixed(0)}%`}
                      </td>
                      <td className="is-number">{usd(row.volumeHoodie, data.hoodieUsd)}</td>
                      <td>
                        <span className="badge-row">
                          {row.badges.map((badge) => (
                            <span className="badge-chip" key={badge}>{badge}</span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="live-empty-state">
                <strong>No confirmed trades yet.</strong>
                <p>The first canonical-pool swap puts a wallet on this board.</p>
              </div>
            )
          ) : data.creators.length > 0 ? (
            <table className="market-table">
              <thead>
                <tr>
                  <th className="is-rank">Rank</th>
                  <th>Creator</th>
                  <th className="is-number">Fees earned</th>
                  <th className="is-number">Volume</th>
                  <th className="is-number">Markets</th>
                  <th className="is-number">Active</th>
                  <th className="is-number">Trades</th>
                </tr>
              </thead>
              <tbody>
                {data.creators.map((row) => (
                  <tr key={row.address}>
                    <td className="is-rank">{medal(row.rank)}</td>
                    <td>
                      <a
                        className="market-table-token"
                        href={`https://robinhoodchain.blockscout.com/address/${row.address}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Avatar
                          address={row.address}
                          size={30}
                          imageUrl={row.topImageUrl}
                        />
                        <span className="market-table-name">
                          <strong>{shorten(row.address)}</strong>
                          <small>top market ${row.topSymbol}</small>
                        </span>
                      </a>
                    </td>
                    <td className="is-number">
                      <strong className="is-up">{usd(row.feesHoodie, data.hoodieUsd)}</strong>
                      <small>80% share</small>
                    </td>
                    <td className="is-number">{usd(row.volumeHoodie, data.hoodieUsd)}</td>
                    <td className="is-number">{row.markets}</td>
                    <td className="is-number">{row.activeMarkets}</td>
                    <td className="is-number">{row.trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="live-empty-state">
              <strong>No validated markets yet.</strong>
              <p>Launch a token to open the creator board.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
