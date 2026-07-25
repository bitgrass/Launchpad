import {
  dopplerHookInitializerAbi,
} from "@whetstone-research/doppler-sdk/evm";
import { encodeFunctionData, getAddress, type Hex } from "viem";
import product from "../../../../config/hoodiepad-v2.json";
import {
  readVersionedHoodiePadMarket,
  type HoodiePadV4Market,
} from "../../../lib/market-v4";
import { createRobinhoodPublicClient } from "../../../lib/protocol";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

type FeeClaimRequest = {
  token?: unknown;
  account?: unknown;
};

// Prepares the collectFees(poolId) transaction on the canonical
// DopplerHookInitializer. Anyone can call it; a caller who is a configured
// beneficiary receives their pending share in the same transaction. The
// transaction is always simulated here first and signed by the connected
// wallet — the server never signs anything.
export async function POST(request: Request) {
  let body: FeeClaimRequest;
  try {
    body = await request.json() as FeeClaimRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    typeof body.token !== "string" ||
    !addressPattern.test(body.token) ||
    typeof body.account !== "string" ||
    !addressPattern.test(body.account)
  ) {
    return Response.json({ error: "Invalid fee claim request" }, { status: 422 });
  }

  try {
    const client = createRobinhoodPublicClient();
    const account = getAddress(body.account);
    const market = await readVersionedHoodiePadMarket(body.token, client);
    if (
      market.version !== "doppler-multicurve-v4-v2" ||
      !("poolKey" in market)
    ) {
      return Response.json(
        { error: "Fee claims are only available for V4 markets" },
        { status: 409 },
      );
    }
    const v4Market = market as HoodiePadV4Market;
    if (!v4Market.official) {
      return Response.json(
        { error: `This V4 market failed HoodiePad validation: ${v4Market.validationErrors.join(", ")}` },
        { status: 409 },
      );
    }
    const initializer = getAddress(product.contracts.dopplerHookInitializer);
    const poolId = v4Market.poolId as Hex;
    let collected0 = 0n;
    let collected1 = 0n;
    try {
      const simulation = await client.simulateContract({
        address: initializer,
        abi: dopplerHookInitializerAbi,
        functionName: "collectFees",
        args: [poolId],
        account,
      });
      const [fees0, fees1] = simulation.result as readonly [bigint, bigint];
      collected0 = fees0;
      collected1 = fees1;
    } catch {
      return Response.json(
        { error: "The fee collection did not simulate for this wallet" },
        { status: 409 },
      );
    }
    const data = encodeFunctionData({
      abi: dopplerHookInitializerAbi,
      functionName: "collectFees",
      args: [poolId],
    });
    const gasEstimate = await client.estimateGas({
      account,
      to: initializer,
      data,
    });
    return Response.json(
      {
        transaction: {
          kind: "fee-claim",
          label: `Collect ${v4Market.symbol} pool fees`,
          from: account,
          to: initializer,
          data,
          gasLimit: (gasEstimate * 120n / 100n).toString(),
          value: "0x0",
        },
        newlyCollected0: collected0.toString(),
        newlyCollected1: collected1.toString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Fee claim preparation is temporarily unavailable" },
      { status: 503 },
    );
  }
}
