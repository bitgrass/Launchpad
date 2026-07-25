# HoodiePad engineering rules

1. Read `PRODUCT_DECISIONS.md` before changing protocol-facing code.
2. Never change frozen economics or protocol parameters without an ADR.
3. Never submit a Robinhood mainnet transaction from automated tooling.
4. Never store or print private keys, seed phrases, RPC secrets, or signer material.
5. Use bigint for all onchain amounts.
6. Associate every contract address with an explicit chain ID.
7. Pin exact versions of contract-facing dependencies.
8. Simulate every transaction path before wallet submission.
9. Never introduce upgradeable proxies.
10. Do not add Rehype, referrals, presales, airdrops, custom supplies, custom fees, custom quote tokens, or migrations in V1.
11. Treat the current Robinhood V3 curve as provisional until the mainnet-fork calibration suite passes.
12. Mainnet broadcast controls must fail closed when required environment values are missing.
13. Update tests and documentation with every protocol-facing change.

