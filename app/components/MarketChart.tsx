"use client";

import { useEffect, useMemo, useState } from "react";

type ChartPoint = {
  blockNumber: string;
  transactionHash: string;
  logIndex: number;
  price: number;
  hoodieVolumeRaw: string;
  childVolumeRaw: string;
};

type ChartData = {
  currentPrice: string;
  fdvHoodie: string;
  points: ChartPoint[];
  swapCount: number;
  hoodieVolume: string;
  changePercent: number | null;
  latestBlock: string | null;
  holderCount: number;
};

function chartPath(points: ChartPoint[]) {
  if (points.length === 0) return "";
  const source = points.length === 1
    ? [points[0], { ...points[0], logIndex: points[0].logIndex + 1 }]
    : points;
  const prices = source.map((point) => point.price);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const spread = maximum - minimum || Math.max(maximum * 0.02, 0.00000001);
  return source.map((point, index) => {
    const x = 20 + (index / Math.max(1, source.length - 1)) * 960;
    const y = 285 - ((point.price - minimum) / spread) * 250;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

export function MarketChart({
  token,
  initialPrice,
}: {
  token: string;
  initialPrice: string;
}) {
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/markets/${token}/chart`, { cache: "no-store" });
        const payload = await response.json() as ChartData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Chart request failed");
        if (active) {
          setData(payload);
          setError("");
        }
      } catch {
        if (active) setError("Live chart data is temporarily unavailable.");
      }
    };
    void load();
    const interval = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [token]);

  const path = useMemo(() => chartPath(data?.points ?? []), [data?.points]);
  const change = data?.changePercent;

  return (
    <div className="onchain-chart">
      <div className="chart-toolbar">
        <div>
          <span>Live canonical-pool price</span>
          <strong>{data?.currentPrice ?? initialPrice} HOODIE</strong>
        </div>
        <div className="chart-live-indicator"><span /> Refreshes every 15s</div>
      </div>
      {error ? (
        <div className="chart-empty"><strong>Chart unavailable</strong><p>{error}</p></div>
      ) : data && data.points.length === 0 ? (
        <div className="chart-empty">
          <strong>No confirmed swaps yet.</strong>
          <p>A confirmed in-app or external swap will add the first onchain chart point.</p>
        </div>
      ) : (
        <div className="chart-canvas">
          <svg viewBox="0 0 1000 320" role="img" aria-label="Onchain HoodiePad market price chart">
            <defs>
              <linearGradient id="hoodieChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#adff00" stopOpacity=".35" />
                <stop offset="100%" stopColor="#adff00" stopOpacity="0" />
              </linearGradient>
            </defs>
            {path && (
              <>
                <path className="chart-area" d={`${path} L 980 305 L 20 305 Z`} />
                <path className="chart-line" d={path} />
              </>
            )}
          </svg>
          {!data && <span className="chart-loading">Reading Robinhood Chain…</span>}
        </div>
      )}
      <div className="chart-metrics">
        <div><span>All-time swaps</span><strong>{data?.swapCount ?? "—"}</strong></div>
        <div><span>All-time volume</span><strong>{data ? `${data.hoodieVolume} HOODIE` : "—"}</strong></div>
        <div>
          <span>All-time change</span>
          <strong className={change !== null && change !== undefined && change < 0 ? "negative" : ""}>
            {change === null || change === undefined
              ? "New"
              : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
          </strong>
        </div>
        <div><span>Market cap (FDV)</span><strong>{data ? `${data.fdvHoodie} HOODIE` : "—"}</strong></div>
        <div><span>Wallet holders</span><strong>{data?.holderCount ?? "—"}</strong></div>
      </div>
    </div>
  );
}
