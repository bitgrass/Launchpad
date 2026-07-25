import type { Address } from "viem";
import product from "../config/hoodiepad-v1.json";
import { deriveHoodieCurve, readChainStatus, simulateLaunch } from "../app/lib/protocol";

function line(label: string, value: unknown) {
  process.stdout.write(`${label.padEnd(24)} ${String(value)}\n`);
}

const DEFAULT_SIMULATION_CREATOR = "0x1111111111111111111111111111111111111111";
const creator = (process.env.HOODIEPAD_SIMULATION_CREATOR?.trim()
  || DEFAULT_SIMULATION_CREATOR) as Address;

line("Mode", "READ-ONLY / NO BROADCAST");
line("Expected chain", product.network.chainId);
line("HOODIE", product.contracts.hoodie);
line("Reference pool", product.hoodieReferencePool.poolId);
line("Simulation creator", creator);

const status = await readChainStatus();
if (!status.available || !status.referencePool || !status.airlockOwner) {
  line("Status", "FAILED");
  line("Reason", status.error ?? "Unknown verification failure");
  process.exitCode = 1;
} else {
  line("Status", "CONNECTED");
  line("Block", status.blockNumber);
  line("Airlock owner", status.airlockOwner);
  line("HOODIE per WETH", status.referencePool.hoodiePerWeth);
  line("Reference tick", status.referencePool.tick);
  line("Reference liquidity", status.referencePool.liquidity);

  let dependenciesValid = true;
  for (const [name, dependency] of Object.entries(status.dependencies ?? {})) {
    dependenciesValid &&= dependency.matchesExpectedHash;
    const state = dependency.matchesExpectedHash ? "VERIFIED" : "MISMATCH";
    line(`${name} code`, dependency.hasCode
      ? `${state} · ${dependency.byteLength} bytes · ${dependency.runtimeHash}`
      : "MISSING");
  }

  const curve = deriveHoodieCurve(status.referencePool.tick);
  line("Candidate curve", `${curve.startTick} → ${curve.endTick}`);
  line("Curve status", curve.status);

  if (!dependenciesValid) {
    line("Simulation", "SKIPPED: dependency hash mismatch");
    process.exitCode = 1;
  } else {
    const simulation = await simulateLaunch({
      name: "HoodiePad Verification",
      symbol: "HPVERIFY",
      tokenURI: "https://hoodie.fun/hoodiepad-verification.json",
      creator,
      chainStatus: status,
    });
    line("Simulation", simulation.status.toUpperCase());
    if (simulation.status === "simulated") {
      line("Predicted token", simulation.asset);
      line("Predicted V3 pool", simulation.pool);
      line("Gas estimate", simulation.gasEstimate ?? "unavailable");
    } else {
      line("Reason", simulation.error ?? "Unknown simulation failure");
      process.exitCode = 1;
    }
  }
}
