import { getAddress, parseAbi } from "viem";
import product from "../../../../config/hoodiepad-v2.json";
import { createRobinhoodPublicClient } from "../../../lib/protocol";
import {
  getHoodieReferencePoolId,
  getHoodieReferencePoolKey,
} from "../../../lib/v4-policy";
import {
  formatRational,
  invertRational,
  sqrtPriceX96ToCurrency1PerCurrency0,
} from "../../../lib/v4-price";

export const revalidate = 0;

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
]);
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

type PriceCache = {
  expiresAt: number;
  ethUsd: number | null;
  hoodieUsd: number | null;
};

let cachedPrices: PriceCache | undefined;

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
async function readDisplayPrices(): Promise<PriceCache> {
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
    // Balances still work without prices; the UI shows "—" for USD values.
  }
  cachedPrices = { expiresAt: now + 60_000, ethUsd, hoodieUsd };
  return cachedPrices;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const account = url.searchParams.get("account") ?? "";
  if (!addressPattern.test(token)) {
    return Response.json({ error: "Invalid token address" }, { status: 422 });
  }
  if (account && !addressPattern.test(account)) {
    return Response.json({ error: "Invalid account address" }, { status: 422 });
  }

  try {
    const prices = await readDisplayPrices();
    let balances: { eth: string; hoodie: string; token: string } | null = null;
    if (account) {
      const client = createRobinhoodPublicClient();
      const owner = getAddress(account);
      const [eth, hoodie, tokenBalance] = await Promise.all([
        client.getBalance({ address: owner }),
        client.readContract({
          address: getAddress(product.contracts.hoodie),
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        }),
        client.readContract({
          address: getAddress(token),
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        }),
      ]);
      balances = {
        eth: eth.toString(),
        hoodie: hoodie.toString(),
        token: tokenBalance.toString(),
      };
    }
    return Response.json(
      {
        ethUsd: prices.ethUsd,
        hoodieUsd: prices.hoodieUsd,
        balances,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Swap context is temporarily unavailable" },
      { status: 503 },
    );
  }
}
