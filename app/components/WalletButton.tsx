"use client";

import { useEffect, useState } from "react";
import { useWallet, WALLETS, type WalletId } from "./WalletProvider";

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function WalletMark({ id }: { id: WalletId }) {
  return (
    <span className={`wallet-mark is-${id}`} aria-hidden="true">
      {id === "metamask" ? "🦊" : "👻"}
    </span>
  );
}

export function WalletPicker({ onClose }: { onClose: () => void }) {
  const { connect, isDetected, status } = useWallet();
  // Extension detection only exists after hydration; render availability
  // labels once mounted so the server and client markup agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card wallet-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Connect a wallet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Connect a wallet</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="wallet-options">
          {WALLETS.map((wallet) => {
            const detected = mounted && isDetected(wallet.id);
            return (
              <button
                key={wallet.id}
                type="button"
                className="wallet-option"
                disabled={status === "connecting"}
                onClick={async () => {
                  await connect(wallet.id);
                  onClose();
                }}
              >
                <WalletMark id={wallet.id} />
                <span className="wallet-option-name">
                  <strong>{wallet.name}</strong>
                  <small>{wallet.hint}</small>
                </span>
                <span className={`wallet-option-state${detected ? " is-detected" : ""}`}>
                  {detected ? "Detected" : "Install ↗"}
                </span>
              </button>
            );
          })}
        </div>
        <p className="modal-note">
          HoodiePad is non-custodial. Your wallet signs every transaction and
          switches to Robinhood Chain automatically.
        </p>
      </div>
    </div>
  );
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, walletId, status, disconnect } = useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <button
        className={`wallet-button${compact ? " wallet-button-compact" : ""}`}
        onClick={() => (address ? disconnect() : setPickerOpen(true))}
        type="button"
        aria-label={address ? `Connected wallet ${address}` : "Connect wallet"}
        title={address ? "Click to disconnect" : undefined}
      >
        <span className={`wallet-dot ${address ? "is-live" : ""}`} />
        {address
          ? shorten(address)
          : status === "connecting"
            ? "Connecting…"
            : "Connect"}
        {address && walletId && <WalletMark id={walletId} />}
      </button>
      {pickerOpen && <WalletPicker onClose={() => setPickerOpen(false)} />}
    </>
  );
}
