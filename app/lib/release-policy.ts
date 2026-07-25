export type ReleasePolicyEnvironment = {
  HOODIEPAD_EXTERNAL_REVIEW_APPROVED?: string;
  HOODIEPAD_OWNER_RISK_WAIVER?: string;
  HOODIEPAD_BROADCAST_ENABLED?: string;
};

export function getReleasePolicy(
  environment: ReleasePolicyEnvironment = process.env as ReleasePolicyEnvironment,
) {
  const externalReviewApproved =
    environment.HOODIEPAD_EXTERNAL_REVIEW_APPROVED === "true";
  const ownerRiskWaiver =
    environment.HOODIEPAD_OWNER_RISK_WAIVER === "true";
  const broadcastEnabled =
    environment.HOODIEPAD_BROADCAST_ENABLED === "true";

  return {
    externalReviewApproved,
    ownerRiskWaiver,
    reviewGateApproved: externalReviewApproved || ownerRiskWaiver,
    reviewGateLabel: externalReviewApproved
      ? "APPROVED"
      : ownerRiskWaiver
        ? "OWNER WAIVER"
        : "NOT APPROVED",
    broadcastEnabled,
  } as const;
}
