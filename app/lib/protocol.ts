import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import {
  DopplerSDK,
  StaticAuctionBuilder,
  airlockAbi,
  getAirlockOwner,
  isToken0Expected,
  type CreateStaticAuctionParams,
} from "@whetstone-research/doppler-sdk/evm";
import product from "../../config/hoodiepad-v1.json";
import { isCalibrationReportApproved } from "./calibration";

export type ChainStatus = {
  available: boolean;
  checkedAt: string;
  error?: string;
  chainId?: number;
  blockNumber?: string;
  airlockOwner?: Address;
  referencePool?: {
    poolId: Hex;
    tick: number;
    sqrtPriceX96: string;
    liquidity: string;
    lpFee: number;
    protocolFee: number;
    hoodiePerWeth: string;
  };
  dependencies?: Record<string, {
    address: Address;
    hasCode: boolean;
    runtimeHash?: Hex;
    expectedRuntimeHash: Hex;
    matchesExpectedHash: boolean;
    byteLength: number;
  }>;
};

export type LaunchSimulation = {
  status: "simulated" | "unavailable";
  error?: string;
  asset?: Address;
  pool?: Address;
  gasEstimate?: string;
  calldata?: Hex;
  airlock?: Address;
  airlockOwner?: Address;
  curve?: {
    startTick: number;
    endTick: number;
    referenceTick: number;
    tickSpacing: number;
    status: string;
  };
};

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

export const ROBINHOOD_CHAIN_ID = 4663 as const;

export const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: product.network.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [product.network.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: product.network.explorerUrl } },
});

function asAddress(value: string) {
  return value as Address;
}

function rpcUrl() {
  const explicit = process.env.ROBINHOOD_RPC_URL?.trim();
  if (explicit) return explicit;
  const alchemyKey = process.env.Alchemy_API_KEY?.trim();
  if (alchemyKey) return `https://robinhood-mainnet.g.alchemy.com/v2/${alchemyKey}`;
  return "";
}

export function hasConfiguredRpc() {
  return rpcUrl().length > 0;
}

export function createRobinhoodPublicClient() {
  const url = rpcUrl();
  if (!url) throw new Error("Robinhood RPC is not configured");
  return createPublicClient({ chain: robinhood, transport: http(url, { timeout: 12_000 }) });
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "Unknown chain error";
  const message = error.message.split("\n")[0].trim();
  return message.replace(/https?:\/\/[^\s]+/g, "[redacted RPC]");
}

function decimalString(value: number, maximumFractionDigits = 4) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    useGrouping: false,
  }).format(value);
}

function alignTick(tick: number, spacing: number) {
  const aligned = Math.round(tick / spacing) * spacing;
  return Object.is(aligned, -0) ? 0 : aligned;
}

export type HoodieCurveTokenOrdering =
  | "child-token0-hoodie-token1"
  | "hoodie-token0-child-token1";

export function deriveHoodieCurveForOrdering(
  referenceTick: number,
  ordering: HoodieCurveTokenOrdering,
) {
  const spacing = product.pool.tickSpacing;
  const childIsToken0 = ordering === "child-token0-hoodie-token1";
  const rawStartTick = childIsToken0
    ? referenceTick - product.pool.referenceEndTickWeth
    : product.pool.referenceStartTickWeth - referenceTick;
  const rawEndTick = childIsToken0
    ? referenceTick - product.pool.referenceStartTickWeth
    : product.pool.referenceEndTickWeth - referenceTick;
  const startTick = alignTick(rawStartTick, spacing);
  const endTick = alignTick(rawEndTick, spacing);

  if (startTick >= endTick) {
    throw new Error(`Invalid HoodiePad curve after ${ordering} tick normalization`);
  }

  return {
    startTick,
    endTick,
    referenceTick,
    tickSpacing: spacing,
    status: isCalibrationReportApproved() ? "calibrated" : product.pool.curveStatus,
  };
}

export function deriveHoodieCurve(referenceTick: number) {
  if (product.pool.tokenOrdering !== "child-token0-hoodie-token1") {
    throw new Error(`Unsupported HoodiePad V1 token ordering: ${product.pool.tokenOrdering}`);
  }
  return deriveHoodieCurveForOrdering(referenceTick, product.pool.tokenOrdering);
}

export function getBeneficiaryConflict(creator: Address, protocolOwner?: Address) {
  const normalizedCreator = creator.toLowerCase();
  if (normalizedCreator === product.contracts.hoodieEcosystemSafe.toLowerCase()) {
    return "Creator wallet must be different from the HOODIE ecosystem Safe";
  }
  if (protocolOwner && normalizedCreator === protocolOwner.toLowerCase()) {
    return "Creator wallet must be different from the Doppler protocol beneficiary";
  }
  return undefined;
}

const dependencyEntries = {
  hoodie: product.contracts.hoodie,
  airlock: product.contracts.airlock,
  dopplerERC20V1Factory: product.contracts.dopplerERC20V1Factory,
  lockableV3Initializer: product.contracts.lockableV3Initializer,
  noOpGovernanceFactory: product.contracts.noOpGovernanceFactory,
  noOpMigrator: product.contracts.noOpMigrator,
  uniswapV4PoolManager: product.contracts.uniswapV4PoolManager,
  uniswapV4StateView: product.contracts.uniswapV4StateView,
  uniswapUniversalRouter: product.contracts.uniswapUniversalRouter,
} as const;

export function runtimeHashMatches(actual: Hex | undefined, expected: Hex) {
  return actual?.toLowerCase() === expected.toLowerCase();
}

export async function readChainStatus(): Promise<ChainStatus> {
  try {
    return await inspectRobinhoodChain(createRobinhoodPublicClient());
  } catch (error) {
    return { available: false, checkedAt: new Date().toISOString(), error: safeError(error) };
  }
}

export async function inspectRobinhoodChain(
  client: ReturnType<typeof createRobinhoodPublicClient>,
): Promise<ChainStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const poolId = product.hoodieReferencePool.poolId as Hex;
    const addresses = Object.values(dependencyEntries).map(asAddress);
    const [chainId, blockNumber, slot0, liquidity, airlockOwner, ...codes] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      client.readContract({
        address: asAddress(product.contracts.uniswapV4StateView),
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [poolId],
      }),
      client.readContract({
        address: asAddress(product.contracts.uniswapV4StateView),
        abi: stateViewAbi,
        functionName: "getLiquidity",
        args: [poolId],
      }),
      getAirlockOwner(client),
      ...addresses.map((address) => client.getCode({ address })),
    ]);

    if (chainId !== product.network.chainId) {
      throw new Error(`RPC returned chain ${chainId}; expected ${product.network.chainId}`);
    }

    const dependencies = Object.fromEntries(
      Object.entries(dependencyEntries).map(([name, address], index) => {
        const code = codes[index] ?? "0x";
        const hasCode = code !== "0x";
        const runtimeHash = hasCode ? keccak256(code) : undefined;
        const expectedRuntimeHash =
          product.runtimeHashSnapshot.hashes[
            name as keyof typeof product.runtimeHashSnapshot.hashes
          ] as Hex;
        return [name, {
          address: asAddress(address),
          hasCode,
          runtimeHash,
          expectedRuntimeHash,
          matchesExpectedHash: runtimeHashMatches(runtimeHash, expectedRuntimeHash),
          byteLength: Math.max(0, (code.length - 2) / 2),
        }];
      }),
    );

    const hoodiePerWeth = Math.pow(1.0001, Number(slot0[1]));
    return {
      available: true,
      checkedAt,
      chainId,
      blockNumber: blockNumber.toString(),
      airlockOwner,
      referencePool: {
        poolId,
        tick: Number(slot0[1]),
        sqrtPriceX96: slot0[0].toString(),
        liquidity: liquidity.toString(),
        protocolFee: Number(slot0[2]),
        lpFee: Number(slot0[3]),
        hoodiePerWeth: decimalString(hoodiePerWeth, 2),
      },
      dependencies,
    };
  } catch (error) {
    return { available: false, checkedAt, error: safeError(error) };
  }
}

export type SimulateLaunchInput = {
  name: string;
  symbol: string;
  tokenURI: string;
  creator: Address;
  chainStatus?: ChainStatus;
};

export function buildStaticLaunchParams(
  input: SimulateLaunchInput,
  chainStatus: ChainStatus,
  launchTimestamp = Math.floor(Date.now() / 1000),
): {
  params: CreateStaticAuctionParams<typeof ROBINHOOD_CHAIN_ID>;
  curve: ReturnType<typeof deriveHoodieCurve>;
} {
  if (!chainStatus.available || !chainStatus.referencePool || !chainStatus.airlockOwner) {
    throw new Error(chainStatus.error ?? "Live Robinhood verification is unavailable");
  }
  if (Object.values(chainStatus.dependencies ?? {}).some((item) => !item.matchesExpectedHash)) {
    throw new Error("One or more canonical dependencies do not match the approved runtime hash snapshot");
  }
  if (!isToken0Expected(asAddress(product.contracts.hoodie))) {
    throw new Error("Pinned Doppler SDK no longer mines the child token as token0 for HOODIE");
  }
  const beneficiaryConflict = getBeneficiaryConflict(input.creator, chainStatus.airlockOwner);
  if (beneficiaryConflict) throw new Error(beneficiaryConflict);

  const curve = deriveHoodieCurve(chainStatus.referencePool.tick);
  const beneficiaries = [
    { beneficiary: input.creator, shares: BigInt(product.fees.creator) },
    {
      beneficiary: asAddress(product.contracts.hoodieEcosystemSafe),
      shares: BigInt(product.fees.hoodieEcosystem),
    },
    { beneficiary: chainStatus.airlockOwner, shares: BigInt(product.fees.doppler) },
  ];
  const totalShares = beneficiaries.reduce((sum, item) => sum + item.shares, BigInt(0));
  if (totalShares !== BigInt(product.fees.wad)) throw new Error("Fee shares do not sum to WAD");

  const params = new StaticAuctionBuilder(ROBINHOOD_CHAIN_ID)
    .tokenConfig({
      type: "dopplerERC20V1",
      name: input.name,
      symbol: input.symbol,
      tokenURI: input.tokenURI,
      maxBalanceLimit: parseEther(product.token.maxWalletTokens),
      balanceLimitEnd: launchTimestamp + product.token.maxWalletDurationSeconds,
      controller: asAddress(product.token.controller),
    })
    .saleConfig({
      initialSupply: parseEther(product.token.totalSupplyTokens),
      numTokensToSell: parseEther(product.token.tokensToSell),
      numeraire: asAddress(product.contracts.hoodie),
    })
    .poolByTicks({
      startTick: curve.startTick,
      endTick: curve.endTick,
      fee: product.pool.fee,
      numPositions: product.pool.numPositions,
    })
    .withBeneficiaries(beneficiaries)
    .withGovernance({ type: "noOp" })
    .withMigration({ type: "noOp" })
    .withUserAddress(input.creator)
    .build();

  return { params, curve };
}

export async function simulateLaunch(input: SimulateLaunchInput): Promise<LaunchSimulation> {
  try {
    const chainStatus = input.chainStatus ?? await readChainStatus();
    const { params, curve } = buildStaticLaunchParams(input, chainStatus);
    const publicClient = createRobinhoodPublicClient();
    const walletClient = createWalletClient({
      account: input.creator,
      chain: robinhood,
      transport: http(rpcUrl(), { timeout: 12_000 }),
    });
    const sdk = new DopplerSDK({
      publicClient,
      walletClient,
      chainId: ROBINHOOD_CHAIN_ID,
    });

    const result = await sdk.factory.simulateCreateStaticAuction(params);
    return {
      status: "simulated",
      asset: result.asset,
      pool: result.pool,
      gasEstimate: result.gasEstimate?.toString(),
      calldata: encodeFunctionData({
        abi: airlockAbi,
        functionName: "create",
        args: [result.createParams],
      }),
      airlock: asAddress(product.contracts.airlock),
      airlockOwner: chainStatus.airlockOwner,
      curve,
    };
  } catch (error) {
    return { status: "unavailable", error: safeError(error) };
  }
}
