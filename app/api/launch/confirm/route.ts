import {
  airlockAbi,
  computePoolId,
  dopplerHookInitializerAbi,
  type V4PoolKey,
} from "@whetstone-research/doppler-sdk/evm";
import {
  decodeEventLog,
  getAddress,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from "viem";
import legacyProduct from "../../../../config/hoodiepad-v1.json";
import product from "../../../../config/hoodiepad-v2.json";
import { PUBLIC_V4_MARKET_VERSION } from "../../../lib/market-version";
import { createRobinhoodPublicClient } from "../../../lib/protocol";

type ConfirmationRequest = {
  transactionHash?: unknown;
  predictedToken?: unknown;
  predictedPool?: unknown;
};

const transactionHashPattern = /^0x[a-fA-F0-9]{64}$/;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const poolIdPattern = /^0x[a-fA-F0-9]{64}$/;

export async function POST(request: Request) {
  let body: ConfirmationRequest;
  try {
    body = (await request.json()) as ConfirmationRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const isV4Confirmation =
    typeof body.predictedPool === "string" &&
    poolIdPattern.test(body.predictedPool);
  if (
    typeof body.transactionHash !== "string" ||
    !transactionHashPattern.test(body.transactionHash) ||
    typeof body.predictedToken !== "string" ||
    !addressPattern.test(body.predictedToken) ||
    typeof body.predictedPool !== "string" ||
    (!isV4Confirmation && !addressPattern.test(body.predictedPool))
  ) {
    return Response.json({ error: "Invalid deployment confirmation request" }, { status: 422 });
  }

  try {
    const client = createRobinhoodPublicClient();
    const receipt = await client.getTransactionReceipt({
      hash: body.transactionHash as Hex,
    });
    if (receipt.status !== "success") {
      return Response.json({ error: "The Robinhood deployment reverted" }, { status: 409 });
    }
    if (!receipt.to || receipt.to.toLowerCase() !== product.contracts.airlock.toLowerCase()) {
      return Response.json({ error: "The transaction did not call the canonical Airlock" }, { status: 409 });
    }

    let confirmed:
      | {
          token: Address;
          poolOrHook: Address;
          initializer: Address;
        }
      | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== product.contracts.airlock.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: airlockAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== "Create") continue;
        const args = decoded.args as {
          asset: Address;
          numeraire: Address;
          initializer: Address;
          poolOrHook: Address;
        };
        if (args.numeraire.toLowerCase() !== product.contracts.hoodie.toLowerCase()) continue;
        confirmed = {
          token: getAddress(args.asset),
          poolOrHook: getAddress(args.poolOrHook),
          initializer: getAddress(args.initializer),
        };
        break;
      } catch {
        // Other Airlock logs are expected in the same receipt.
      }
    }

    if (!confirmed) {
      return Response.json({ error: "No HoodiePad Airlock Create event was found" }, { status: 409 });
    }
    if (confirmed.token.toLowerCase() !== body.predictedToken.toLowerCase()) {
      return Response.json(
        { error: "Confirmed token does not match the simulated deployment" },
        { status: 409 },
      );
    }

    if (isV4Confirmation) {
      if (
        confirmed.initializer.toLowerCase() !==
        product.contracts.dopplerHookInitializer.toLowerCase()
      ) {
        return Response.json(
          { error: "The deployment did not use the canonical HoodiePad V2 initializer" },
          { status: 409 },
        );
      }
      const state = await client.readContract({
        address: getAddress(product.contracts.dopplerHookInitializer),
        abi: dopplerHookInitializerAbi,
        functionName: "getState",
        args: [confirmed.token],
      });
      const poolKey = {
        currency0: getAddress(state[5].currency0),
        currency1: getAddress(state[5].currency1),
        fee: Number(state[5].fee),
        tickSpacing: Number(state[5].tickSpacing),
        hooks: getAddress(state[5].hooks),
      } satisfies V4PoolKey;
      const poolId = computePoolId(poolKey);
      if (poolId.toLowerCase() !== body.predictedPool.toLowerCase()) {
        return Response.json(
          { error: "Confirmed V4 PoolId does not match the simulated deployment" },
          { status: 409 },
        );
      }
      return Response.json({
        status: "confirmed",
        marketVersion: PUBLIC_V4_MARKET_VERSION,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        creator: receipt.from,
        token: confirmed.token,
        pool: poolId,
        poolKey,
        externalHook: getAddress(state[2]),
      });
    }

    if (
      confirmed.initializer.toLowerCase() !==
      legacyProduct.contracts.lockableV3Initializer.toLowerCase() ||
      confirmed.poolOrHook.toLowerCase() !== body.predictedPool.toLowerCase()
    ) {
      return Response.json(
        { error: "Confirmed legacy V3 pool does not match the simulated deployment" },
        { status: 409 },
      );
    }

    return Response.json({
      status: "confirmed",
      marketVersion: "doppler-lockable-v3-v1",
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      creator: receipt.from,
      token: confirmed.token,
      pool: confirmed.poolOrHook,
    });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) {
      return Response.json({ status: "confirming" }, { status: 202 });
    }
    return Response.json(
      { error: "Robinhood confirmation is temporarily unavailable" },
      { status: 503 },
    );
  }
}
