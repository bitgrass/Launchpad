"use client";

import { useWallet } from "./WalletProvider";

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, status, connect } = useWallet();

  return (
    <button
      className={`wallet-button${compact ? " wallet-button-compact" : ""}`}
      onClick={connect}
      type="button"
      aria-label={address ? `Connected MetaMask wallet ${address}` : "Connect MetaMask wallet"}
    >
      <span className={`wallet-dot ${address ? "is-live" : ""}`} />
      {address
        ? shorten(address)
        : status === "connecting"
          ? "Connecting…"
          : status === "error"
            ? "Install / retry MetaMask"
            : "Connect MetaMask"}
    </button>
  );
}
