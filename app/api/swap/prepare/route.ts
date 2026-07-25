import {
  prepareHoodiePadSwap,
  SwapPreparationError,
  type SwapSide,
} from "../../../lib/swap";

type SwapRequest = {
  token?: unknown;
  account?: unknown;
  side?: unknown;
  amount?: unknown;
  slippageBps?: unknown;
};

function safeSwapError(error: unknown) {
  if (!(error instanceof Error)) return "Swap preparation failed";
  return error.message
    .split("\n")[0]
    .replace(/https?:\/\/[^\s]+/g, "[redacted RPC]")
    .slice(0, 240);
}

export async function POST(request: Request) {
  let body: SwapRequest;
  try {
    body = await request.json() as SwapRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    typeof body.token !== "string" ||
    typeof body.account !== "string" ||
    (body.side !== "buy" && body.side !== "sell") ||
    typeof body.amount !== "string" ||
    typeof body.slippageBps !== "number"
  ) {
    return Response.json({ error: "Invalid swap request" }, { status: 422 });
  }

  try {
    const prepared = await prepareHoodiePadSwap({
      token: body.token,
      account: body.account,
      side: body.side as SwapSide,
      amount: body.amount,
      slippageBps: body.slippageBps,
    });
    return Response.json(prepared, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const details = error instanceof SwapPreparationError
      ? {
          code: error.code,
          maximumAmount: error.maximumAmount,
          inputSymbol: error.inputSymbol,
        }
      : {};
    return Response.json(
      { error: safeSwapError(error), ...details },
      { status: 409 },
    );
  }
}
