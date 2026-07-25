const Q96 = 1n << 96n;
const Q192 = Q96 * Q96;

export type Rational = {
  numerator: bigint;
  denominator: bigint;
};

function powerOfTen(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals must be an integer between 0 and 255");
  }
  return 10n ** BigInt(decimals);
}

function gcd(first: bigint, second: bigint) {
  let a = first < 0n ? -first : first;
  let b = second < 0n ? -second : second;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function reduceRational(value: Rational): Rational {
  if (value.denominator === 0n) throw new Error("Price denominator cannot be zero");
  if (value.numerator < 0n || value.denominator < 0n) {
    throw new Error("Prices cannot be negative");
  }
  const divisor = gcd(value.numerator, value.denominator);
  return divisor === 0n
    ? { numerator: 0n, denominator: 1n }
    : {
        numerator: value.numerator / divisor,
        denominator: value.denominator / divisor,
      };
}

export function invertRational(value: Rational) {
  if (value.numerator === 0n) throw new Error("Cannot invert a zero price");
  return reduceRational({
    numerator: value.denominator,
    denominator: value.numerator,
  });
}

export function multiplyRationals(first: Rational, second: Rational) {
  return reduceRational({
    numerator: first.numerator * second.numerator,
    denominator: first.denominator * second.denominator,
  });
}

export function sqrtPriceX96ToCurrency1PerCurrency0(
  sqrtPriceX96: bigint,
  currency0Decimals: number,
  currency1Decimals: number,
) {
  if (sqrtPriceX96 <= 0n) throw new Error("sqrtPriceX96 must be positive");
  return reduceRational({
    numerator:
      sqrtPriceX96 *
      sqrtPriceX96 *
      powerOfTen(currency0Decimals),
    denominator: Q192 * powerOfTen(currency1Decimals),
  });
}

export function formatRational(
  value: Rational,
  maximumFractionDigits = 18,
) {
  if (!Number.isInteger(maximumFractionDigits) || maximumFractionDigits < 0) {
    throw new Error("maximumFractionDigits must be a non-negative integer");
  }
  const reduced = reduceRational(value);
  const whole = reduced.numerator / reduced.denominator;
  if (maximumFractionDigits === 0) return whole.toString();
  const scale = 10n ** BigInt(maximumFractionDigits);
  const fraction = (reduced.numerator % reduced.denominator) * scale /
    reduced.denominator;
  const fractionText = fraction
    .toString()
    .padStart(maximumFractionDigits, "0")
    .replace(/0+$/, "");
  return fractionText.length > 0 ? `${whole}.${fractionText}` : whole.toString();
}

export function quoteRawAmount(
  amountInRaw: bigint,
  inputDecimals: number,
  outputDecimals: number,
  outputPerInput: Rational,
) {
  if (amountInRaw < 0n) throw new Error("Quote input cannot be negative");
  const result = multiplyRationals(outputPerInput, {
    numerator: amountInRaw * powerOfTen(outputDecimals),
    denominator: powerOfTen(inputDecimals),
  });
  return result.numerator / result.denominator;
}

export function calculateFdv(
  quotePerToken: Rational,
  totalSupplyRaw: bigint,
  tokenDecimals: number,
) {
  return reduceRational({
    numerator: quotePerToken.numerator * totalSupplyRaw,
    denominator: quotePerToken.denominator * powerOfTen(tokenDecimals),
  });
}

export function calculateDeviationBps(actual: Rational, target: Rational) {
  if (target.numerator === 0n) throw new Error("Deviation target cannot be zero");
  const actualCross = actual.numerator * target.denominator;
  const targetCross = target.numerator * actual.denominator;
  const difference = actualCross >= targetCross
    ? actualCross - targetCross
    : targetCross - actualCross;
  return difference * 10_000n / targetCross;
}

export { Q96, Q192 };
