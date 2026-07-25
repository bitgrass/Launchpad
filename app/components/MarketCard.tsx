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
};

export function MarketCard(props: MarketCardProps) {
  const positive = !props.change.startsWith("-");
  const creator = `${props.creator.slice(0, 8)}…${props.creator.slice(-6)}`;
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
          <dd>{props.price} HOODIE</dd>
        </div>
        <div>
          <dt>Market cap (FDV)</dt>
          <dd>{props.fdv}</dd>
        </div>
      </dl>
      <p className="market-card-volume">Volume {props.volume}</p>
      <div className="market-live-row">
        <span className={`market-live-dot${props.active ? " is-active" : ""}`} />
        <strong>{props.active ? "Market active" : "Awaiting first trade"}</strong>
        <span>Block {props.launchBlock}</span>
      </div>
      <p className="creator-line">by {creator}</p>
    </Link>
  );
}
