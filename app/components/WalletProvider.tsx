"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type EthereumProvider = {
  isMetaMask?: boolean;
  isPhantom?: boolean;
  providers?: EthereumProvider[];
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    phantom?: { ethereum?: EthereumProvider };
  }
}

export type WalletId = "metamask" | "phantom";

// Phantom stays out of this list until it supports dapp connections on
// Robinhood Chain: its provider connects and switches chains, but signing any
// dapp transaction fails inside the wallet. The detection and provider
// plumbing below is kept so restoring Phantom is a one-entry change.
export const WALLETS: Array<{
  id: WalletId;
  name: string;
  hint: string;
  installUrl: string;
}> = [
  {
    id: "metamask",
    name: "MetaMask",
    hint: "Browser extension",
    installUrl: "https://metamask.io/download/",
  },
];

const ROBINHOOD_CHAIN = {
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
};

const STORAGE_KEY = "hoodiepad.wallet";

type WalletContextValue = {
  address: string;
  walletId: WalletId | null;
  status: "idle" | "connecting" | "error";
  connect: (walletId?: WalletId) => Promise<void>;
  disconnect: () => void;
  isDetected: (walletId: WalletId) => boolean;
  sendTransaction: (transaction: {
    from: string;
    to: string;
    data: string;
    gasLimit?: string;
    value?: string;
  }) => Promise<string>;
  waitForTransaction: (transactionHash: string) => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function injectedProviders(): EthereumProvider[] {
  if (typeof window === "undefined") return [];
  const found: EthereumProvider[] = [];
  const injected = window.ethereum;
  if (injected?.providers?.length) found.push(...injected.providers);
  else if (injected) found.push(injected);
  // Phantom also exposes a dedicated EVM provider that is not always mirrored
  // into window.ethereum when another wallet wins the injection race.
  const phantom = window.phantom?.ethereum;
  if (phantom && !found.includes(phantom)) found.push(phantom);
  return found;
}

function providerFor(walletId: WalletId) {
  if (typeof window === "undefined") return undefined;
  const providers = injectedProviders();
  if (walletId === "phantom") {
    return window.phantom?.ethereum ??
      providers.find((provider) => provider.isPhantom);
  }
  return providers.find(
    (provider) => provider.isMetaMask && !provider.isPhantom,
  );
}

async function ensureRobinhoodChain(provider: EthereumProvider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ROBINHOOD_CHAIN.chainId }],
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [ROBINHOOD_CHAIN],
    });
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState("");
  const [walletId, setWalletId] = useState<WalletId | null>(null);
  const [status, setStatus] = useState<WalletContextValue["status"]>("idle");

  useEffect(() => {
    const candidate: WalletId = "metamask";
    const provider = providerFor(candidate);
    if (!provider) return;

    provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const account = Array.isArray(accounts) ? accounts[0] : undefined;
        if (typeof account === "string") {
          setAddress(account);
          setWalletId(candidate);
        }
      })
      .catch(() => undefined);

    const onAccountsChanged = (value: unknown) => {
      const account = Array.isArray(value) ? value[0] : undefined;
      setAddress(typeof account === "string" ? account : "");
      setStatus("idle");
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    return () => provider.removeListener?.("accountsChanged", onAccountsChanged);
  }, []);

  async function connect(requested: WalletId = "metamask") {
    const provider = providerFor(requested);
    if (!provider) {
      setStatus("error");
      const wallet = WALLETS.find((entry) => entry.id === requested);
      if (wallet) window.open(wallet.installUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setStatus("connecting");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const account = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof account !== "string") throw new Error("No wallet account returned");

      await ensureRobinhoodChain(provider);

      setAddress(account);
      setWalletId(requested);
      window.localStorage.setItem(STORAGE_KEY, requested);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  function disconnect() {
    setAddress("");
    setWalletId(null);
    setStatus("idle");
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function isDetected(candidate: WalletId) {
    return providerFor(candidate) !== undefined;
  }

  async function sendTransaction(transaction: {
    from: string;
    to: string;
    data: string;
    gasLimit?: string;
    value?: string;
  }) {
    const provider = providerFor(walletId ?? "metamask");
    if (!provider) throw new Error("No supported wallet is connected");
    if (!address || transaction.from.toLowerCase() !== address.toLowerCase()) {
      throw new Error("The prepared creator wallet is no longer connected");
    }
    await ensureRobinhoodChain(provider);
    const chainId = await provider.request({ method: "eth_chainId" });
    if (chainId !== ROBINHOOD_CHAIN.chainId) {
      throw new Error("The wallet is not connected to Robinhood Chain");
    }
    const parameters: Record<string, string> = {
      from: address,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value ?? "0x0",
    };
    if (transaction.gasLimit) {
      parameters.gas = `0x${BigInt(transaction.gasLimit).toString(16)}`;
    }
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [parameters],
    });
    if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      throw new Error("The wallet did not return a transaction hash");
    }
    return hash;
  }

  async function waitForTransaction(transactionHash: string) {
    const provider = providerFor(walletId ?? "metamask");
    if (!provider) throw new Error("No supported wallet is connected");
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const receipt = await provider.request({
        method: "eth_getTransactionReceipt",
        params: [transactionHash],
      }) as { status?: string } | null;
      if (receipt?.status === "0x1") return;
      if (receipt?.status === "0x0") throw new Error("The transaction reverted");
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    throw new Error("Transaction confirmation timed out");
  }

  const value = {
    address,
    walletId,
    status,
    connect,
    disconnect,
    isDetected,
    sendTransaction,
    waitForTransaction,
  };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}
