"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type EthereumProvider = {
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const ROBINHOOD_CHAIN = {
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
};

type WalletContextValue = {
  address: string;
  status: "idle" | "connecting" | "error";
  connect: () => Promise<void>;
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

function metaMaskProvider() {
  const injected = window.ethereum;
  if (!injected) return undefined;
  if (injected.providers?.length) {
    return injected.providers.find((provider) => provider.isMetaMask);
  }
  return injected.isMetaMask ? injected : undefined;
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
  const [status, setStatus] = useState<WalletContextValue["status"]>("idle");

  useEffect(() => {
    const provider = metaMaskProvider();
    if (!provider) return;

    provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const account = Array.isArray(accounts) ? accounts[0] : undefined;
        if (typeof account === "string") setAddress(account);
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

  async function connect() {
    const provider = metaMaskProvider();
    if (!provider) {
      setStatus("error");
      window.open("https://metamask.io/download/", "_blank", "noopener,noreferrer");
      return;
    }

    setStatus("connecting");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const account = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof account !== "string") throw new Error("No MetaMask account returned");

      await ensureRobinhoodChain(provider);

      setAddress(account);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function sendTransaction(transaction: {
    from: string;
    to: string;
    data: string;
    gasLimit?: string;
    value?: string;
  }) {
    const provider = metaMaskProvider();
    if (!provider) throw new Error("MetaMask is not installed");
    if (!address || transaction.from.toLowerCase() !== address.toLowerCase()) {
      throw new Error("The prepared creator wallet is no longer connected");
    }
    await ensureRobinhoodChain(provider);
    const chainId = await provider.request({ method: "eth_chainId" });
    if (chainId !== ROBINHOOD_CHAIN.chainId) {
      throw new Error("MetaMask is not connected to Robinhood Chain");
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
      throw new Error("MetaMask did not return a transaction hash");
    }
    return hash;
  }

  async function waitForTransaction(transactionHash: string) {
    const provider = metaMaskProvider();
    if (!provider) throw new Error("MetaMask is not installed");
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

  const value = { address, status, connect, sendTransaction, waitForTransaction };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}
