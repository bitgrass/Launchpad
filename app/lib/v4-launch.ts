import {
  airlockAbi,
  DopplerSDK,
  RehypeFeeRoutingMode,
  type CreateMulticurveParams,
} from "@whetstone-research/doppler-sdk/evm";
import {
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import product from "../../config/hoodiepad-v2.json";
import { robinhood } from "./protocol";
import {
  formatRational,
  invertRational,
  multiplyRationals,
  sqrtPriceX96ToCurrency1PerCurrency0,
  type Rational,
} from "./v4-price";
import {
  getHoodieReferencePoolId,
  getHoodieReferencePoolKey,
  getHoodieV4Curve,
  getV4Beneficiaries,
  V4_LP_FEE,
  V4_MAX_WALLET,
  V4_TICK_SPACING,
  V4_TOKENS_TO_SELL,
  V4_TOTAL_SUPPLY,
  WAD,
} from "./v4-policy";

const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

export type V4PriceSnapshot = {
  referenceBlock: string;
  referenceTimestamp: string;
  ethUsd: string;
  ethUsdSource: "coinbase";
  ethUsdTimestamp: string;
  hoodiePerWeth: string;
  hoodieUsd: string;
  hoodieUsdNumber: number;
  referencePoolId: Hex;
};

export type V4LaunchInput = {
  name: string;
  symbol: string;
  tokenURI: string;
  creator: Address;
};

function decimalToRational(value: string): Rational {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("Price source returned an invalid decimal value");
  }
  const [whole, fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator,
  };
}

function rpcUrl() {
  const explicit = process.env.ROBINHOOD_RPC_URL?.trim();
  if (explicit) return explicit;
  const alchemyKey = process.env.Alchemy_API_KEY?.trim();
  if (alchemyKey) {
    return `https://robinhood-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  }
  throw new Error("Robinhood RPC is not configured");
}

async function readCoinbaseEthUsd(now = Date.now()) {
  const response = await fetch(
    "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`Coinbase ETH/USD returned HTTP ${response.status}`);
  }
  const payload = await response.json() as { price?: unknown; time?: unknown };
  if (typeof payload.price !== "string" || typeof payload.time !== "string") {
    throw new Error("Coinbase ETH/USD response is incomplete");
  }
  const timestamp = Date.parse(payload.time);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Coinbase ETH/USD timestamp is invalid");
  }
  const ageMilliseconds = now - timestamp;
  if (
    ageMilliseconds < -5_000 ||
    ageMilliseconds >
      product.pricing.maximumSourceAgeSeconds * 1_000
  ) {
    throw new Error("Coinbase ETH/USD price is stale");
  }
  return {
    value: decimalToRational(payload.price),
    text: payload.price,
    timestamp: new Date(timestamp).toISOString(),
  };
}

export async function readV4PriceSnapshot(
  client: PublicClient,
): Promise<V4PriceSnapshot> {
  const referencePoolId = getHoodieReferencePoolId();
  const [block, slot0, ethUsd] = await Promise.all([
    client.getBlock(),
    client.readContract({
      address: getAddress(product.contracts.uniswapV4StateView),
      abi: stateViewAbi,
      functionName: "getSlot0",
      args: [referencePoolId],
    }),
    readCoinbaseEthUsd(),
  ]);
  if (slot0[0] === 0n) {
    throw new Error("HOODIE/WETH V4 reference pool is uninitialized");
  }
  const key = getHoodieReferencePoolKey();
  const currency1PerCurrency0 = sqrtPriceX96ToCurrency1PerCurrency0(
    slot0[0],
    18,
    18,
  );
  let hoodiePerWeth: Rational;
  if (
    key.currency0.toLowerCase() === product.contracts.weth.toLowerCase() &&
    key.currency1.toLowerCase() === product.contracts.hoodie.toLowerCase()
  ) {
    hoodiePerWeth = currency1PerCurrency0;
  } else if (
    key.currency1.toLowerCase() === product.contracts.weth.toLowerCase() &&
    key.currency0.toLowerCase() === product.contracts.hoodie.toLowerCase()
  ) {
    hoodiePerWeth = invertRational(currency1PerCurrency0);
  } else {
    throw new Error("Reference PoolKey is not WETH/HOODIE");
  }
  const hoodieUsd = multiplyRationals(
    ethUsd.value,
    invertRational(hoodiePerWeth),
  );
  const hoodieUsdText = formatRational(hoodieUsd, 18);
  const hoodieUsdNumber = Number(hoodieUsdText);
  if (!Number.isFinite(hoodieUsdNumber) || hoodieUsdNumber <= 0) {
    throw new Error("Derived HOODIE/USD value is invalid");
  }
  return {
    referenceBlock: block.number.toString(),
    referenceTimestamp: new Date(Number(block.timestamp) * 1_000).toISOString(),
    ethUsd: ethUsd.text,
    ethUsdSource: "coinbase",
    ethUsdTimestamp: ethUsd.timestamp,
    hoodiePerWeth: formatRational(hoodiePerWeth, 18),
    hoodieUsd: hoodieUsdText,
    hoodieUsdNumber,
    referencePoolId,
  };
}

export function buildV4LaunchParams(
  sdk: DopplerSDK,
  input: V4LaunchInput,
  airlockOwner: Address,
  hoodieUsdPrice: number,
  launchTimestamp: number,
): CreateMulticurveParams<4663> {
  const beneficiaries = getV4Beneficiaries(input.creator, airlockOwner);
  return sdk
    .buildMulticurveAuction()
    .tokenConfig({
      type: "dopplerERC20V1",
      name: input.name,
      symbol: input.symbol,
      tokenURI: input.tokenURI,
      maxBalanceLimit: V4_MAX_WALLET,
      balanceLimitEnd:
        launchTimestamp + product.token.maxWalletDurationSeconds,
      controller: getAddress(product.token.controller),
    })
    .saleConfig({
      initialSupply: V4_TOTAL_SUPPLY,
      numTokensToSell: V4_TOKENS_TO_SELL,
      numeraire: getAddress(product.contracts.hoodie),
    })
    .withCurves({
      numerairePrice: hoodieUsdPrice,
      tokenSupply: V4_TOTAL_SUPPLY,
      tokenDecimals: product.token.decimals,
      numeraireDecimals: 18,
      fee: V4_LP_FEE,
      tickSpacing: V4_TICK_SPACING,
      beneficiaries,
      curves: getHoodieV4Curve(),
    })
    .withRehypeDopplerHookInitializer({
      hookAddress: getAddress(
        product.contracts.rehypeDopplerHookInitializer,
      ),
      buybackDestination: getAddress(product.contracts.hoodieEcosystemSafe),
      startFee: product.rehype.startFee,
      endFee: product.rehype.endFee,
      durationSeconds: product.rehype.durationSeconds,
      startingTime: product.rehype.startingTime,
      feeRoutingMode: RehypeFeeRoutingMode.RouteToBeneficiaryFees,
      feeDistributionInfo: {
        assetFeesToAssetBuybackWad: 0n,
        assetFeesToNumeraireBuybackWad: 0n,
        assetFeesToBeneficiaryWad: WAD,
        assetFeesToLpWad: 0n,
        numeraireFeesToAssetBuybackWad: 0n,
        numeraireFeesToNumeraireBuybackWad: 0n,
        numeraireFeesToBeneficiaryWad: WAD,
        numeraireFeesToLpWad: 0n,
      },
    })
    .withGovernance({ type: "noOp" })
    .withMigration({ type: "noOp" })
    .withUserAddress(getAddress(input.creator))
    .build();
}

export async function simulateV4Launch(
  client: PublicClient,
  input: V4LaunchInput,
  airlockOwner: Address,
) {
  const walletClient = createWalletClient({
    account: getAddress(input.creator),
    chain: robinhood,
    transport: http(rpcUrl(), { timeout: 12_000 }),
  });
  const sdk = new DopplerSDK({
    publicClient: client,
    walletClient,
    chainId: product.network.chainId,
  });
  const price = await readV4PriceSnapshot(client);
  const latest = await client.getBlock();
  const params = buildV4LaunchParams(
    sdk,
    input,
    airlockOwner,
    price.hoodieUsdNumber,
    Number(latest.timestamp),
  );
  const simulation = await sdk.factory.simulateCreateMulticurve(params);
  const calldata = encodeFunctionData({
    abi: airlockAbi,
    functionName: "create",
    args: [simulation.createParams],
  });
  return {
    asset: simulation.tokenAddress,
    pool: simulation.poolId,
    gasEstimate: simulation.gasEstimate,
    calldata,
    createParams: simulation.createParams,
    price,
  };
}
