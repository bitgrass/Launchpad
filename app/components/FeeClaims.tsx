"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";

type PendingFeeMarket = {
  token: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  poolId: string;
  isCreator: boolean;
  pendingTokenRaw: string;
  pendingToken: string;
  pendingHoodieRaw: string;
  pendingHoodie: string;
};

type FeeClaimTransaction = {
  label: string;
  from: string;
  to: string;
  data: string;
  gasLimit?: string;
  value: string;
};

export function FeeClaims() {
  const { address } = useWallet();
  if (!address) return null;
  // Keyed by address so switching wallets starts from a clean slate without
  // synchronous state resets inside effects.
  return <FeeClaimsInner key={address} address={address} />;
}

function FeeClaimsInner({ address }: { address: string }) {
  const { sendTransaction, waitForTransaction } = useWallet();
  const [markets, setMarkets] = useState<PendingFeeMarket[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyToken, setBusyToken] = useState("");
  const [status, setStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/fees/pending?account=${encodeURIComponent(address)}`,
      { cache: "no-store" },
    ).catch(() => null);
    if (!response?.ok) {
      setLoaded(true);
      return;
    }
    const payload = await response.json() as { markets?: PendingFeeMarket[] };
    setMarkets(Array.isArray(payload.markets) ? payload.markets : []);
    setLoaded(true);
  }, [address]);

  useEffect(() => {
    const initial = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function claim(market: PendingFeeMarket) {
    if (busyToken) return;
    setBusyToken(market.token);
    setErrorMessage("");
    setStatus(`Preparing ${market.symbol} fee collection…`);
    try {
      const response = await fetch("/api/fees/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: market.token, account: address }),
      });
      const payload = await response.json() as {
        transaction?: FeeClaimTransaction;
        error?: string;
      };
      if (!response.ok || !payload.transaction) {
        throw new Error(payload.error ?? "Could not prepare the fee claim");
      }
      setStatus("Confirm the fee collection in your wallet");
      const hash = await sendTransaction(payload.transaction);
      setStatus("Waiting for Robinhood confirmation…");
      await waitForTransaction(hash);
      setStatus(`Fees collected for ${market.symbol}.`);
      await refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Fee claim failed",
      );
      setStatus("");
    } finally {
      setBusyToken("");
    }
  }

  return (
    <section className="market-section section-frame dashboard-market-list">
      <div className="section-heading">
        <div>
          <p className="eyebrow"><span /> Beneficiary earnings</p>
          <h2>Claimable pool fees.</h2>
        </div>
      </div>
      {markets.length > 0 ? (
        <div className="fee-claims-list">
          {markets.map((market) => {
            const nothingPending =
              market.pendingTokenRaw === "0" && market.pendingHoodieRaw === "0";
            return (
              <article className="fee-claim-card" key={market.token}>
                <div className="fee-claim-identity">
                  <span
                    className="token-chip-logo"
                    aria-hidden="true"
                    style={market.imageUrl
                      ? { backgroundImage: `url("${market.imageUrl.replaceAll('"', "%22")}")` }
                      : undefined}
                  >
                    {market.imageUrl ? "" : market.symbol.slice(0, 2)}
                  </span>
                  <div>
                    <strong>${market.symbol}</strong>
                    <small>
                      {market.isCreator ? "Creator · 80% of pool fees" : "Fee beneficiary"}
                    </small>
                  </div>
                </div>
                <div className="fee-claim-amounts">
                  <div>
                    <span>Pending {market.symbol}</span>
                    <strong>{market.pendingToken}</strong>
                  </div>
                  <div>
                    <span>Pending HOODIE</span>
                    <strong>{market.pendingHoodie}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busyToken !== "" || nothingPending}
                  onClick={() => claim(market)}
                >
                  {busyToken === market.token
                    ? "Claiming…"
                    : nothingPending
                      ? "Nothing to claim"
                      : "Claim fees"}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="fee-claim-note">
          {loaded
            ? "No claimable pool fees for this wallet yet. Fees accrue with every canonical-pool trade and can be claimed here at any time."
            : "Reading pending fees from Robinhood Chain…"}
        </p>
      )}
      {status && <p className="swap-progress" role="status">{status}</p>}
      {errorMessage && <p className="swap-error" role="alert">{errorMessage}</p>}
      <p className="fee-claim-note">
        Trading fees accrue inside the locked canonical pool and are not paid
        out automatically. Claiming sends the pool&apos;s
        <code> collectFees </code> transaction; your accrued share (in both the
        token and HOODIE) is released directly to this wallet. The ecosystem
        Safe and the Doppler protocol claim their 15% / 5% the same way from
        their own accounts.
      </p>
    </section>
  );
}
