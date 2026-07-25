import { getAddress, parseAbi } from "viem";
import product from "../../../../config/hoodiepad-v2.json";
import { readDisplayPrices } from "../../../lib/display-prices";
import { createRobinhoodPublicClient } from "../../../lib/protocol";

export const revalidate = 0;

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

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
