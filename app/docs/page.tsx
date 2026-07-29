import Link from "next/link";
import crown from "../../config/hoodie-crown.json";
import curve from "../../config/hoodie-v4-curve-v1.json";
import product from "../../config/hoodiepad-v2.json";
import { AppShell } from "../components/AppShell";
import { TRADER_SCORE_WEIGHTS } from "../lib/leaderboard";

export const metadata = {
  title: "HoodiePad docs — how the protocol works",
  description:
    "How HoodiePad launches, prices, and pays out canonical CHILD/HOODIE markets on Robinhood Chain.",
};

const SECTIONS = [
  { id: "overview", label: "Overview", group: "Protocol" },
  { id: "launches", label: "How launches work", group: "Protocol" },
  { id: "fixed-rules", label: "Fixed rules", group: "Protocol" },
  { id: "pricing", label: "Trading and pricing", group: "Protocol" },
  { id: "fees", label: "Fees and claims", group: "Protocol" },
  { id: "leaderboards", label: "Leaderboards and the crown", group: "Protocol" },
  { id: "validation", label: "Discovery and validation", group: "Protocol" },
  { id: "network", label: "Network and contracts", group: "Integration" },
  { id: "reading", label: "Reading market state", group: "Integration" },
  { id: "indexing", label: "Indexing events", group: "Integration" },
  { id: "api", label: "Public API", group: "Integration" },
  { id: "risk", label: "Risk disclosures", group: "Reference" },
  { id: "faq", label: "FAQ", group: "Reference" },
];

const CONTRACTS: Array<[string, string]> = [
  ["HOODIE (numeraire)", product.contracts.hoodie],
  ["Ecosystem Safe", product.contracts.hoodieEcosystemSafe],
  ["WETH", product.contracts.weth],
  ["Doppler Airlock", product.contracts.airlock],
  ["DopplerHookInitializer (pool hook)", product.contracts.dopplerHookInitializer],
  ["RehypeDopplerHookInitializer", product.contracts.rehypeDopplerHookInitializer],
  ["DopplerERC20V1 factory", product.contracts.dopplerERC20V1Factory],
  ["NoOp governance factory", product.contracts.noOpGovernanceFactory],
  ["NoOp migrator", product.contracts.noOpMigrator],
  ["Uniswap V4 PoolManager", product.contracts.uniswapV4PoolManager],
  ["Uniswap V4 StateView", product.contracts.uniswapV4StateView],
  ["Uniswap V4 Quoter", product.contracts.uniswapV4Quoter],
  ["Universal Router (2.1.1 build)", product.contracts.uniswapUniversalRouter],
  ["Permit2", product.contracts.permit2],
];

const ENDPOINTS: Array<[string, string]> = [
  ["GET /api/markets", "Every validated market with price, FDV, volume, txns and holders."],
  ["GET /api/markets/{address}/chart", "Swap points, holders and USD values for one market."],
  ["GET /api/analytics", "Protocol totals, all-time and rolling 24h."],
  ["GET /api/leaderboard", "Trader and creator rankings with the score weights."],
  ["GET /api/king", "Current crown holder, contenders and reign history."],
  ["GET /api/fuel", "Fee accrual by beneficiary and live ecosystem Safe balances."],
  ["GET /api/activity", "Recent launches and trades for the live ticker."],
  ["GET /api/swap/context?token=&account=", "Display prices and wallet balances."],
  ["POST /api/swap/prepare", "Simulated swap calldata for a wallet to sign."],
  ["GET /api/fees/pending?account=", "Claimable pool fees for a beneficiary."],
  ["GET /api/chain/status", "Live chain and dependency verification."],
];

function fmtUsd(value: number | string) {
  return `$${Number(value).toLocaleString("en-US")}`;
}

export default function DocsPage() {
  const groups = [...new Set(SECTIONS.map((section) => section.group))];
  const maxWallet = Number(product.token.maxWalletTokens).toLocaleString("en-US");
  const supply = Number(product.token.totalSupplyTokens).toLocaleString("en-US");

  return (
    <AppShell>
      <section className="page-hero section-frame explore-hero">
        <p className="eyebrow"><span /> Documentation</p>
        <h1>How HoodiePad works.</h1>
        <p>
          Every rule below is enforced by the contracts, not by this interface.
          HoodiePad is an interface to canonical Doppler and Uniswap V4
          contracts — not investment advice, and not a judgement about any
          token launched through it.
        </p>
      </section>

      <section className="section-frame docs-layout">
        <aside className="docs-nav" aria-label="Documentation sections">
          {groups.map((group) => (
            <div key={group}>
              <span>{group}</span>
              <ul>
                {SECTIONS.filter((section) => section.group === group).map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <article className="docs-body">
          <section id="overview">
            <h2>Overview</h2>
            <p>
              HoodiePad launches fixed-supply tokens on Robinhood Chain
              (chain ID {product.network.chainId}). Every token is paired with
              HOODIE in a canonical Uniswap V4 pool created through Doppler&apos;s
              Multicurve initializer, so every buy and sell of any HoodiePad
              token routes through HOODIE.
            </p>
            <p>
              The protocol choices are frozen. A creator picks a name, ticker,
              artwork and optional links — nothing else. Supply, allocation,
              fee split, wallet cap and liquidity behaviour are identical for
              every launch, which is what makes the rules worth reading once.
            </p>
            <div className="docs-callout">
              <strong>No presale. No creator allocation. No migration.</strong>
              <p>
                100% of supply goes to the market at launch, liquidity is locked
                permanently, and the creator receives {Number(product.fees.creator) / 1e16}%
                of trading fees instead of a token bag.
              </p>
            </div>
          </section>

          <section id="launches">
            <h2>How launches work</h2>
            <ol className="docs-steps">
              <li>
                <strong>01 · Create</strong>
                <p>
                  You supply a name, ticker and artwork. HoodiePad stores the
                  artwork and writes an immutable metadata document, then
                  derives the opening curve from the live HOODIE price so the
                  market opens near {fmtUsd(product.market.targetOpeningFdvUsd)}{" "}
                  fully diluted.
                </p>
              </li>
              <li>
                <strong>02 · Confirm</strong>
                <p>
                  The launch is simulated against current chain state, and the
                  exact transaction it produces is what your wallet signs. Your
                  connected account is both the sender and the immutable creator
                  fee recipient. HoodiePad never holds a key.
                </p>
              </li>
              <li>
                <strong>03 · Trade</strong>
                <p>
                  The Airlock deploys the token, mints the multicurve liquidity
                  and locks it. The market is tradeable immediately from its
                  token page — there is no bonding-curve phase and no graduation
                  event to wait for.
                </p>
              </li>
            </ol>
          </section>

          <section id="fixed-rules">
            <h2>Fixed rules</h2>
            <p>These values are identical for every HoodiePad market.</p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <tbody>
                  <tr><td>Network</td><td>Robinhood Chain · {product.network.chainId}</td></tr>
                  <tr><td>Quote asset</td><td>HOODIE, every market</td></tr>
                  <tr><td>Supply</td><td>{supply} · fixed, 18 decimals</td></tr>
                  <tr><td>Market allocation</td><td>100% · no presale, no dev buy, no vesting</td></tr>
                  <tr><td>Opening market cap</td><td>{fmtUsd(product.market.targetOpeningFdvUsd)} target</td></tr>
                  <tr><td>Pool fee</td><td>{product.market.lpFee / 10_000}% on every trade</td></tr>
                  <tr>
                    <td>Fee split</td>
                    <td>
                      {Number(product.fees.creator) / 1e16}% creator ·{" "}
                      {Number(product.fees.hoodieEcosystem) / 1e16}% HOODIE ecosystem ·{" "}
                      {Number(product.fees.doppler) / 1e16}% protocol
                    </td>
                  </tr>
                  <tr>
                    <td>Maximum wallet</td>
                    <td>
                      {maxWallet} tokens for{" "}
                      {product.token.maxWalletDurationSeconds / 3600} hours after launch
                    </td>
                  </tr>
                  <tr><td>Liquidity</td><td>Locked · no migration, no LP withdrawal</td></tr>
                  <tr><td>Governance</td><td>None (NoOp)</td></tr>
                  <tr><td>Launch fee</td><td>None · network gas only</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="pricing">
            <h2>Trading and pricing</h2>
            <p>
              Liquidity is distributed across three market-cap segments rather
              than a single range. Early buyers move price quickly; depth grows
              as the market cap climbs.
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr><th>Segment</th><th>Market cap range</th><th>Share of supply</th><th>Positions</th></tr>
                </thead>
                <tbody>
                  {curve.curves.map((item, index) => (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>
                        {fmtUsd(item.marketCap.start)} →{" "}
                        {item.marketCap.end === "max" ? "no cap" : fmtUsd(item.marketCap.end)}
                      </td>
                      <td>{Number(item.shares) / 1e16}%</td>
                      <td>{item.numPositions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Quotes come from the canonical Uniswap V4 Quoter against the exact
              pool key, and swaps execute through Robinhood&apos;s Universal
              Router with Permit2 approvals for the exact amount. Every swap is
              simulated before your wallet is asked to sign it.
            </p>
            <p>
              You can pay in HOODIE directly, or in ETH — an ETH buy routes
              ETH → HOODIE → token in one atomic transaction through the
              HOODIE/WETH reference pool, which carries its own fee and price
              impact.
            </p>
            <div className="docs-callout is-warning">
              <strong>Selling before the first buy reverts.</strong>
              <p>
                A fresh market has no liquidity below its opening price, so a
                sell quote fails with <code>NotEnoughLiquidity</code> until
                someone buys. This is normal multicurve behaviour, not a fault.
              </p>
            </div>
            <p>
              The Uniswap web interface indexes these pools but will not route
              swaps through them: its router excludes V4 pools whose hook is not
              on its allowlist, and no Robinhood Chain hooks are listed. Trade
              from the token page instead.
            </p>
          </section>

          <section id="fees">
            <h2>Fees and claims</h2>
            <p>
              Each trade pays {product.market.lpFee / 10_000}% to the pool. That
              fee accrues inside the locked pool and is <em>not</em> paid out
              automatically — a beneficiary releases their share by calling{" "}
              <code>collectFees</code> on the initializer, which HoodiePad
              prepares for you from the dashboard.
            </p>
            <ul className="docs-list">
              <li>
                <strong>Creators ({Number(product.fees.creator) / 1e16}%)</strong> —
                claim from <Link href="/dashboard">the dashboard</Link>. Fees arrive
                in both the token and HOODIE.
              </li>
              <li>
                <strong>HOODIE ecosystem ({Number(product.fees.hoodieEcosystem) / 1e16}%)</strong> —
                accrues to the ecosystem Safe. Balances and claimable amounts are
                published on <Link href="/fuel">HOODIE Fuel</Link>.
              </li>
              <li>
                <strong>Protocol ({Number(product.fees.doppler) / 1e16}%)</strong> —
                the Doppler beneficiary set by the live Airlock owner.
              </li>
            </ul>
            <p>
              The split is written into the pool at launch and cannot be changed
              afterwards, by anyone, including HoodiePad.
            </p>
          </section>

          <section id="leaderboards">
            <h2>Leaderboards and the crown</h2>
            <p>
              Rankings are computed from canonical Swap events using
              average-cost accounting. Realized profit is booked only when a
              position is closed; open positions keep their cost basis and are
              shown separately as unrealized.
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead><tr><th>Trader score component</th><th>Weight</th></tr></thead>
                <tbody>
                  <tr><td>Realized profit</td><td>{TRADER_SCORE_WEIGHTS.realizedProfit}%</td></tr>
                  <tr><td>Win rate across closed positions</td><td>{TRADER_SCORE_WEIGHTS.winRate}%</td></tr>
                  <tr><td>Return on capital deployed</td><td>{TRADER_SCORE_WEIGHTS.roi}%</td></tr>
                  <tr><td>Volume</td><td>{TRADER_SCORE_WEIGHTS.volume}%</td></tr>
                  <tr><td>Consistency (markets and days active)</td><td>{TRADER_SCORE_WEIGHTS.consistency}%</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              Volume is capped at {TRADER_SCORE_WEIGHTS.volume}% deliberately.
              Wash trading inflates volume cheaply, but it cannot manufacture
              realized profit, win rate, or activity spread across markets and
              days.
            </p>
            <p>
              <strong>King of the Hood</strong> crowns one market at a time. A
              market must first clear every activity gate —{" "}
              {crown.gates.minimumTrades24h} trades and{" "}
              {crown.gates.minimumHolders} holders with{" "}
              {fmtUsd(crown.gates.minimumVolume24hUsd)} of volume in 24 hours —
              then the highest weighted score among eligible markets reigns
              (24h volume {crown.weights.volume24h}%, trades{" "}
              {crown.weights.trades24h}%, holders {crown.weights.holders}%, 24h
              change {crown.weights.change24h}%). The crown is never curated and
              never sold; every handover is recorded.
            </p>
          </section>

          <section id="validation">
            <h2>Discovery and validation</h2>
            <p>
              HoodiePad has no database of markets. It discovers launches by
              scanning canonical Airlock <code>Create</code> events filtered by
              the HOODIE numeraire, then validates each candidate against
              roughly thirty-five on-chain invariants before showing it.
            </p>
            <p>
              A market must use the canonical initializer and hook, carry the
              dynamic-fee flag and tick spacing, be status <em>Locked</em>, hold
              the exact supply and wallet cap, route fees to the exact
              beneficiary weights, and serve metadata that HoodiePad itself
              minted. A single failed check keeps a token out of discovery,
              analytics and in-app trading.
            </p>
          </section>

          <section id="network">
            <h2>Network and contracts</h2>
            <p>
              Chain ID {product.network.chainId} · RPC{" "}
              <code>{product.network.rpcUrl}</code> · explorer{" "}
              <a href={product.network.explorerUrl} target="_blank" rel="noreferrer">
                {product.network.explorerUrl.replace("https://", "")} ↗
              </a>
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table is-mono">
                <tbody>
                  {CONTRACTS.map(([label, address]) => (
                    <tr key={address}>
                      <td>{label}</td>
                      <td>
                        <a
                          href={`${product.network.explorerUrl}/address/${address}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {address}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Pool keys use fee <code>{product.market.dynamicFeeFlag}</code> (the
              dynamic-fee flag) and tick spacing{" "}
              <code>{product.market.tickSpacing}</code>, with the active LP fee
              set to {product.market.lpFee / 10_000}%.
            </p>
          </section>

          <section id="reading">
            <h2>Reading market state</h2>
            <p>
              A pool ID is <code>keccak256</code> of the ABI-encoded pool key.
              Sort the token and HOODIE addresses to get currency0 and
              currency1:
            </p>
            <pre className="docs-code">{`import { createPublicClient, http, keccak256, encodeAbiParameters } from "viem";

const HOODIE = "${product.contracts.hoodie}";
const HOOK   = "${product.contracts.dopplerHookInitializer}";

const [currency0, currency1] =
  token.toLowerCase() < HOODIE.toLowerCase() ? [token, HOODIE] : [HOODIE, token];

const poolId = keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint24" },
   { type: "int24" },   { type: "address" }],
  [currency0, currency1, ${product.market.dynamicFeeFlag}, ${product.market.tickSpacing}, HOOK],
));

const client = createPublicClient({ transport: http("${product.network.rpcUrl}") });
const slot0 = await client.readContract({
  address: "${product.contracts.uniswapV4StateView}",
  abi: [{ name: "getSlot0", type: "function", stateMutability: "view",
          inputs: [{ type: "bytes32" }],
          outputs: [{ name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" },
                    { name: "protocolFee", type: "uint24" }, { name: "lpFee", type: "uint24" }] }],
  functionName: "getSlot0",
  args: [poolId],
});`}</pre>
            <p>
              Price in HOODIE per token comes from{" "}
              <code>sqrtPriceX96</code>, inverted when HOODIE is currency0.
            </p>
          </section>

          <section id="indexing">
            <h2>Indexing events</h2>
            <ul className="docs-list">
              <li>
                <strong>Launches</strong> — <code>Create</code> on the Airlock,
                filtered by <code>numeraire = HOODIE</code>. The event carries the
                asset, initializer and pool.
              </li>
              <li>
                <strong>Trades</strong> — <code>Swap</code> on the PoolManager,
                filtered by pool ID. Amounts are the swapper&apos;s balance deltas:
                positive means received, negative means paid in. This is the
                opposite of the V3 convention.
              </li>
              <li>
                <strong>Holders</strong> — standard ERC-20 <code>Transfer</code>{" "}
                events on the token, excluding the PoolManager and protocol
                contracts.
              </li>
            </ul>
          </section>

          <section id="api">
            <h2>Public API</h2>
            <p>
              These read endpoints are open and return JSON. They are derived
              live from chain state and cached briefly.
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <tbody>
                  {ENDPOINTS.map(([path, description]) => (
                    <tr key={path}>
                      <td><code>{path}</code></td>
                      <td>{description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="risk">
            <h2>Risk disclosures</h2>
            <ul className="docs-list">
              <li>
                Tokens launched here are created by users. They can lose all
                value, and most will. HoodiePad does not review, endorse or
                rank tokens by quality.
              </li>
              <li>
                A {product.token.maxWalletTokens && `${maxWallet}-token`} wallet
                cap is not Sybil protection — one person can use many wallets,
                and the cap expires after{" "}
                {product.token.maxWalletDurationSeconds / 3600} hours.
              </li>
              <li>
                Locked liquidity is not a price floor. It prevents liquidity
                withdrawal; it does not stop price from falling.
              </li>
              <li>
                Leaderboard ranks describe past on-chain activity. They are not
                investment advice and not a prediction.
              </li>
              <li>
                Blockchain transactions are irreversible. HoodiePad is
                non-custodial software: it never holds your keys or your funds,
                and it cannot reverse a trade or a launch.
              </li>
              <li>
                HoodiePad is an independent project. It is not Robinhood
                Markets, Inc., not Uniswap Labs, and not Whetstone Research, and
                it is not endorsed by any of them.
              </li>
            </ul>
          </section>

          <section id="faq">
            <h2>FAQ</h2>
            <dl className="docs-faq">
              <dt>What does it cost to launch?</dt>
              <dd>Only network gas. HoodiePad charges no launch fee.</dd>

              <dt>Can I buy my own token at launch?</dt>
              <dd>
                There is no dev buy built into the launch. You can buy on the
                open market like anyone else, subject to the same wallet cap.
              </dd>

              <dt>When do I get my fees?</dt>
              <dd>
                Whenever you claim them. They accrue continuously in the pool
                and never expire; the dashboard shows the claimable amount.
              </dd>

              <dt>Can the fee split or supply be changed later?</dt>
              <dd>
                No. Both are written into the pool and the token at launch and
                are immutable afterwards.
              </dd>

              <dt>Why can&apos;t I trade on the Uniswap app?</dt>
              <dd>
                Uniswap&apos;s router only routes V4 pools whose hook is
                allowlisted, and Robinhood Chain hooks are not. The pool page
                renders because their indexer sees it, but swaps must go through
                HoodiePad or another router that targets the hooked pool.
              </dd>

              <dt>Which wallets are supported?</dt>
              <dd>
                MetaMask, on chain {product.network.chainId}. Phantom can hold
                Robinhood Chain assets but does not yet support dapp
                connections on the chain, so it cannot sign HoodiePad
                transactions.
              </dd>

              <dt>Do you have a token?</dt>
              <dd>
                HoodiePad does not have its own token. Every market is paired
                with <a href="https://hoodie.fun" target="_blank" rel="noreferrer">HOODIE ↗</a>.
              </dd>
            </dl>
          </section>

          <div className="docs-footer-cta">
            <p>Ready to try it?</p>
            <div>
              <Link className="button button-primary" href="/launch">Launch a token ↗</Link>
              <Link className="button" href="/explore">Explore markets</Link>
            </div>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
