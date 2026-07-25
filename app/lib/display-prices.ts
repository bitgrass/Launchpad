import { getAddress, parseAbi } from "viem";
import product from "../../config/hoodiepad-v2.json";
import { createRobinhoodPublicClient } from "./protocol";
import {
  getHoodieReferencePoolId,
  getHoodieReferencePoolKey,
} from "./v4-policy";
import {
  formatRational,
  invertRational,
  sqrtPriceX96ToCurrency1PerCurrency0,
} from "./v4-price";

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
]);

export type DisplayPrices = {
  expiresAt: number;
  ethUsd: number | null;
  hoodieUsd: number | null;
};

let cachedPrices: DisplayPrices | undefined;

async function readDisplayEthUsd(): Promise<number | null> {
  try {
    const response = await fetch(
      "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4_000),
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    const payload = await response.json() as { price?: unknown };
    const value = typeof payload.price === "string" ? Number(payload.price) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

// Display-only USD context. Never used for launch pricing or swap execution —
// those keep their own strict, fail-closed price paths.
export async function readDisplayPrices(): Promise<DisplayPrices> {
  const now = Date.now();
  if (cachedPrices && cachedPrices.expiresAt > now) return cachedPrices;
  let ethUsd: number | null = null;
  let hoodieUsd: number | null = null;
  try {
    const client = createRobinhoodPublicClient();
    const [slot0, coinbase] = await Promise.all([
      client.readContract({
        address: getAddress(product.contracts.uniswapV4StateView),
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [getHoodieReferencePoolId()],
      }),
      readDisplayEthUsd(),
    ]);
    ethUsd = coinbase;
    if (ethUsd !== null && slot0[0] > 0n) {
      const key = getHoodieReferencePoolKey();
      const currency1PerCurrency0 = sqrtPriceX96ToCurrency1PerCurrency0(
        slot0[0],
        18,
        18,
      );
      const hoodiePerWeth =
        key.currency0.toLowerCase() === product.contracts.weth.toLowerCase()
          ? currency1PerCurrency0
          : invertRational(currency1PerCurrency0);
      const hoodiePerWethNumber = Number(formatRational(hoodiePerWeth, 18));
      if (Number.isFinite(hoodiePerWethNumber) && hoodiePerWethNumber > 0) {
        hoodieUsd = ethUsd / hoodiePerWethNumber;
      }
    }
  } catch {
    // Callers render "—" for USD values when prices are unavailable.
  }
  cachedPrices = { expiresAt: now + 60_000, ethUsd, hoodieUsd };
  return cachedPrices;
}

export function formatUsdCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 2 : value >= 1 ? 2 : 4,
  }).format(value)}`;
}

export function formatUsdPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value >= 0.01) {
    return `$${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: value >= 1_000 ? 2 : 4,
    }).format(value)}`;
  }
  // Sub-cent prices keep meaningful precision, Dexscreener-style.
  return `$${value.toLocaleString("en-US", {
    maximumSignificantDigits: 3,
    minimumSignificantDigits: 1,
    notation: "standard",
    useGrouping: false,
    maximumFractionDigits: 12,
  })}`;
}
