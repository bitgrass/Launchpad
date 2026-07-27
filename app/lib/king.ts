import crown from "../../config/hoodie-crown.json";
import type { HoodiePadLaunch } from "./launches";

// The crown is decided by objective on-chain activity only: no curation, no
// allowlist, no payment. A market must clear every activity gate before it is
// eligible, and the highest weighted score among eligible markets reigns.

export type CrownCandidate = {
  token: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  score: number;
  volume24hUsd: number;
  trades24h: number;
  holders: number;
  change24h: number | null;
  eligible: boolean;
  missing: string[];
};

export type Reign = {
  token: string;
  symbol: string;
  imageUrl?: string;
  startedAt: string;
  endedAt: string | null;
  peakScore: number;
};

export type CrownState = {
  king: CrownCandidate | null;
  contenders: CrownCandidate[];
  reigns: Reign[];
  gates: typeof crown.gates;
  weights: typeof crown.weights;
};

function normalize(value: number, maximum: number) {
  if (!Number.isFinite(value) || maximum <= 0) return 0;
  return Math.max(0, Math.min(1, value / maximum));
}

export function scoreCrownCandidates(
  launches: HoodiePadLaunch[],
  hoodieUsd: number | null,
): CrownCandidate[] {
  const rows = launches.map((launch) => {
    const volume24hHoodie = Number(launch.analytics.hoodieVolume24hRaw) / 1e18;
    const volume24hUsd = hoodieUsd !== null ? volume24hHoodie * hoodieUsd : 0;
    const trades24h = launch.analytics.swapCount24h;
    const holders = launch.analytics.holderCount;
    const change24h = launch.analytics.changePercent24h;
    const missing: string[] = [];
    if (trades24h < crown.gates.minimumTrades24h) {
      missing.push(`${crown.gates.minimumTrades24h} trades in 24h`);
    }
    if (holders < crown.gates.minimumHolders) {
      missing.push(`${crown.gates.minimumHolders} holders`);
    }
    if (volume24hUsd < crown.gates.minimumVolume24hUsd) {
      missing.push(`$${crown.gates.minimumVolume24hUsd} of 24h volume`);
    }
    return {
      token: launch.address,
      symbol: launch.symbol,
      name: launch.name,
      imageUrl: launch.imageUrl,
      score: 0,
      volume24hUsd,
      trades24h,
      holders,
      change24h,
      eligible: missing.length === 0,
      missing,
    } satisfies CrownCandidate;
  });

  const eligible = rows.filter((row) => row.eligible);
  const maxVolume = Math.max(...eligible.map((row) => row.volume24hUsd), 0);
  const maxTrades = Math.max(...eligible.map((row) => row.trades24h), 0);
  const maxHolders = Math.max(...eligible.map((row) => row.holders), 0);
  const maxChange = Math.max(
    ...eligible.map((row) => Math.max(0, row.change24h ?? 0)),
    0,
  );

  for (const row of rows) {
    if (!row.eligible) continue;
    row.score = Math.round(
      normalize(row.volume24hUsd, maxVolume) * crown.weights.volume24h +
      normalize(row.trades24h, maxTrades) * crown.weights.trades24h +
      normalize(row.holders, maxHolders) * crown.weights.holders +
      normalize(Math.max(0, row.change24h ?? 0), maxChange) * crown.weights.change24h,
    );
  }

  return rows.sort((first, second) =>
    Number(second.eligible) - Number(first.eligible) ||
    second.score - first.score ||
    second.volume24hUsd - first.volume24hUsd);
}

function reignsPath() {
  const configured = process.env.HOODIEPAD_STORAGE_DIR?.trim();
  const railwayVolume = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const root = configured ||
    (railwayVolume ? `${railwayVolume.replace(/[\\/]+$/, "")}/hoodiepad` : "");
  if (!root) return null;
  return `${root}/state/crown-reigns.json`;
}

async function readReigns(): Promise<Reign[]> {
  const path = reignsPath();
  if (!path) return [];
  try {
    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      reigns?: Reign[];
    };
    return Array.isArray(parsed.reigns) ? parsed.reigns : [];
  } catch {
    return [];
  }
}

async function writeReigns(reigns: Reign[]) {
  const path = reignsPath();
  if (!path) return;
  try {
    const { mkdir, rename, writeFile } = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const resolved = nodePath.resolve(path);
    await mkdir(nodePath.dirname(resolved), { recursive: true });
    const temporary = `${resolved}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, reigns }), "utf8");
    await rename(temporary, resolved);
  } catch {
    // The reign ledger is a record, not a dependency: never break the page.
  }
}

let reignWrite: Promise<void> = Promise.resolve();

// Records the handover when the crown changes hands. Serialized through a
// single promise chain so concurrent requests cannot interleave writes.
export async function recordReign(king: CrownCandidate | null) {
  const existing = await readReigns();
  const current = existing.find((reign) => reign.endedAt === null);
  const now = new Date().toISOString();

  if (!king) {
    if (!current) return existing;
    const closed = existing.map((reign) =>
      reign.endedAt === null ? { ...reign, endedAt: now } : reign);
    reignWrite = reignWrite.then(() => writeReigns(closed));
    await reignWrite;
    return closed;
  }

  if (current && current.token.toLowerCase() === king.token.toLowerCase()) {
    if (king.score <= current.peakScore) return existing;
    const updated = existing.map((reign) =>
      reign.endedAt === null ? { ...reign, peakScore: king.score } : reign);
    reignWrite = reignWrite.then(() => writeReigns(updated));
    await reignWrite;
    return updated;
  }

  const next: Reign[] = [
    {
      token: king.token,
      symbol: king.symbol,
      imageUrl: king.imageUrl,
      startedAt: now,
      endedAt: null,
      peakScore: king.score,
    },
    ...existing.map((reign) =>
      reign.endedAt === null ? { ...reign, endedAt: now } : reign),
  ].slice(0, 50);
  reignWrite = reignWrite.then(() => writeReigns(next));
  await reignWrite;
  return next;
}

export async function readCrownState(
  launches: HoodiePadLaunch[],
  hoodieUsd: number | null,
): Promise<CrownState> {
  const contenders = scoreCrownCandidates(launches, hoodieUsd);
  const king = contenders.find((row) => row.eligible) ?? null;
  const reigns = await recordReign(king);
  return {
    king,
    contenders: contenders.slice(0, 10),
    reigns,
    gates: crown.gates,
    weights: crown.weights,
  };
}
