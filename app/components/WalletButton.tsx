"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { useWallet, WALLETS, type WalletId } from "./WalletProvider";

function shorten(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function WalletMark({ id, size = 26 }: { id: WalletId; size?: number }) {
  return (
    <span
      className="wallet-mark"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        backgroundImage: `url("/wallets/${id}.svg")`,
      }}
    />
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
                <WalletMark id={wallet.id} size={30} />
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
  const { address, status, disconnect } = useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  if (!address) {
    return (
      <>
        <button
          className={`wallet-button${compact ? " wallet-button-compact" : ""}`}
          onClick={() => setPickerOpen(true)}
          type="button"
          aria-label="Connect wallet"
        >
          <span className="wallet-dot" />
          {status === "connecting" ? "Connecting…" : "Connect"}
        </button>
        {pickerOpen && <WalletPicker onClose={() => setPickerOpen(false)} />}
      </>
    );
  }

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        type="button"
        className="profile-trigger"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Profile ${address}`}
      >
        <Avatar address={address} size={26} />
        <code>{shorten(address)}</code>
        <span className="profile-caret" aria-hidden="true">▾</span>
      </button>
      {menuOpen && (
        <div className="profile-dropdown" role="menu">
          <div className="profile-identity">
            <Avatar address={address} size={42} />
            <div>
              <strong>My hood</strong>
              <code>{shorten(address)}</code>
            </div>
          </div>
          <Link href="/dashboard" role="menuitem" onClick={() => setMenuOpen(false)}>
            <span aria-hidden="true">📊</span> Dashboard &amp; fees
          </Link>
          <Link href="/leaderboard" role="menuitem" onClick={() => setMenuOpen(false)}>
            <span aria-hidden="true">🏆</span> Leaderboard rank
          </Link>
          <Link href="/about" role="menuitem" onClick={() => setMenuOpen(false)}>
            <span aria-hidden="true">📖</span> How it works
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1_500);
              } catch {
                // Clipboard unavailable; leave the label unchanged.
              }
            }}
          >
            <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
            {copied ? "Copied" : "Copy address"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              disconnect();
              setMenuOpen(false);
            }}
          >
            <span aria-hidden="true">⏻</span> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
