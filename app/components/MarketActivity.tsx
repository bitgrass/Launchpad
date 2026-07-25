"use client";

import { useEffect, useState } from "react";

type Trade = {
  transactionHash: string;
  timestamp: number;
  side: "buy" | "sell";
  trader: string;
  hoodieVolumeRaw: string;
  childVolumeRaw: string;
  price: number;
};

type Holder = {
  address: string;
  balance: string;
  sharePercent: number;
};

type ActivityData = {
  points: Trade[];
  holderCount: number;
  holders: Holder[];
};

function shorten(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatRaw(raw: string) {
  const numeric = Number(raw) / 1e18;
  if (!Number.isFinite(numeric)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    notation: numeric >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: numeric >= 1_000_000 ? 2 : 4,
  }).format(numeric);
}

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(timestamp * 1000));
}

export function MarketActivity({
  token,
  symbol,
}: {
  token: string;
  symbol: string;
}) {
  const [tab, setTab] = useState<"trades" | "holders">("trades");
  const [data, setData] = useState<ActivityData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/markets/${token}/chart`, {
          cache: "no-store",
        });
        const payload = await response.json() as ActivityData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Activity request failed");
        if (active) {
          setData(payload);
          setError("");
        }
      } catch {
        if (active) setError("Onchain market activity is temporarily unavailable.");
      }
    };
    void load();
    const interval = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [token]);

  const recentTrades = [...(data?.points ?? [])].reverse().slice(0, 20);

  return (
    <section className="market-activity section-frame">
      <div className="market-activity-head">
        <div>
          <span className="eyebrow">LIVE ROBINHOOD ACTIVITY</span>
          <h2>Market activity.</h2>
        </div>
        <div className="activity-tabs" role="tablist" aria-label="Market activity">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "trades"}
            className={tab === "trades" ? "is-active" : ""}
            onClick={() => setTab("trades")}
          >
            Recent trades
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "holders"}
            className={tab === "holders" ? "is-active" : ""}
            onClick={() => setTab("holders")}
          >
            Holders {data ? `(${data.holderCount})` : ""}
          </button>
        </div>
      </div>

      {error ? (
        <div className="activity-empty">{error}</div>
      ) : tab === "trades" ? (
        recentTrades.length === 0 ? (
          <div className="activity-empty">No confirmed canonical-pool trades yet.</div>
        ) : (
          <div className="activity-table">
            <div className="activity-row activity-row-head">
              <span>Time</span><span>Side</span><span>Trader</span>
              <span>{symbol}</span><span>HOODIE</span><span>Price</span>
            </div>
            {recentTrades.map((trade) => (
              <a
                className="activity-row"
                href={`https://robinhoodchain.blockscout.com/tx/${trade.transactionHash}`}
                target="_blank"
                rel="noreferrer"
                key={`${trade.transactionHash}-${trade.timestamp}`}
              >
                <span>{timeLabel(trade.timestamp)} UTC</span>
                <strong className={`trade-side ${trade.side}`}>
                  {trade.side === "buy" ? "Buy" : "Sell"}
                </strong>
                <code>{shorten(trade.trader)}</code>
                <span>{formatRaw(trade.childVolumeRaw)}</span>
                <span>{formatRaw(trade.hoodieVolumeRaw)}</span>
                <span>{trade.price.toLocaleString("en-US", { maximumFractionDigits: 8 })}</span>
              </a>
            ))}
          </div>
        )
      ) : data && data.holders.length > 0 ? (
        <div className="activity-table holder-table">
          <div className="activity-row activity-row-head">
            <span>Rank</span><span>Holder</span><span>Balance</span><span>Supply</span>
          </div>
          {data.holders.map((holder, index) => (
            <a
              className="activity-row"
              href={`https://robinhoodchain.blockscout.com/address/${holder.address}`}
              target="_blank"
              rel="noreferrer"
              key={holder.address}
            >
              <strong>#{index + 1}</strong>
              <code>{shorten(holder.address)}</code>
              <span>{holder.balance} {symbol}</span>
              <span>{holder.sharePercent.toFixed(4)}%</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="activity-empty">
          No wallet holders found after excluding the locked pool and protocol contracts.
        </div>
      )}
    </section>
  );
}
