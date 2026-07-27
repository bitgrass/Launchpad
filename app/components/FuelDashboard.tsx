"use client";

import { useEffect, useState } from "react";
import type { FuelSnapshot } from "../lib/fuel";

function shorten(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function hoodie(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value)} HOODIE`;
}

function dual(value: number, hoodieUsd: number | null) {
  if (hoodieUsd === null) return { main: hoodie(value), sub: undefined };
  const dollars = value * hoodieUsd;
  const main = dollars === 0
    ? "$0"
    : dollars < 0.01
      ? "<$0.01"
      : `$${new Intl.NumberFormat("en-US", {
          notation: dollars >= 10_000 ? "compact" : "standard",
          maximumFractionDigits: 2,
        }).format(dollars)}`;
  return { main, sub: hoodie(value) };
}

export function FuelDashboard({ initial }: { initial: FuelSnapshot }) {
  const [data, setData] = useState(initial);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const response = await fetch("/api/fuel", { cache: "no-store" })
        .catch(() => null);
      if (!response?.ok || !active) return;
      const payload = await response.json() as FuelSnapshot & { error?: string };
      if (active && payload.fees) setData(payload);
    };
    const initialLoad = window.setTimeout(load, 0);
    const interval = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, []);

  const usd = data.hoodieUsd;
  const volume = dual(data.volume.allTimeHoodie, usd);
  const volume24h = dual(data.volume.last24hHoodie, usd);
  const creator = dual(data.fees.creatorHoodie, usd);
  const ecosystem = dual(data.fees.ecosystemHoodie, usd);
  const protocolFees = dual(data.fees.protocolHoodie, usd);
  const safeHoodie = dual(data.ecosystemSafe.hoodieBalance, usd);
  const claimable = dual(data.ecosystemSafe.claimableHoodie, usd);

  return (
    <>
      <section className="section-frame fuel-headline">
        <article>
          <span>HOODIE routed through HoodiePad pools</span>
          <strong>{volume.main}</strong>
          {volume.sub && <small>{volume.sub}</small>}
          <p>
            Every HoodiePad token trades against HOODIE, so this is not a
            buyback promise — it is the product. {data.markets} markets,
            {" "}{data.trades} confirmed swaps.
          </p>
        </article>
        <article>
          <span>Last 24 hours</span>
          <strong>{volume24h.main}</strong>
          {volume24h.sub && <small>{volume24h.sub}</small>}
          <p>Canonical-pool volume measured from confirmed Swap events.</p>
        </article>
      </section>

      <section className="section-frame">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span /> Where every fee goes</p>
            <h2>1% of every trade, split three ways.</h2>
          </div>
        </div>
        <div className="fuel-split">
          <article>
            <span className="fuel-share">80%</span>
            <strong>Creators</strong>
            <p className="fuel-amount">{creator.main}</p>
            {creator.sub && <small>{creator.sub}</small>}
            <p>Paid to the launch wallet of each market. Claimed from the dashboard.</p>
          </article>
          <article className="is-highlight">
            <span className="fuel-share">15%</span>
            <strong>HOODIE ecosystem</strong>
            <p className="fuel-amount">{ecosystem.main}</p>
            {ecosystem.sub && <small>{ecosystem.sub}</small>}
            <p>Accrues to the ecosystem Safe for HOODIE growth and operations.</p>
          </article>
          <article>
            <span className="fuel-share">5%</span>
            <strong>Doppler protocol</strong>
            <p className="fuel-amount">{protocolFees.main}</p>
            {protocolFees.sub && <small>{protocolFees.sub}</small>}
            <p>The protocol beneficiary set by the live Airlock owner.</p>
          </article>
        </div>
        <p className="analytics-disclosure">
          Fee figures are estimates derived from HOODIE paid into buy-side
          swaps at the immutable share weights. Token-side fees accrue
          separately and are not converted or combined here.
        </p>
      </section>

      <section className="section-frame">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span /> Independently verifiable</p>
            <h2>Ecosystem Safe.</h2>
          </div>
          <a
            className="token-meta-chip"
            href={`https://robinhoodchain.blockscout.com/address/${data.ecosystemSafe.address}`}
            target="_blank"
            rel="noreferrer"
          >
            {shorten(data.ecosystemSafe.address)} ↗
          </a>
        </div>
        <div className="fuel-safe-grid">
          <article>
            <span>HOODIE held</span>
            <strong>{safeHoodie.main}</strong>
            {safeHoodie.sub && <small>{safeHoodie.sub}</small>}
            <p>Live on-chain balance, not an estimate.</p>
          </article>
          <article>
            <span>Claimable now</span>
            <strong>{claimable.main}</strong>
            {claimable.sub && <small>{claimable.sub}</small>}
            <p>
              Accrued in the pools and not yet collected
              {data.ecosystemSafe.claimableTokens.length > 0 && (
                <> · plus {data.ecosystemSafe.claimableTokens
                  .map((entry) => `${entry.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${entry.symbol}`)
                  .join(", ")}</>
              )}
              .
            </p>
          </article>
          <article>
            <span>Token positions</span>
            <strong>{data.ecosystemSafe.tokenPositions.length}</strong>
            <p>
              {data.ecosystemSafe.tokenPositions.length > 0
                ? data.ecosystemSafe.tokenPositions
                    .map((entry) => `${entry.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${entry.symbol}`)
                    .join(" · ")
                : "No launched-token balances held yet."}
            </p>
          </article>
        </div>
      </section>

      <section className="section-frame">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span /> Executed distributions</p>
            <h2>What the Safe has spent.</h2>
          </div>
        </div>
        {data.distributions.length > 0 ? (
          <div className="market-table-wrap">
            <table className="market-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th className="is-number">Amount</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {data.distributions.map((entry) => (
                  <tr key={entry.transactionHash}>
                    <td>{entry.date}</td>
                    <td><strong>{entry.kind}</strong>{entry.note && <small>{entry.note}</small>}</td>
                    <td className="is-number">{entry.amount} {entry.asset}</td>
                    <td>
                      <a
                        href={`https://robinhoodchain.blockscout.com/tx/${entry.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shorten(entry.transactionHash)} ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="live-empty-state">
            <strong>No distributions executed yet.</strong>
            <p>
              Every distribution from the ecosystem Safe is listed here with its
              transaction hash once it happens. HoodiePad contracts do not
              perform automatic buybacks or burns.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
