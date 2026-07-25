import {
  DopplerSDK,
  computePoolId,
  getAddresses,
  type V4PoolKey,
} from "@whetstone-research/doppler-sdk/evm";
import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  getAddress,
  maxUint256,
  parseAbi,
  parseAbiParameters,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import product from "../../config/hoodiepad-v1.json";
import v2Product from "../../config/hoodiepad-v2.json";
import { readHoodiePadMarket } from "./market";
import {
  readVersionedHoodiePadMarket,
  type HoodiePadV4Market,
} from "./market-v4";
import {
  createRobinhoodPublicClient,
  ROBINHOOD_CHAIN_ID,
} from "./protocol";

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
const swapRouter02Abi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)",
]);
const permit2AllowanceAbi = parseAbi([
  "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
const universalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
const v4RouterInputParameters = parseAbiParameters(
  "bytes actions,bytes[] params",
);
// Robinhood uses Universal Router 2.1.1. Each swap action takes one dynamic
// struct, so its payload must begin with the ABI tuple offset (0x20). The
// deployed router also includes the v2.1.1 per-hop price fields; keep these
// layouts aligned with the reviewed runtime snapshot.
const v4ExactInputSingleParameters = parseAbiParameters(
  "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) swap",
);
const v4ExactInputParameters = parseAbiParameters(
  "(address currencyIn,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint256[] minHopPriceX36,uint128 amountIn,uint128 amountOutMinimum) swap",
);
const v4SettleAllParameters = parseAbiParameters(
  "address currency,uint256 maxAmount",
);
const v4SettleParameters = parseAbiParameters(
  "address currency,uint256 amount,bool payerIsUser",
);
const v4TakeParameters = parseAbiParameters(
  "address currency,address recipient,uint256 amount",
);
const v4TakeAllParameters = parseAbiParameters(
  "address currency,uint256 minAmount",
);
const wrapOrUnwrapParameters = parseAbiParameters(
  "address recipient,uint256 amount",
);

const UNIVERSAL_ROUTER_V4_SWAP = "0x10" as Hex;
const UNIVERSAL_ROUTER_WRAP_ETH = "0x0b" as Hex;
const UNIVERSAL_ROUTER_UNWRAP_WETH = "0x0c" as Hex;
const V4_ACTION_SWAP_EXACT_IN_SINGLE = "0x06" as Hex;
const V4_ACTION_SWAP_EXACT_IN = "0x07" as Hex;
const V4_ACTION_SETTLE = "0x0b" as Hex;
const V4_ACTION_SETTLE_ALL = "0x0c" as Hex;
const V4_ACTION_TAKE = "0x0e" as Hex;
const V4_ACTION_TAKE_ALL = "0x0f" as Hex;
const UNIVERSAL_ROUTER_ADDRESS_THIS =
  "0x0000000000000000000000000000000000000002" as Address;
const UNIVERSAL_ROUTER_MSG_SENDER =
  "0x0000000000000000000000000000000000000001" as Address;
const V4_OPEN_DELTA = 0n;

export type SwapSide = "buy" | "sell";

export type PreparedWalletTransaction = {
  kind: "token-approval" | "permit2-approval" | "swap";
  label: string;
  from: Address;
  to: Address;
  data: Hex;
  gasLimit?: string;
  value: Hex;
};

export type PreparedSwap = {
  token: Address;
  pool: string;
  side: SwapSide;
  inputToken: Address;
  outputToken: Address;
  inputSymbol: string;
  outputSymbol: string;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minimumOut: string;
  minimumOutFormatted: string;
  slippageBps: number;
  priceImpactTicks: number;
  priceImpactPercent: number | null;
  inputBalanceFormatted: string;
  approvalTransactions: PreparedWalletTransaction[];
  swapTransaction: PreparedWalletTransaction | null;
  simulationPassed: boolean;
  expiresAt: string;
};

export class SwapPreparationError extends Error {
  code: "MAX_WALLET" | "TRADE_SIZE" | "QUOTE_UNAVAILABLE";
  maximumAmount?: string;
  inputSymbol?: string;

  constructor(
    message: string,
    input: {
      code: SwapPreparationError["code"];
      maximumAmount?: string;
      inputSymbol?: string;
    },
  ) {
    super(message);
    this.name = "SwapPreparationError";
    this.code = input.code;
    this.maximumAmount = input.maximumAmount;
    this.inputSymbol = input.inputSymbol;
  }
}

function isQuoterRevert(error: unknown) {
  return error instanceof Error &&
    error.message.toLowerCase().includes("revert");
}

function formattedMaximumInput(raw: bigint) {
  const conservative = raw * 995n / 1_000n;
  return formatUnits(conservative > 0n ? conservative : raw, 18);
}

export function routerDeploymentMatches(input: {
  code: Hex | undefined;
  factory: Address;
  weth: Address;
  expectedFactory: Address;
  expectedWeth: Address;
}) {
  return !!input.code &&
    input.code !== "0x" &&
    input.factory.toLowerCase() === input.expectedFactory.toLowerCase() &&
    input.weth.toLowerCase() === input.expectedWeth.toLowerCase();
}

export function estimateMaxInputAtSpot(input: {
  childBalance: bigint;
  maxBalance: bigint;
  hoodiePerToken: string;
}) {
  if (input.childBalance >= input.maxBalance) return 0n;
  const normalizedPrice = input.hoodiePerToken.replaceAll(",", "");
  if (normalizedPrice === "Unavailable") return null;
  try {
    const price = parseUnits(normalizedPrice, 18);
    return (input.maxBalance - input.childBalance) * price / 10n ** 18n;
  } catch {
    return null;
  }
}

export function encodeV3ExactInputSwap(input: {
  recipient: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minimumOut: bigint;
  fee: number;
  deadline: bigint;
}) {
  const exactInput = encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      fee: input.fee,
      recipient: input.recipient,
      amountIn: input.amountIn,
      amountOutMinimum: input.minimumOut,
      sqrtPriceLimitX96: 0n,
    }],
  });
  return encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: "multicall",
    args: [input.deadline, [exactInput]],
  });
}

function poolKeyTuple(poolKey: V4PoolKey) {
  return {
    currency0: getAddress(poolKey.currency0),
    currency1: getAddress(poolKey.currency1),
    fee: poolKey.fee,
    tickSpacing: poolKey.tickSpacing,
    hooks: getAddress(poolKey.hooks),
  };
}

function pathKeyForOutput(poolKey: V4PoolKey, outputCurrency: Address) {
  const output = getAddress(outputCurrency);
  const currency0 = getAddress(poolKey.currency0);
  const currency1 = getAddress(poolKey.currency1);
  if (
    output.toLowerCase() !== currency0.toLowerCase() &&
    output.toLowerCase() !== currency1.toLowerCase()
  ) {
    throw new Error("V4 PoolKey does not contain the requested output currency");
  }
  return {
    intermediateCurrency: output,
    fee: poolKey.fee,
    tickSpacing: poolKey.tickSpacing,
    hooks: getAddress(poolKey.hooks),
    hookData: "0x" as Hex,
  };
}

export function encodeV4ExactInputSwap(input: {
  poolKey: V4PoolKey;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minimumOut: bigint;
  deadline: bigint;
}) {
  const currency0 = getAddress(input.poolKey.currency0);
  const zeroForOne =
    getAddress(input.tokenIn).toLowerCase() === currency0.toLowerCase();
  const expectedOutput = zeroForOne
    ? getAddress(input.poolKey.currency1)
    : currency0;
  if (expectedOutput.toLowerCase() !== getAddress(input.tokenOut).toLowerCase()) {
    throw new Error("V4 PoolKey does not match the requested swap direction");
  }
  const actions = concatHex([
    V4_ACTION_SWAP_EXACT_IN_SINGLE,
    V4_ACTION_SETTLE_ALL,
    V4_ACTION_TAKE_ALL,
  ]);
  const actionInputs = [
    encodeAbiParameters(v4ExactInputSingleParameters, [
      {
        poolKey: poolKeyTuple(input.poolKey),
        zeroForOne,
        amountIn: input.amountIn,
        amountOutMinimum: input.minimumOut,
        minHopPriceX36: 0n,
        hookData: "0x",
      },
    ]),
    encodeAbiParameters(v4SettleAllParameters, [
      getAddress(input.tokenIn),
      maxUint256,
    ]),
    encodeAbiParameters(v4TakeAllParameters, [
      getAddress(input.tokenOut),
      0n,
    ]),
  ];
  const v4Input = encodeAbiParameters(v4RouterInputParameters, [
    actions,
    actionInputs,
  ]);
  return encodeFunctionData({
    abi: universalRouterAbi,
    functionName: "execute",
    args: [UNIVERSAL_ROUTER_V4_SWAP, [v4Input], input.deadline],
  });
}

export function encodeV4EthToChildSwap(input: {
  referencePoolKey: V4PoolKey;
  childPoolKey: V4PoolKey;
  weth: Address;
  hoodie: Address;
  child: Address;
  amountIn: bigint;
  minimumOut: bigint;
  deadline: bigint;
}) {
  const weth = getAddress(input.weth);
  const hoodie = getAddress(input.hoodie);
  const child = getAddress(input.child);
  const referencePoolId = computePoolId(input.referencePoolKey);
  const childPoolId = computePoolId(input.childPoolKey);
  if (referencePoolId === childPoolId) {
    throw new Error("Reference and child V4 pools must be distinct");
  }
  const path = [
    pathKeyForOutput(input.referencePoolKey, hoodie),
    pathKeyForOutput(input.childPoolKey, child),
  ];
  const actions = concatHex([
    V4_ACTION_SWAP_EXACT_IN,
    V4_ACTION_SETTLE,
    V4_ACTION_TAKE_ALL,
  ]);
  const v4Input = encodeAbiParameters(v4RouterInputParameters, [
    actions,
    [
      encodeAbiParameters(v4ExactInputParameters, [
        {
          currencyIn: weth,
          path,
          minHopPriceX36: [],
          amountIn: input.amountIn,
          amountOutMinimum: input.minimumOut,
        },
      ]),
      encodeAbiParameters(v4SettleParameters, [
        weth,
        input.amountIn,
        false,
      ]),
      encodeAbiParameters(v4TakeAllParameters, [
        child,
        0n,
      ]),
    ],
  ]);
  return encodeFunctionData({
    abi: universalRouterAbi,
    functionName: "execute",
    args: [
      concatHex([UNIVERSAL_ROUTER_WRAP_ETH, UNIVERSAL_ROUTER_V4_SWAP]),
      [
        encodeAbiParameters(wrapOrUnwrapParameters, [
          UNIVERSAL_ROUTER_ADDRESS_THIS,
          input.amountIn,
        ]),
        v4Input,
      ],
      input.deadline,
    ],
  });
}

export function encodeV4ChildToEthSwap(input: {
  childPoolKey: V4PoolKey;
  referencePoolKey: V4PoolKey;
  child: Address;
  hoodie: Address;
  weth: Address;
  amountIn: bigint;
  minimumOut: bigint;
  deadline: bigint;
}) {
  const child = getAddress(input.child);
  const hoodie = getAddress(input.hoodie);
  const weth = getAddress(input.weth);
  const path = [
    pathKeyForOutput(input.childPoolKey, hoodie),
    pathKeyForOutput(input.referencePoolKey, weth),
  ];
  const actions = concatHex([
    V4_ACTION_SWAP_EXACT_IN,
    V4_ACTION_SETTLE_ALL,
    V4_ACTION_TAKE,
  ]);
  const v4Input = encodeAbiParameters(v4RouterInputParameters, [
    actions,
    [
      encodeAbiParameters(v4ExactInputParameters, [
        {
          currencyIn: child,
          path,
          minHopPriceX36: [],
          amountIn: input.amountIn,
          amountOutMinimum: input.minimumOut,
        },
      ]),
      encodeAbiParameters(v4SettleAllParameters, [
        child,
        maxUint256,
      ]),
      encodeAbiParameters(v4TakeParameters, [
        weth,
        UNIVERSAL_ROUTER_ADDRESS_THIS,
        V4_OPEN_DELTA,
      ]),
    ],
  ]);
  return encodeFunctionData({
    abi: universalRouterAbi,
    functionName: "execute",
    args: [
      concatHex([UNIVERSAL_ROUTER_V4_SWAP, UNIVERSAL_ROUTER_UNWRAP_WETH]),
      [
        v4Input,
        encodeAbiParameters(wrapOrUnwrapParameters, [
          UNIVERSAL_ROUTER_MSG_SENDER,
          input.minimumOut,
        ]),
      ],
      input.deadline,
    ],
  });
}

async function prepareV4Swap(input: {
  market: HoodiePadV4Market;
  account: Address;
  side: SwapSide;
  amount: string;
  slippageBps: number;
}): Promise<PreparedSwap> {
  const { market, account } = input;
  if (!market.official) {
    throw new Error(
      `This V4 market failed HoodiePad validation: ${market.validationErrors.join(", ")}`,
    );
  }
  const client = createRobinhoodPublicClient();
  const token = getAddress(market.address);
  const hoodie = getAddress(v2Product.contracts.hoodie);
  const inputToken = input.side === "buy" ? hoodie : token;
  const outputToken = input.side === "buy" ? token : hoodie;
  const inputSymbol = input.side === "buy" ? "HOODIE" : market.symbol;
  const outputSymbol = input.side === "buy" ? market.symbol : "HOODIE";
  const amountIn = parseUnits(input.amount, 18);
  if (amountIn <= 0n || amountIn > 2n ** 128n - 1n) {
    throw new Error("Swap amount is outside the supported V4 range");
  }
  const poolKey = market.poolKey;
  if (computePoolId(poolKey).toLowerCase() !== market.poolId.toLowerCase()) {
    throw new Error("Canonical V4 PoolId does not match its PoolKey");
  }
  const zeroForOne =
    inputToken.toLowerCase() === poolKey.currency0.toLowerCase();
  const sdk = new DopplerSDK({
    publicClient: client,
    chainId: ROBINHOOD_CHAIN_ID,
  });
  const quote = await sdk.quoter.quoteExactInputV4Quoter({
      poolKey,
      zeroForOne,
      exactAmount: amountIn,
      hookData: "0x",
  }).catch(() => {
    throw new SwapPreparationError(
      "The canonical V4 pool cannot quote this trade. Try a smaller amount.",
      { code: "QUOTE_UNAVAILABLE", inputSymbol },
    );
  });
  const amountOut = quote.amountOut;
  if (
    input.side === "buy" &&
    market.balanceLimitActive
  ) {
    const childBalance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    });
    if (childBalance + amountOut > BigInt(market.maxBalanceRaw)) {
      throw new SwapPreparationError(
        "This buy would exceed the active 2% maximum-wallet limit.",
        { code: "MAX_WALLET", inputSymbol },
      );
    }
  }
  const minimumOut =
    amountOut * BigInt(10_000 - input.slippageBps) / 10_000n;
  const router = getAddress(v2Product.contracts.uniswapUniversalRouter);
  const permit2 = getAddress(v2Product.contracts.permit2);
  const now = Math.floor(Date.now() / 1_000);
  const deadline = BigInt(now + 20 * 60);
  const approvalExpiration = now + 20 * 60;
  const [inputBalance, tokenAllowance, permitAllowance] = await Promise.all([
    client.readContract({
      address: inputToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }),
    client.readContract({
      address: inputToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, permit2],
    }),
    client.readContract({
      address: permit2,
      abi: permit2AllowanceAbi,
      functionName: "allowance",
      args: [account, inputToken, router],
    }),
  ]);
  if (inputBalance < amountIn) {
    throw new Error(`Insufficient ${inputSymbol} balance`);
  }
  const approvalTransactions: PreparedWalletTransaction[] = [];
  if (tokenAllowance < amountIn) {
    approvalTransactions.push({
      kind: "token-approval",
      label: `Approve exact ${inputSymbol} input for Permit2`,
      from: account,
      to: inputToken,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [permit2, amountIn],
      }),
      value: "0x0",
    });
  } else if (
    permitAllowance[0] < amountIn ||
    Number(permitAllowance[1]) <= now
  ) {
    approvalTransactions.push({
      kind: "permit2-approval",
      label: `Authorize exact ${inputSymbol} input for 20 minutes`,
      from: account,
      to: permit2,
      data: encodeFunctionData({
        abi: permit2AllowanceAbi,
        functionName: "approve",
        args: [inputToken, router, amountIn, approvalExpiration],
      }),
      value: "0x0",
    });
  }
  const swapData = encodeV4ExactInputSwap({
    poolKey,
    tokenIn: inputToken,
    tokenOut: outputToken,
    amountIn,
    minimumOut,
    deadline,
  });
  let swapTransaction: PreparedWalletTransaction | null = null;
  if (approvalTransactions.length === 0) {
    let gasEstimate: bigint;
    try {
      gasEstimate = await client.estimateGas({
        account,
        to: router,
        data: swapData,
      });
    } catch {
      throw new SwapPreparationError(
        "The direct Uniswap V4 swap did not simulate. Try a smaller amount.",
        { code: "QUOTE_UNAVAILABLE", inputSymbol },
      );
    }
    swapTransaction = {
      kind: "swap",
      label: `Swap ${inputSymbol} for ${outputSymbol}`,
      from: account,
      to: router,
      data: swapData,
      gasLimit: (gasEstimate * 120n / 100n).toString(),
      value: "0x0",
    };
  }
  const inputValue = Number(formatUnits(amountIn, 18));
  const outputValue = Number(formatUnits(amountOut, 18));
  const spotPrice = Number(market.hoodiePerToken.replaceAll(",", ""));
  const executionPrice = input.side === "buy"
    ? inputValue / outputValue
    : outputValue / inputValue;
  const priceImpactPercent =
    Number.isFinite(executionPrice) && Number.isFinite(spotPrice) && spotPrice > 0
      ? Math.abs((executionPrice / spotPrice) - 1) * 100
      : null;
  return {
    token,
    pool: market.poolId,
    side: input.side,
    inputToken,
    outputToken,
    inputSymbol,
    outputSymbol,
    amountIn: amountIn.toString(),
    amountInFormatted: formatUnits(amountIn, 18),
    amountOut: amountOut.toString(),
    amountOutFormatted: formatUnits(amountOut, 18),
    minimumOut: minimumOut.toString(),
    minimumOutFormatted: formatUnits(minimumOut, 18),
    slippageBps: input.slippageBps,
    priceImpactTicks: 0,
    priceImpactPercent,
    inputBalanceFormatted: formatUnits(inputBalance, 18),
    approvalTransactions,
    swapTransaction,
    simulationPassed: swapTransaction !== null,
    expiresAt: new Date(Number(deadline) * 1_000).toISOString(),
  };
}

export async function prepareHoodiePadSwap(input: {
  token: string;
  account: string;
  side: SwapSide;
  amount: string;
  slippageBps: number;
}): Promise<PreparedSwap> {
  const account = getAddress(input.account);
  const token = getAddress(input.token);
  if (input.side !== "buy" && input.side !== "sell") {
    throw new Error("Choose buy or sell");
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d{0,18})?$/.test(input.amount.trim())) {
    throw new Error("Enter a valid token amount");
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 25 || input.slippageBps > 500) {
    throw new Error("Slippage must be between 0.25% and 5%");
  }

  const client = createRobinhoodPublicClient();
  const versionedMarket = await readVersionedHoodiePadMarket(token, client);
  if (
    versionedMarket.version === "doppler-multicurve-v4-v2" &&
    "poolKey" in versionedMarket
  ) {
    return prepareV4Swap({
      market: versionedMarket as HoodiePadV4Market,
      account,
      side: input.side,
      amount: input.amount,
      slippageBps: input.slippageBps,
    });
  }
  const market = await readHoodiePadMarket(token, client);
  if (!market.official) throw new Error("This is not an official HoodiePad market");

  const hoodie = getAddress(product.contracts.hoodie);
  const inputToken = input.side === "buy" ? hoodie : token;
  const outputToken = input.side === "buy" ? token : hoodie;
  const inputSymbol = input.side === "buy" ? "HOODIE" : market.symbol;
  const outputSymbol = input.side === "buy" ? market.symbol : "HOODIE";
  const amountIn = parseUnits(input.amount, 18);
  if (amountIn <= 0n || amountIn > 2n ** 160n - 1n) {
    throw new Error("Swap amount is outside the supported range");
  }

  const addresses = getAddresses(ROBINHOOD_CHAIN_ID);
  const swapRouter = getAddress(product.contracts.uniswapSwapRouter02);
  const expectedV3Factory = getAddress(product.contracts.uniswapV3Factory);
  const expectedWeth = getAddress(product.contracts.weth);
  const sdkV3Factory = addresses.uniswapV3Factory
    ? getAddress(addresses.uniswapV3Factory)
    : undefined;
  const sdkV2Factory = addresses.uniswapV2Factory
    ? getAddress(addresses.uniswapV2Factory)
    : undefined;
  if (
    !sdkV3Factory ||
    !sdkV2Factory ||
    addresses.v3Quoter.toLowerCase() !== product.contracts.uniswapV3Quoter.toLowerCase() ||
    sdkV3Factory.toLowerCase() !== expectedV3Factory.toLowerCase() ||
    addresses.weth.toLowerCase() !== expectedWeth.toLowerCase() ||
    swapRouter.toLowerCase() === sdkV2Factory.toLowerCase()
  ) {
    throw new Error("Pinned swap dependency addresses do not match the HoodiePad configuration");
  }

  const sdk = new DopplerSDK({
    publicClient: client,
    chainId: ROBINHOOD_CHAIN_ID,
  });
  const [
    inputBalance,
    childBalance,
    tokenAllowance,
    routerCode,
    routerFactory,
    routerWeth,
  ] =
    await Promise.all([
      client.readContract({
        address: inputToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      }),
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      }),
      client.readContract({
        address: inputToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, swapRouter],
      }),
      client.getCode({ address: swapRouter }),
      client.readContract({
        address: swapRouter,
        abi: swapRouter02Abi,
        functionName: "factory",
      }),
      client.readContract({
        address: swapRouter,
        abi: swapRouter02Abi,
        functionName: "WETH9",
      }),
    ]);

  if (!routerDeploymentMatches({
    code: routerCode,
    factory: routerFactory,
    weth: routerWeth,
    expectedFactory: expectedV3Factory,
    expectedWeth,
  })) {
    throw new Error("The pinned Robinhood SwapRouter02 deployment failed identity verification");
  }

  if (inputBalance < amountIn) {
    throw new Error(`Insufficient ${inputSymbol} balance`);
  }

  if (input.side === "buy" && market.balanceLimitActive) {
    const spotMaximum = estimateMaxInputAtSpot({
      childBalance,
      maxBalance: BigInt(market.maxBalanceRaw),
      hoodiePerToken: market.hoodiePerToken,
    });
    if (spotMaximum !== null && amountIn > spotMaximum) {
      const maximumAmount = formattedMaximumInput(spotMaximum);
      throw new SwapPreparationError(
        spotMaximum === 0n
          ? "This wallet has reached the active 2% maximum-wallet limit."
          : `This buy would exceed the active 2% maximum-wallet limit. Try at most about ${maximumAmount} HOODIE.`,
        {
          code: "MAX_WALLET",
          maximumAmount: spotMaximum > 0n ? maximumAmount : undefined,
          inputSymbol,
        },
      );
    }
  }

  const quoteExactInput = (candidateAmount: bigint) =>
    sdk.quoter.quoteExactInputV3({
      tokenIn: inputToken,
      tokenOut: outputToken,
      amountIn: candidateAmount,
      fee: product.pool.fee,
    });

  let quote: Awaited<ReturnType<typeof quoteExactInput>>;
  try {
    quote = await quoteExactInput(amountIn);
  } catch (error) {
    if (!isQuoterRevert(error)) throw error;

    let quoteableAmount = amountIn / 2n;
    let quoteable = false;
    for (let attempt = 0; attempt < 10 && quoteableAmount > 0n; attempt += 1) {
      try {
        await quoteExactInput(quoteableAmount);
        quoteable = true;
        break;
      } catch (probeError) {
        if (!isQuoterRevert(probeError)) throw probeError;
        quoteableAmount /= 2n;
      }
    }
    if (!quoteable || quoteableAmount <= 0n) {
      throw new SwapPreparationError(
        "The canonical pool cannot quote this trade right now. Try a smaller amount or use the Uniswap pool link.",
        { code: "QUOTE_UNAVAILABLE", inputSymbol },
      );
    }

    let lower = quoteableAmount;
    let upper = amountIn;
    for (let attempt = 0; attempt < 8 && upper - lower > 1n; attempt += 1) {
      const candidate = (lower + upper) / 2n;
      try {
        await quoteExactInput(candidate);
        lower = candidate;
      } catch (probeError) {
        if (!isQuoterRevert(probeError)) throw probeError;
        upper = candidate;
      }
    }
    const maximumAmount = formattedMaximumInput(lower);
    throw new SwapPreparationError(
      `This trade reaches the available curve boundary. Try at most about ${maximumAmount} ${inputSymbol}.`,
      {
        code: "TRADE_SIZE",
        maximumAmount,
        inputSymbol,
      },
    );
  }

  if (
    input.side === "buy" &&
    market.balanceLimitActive &&
    childBalance + quote.amountOut > BigInt(market.maxBalanceRaw)
  ) {
    const remaining = BigInt(market.maxBalanceRaw) - childBalance;
    const maximumRaw = remaining > 0n
      ? amountIn * remaining / quote.amountOut
      : 0n;
    const maximumAmount = formattedMaximumInput(maximumRaw);
    throw new SwapPreparationError(
      maximumRaw === 0n
        ? "This wallet has reached the active 2% maximum-wallet limit."
        : `This buy would exceed the active 2% maximum-wallet limit. Try at most about ${maximumAmount} HOODIE.`,
      {
        code: "MAX_WALLET",
        maximumAmount: maximumRaw > 0n ? maximumAmount : undefined,
        inputSymbol,
      },
    );
  }

  const minimumOut =
    quote.amountOut * BigInt(10_000 - input.slippageBps) / 10_000n;
  const inputValue = Number(formatUnits(amountIn, 18));
  const outputValue = Number(formatUnits(quote.amountOut, 18));
  const spotPrice = Number(market.hoodiePerToken.replaceAll(",", ""));
  const executionPrice = input.side === "buy"
    ? inputValue / outputValue
    : outputValue / inputValue;
  const priceImpactPercent =
    Number.isFinite(executionPrice) && Number.isFinite(spotPrice) && spotPrice > 0
      ? Math.abs((executionPrice / spotPrice) - 1) * 100
      : null;
  const now = Math.floor(Date.now() / 1000);
  const deadline = BigInt(now + 20 * 60);
  const approvalTransactions: PreparedWalletTransaction[] = [];

  if (tokenAllowance < amountIn) {
    approvalTransactions.push({
      kind: "token-approval",
      label: `Approve exact ${inputSymbol} input`,
      from: account,
      to: inputToken,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [swapRouter, amountIn],
      }),
      value: "0x0",
    });
  }

  const swapData = encodeV3ExactInputSwap({
    recipient: account,
    tokenIn: inputToken,
    tokenOut: outputToken,
    amountIn,
    minimumOut,
    fee: product.pool.fee,
    deadline,
  });
  let swapTransaction: PreparedWalletTransaction | null = null;
  if (approvalTransactions.length === 0) {
    let gasEstimate: bigint;
    try {
      gasEstimate = await client.estimateGas({
        account,
        to: swapRouter,
        data: swapData,
      });
    } catch {
      throw new SwapPreparationError(
        "The direct Uniswap V3 swap did not simulate. Try a smaller amount or use the canonical pool link.",
        { code: "QUOTE_UNAVAILABLE", inputSymbol },
      );
    }
    swapTransaction = {
      kind: "swap",
      label: `Swap ${inputSymbol} for ${outputSymbol}`,
      from: account,
      to: swapRouter,
      data: swapData,
      gasLimit: (gasEstimate * 120n / 100n).toString(),
      value: "0x0",
    };
  }

  return {
    token,
    pool: market.pool,
    side: input.side,
    inputToken,
    outputToken,
    inputSymbol,
    outputSymbol,
    amountIn: amountIn.toString(),
    amountInFormatted: formatUnits(amountIn, 18),
    amountOut: quote.amountOut.toString(),
    amountOutFormatted: formatUnits(quote.amountOut, 18),
    minimumOut: minimumOut.toString(),
    minimumOutFormatted: formatUnits(minimumOut, 18),
    slippageBps: input.slippageBps,
    priceImpactTicks: quote.initializedTicksCrossed,
    priceImpactPercent,
    inputBalanceFormatted: formatUnits(inputBalance, 18),
    approvalTransactions,
    swapTransaction,
    simulationPassed: swapTransaction !== null,
    expiresAt: new Date(Number(deadline) * 1000).toISOString(),
  };
}
