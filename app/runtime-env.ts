export type HoodiePadRuntimeEnv = {
  ARTWORK: R2Bucket;
};

declare global {
  var __HOODIEPAD_RUNTIME_ENV__: HoodiePadRuntimeEnv | undefined;
}

export function getRuntimeEnv() {
  return globalThis.__HOODIEPAD_RUNTIME_ENV__;
}

export function getR2Bucket() {
  return getRuntimeEnv()?.ARTWORK;
}
