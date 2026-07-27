"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ActivityEvent = {
  kind: "launch" | "buy" | "sell";
  token: string;
  symbol: string;
  imageUrl?: string;
  actor: string;
  timestamp: number;
  hoodieAmount: number;
  transactionHash: string;
};

function shorten(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function amountLabel(event: ActivityEvent, hoodieUsd: number | null) {
  if (event.kind === "launch") return "launched";
  const usd = hoodieUsd !== null ? event.hoodieAmount * hoodieUsd : null;
  const value = usd !== null && usd >= 0.01
    ? `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(usd)}`
    : `${new Intl.NumberFormat("en-US", {
        notation: event.hoodieAmount >= 1_000_000 ? "compact" : "standard",
        maximumFractionDigits: 2,
      }).format(event.hoodieAmount)} HOODIE`;
  return `${event.kind === "buy" ? "bought" : "sold"} ${value}`;
}

export function LiveTicker() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [hoodieUsd, setHoodieUsd] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const response = await fetch("/api/activity", { cache: "no-store" })
        .catch(() => null);
      if (!response?.ok || !active) return;
      const payload = await response.json() as {
        events?: ActivityEvent[];
        hoodieUsd?: number | null;
      };
      if (!active) return;
      if (Array.isArray(payload.events)) setEvents(payload.events);
      if (payload.hoodieUsd !== undefined) setHoodieUsd(payload.hoodieUsd);
    };
    const initial = window.setTimeout(load, 0);
    const interval = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);

  if (events.length === 0) return null;
  // Duplicated so the marquee can loop without a visible seam.
  const loop = [...events, ...events];

  return (
    <div className="live-ticker" aria-label="Live HoodiePad activity">
      <span className="live-ticker-label"><i /> HOODIE LIVE</span>
      <div className="live-ticker-viewport">
        <div className="live-ticker-track">
          {loop.map((event, index) => (
            <Link
              className={`live-ticker-item is-${event.kind}`}
              href={`/token/${event.token}`}
              key={`${event.transactionHash}-${event.kind}-${index}`}
            >
              <span
                className="live-ticker-logo"
                aria-hidden="true"
                style={event.imageUrl
                  ? { backgroundImage: `url("${event.imageUrl.replaceAll('"', "%22")}")` }
                  : undefined}
              >
                {event.imageUrl ? "" : event.symbol.slice(0, 2)}
              </span>
              <strong>${event.symbol}</strong>
              <span>{amountLabel(event, hoodieUsd)}</span>
              <code>{shorten(event.actor)}</code>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
