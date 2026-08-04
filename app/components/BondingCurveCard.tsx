import graduation from "../../config/hoodie-graduation.json";

// Graduation is a UI milestone only (ADR 0014): the pool is locked forever
// and nothing migrates when the threshold is reached.
const GRADUATION_HOODIE = Number(graduation.hoodieNetPoolThresholdTokens);

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function usdCompact(value: number) {
  if (!Number.isFinite(value)) return null;
  return `$${new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)}`;
}

export function BondingCurveCard({
  hoodieRaisedRaw,
  hoodieUsd,
}: {
  hoodieRaisedRaw: string | null;
  hoodieUsd: number | null;
}) {
  if (hoodieRaisedRaw === null) return null;
  const raised = Math.max(0, Number(hoodieRaisedRaw) / 1e18);
  if (!Number.isFinite(raised)) return null;

  const percent = Math.min(100, (raised / GRADUATION_HOODIE) * 100);
  const graduated = raised >= GRADUATION_HOODIE;
  const remaining = Math.max(0, GRADUATION_HOODIE - raised);
  const remainingUsd = hoodieUsd !== null ? usdCompact(remaining * hoodieUsd) : null;

  return (
    <aside className={`curve-card${graduated ? " is-graduated" : ""}`}>
      <div className="curve-card-head">
        <span className="curve-card-title"><i aria-hidden="true" /> Bonding curve progress</span>
        <strong>{graduated ? "Graduated" : `${percent.toFixed(percent < 10 ? 1 : 0)}%`}</strong>
      </div>
      <div
        className="curve-card-bar"
        role="img"
        aria-label={graduated
          ? "Graduated"
          : `${percent.toFixed(0)} percent to graduation`}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      <dl className="curve-card-rows">
        <div>
          <dt>Raised</dt>
          <dd>{compact.format(raised)} / {compact.format(GRADUATION_HOODIE)} HOODIE</dd>
        </div>
        <div>
          <dt>Amount required</dt>
          <dd>
            {graduated
              ? "0 HOODIE"
              : `${compact.format(remaining)} HOODIE${remainingUsd ? ` (${remainingUsd})` : ""}`}
          </dd>
        </div>
      </dl>
      <p className="curve-card-foot">
        {graduated
          ? "Graduated — the pool stays locked and trading continues here."
          : "Graduates at 100%. The pool stays locked; nothing migrates."}
      </p>
    </aside>
  );
}
