export const LEGACY_V3_MARKET_VERSION = "doppler-lockable-v3-v1" as const;
export const PUBLIC_V4_MARKET_VERSION = "doppler-multicurve-v4-v2" as const;

export type HoodiePadMarketVersion =
  | typeof LEGACY_V3_MARKET_VERSION
  | typeof PUBLIC_V4_MARKET_VERSION;

export function isPublicMarketVersion(version: HoodiePadMarketVersion) {
  return version === PUBLIC_V4_MARKET_VERSION;
}
