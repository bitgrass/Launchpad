"use client";

import { useState } from "react";

export function TokenMetaBar({
  address,
  dexscreenerUrl,
  websiteUrl,
  xUrl,
  telegramUrl,
  holderCount,
  volumeUsd,
  volumeHoodie,
}: {
  address: string;
  dexscreenerUrl?: string;
  websiteUrl?: string;
  xUrl?: string;
  telegramUrl?: string;
  holderCount?: number;
  volumeUsd?: string;
  volumeHoodie?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard unavailable (permissions/insecure context); ignore.
    }
  }

  return (
    <div className="token-meta-bar">
      <button
        type="button"
        className="token-meta-chip"
        onClick={copyAddress}
        aria-label="Copy contract address"
      >
        <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
        {copied ? "Copied" : "Copy CA"}
      </button>
      {dexscreenerUrl && (
        <a
          className="token-meta-chip"
          href={dexscreenerUrl}
          target="_blank"
          rel="noreferrer"
        >
          <span aria-hidden="true">📊</span> Dexscreener ↗
        </a>
      )}
      {websiteUrl && (
        <a className="token-meta-chip" href={websiteUrl} target="_blank" rel="noreferrer">
          <span aria-hidden="true">🌐</span> Website ↗
        </a>
      )}
      {xUrl && (
        <a className="token-meta-chip" href={xUrl} target="_blank" rel="noreferrer">
          <span aria-hidden="true">𝕏</span> Twitter ↗
        </a>
      )}
      {telegramUrl && (
        <a className="token-meta-chip" href={telegramUrl} target="_blank" rel="noreferrer">
          <span aria-hidden="true">✈️</span> Telegram ↗
        </a>
      )}
      {holderCount !== undefined && (
        <span className="token-meta-chip is-stat">
          Holders <strong>{holderCount.toLocaleString("en-US")}</strong>
        </span>
      )}
      {(volumeUsd || volumeHoodie) && (
        <span className="token-meta-chip is-stat">
          Total volume <strong>{volumeUsd ?? volumeHoodie}</strong>
          {volumeUsd && volumeHoodie && <small>{volumeHoodie}</small>}
        </span>
      )}
    </div>
  );
}
