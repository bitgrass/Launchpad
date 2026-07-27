import curve from "../../config/hoodie-v4-curve-v1.json";

// The multicurve is three market-cap segments. Showing where a market sits
// inside them gives the same "chase" readout a graduation bar would, without
// implying a graduation event — HoodiePad pools stay locked forever.
export function CurveProgress({ fdvUsd }: { fdvUsd: number | null }) {
  if (fdvUsd === null || !Number.isFinite(fdvUsd) || fdvUsd <= 0) return null;

  const segments = curve.curves.map((item, index) => ({
    index,
    start: Number(item.marketCap.start),
    end: item.marketCap.end === "max" ? null : Number(item.marketCap.end),
  }));

  const active = segments.find((segment) =>
    segment.end === null ? fdvUsd >= segment.start : fdvUsd < segment.end,
  ) ?? segments[segments.length - 1];

  const percent = active.end === null
    ? 100
    : Math.max(
        0,
        Math.min(100, ((fdvUsd - active.start) / (active.end - active.start)) * 100),
      );

  const target = active.end === null
    ? "final segment"
    : `$${new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(active.end)}`;

  return (
    <div className="curve-progress">
      <div className="curve-progress-head">
        <span>
          Curve segment {active.index + 1} of {segments.length}
        </span>
        <strong>
          {active.end === null
            ? "Final segment"
            : `${percent.toFixed(0)}% to ${target}`}
        </strong>
      </div>
      <div className="curve-progress-bar" role="img" aria-label={`Curve progress ${percent.toFixed(0)} percent`}>
        {segments.map((segment) => (
          <span
            key={segment.index}
            className={`curve-progress-segment${
              segment.index < active.index ? " is-complete" : ""
            }${segment.index === active.index ? " is-active" : ""}`}
          >
            {segment.index === active.index && (
              <i style={{ width: `${percent}%` }} />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
