"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { WalletButton } from "../components/WalletButton";
import { useWallet } from "../components/WalletProvider";

type Draft = {
  name: string;
  symbol: string;
  description: string;
  website: string;
  xUrl: string;
};

type PreparedLaunch = {
  checksum: string;
  preparedAt: string;
  productionReady: boolean;
  blockers: string[];
  calibration: {
    status: "pending" | "passed" | "failed";
    forkBlock: string | null;
    approved: boolean;
  };
  chainStatus: {
    available: boolean;
    blockNumber?: string;
    airlockOwner?: string;
    referencePool?: {
      tick: number;
      liquidity: string;
      hoodiePerWeth: string;
    };
  };
  simulation: {
    status: "simulated" | "unavailable";
    asset?: string;
    pool?: string;
    gasEstimate?: string;
    error?: string;
    curve?: {
      startTick: number;
      endTick: number;
      referenceTick: number;
    };
  };
  deployment: {
    chainId: number;
    from: string;
    to: string;
    data: string;
    gasLimit: string;
    predictedToken: string;
    predictedPool: string;
    validUntil: string;
  } | null;
};

type UploadedArtwork = {
  key: string;
  url: string;
  sha256: string;
};

type ConfirmedDeployment = {
  status: "confirmed";
  marketVersion: "doppler-multicurve-v4-v2";
  transactionHash: string;
  blockNumber: string;
  creator: string;
  token: string;
  pool: string;
};

const initialDraft: Draft = {
  name: "",
  symbol: "",
  description: "",
  website: "",
  xUrl: "",
};

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const supportedArtworkTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxArtworkBytes = 750 * 1024;
const ecosystemSafe = "0xAB10Efe787DB2ef3700b94578aeC68b98e0446A7";
const launchSteps = [
  [1, "Token details", "Name the thing"],
  [2, "Connected wallet", "Route the 80%"],
  [3, "Review launch", "Know what you sign"],
] as const;

function shorten(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function confirmDeployment(
  transactionHash: string,
  predictedToken: string,
  predictedPool: string,
) {
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const response = await fetch("/api/launch/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionHash, predictedToken, predictedPool }),
    });
    if (response.status === 202) {
      await wait(2_000);
      continue;
    }
    const payload = await response.json().catch(() => null) as
      | ConfirmedDeployment
      | { error?: string }
      | null;
    if (!response.ok) {
      throw new Error(payload && "error" in payload && payload.error
        ? payload.error
        : "Robinhood confirmation failed.");
    }
    return payload as ConfirmedDeployment;
  }
  throw new Error("Robinhood confirmation is taking longer than expected.");
}

export function LaunchWizard() {
  const { address, sendTransaction } = useWallet();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(initialDraft);
  const [artwork, setArtwork] = useState<File | null>(null);
  const [artworkError, setArtworkError] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "preparing" | "deploying" | "confirming" | "deployed" | "error"
  >("idle");
  const [prepared, setPrepared] = useState<PreparedLaunch | null>(null);
  const [preparedWallet, setPreparedWallet] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [confirmedDeployment, setConfirmedDeployment] = useState<ConfirmedDeployment | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const artworkPreview = useMemo(() => (artwork ? URL.createObjectURL(artwork) : ""), [artwork]);
  useEffect(() => () => {
    if (artworkPreview) URL.revokeObjectURL(artworkPreview);
  }, [artworkPreview]);

  const validMetadata = useMemo(
    () =>
      draft.name.trim().length >= 2 &&
      /^[A-Za-z0-9]{2,10}$/.test(draft.symbol) &&
      artwork !== null,
    [artwork, draft],
  );
  const validWallet = addressPattern.test(address);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setPrepared(null);
    setPreparedWallet("");
    setTransactionHash("");
    setConfirmedDeployment(null);
    setErrorMessage("");
    setDraft((current) => ({
      ...current,
      [key]: key === "symbol" ? String(value).toUpperCase() : value,
    }));
  }

  function chooseArtwork(file: File | undefined) {
    setPrepared(null);
    setPreparedWallet("");
    setTransactionHash("");
    setConfirmedDeployment(null);
    setErrorMessage("");
    setArtworkError("");
    if (!file) {
      setArtwork(null);
      return;
    }
    if (!supportedArtworkTypes.has(file.type) || file.size > maxArtworkBytes || file.size === 0) {
      setArtwork(null);
      setArtworkError("Choose a JPG, PNG, or WebP image no larger than 750 KB for Railway.");
      return;
    }
    setArtwork(file);
  }

  async function uploadArtwork() {
    if (!artwork) throw new Error("Artwork is required");
    const response = await fetch("/api/artwork", {
      method: "POST",
      headers: {
        "content-type": artwork.type,
        "x-hoodiepad-artwork-name": encodeURIComponent(artwork.name),
      },
      body: artwork,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? "Artwork upload failed.");
    }
    return (await response.json()) as UploadedArtwork;
  }

  async function prepareLaunch(event: FormEvent) {
    event.preventDefault();
    if (!validMetadata || !validWallet || !agreed) return;
    setPrepared(null);
    setPreparedWallet("");
    setTransactionHash("");
    setConfirmedDeployment(null);
    setErrorMessage("");
    setStatus("uploading");
    try {
      const uploaded = await uploadArtwork();
      setStatus("preparing");
      const response = await fetch("/api/launch/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          artworkKey: uploaded.key,
          artworkUrl: uploaded.url,
          artworkSha256: uploaded.sha256,
          payoutWallet: address,
        }),
      });
      if (!response.ok) throw new Error("Preparation failed");
      setPrepared((await response.json()) as PreparedLaunch);
      setPreparedWallet(address);
      setStatus("idle");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not upload the artwork or prepare this launch. Try again.",
      );
      setStatus("error");
    }
  }

  async function deployLaunch() {
    if (!prepared?.productionReady || !prepared.deployment || preparedWallet !== address) return;
    if (Date.now() >= new Date(prepared.deployment.validUntil).getTime()) {
      setErrorMessage("This deployment preview expired. Prepare a fresh simulation before signing.");
      setPrepared(null);
      setPreparedWallet("");
      setStatus("error");
      return;
    }
    setErrorMessage("");
    setStatus("deploying");
    let submittedHash = "";
    try {
      const hash = await sendTransaction(prepared.deployment);
      submittedHash = hash;
      setTransactionHash(hash);
      setStatus("confirming");
      const confirmed = await confirmDeployment(
        hash,
        prepared.deployment.predictedToken,
        prepared.deployment.predictedPool,
      );
      setConfirmedDeployment(confirmed);
      setStatus("deployed");
      window.location.assign(
        `/token/${confirmed.token}?tx=${encodeURIComponent(confirmed.transactionHash)}`,
      );
    } catch (error) {
      if (submittedHash) {
        setErrorMessage(
          error instanceof Error
            ? `The transaction was submitted, but HoodiePad could not confirm its token details yet: ${error.message}`
            : "The transaction was submitted, but token confirmation is still pending.",
        );
        setStatus("deployed");
      } else {
        setErrorMessage("MetaMask did not submit the deployment. Review the transaction and try again.");
        setStatus("error");
      }
    }
  }

  return (
    <div className="launch-studio">
      <aside className="launch-steps" aria-label="Launch progress">
        {launchSteps.map(([number, label, hint]) => (
          <button
            className={step === number ? "is-active" : step > number ? "is-done" : ""}
            key={number}
            onClick={() => {
              const next = Number(number);
              if (next === 1 || (next === 2 && validMetadata) || (next === 3 && validMetadata && validWallet)) setStep(next);
            }}
            type="button"
          >
            <span>{step > number ? "✓" : number}</span>
            <div><strong>{label}</strong><small>{hint}</small></div>
          </button>
        ))}
        <div className="fixed-rule-mini">
          <span>Fixed by HoodiePad</span>
          <p>1B supply · 1% fee · HOODIE pair · no migration</p>
        </div>
      </aside>

      <form className="launch-form" onSubmit={prepareLaunch}>
        {step === 1 && (
          <div className="form-step">
            <p className="step-kicker">Step 1 of 3</p>
            <h2>Give the hood a name.</h2>
            <p className="form-intro">Choose the token image directly from your device. HoodiePad uploads it for you.</p>
            <div className="field-grid two-columns">
              <label>
                <span>Token name</span>
                <input value={draft.name} onChange={(e) => update("name", e.target.value)} maxLength={40} placeholder="Hoodie Hug" />
              </label>
              <label>
                <span>Ticker</span>
                <div className="ticker-input"><i>$</i><input value={draft.symbol} onChange={(e) => update("symbol", e.target.value.replace(/[^A-Za-z0-9]/g, ""))} maxLength={10} placeholder="HUG" /></div>
              </label>
            </div>
            <label>
              <span>Description <small>Optional · {draft.description.length}/280</small></span>
              <textarea value={draft.description} onChange={(e) => update("description", e.target.value)} maxLength={280} placeholder="Optional: tell the hood what this token is about. Links belong in the fields below." />
            </label>
            <label className={`artwork-picker${artwork ? " has-file" : ""}`}>
              <span>Token artwork <em>JPG, PNG or WebP · max 750 KB on Railway</em></span>
              <input
                className="artwork-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => chooseArtwork(event.target.files?.[0])}
              />
              <span className="artwork-dropzone">
                {artworkPreview ? <Image src={artworkPreview} alt="Selected token artwork preview" width={56} height={56} unoptimized /> : <i>+</i>}
                <strong>{artwork ? artwork.name : "Choose token image"}</strong>
                <small>{artwork ? `${(artwork.size / 1024).toFixed(0)} KB · click to replace` : "Select a file from your device"}</small>
              </span>
            </label>
            {artworkError && <p className="form-error">{artworkError}</p>}
            <div className="field-grid two-columns">
              <label><span>Website <em>Optional</em></span><input value={draft.website} onChange={(e) => update("website", e.target.value)} inputMode="url" placeholder="https://" /></label>
              <label><span>X / Twitter <em>Optional</em></span><input value={draft.xUrl} onChange={(e) => update("xUrl", e.target.value)} inputMode="url" placeholder="https://x.com/" /></label>
            </div>
            <div className="form-actions">
              <span>{validMetadata ? "Looking sharp." : "Name, ticker, and artwork required."}</span>
              <button className="button button-primary" type="button" disabled={!validMetadata} onClick={() => setStep(2)}>Continue <span>→</span></button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="form-step">
            <p className="step-kicker">Step 2 of 3</p>
            <h2>Your wallet gets the 80%.</h2>
            <p className="form-intro">The connected MetaMask account automatically becomes the immutable creator fee recipient. It cannot be replaced with a different address in this launch.</p>
            {validWallet ? (
              <div className="creator-wallet-card">
                <span className="wallet-fox" aria-hidden="true">M</span>
                <div><small>Connected MetaMask · creator fee recipient</small><code>{address}</code></div>
                <strong>80%</strong>
              </div>
            ) : (
              <div className="wallet-connect-panel">
                <strong>Connect MetaMask to continue</strong>
                <p>HoodiePad will switch MetaMask to Robinhood Chain and use that account as the creator beneficiary.</p>
                <WalletButton compact />
              </div>
            )}
            <div className={`address-check ${validWallet ? "valid" : ""}`}>
              <span>{validWallet ? "✓" : "!"}</span>
              <div><strong>{validWallet ? "Creator recipient locked to connected wallet" : "MetaMask connection required"}</strong><p>This account receives 80% of canonical pool fees in both assets.</p></div>
            </div>
            <div className="split-preview compact">
              <div><span>Connected creator wallet</span><strong>80%</strong></div>
              <div><span>HOODIE ecosystem Safe</span><strong>15%</strong></div>
              <div><span>Doppler</span><strong>5%</strong></div>
            </div>
            <div className="safe-address"><span>Ecosystem Safe</span><code>{ecosystemSafe}</code></div>
            <div className="form-actions">
              <button className="back-button" type="button" onClick={() => setStep(1)}>← Back</button>
              <button className="button button-primary" type="button" disabled={!validWallet} onClick={() => setStep(3)}>Review launch <span>→</span></button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="form-step review-step">
            <p className="step-kicker">Step 3 of 3</p>
            <h2>Review before MetaMask asks.</h2>
            <div className="review-token">
              <div className="review-avatar" style={artworkPreview ? { backgroundImage: `url(${artworkPreview})` } : undefined}>{artworkPreview ? "" : draft.symbol.slice(0, 2)}</div>
              <div><strong>{draft.name}</strong><span>${draft.symbol} · 1,000,000,000 supply</span></div>
              <button type="button" onClick={() => setStep(1)}>Edit</button>
            </div>
            <div className="review-rules">
              <div><span>Network</span><strong>Robinhood Chain</strong></div>
              <div><span>Market</span><strong>Multicurve V4</strong></div>
              <div><span>Canonical pair</span><strong>${draft.symbol} / HOODIE</strong></div>
              <div><span>Target opening FDV</span><strong>$30,000</strong></div>
              <div><span>Creator recipient</span><strong>{shorten(address)}</strong></div>
              <div><span>Ecosystem Safe</span><strong>{shorten(ecosystemSafe)}</strong></div>
              <div><span>Trading fee</span><strong>1.00%</strong></div>
              <div><span>Creator share</span><strong>80%</strong></div>
              <div><span>Market allocation</span><strong>100%</strong></div>
              <div><span>Max wallet</span><strong>2% for 24h</strong></div>
              <div><span>Migration</span><strong>None</strong></div>
            </div>
            <label className="confirm-check">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I understand the token, pool, fee beneficiaries, and metadata are irreversible after launch.</span>
            </label>
            <div className={`simulation-notice${prepared?.productionReady ? " is-ready" : ""}`}>
              <span>{prepared?.productionReady ? "DEPLOYMENT READY" : "RELEASE GATE"}</span>
              <p>
                {prepared?.productionReady
                  ? "The fork calibration, dependency snapshot, and live simulation passed. MetaMask will show the final mainnet transaction before anything is submitted."
                  : "HoodiePad V2 is V4-only. Mainnet deployment appears only after the exact SDK, runtime, PoolKey, fork, and review gates pass."}
              </p>
            </div>
            {prepared && preparedWallet === address && (
              <div className={`prepared-card${prepared.productionReady ? " is-ready" : ""}`} role="status">
                <div>
                  <span>{prepared.simulation.status === "simulated" ? "✓" : "i"}</span>
                  <strong>
                    {prepared.productionReady
                      ? "Exact deployment transaction is ready"
                      : prepared.simulation.status === "simulated"
                      ? "Live Robinhood simulation completed"
                      : "Draft prepared; live simulation unavailable"}
                  </strong>
                </div>
                <code>{prepared.checksum}</code>
                {prepared.chainStatus.available && (
                  <dl className="prepared-facts">
                    <div><dt>Block</dt><dd>{prepared.chainStatus.blockNumber}</dd></div>
                    <div><dt>Market version</dt><dd>Multicurve V4</dd></div>
                    <div><dt>Predicted token</dt><dd>{prepared.simulation.asset ? shorten(prepared.simulation.asset) : "—"}</dd></div>
                    <div><dt>Predicted PoolId</dt><dd>{prepared.simulation.pool ? shorten(prepared.simulation.pool) : "—"}</dd></div>
                    <div><dt>Gas estimate</dt><dd>{prepared.simulation.gasEstimate ?? "—"}</dd></div>
                    <div><dt>Fork calibration</dt><dd>{prepared.calibration.approved ? `Block ${prepared.calibration.forkBlock}` : prepared.calibration.status}</dd></div>
                  </dl>
                )}
                <ul>{prepared.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
              </div>
            )}
            {transactionHash && prepared?.deployment && (
              <div className="deployment-success" role="status">
                <strong>
                  {confirmedDeployment
                    ? "Deployment confirmed on Robinhood Chain."
                    : status === "confirming"
                      ? "Deployment submitted. Waiting for Robinhood confirmation…"
                      : "Deployment submitted to Robinhood Chain."}
                </strong>
                <a
                  href={`https://robinhoodchain.blockscout.com/tx/${transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction
                </a>
                <a
                  href={`/token/${confirmedDeployment?.token ?? prepared.deployment.predictedToken}?tx=${encodeURIComponent(transactionHash)}`}
                >
                  Open {confirmedDeployment ? "confirmed" : "predicted"} token page
                </a>
                {confirmedDeployment && <span>V4 PoolId {shorten(confirmedDeployment.pool)}</span>}
              </div>
            )}
            {status === "error" && <p className="form-error">{errorMessage}</p>}
            <div className="form-actions">
              <button className="back-button" type="button" onClick={() => setStep(2)}>← Back</button>
              {prepared?.productionReady && prepared.deployment ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={status === "deploying" || status === "confirming" || status === "deployed"}
                  onClick={deployLaunch}
                >
                  {status === "deploying"
                    ? "Confirm in MetaMask"
                    : status === "confirming"
                      ? "Confirming on Robinhood"
                    : status === "deployed"
                      ? confirmedDeployment ? "Deployment confirmed" : "Deployment submitted"
                      : "Deploy with MetaMask"} <span>↗</span>
                </button>
              ) : (
                <button className="button button-primary" type="submit" disabled={!agreed || !validWallet || status === "uploading" || status === "preparing"}>
                {status === "uploading" ? "Uploading artwork…" : status === "preparing" ? "Simulating on Robinhood…" : "Prepare simulation"} <span>↗</span>
                </button>
              )}
            </div>
          </div>
        )}
      </form>

      <aside className="launch-preview">
        <span className="preview-label">LIVE PREVIEW</span>
        <div className="preview-art" style={artworkPreview ? { backgroundImage: `url(${artworkPreview})` } : undefined}>
          {!artworkPreview && <Image className="preview-placeholder-logo" src="/hoodie-logo.jpg" alt="" width={260} height={260} unoptimized />}
        </div>
        <h3>{draft.name || "Your token"}</h3>
        <p className="preview-symbol">${draft.symbol || "TICKER"} / HOODIE</p>
        <p>{draft.description || "Your token story will appear here for the hood to inspect."}</p>
        <div className="preview-badges"><span>1B fixed</span><span>80% creator</span><span>No migration</span></div>
      </aside>
    </div>
  );
}
