import Link from "next/link";

export type MarketCardProps = {
  address: string;
  symbol: string;
  name: string;
  creator: string;
  price: string;
  fdv: string;
  volume: string;
  change: string;
  imageUrl?: string;
  active: boolean;
  launchBlock: string;
  tone: "green" | "peach" | "blue" | "violet";
  // Bonding-curve progress toward the 420M HOODIE graduation milestone
  // (ADR 0014); omit or null to hide the bar (legacy V3 markets).
  graduationPercent?: number | null;
  ageLabel?: string;
};

export function MarketCard(props: MarketCardProps) {
  const positive = !props.change.startsWith("-");
  const creator = `${props.creator.slice(0, 8)}…${props.creator.slice(-6)}`;
  const percent = props.graduationPercent ?? null;
  return (
    <Link className="market-card" href={`/token/${props.address}`}>
      <div
        className={`token-avatar tone-${props.tone}${props.imageUrl ? " has-artwork" : ""}`}
        style={props.imageUrl ? { backgroundImage: `url("${props.imageUrl}")` } : undefined}
        aria-hidden="true"
      >
        {props.imageUrl ? "" : props.symbol.slice(0, 2)}
      </div>
      <div className="market-card-title">
        <div>
          <h3>${props.symbol}</h3>
          <p>{props.name}</p>
        </div>
        <span className={positive ? "change-up" : "change-down"}>
          {props.change}
        </span>
      </div>
      <dl className="market-stats">
        <div>
          <dt>Price</dt>
          <dd>{props.price}</dd>
        </div>
        <div>
          <dt>Market cap (FDV)</dt>
          <dd>{props.fdv}</dd>
        </div>
      </dl>
      <p className="market-card-volume">Volume {props.volume}</p>
      {percent !== null && (
        percent >= 100 ? (
          <div className="market-card-curve is-graduated">
            <em className="mini-curve-grad">GRADUATED</em>
            <small>Pool stays locked — trading continues</small>
          </div>
        ) : (
          <div className="market-card-curve">
            <span className="mini-curve-bar">
              <i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
            </span>
            <small>{percent.toFixed(percent < 10 ? 1 : 0)}% to graduation</small>
          </div>
        )
      )}
      <div className="market-live-row">
        <span className={`market-live-dot${props.active ? " is-active" : ""}`} />
        <strong>{props.active ? "Market active" : "Awaiting first trade"}</strong>
        <span>{props.ageLabel ?? `Block ${props.launchBlock}`}</span>
      </div>
      <p className="creator-line">by {creator}</p>
    </Link>
  );
}
