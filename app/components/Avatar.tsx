// Deterministic hoodie identity art. Derived purely from the address, so the
// same wallet always renders the same avatar everywhere without any account,
// upload, or third-party lookup.

const PALETTE = [
  ["#b8f500", "#1d1a16"],
  ["#ff8f5e", "#1d1a16"],
  ["#6ec7ff", "#12233a"],
  ["#c89bff", "#231640"],
  ["#ffd75e", "#33270a"],
  ["#7ef0b6", "#0f3323"],
  ["#ff7ba8", "#3a1224"],
  ["#9df0ff", "#0d2d33"],
] as const;

function hashAddress(address: string) {
  let hash = 0;
  const normalized = address.toLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function Avatar({
  address,
  size = 32,
  imageUrl,
  className,
}: {
  address: string;
  size?: number;
  imageUrl?: string;
  className?: string;
}) {
  if (imageUrl) {
    return (
      <span
        className={`identity-avatar${className ? ` ${className}` : ""}`}
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          backgroundImage: `url("${imageUrl.replaceAll('"', "%22")}")`,
        }}
      />
    );
  }

  const hash = hashAddress(address || "0x");
  const [background, ink] = PALETTE[hash % PALETTE.length];
  // A second hash bit tilts the hood so neighbouring addresses look distinct.
  const tilt = ((hash >> 3) % 5) - 2;

  return (
    <span
      className={`identity-avatar${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{ width: size, height: size, backgroundColor: background }}
    >
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <g transform={`rotate(${tilt} 20 20)`}>
          {/* hood */}
          <path
            fill={ink}
            d="M20 6c-7 0-12.5 5.2-12.5 12.2 0 4.6 2 8.4 5.2 10.7l-1.1 4.6c-.2.9.5 1.7 1.4 1.7h14c.9 0 1.6-.8 1.4-1.7l-1.1-4.6c3.2-2.3 5.2-6.1 5.2-10.7C32.5 11.2 27 6 20 6z"
          />
          {/* face */}
          <ellipse cx="20" cy="19.5" rx="7.1" ry="7.8" fill={background} />
          {/* eyes */}
          <ellipse cx="17.2" cy="19" rx="1.25" ry="1.7" fill={ink} />
          <ellipse cx="22.8" cy="19" rx="1.25" ry="1.7" fill={ink} />
          {/* drawstring */}
          <path
            d="M15.8 27.4v4.2M24.2 27.4v4.2"
            stroke={ink}
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      </svg>
    </span>
  );
}
