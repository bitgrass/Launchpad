"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CrownState } from "../lib/king";

type CrownPayload = CrownState & { hoodieUsd: number | null };

function usd(value: number) {
  if (!Number.isFinite(value) || value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function reignLength(startedAt: string, endedAt: string | null) {
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1_440)}d`;
}

export function KingOfTheHood({ initial }: { initial: CrownPayload }) {
  const [data, setData] = useState(initial);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const response = await fetch("/api/king", { cache: "no-store" })
        .catch(() => null);
      if (!response?.ok || !active) return;
      const payload = await response.json() as CrownPayload & { error?: string };
      if (active && payload.contenders) setData(payload);
    };
    const initialLoad = window.setTimeout(load, 0);
    const interval = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, []);

  const { king, contenders, reigns, gates } = data;
  const closedReigns = reigns.filter((reign) => reign.endedAt !== null);
  const nextUp = contenders.find((row) => !row.eligible);

  return (
    <section className="section-frame crown-section">
      <div className="crown-head">
        <div>
          <p className="eyebrow"><span /> Never curated, never sold</p>
          <h2>King of the Hood.</h2>
        </div>
        <button
          type="button"
          className="token-meta-chip"
          onClick={() => setHistoryOpen((open) => !open)}
        >
          Reign history ({closedReigns.length})
        </button>
      </div>

      {king ? (
        <Link className="crown-card is-crowned" href={`/token/${king.token}`}>
          <span className="crown-emblem" aria-hidden="true">👑</span>
          <span
            className="crown-avatar"
            aria-hidden="true"
            style={king.imageUrl
              ? { backgroundImage: `url("${king.imageUrl.replaceAll('"', "%22")}")` }
              : undefined}
          >
            {king.imageUrl ? "" : king.symbol.slice(0, 2)}
          </span>
          <div className="crown-identity">
            <strong>${king.symbol}</strong>
            <small>{king.name}</small>
          </div>
          <dl className="crown-stats">
            <div><dt>Score</dt><dd>{king.score}</dd></div>
            <div><dt>24h volume</dt><dd>{usd(king.volume24hUsd)}</dd></div>
            <div><dt>24h trades</dt><dd>{king.trades24h}</dd></div>
            <div><dt>Holders</dt><dd>{king.holders}</dd></div>
            <div>
              <dt>24h</dt>
              <dd className={(king.change24h ?? 0) < 0 ? "is-down" : "is-up"}>
                {king.change24h === null
                  ? "—"
                  : `${king.change24h > 0 ? "+" : ""}${king.change24h.toFixed(2)}%`}
              </dd>
            </div>
          </dl>
        </Link>
      ) : (
        <div className="crown-card is-empty">
          <span className="crown-emblem is-dim" aria-hidden="true">👑</span>
          <div>
            <strong>The crown is unclaimed.</strong>
            <p>
              No market has cleared the activity gates yet —
              {" "}{gates.minimumTrades24h} trades and {gates.minimumHolders} holders
              with {usd(gates.minimumVolume24hUsd)} of volume in 24 hours.
              {nextUp && (
                <> Closest contender: <strong>${nextUp.symbol}</strong>, still needs {nextUp.missing.join(" and ")}.</>
              )}
            </p>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="crown-history">
          {closedReigns.length > 0 ? (
            <ul>
              {closedReigns.map((reign) => (
                <li key={`${reign.token}-${reign.startedAt}`}>
                  <strong>${reign.symbol}</strong>
                  <span>
                    reigned {reignLength(reign.startedAt, reign.endedAt)} · peak score {reign.peakScore}
                  </span>
                  <code>{new Date(reign.startedAt).toISOString().slice(0, 10)}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fee-claim-note">
              Every reign is recorded here the moment the crown changes hands.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
