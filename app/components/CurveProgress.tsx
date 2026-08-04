import curve from "../../config/hoodie-v4-curve-v2.json";
import graduation from "../../config/hoodie-graduation.json";

// Graduation is a UI milestone only (ADR 0014): the pool is locked forever
// and nothing migrates when the threshold is reached.
const GRADUATION_HOODIE = Number(graduation.hoodieNetPoolThresholdTokens);

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function CurveProgress({
  fdvUsd,
  hoodieRaisedRaw,
}: {
  fdvUsd: number | null;
  hoodieRaisedRaw: string | null;
}) {
  if (hoodieRaisedRaw === null) return null;
  const raised = Math.max(0, Number(hoodieRaisedRaw) / 1e18);
  if (!Number.isFinite(raised)) return null;

  const percent = Math.min(100, (raised / GRADUATION_HOODIE) * 100);
  const graduated = raised >= GRADUATION_HOODIE;
  const thresholdLabel = `${compact.format(GRADUATION_HOODIE)} HOODIE`;

  const activeSegment = fdvUsd === null || !Number.isFinite(fdvUsd) || fdvUsd <= 0
    ? -1
    : curve.curves.findIndex((item) =>
        item.marketCap.end === "max"
          ? fdvUsd >= Number(item.marketCap.start)
          : fdvUsd < Number(item.marketCap.end),
      );

  return (
    <div className={`curve-progress${graduated ? " is-graduated" : ""}`}>
      <div className="curve-progress-head">
        <span>
          Bonding curve
          {activeSegment >= 0 && ` · segment ${activeSegment + 1} of ${curve.curves.length}`}
        </span>
        <strong>
          {graduated
            ? "Graduated"
            : `${compact.format(raised)} / ${thresholdLabel} raised`}
        </strong>
      </div>
      <div
        className="curve-progress-bar"
        role="img"
        aria-label={graduated
          ? "Graduated"
          : `${percent.toFixed(0)} percent to graduation`}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="curve-progress-foot">
        {graduated
          ? <span>{thresholdLabel} raised — pool stays locked, trading continues</span>
          : <span>{percent.toFixed(percent < 10 ? 1 : 0)}% to graduation</span>}
      </div>
    </div>
  );
}
