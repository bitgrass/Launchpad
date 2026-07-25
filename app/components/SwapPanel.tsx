"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";

type WalletTransaction = {
  kind: "token-approval" | "swap";
  label: string;
  from: string;
  to: string;
  data: string;
  gasLimit?: string;
  value: string;
};

type PreparedSwap = {
  inputSymbol: string;
  outputSymbol: string;
  amountOutFormatted: string;
  minimumOutFormatted: string;
  inputBalanceFormatted: string;
  priceImpactTicks: number;
  priceImpactPercent: number | null;
  approvalTransactions: WalletTransaction[];
  swapTransaction: WalletTransaction | null;
  simulationPassed: boolean;
};

type SwapErrorPayload = {
  error?: string;
  code?: "MAX_WALLET" | "TRADE_SIZE" | "QUOTE_UNAVAILABLE";
  maximumAmount?: string;
  inputSymbol?: string;
};

function displayAmount(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  if (numeric === 0) return "0";
  if (numeric < 0.000001) return numeric.toExponential(4);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(numeric);
}

export function SwapPanel({
  token,
  symbol,
  poolUrl,
  marketVersion = "doppler-lockable-v3-v1",
}: {
  token: string;
  symbol: string;
  poolUrl: string;
  marketVersion?: "doppler-lockable-v3-v1" | "doppler-multicurve-v4-v2";
}) {
  const { address, connect, sendTransaction, waitForTransaction } = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [prepared, setPrepared] = useState<PreparedSwap | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [suggestedMaximum, setSuggestedMaximum] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [transactionHash, setTransactionHash] = useState("");

  const prepare = useCallback(async (): Promise<PreparedSwap> => {
    const response = await fetch("/api/swap/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, account: address, side, amount, slippageBps }),
    });
    const payload = await response.json() as PreparedSwap & SwapErrorPayload;
    if (!response.ok) {
      const quoteFailure = new Error(
        payload.error ?? "Could not prepare this swap",
      ) as Error & SwapErrorPayload;
      quoteFailure.code = payload.code;
      quoteFailure.maximumAmount = payload.maximumAmount;
      quoteFailure.inputSymbol = payload.inputSymbol;
      throw quoteFailure;
    }
    return payload;
  }, [address, amount, side, slippageBps, token]);

  useEffect(() => {
    if (!address || !amount || Number(amount) <= 0) return;
    let active = true;
    const timeout = window.setTimeout(async () => {
      try {
        const next = await prepare();
        if (active) {
          setPrepared(next);
          setQuoteError("");
          setSuggestedMaximum("");
        }
      } catch (error) {
        if (active) {
          setPrepared(null);
          setQuoteError(error instanceof Error ? error.message : "Quote unavailable");
          setSuggestedMaximum(
            error instanceof Error && "maximumAmount" in error
              ? String((error as Error & SwapErrorPayload).maximumAmount ?? "")
              : "",
          );
        }
      }
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [address, amount, prepare]);

  async function executeSwap() {
    if (!address) {
      await connect();
      return;
    }
    if (!amount || Number(amount) <= 0) return;
    setBusy(true);
    setQuoteError("");
    setSuggestedMaximum("");
    setTransactionHash("");
    try {
      let current = await prepare();
      const approvals = current.approvalTransactions;
      for (let index = 0; index < approvals.length; index += 1) {
        const transaction = approvals[index];
        setProgress(`${transaction.label} (${index + 1}/${approvals.length})`);
        const hash = await sendTransaction(transaction);
        await waitForTransaction(hash);
      }
      if (approvals.length > 0) {
        setProgress("Re-simulating the exact swap…");
        current = await prepare();
      }
      if (!current.simulationPassed || !current.swapTransaction) {
        throw new Error("The swap could not be simulated after approval");
      }
      setPrepared(current);
      setProgress("Confirm the simulated swap in MetaMask");
      const hash = await sendTransaction(current.swapTransaction);
      setTransactionHash(hash);
      setProgress("Waiting for Robinhood confirmation…");
      await waitForTransaction(hash);
      setProgress("Swap confirmed");
      setAmount("");
      window.setTimeout(() => window.location.reload(), 1_500);
    } catch (error) {
      setQuoteError(error instanceof Error ? error.message : "Swap failed");
      setSuggestedMaximum(
        error instanceof Error && "maximumAmount" in error
          ? String((error as Error & SwapErrorPayload).maximumAmount ?? "")
          : "",
      );
      setProgress("");
    } finally {
      setBusy(false);
    }
  }

  const inputSymbol = side === "buy" ? "HOODIE" : symbol;
  const outputSymbol = side === "buy" ? symbol : "HOODIE";

  if (marketVersion === "doppler-multicurve-v4-v2") {
    return (
      <aside className="trade-panel">
        <span className="preview-label">TRADE CANONICAL V4 POOL</span>
        <h2>V4 market detected.</h2>
        <p className="trade-warning">
          HoodiePad has verified this V4 market. Deterministic in-app V4 routing
          remains disabled until the Robinhood V4 quote, Permit2, native ETH,
          and fee-claim fork gates all pass.
        </p>
        <a
          className="button button-primary full-width"
          href={poolUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open canonical V4 pool on Uniswap ↗
        </a>
      </aside>
    );
  }

  return (
    <aside className="trade-panel">
      <span className="preview-label">TRADE CANONICAL POOL</span>
      <div className="trade-tabs">
        <button
          type="button"
          className={side === "buy" ? "is-active" : ""}
          onClick={() => {
            setSide("buy");
            setAmount("");
            setPrepared(null);
            setQuoteError("");
            setSuggestedMaximum("");
          }}
        >
          Buy
        </button>
        <button
          type="button"
          className={side === "sell" ? "is-active" : ""}
          onClick={() => {
            setSide("sell");
            setAmount("");
            setPrepared(null);
            setQuoteError("");
            setSuggestedMaximum("");
          }}
        >
          Sell
        </button>
      </div>
      <label>
        <span>You pay</span>
        <div>
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            disabled={busy}
            onChange={(event) => {
              setAmount(event.target.value.replace(/[^0-9.]/g, ""));
              setPrepared(null);
              setQuoteError("");
              setSuggestedMaximum("");
            }}
          />
          <strong>{inputSymbol}</strong>
        </div>
      </label>
      <div className="swap-arrow" aria-hidden="true">↓</div>
      <label>
        <span>You receive, estimated</span>
        <div>
          <input
            readOnly
            value={prepared ? displayAmount(prepared.amountOutFormatted) : ""}
            placeholder="0.0"
          />
          <strong>{outputSymbol}</strong>
        </div>
      </label>
      <div className="trade-details">
        <span>Minimum received</span>
        <strong>
          {prepared ? `${displayAmount(prepared.minimumOutFormatted)} ${outputSymbol}` : "—"}
        </strong>
        <span>Input balance</span>
        <strong>
          {prepared ? `${displayAmount(prepared.inputBalanceFormatted)} ${inputSymbol}` : "—"}
        </strong>
        <span>Estimated execution impact</span>
        <strong>
          {prepared?.priceImpactPercent === null || prepared?.priceImpactPercent === undefined
            ? "—"
            : `${prepared.priceImpactPercent.toFixed(2)}%`}
        </strong>
        <label className="slippage-control">
          <span>Max slippage</span>
          <select
            value={slippageBps}
            disabled={busy}
            onChange={(event) => {
              setSlippageBps(Number(event.target.value));
              setPrepared(null);
              setQuoteError("");
              setSuggestedMaximum("");
            }}
          >
            <option value={50}>0.5%</option>
            <option value={100}>1.0%</option>
            <option value={200}>2.0%</option>
            <option value={500}>5.0%</option>
          </select>
        </label>
      </div>
      {quoteError && <p className="swap-error" role="alert">{quoteError}</p>}
      {suggestedMaximum && (
        <button
          type="button"
          className="swap-use-maximum"
          disabled={busy}
          onClick={() => {
            setAmount(suggestedMaximum);
            setPrepared(null);
            setQuoteError("");
            setSuggestedMaximum("");
          }}
        >
          Use suggested maximum: {displayAmount(suggestedMaximum)} {inputSymbol}
        </button>
      )}
      {progress && <p className="swap-progress" role="status">{progress}</p>}
      {transactionHash && (
        <a
          className="swap-transaction-link"
          href={`https://robinhoodchain.blockscout.com/tx/${transactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View submitted swap ↗
        </a>
      )}
      <button
        type="button"
        className="button button-primary full-width"
        disabled={busy || (!!address && (!prepared || !amount))}
        onClick={executeSwap}
      >
        {!address
          ? "Connect MetaMask"
          : busy
            ? "Working…"
            : prepared?.approvalTransactions.length
              ? `Approve & swap ${inputSymbol}`
              : `Swap ${inputSymbol} for ${outputSymbol}`}
      </button>
      <p className="trade-warning">
        Quotes come from the canonical Uniswap V3 Quoter. The exact-amount approval and direct
        SwapRouter02 transaction are always confirmed in MetaMask.
      </p>
      <a className="external-trade-link" href={poolUrl} target="_blank" rel="noreferrer">
        Open the same pool on Uniswap ↗
      </a>
    </aside>
  );
}
