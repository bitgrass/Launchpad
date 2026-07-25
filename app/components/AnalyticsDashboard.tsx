"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ProtocolAnalytics,
  ProtocolAnalyticsMetrics,
  ProtocolDailyActivity,
} from "../lib/analytics";

function metricCards(metrics: ProtocolAnalyticsMetrics) {
  return [
    {
      label: "Trading volume",
      value: `${metrics.hoodieVolume} HOODIE`,
      note: "Canonical-pool volume measured from confirmed Swap events.",
    },
    {
      label: "Token launches",
      value: metrics.launches.toLocaleString("en-US"),
      note: "Validated HoodiePad markets created on Robinhood Chain.",
    },
    {
      label: "Trades",
      value: metrics.trades.toLocaleString("en-US"),
      note: "Confirmed swaps across every canonical CHILD / HOODIE pool.",
    },
    {
      label: "Estimated creator fees",
      value: `${metrics.creatorFeesHoodie} HOODIE`,
      note: "HOODIE-side fee estimate at the immutable 80% creator share.",
    },
    {
      label: "Estimated ecosystem fees",
      value: `${metrics.ecosystemFeesHoodie} HOODIE`,
      note: "HOODIE-side fee estimate at the immutable 15% ecosystem share.",
    },
    {
      label: "Unique creators",
      value: metrics.uniqueCreators.toLocaleString("en-US"),
      note: `${metrics.activeMarkets.toLocaleString("en-US")} markets traded in this period.`,
    },
  ];
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function numericVolume(raw: string) {
  return Number(BigInt(raw)) / 1e18;
}

function ActivityBars({
  title,
  description,
  data,
  value,
  display,
}: {
  title: string;
  description: string;
  data: ProtocolDailyActivity[];
  value: (item: ProtocolDailyActivity) => number;
  display: (item: ProtocolDailyActivity) => string;
}) {
  const maximum = Math.max(1, ...data.map(value));
  return (
    <article className="analytics-chart-card">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="analytics-bars" role="img" aria-label={`${title} by UTC day`}>
        {data.map((item) => {
          const amount = value(item);
          const height = amount === 0 ? 2 : Math.max(8, amount / maximum * 100);
          return (
            <div className="analytics-bar-column" key={item.date}>
              <span className="analytics-bar-value">{display(item)}</span>
              <i style={{ height: `${height}%` }} />
              <span>{dateLabel(item.date)}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function AnalyticsDashboard({
  initialAnalytics,
}: {
  initialAnalytics: ProtocolAnalytics;
}) {
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [period, setPeriod] = useState<"24h" | "all">("24h");
  const [refreshError, setRefreshError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/analytics", { cache: "no-store" });
        const payload = await response.json() as ProtocolAnalytics & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Analytics request failed");
        }
        if (active) {
          setAnalytics(payload);
          setRefreshError("");
        }
      } catch {
        if (active) setRefreshError("Live refresh is temporarily unavailable.");
      }
    };
    const interval = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const metrics = period === "24h" ? analytics.rolling24h : analytics.allTime;
  const cards = useMemo(() => metricCards(metrics), [metrics]);
  const updated = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(analytics.asOf));

  return (
    <>
      <section className="analytics-overview section-frame">
        <div className="analytics-overview-head">
          <div>
            <p className="eyebrow"><span /> Robinhood onchain reporting</p>
            <h1>Protocol analytics.</h1>
            <p>
              Confirmed HoodiePad launch and swap events, indexed directly from
              Robinhood Chain.
            </p>
            <small>
              Updated {updated} · refreshes every 15s
              {refreshError ? ` · ${refreshError}` : ""}
            </small>
          </div>
          <div className="analytics-period" aria-label="Analytics period">
            <button
              type="button"
              className={period === "24h" ? "is-active" : ""}
              onClick={() => setPeriod("24h")}
            >
              24h
            </button>
            <button
              type="button"
              className={period === "all" ? "is-active" : ""}
              onClick={() => setPeriod("all")}
            >
              All time
            </button>
          </div>
        </div>
        <div className="analytics-metric-grid">
          {cards.map((card) => (
            <article key={card.label}>
              <span>{period === "24h" ? "24h" : "All-time"} {card.label}</span>
              <strong>{card.value}</strong>
              <p>{card.note}</p>
            </article>
          ))}
        </div>
        <p className="analytics-disclosure">
          Volume and trade counts are exact onchain event totals. Fee cards are
          estimates for HOODIE paid into buy-side swaps; child-token-side fees
          are not converted or combined.
        </p>
      </section>

      <section className="analytics-chart-grid section-frame">
        <ActivityBars
          title="Trading volume"
          description="HOODIE volume by UTC day."
          data={analytics.daily}
          value={(item) => numericVolume(item.hoodieVolumeRaw)}
          display={(item) => `${item.hoodieVolume} H`}
        />
        <ActivityBars
          title="Token launches"
          description="Official markets created by UTC day."
          data={analytics.daily}
          value={(item) => item.launches}
          display={(item) => item.launches.toLocaleString("en-US")}
        />
        <ActivityBars
          title="Trades"
          description="Confirmed canonical-pool swaps by UTC day."
          data={analytics.daily}
          value={(item) => item.trades}
          display={(item) => item.trades.toLocaleString("en-US")}
        />
        <article className="analytics-method-card">
          <span>DATA METHOD</span>
          <h2>Onchain first.</h2>
          <p>
            HoodiePad reads V4 Airlock Create events and each canonical PoolManager
            Swap event. Legacy V3 launches are excluded from public analytics.
          </p>
          <dl>
            <div><dt>Source</dt><dd>{analytics.source}</dd></div>
            <div><dt>Network</dt><dd>Robinhood Chain · 4663</dd></div>
            <div><dt>Quote asset</dt><dd>HOODIE</dd></div>
          </dl>
        </article>
      </section>
    </>
  );
}
