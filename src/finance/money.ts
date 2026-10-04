/**
 * ============================================================================
 *  MONEY - integer minor units, and nothing else
 * ============================================================================
 *
 *  Every amount in the financial system is an INTEGER NUMBER OF CENTS, held in
 *  a `Minor`. One birr is 100 cents. `1000.50 ETB` is `100050`.
 *
 *  WHY NOT A JAVASCRIPT NUMBER OF BIRRS
 *  ------------------------------------
 *  `0.1 + 0.2 === 0.30000000000000004` in IEEE-754. In a wallet system that is
 *  not a curiosity, it is a customer who is short by a fraction of a cent and a
 *  ledger that will not balance. Three sums that should each be exactly 10.00
 *  come out as 9.999999999999998, 10.000000000000002 and 9.999999999999996.
 *
 *  Integers sidestep the whole problem: addition and subtraction of integers
 *  below 2^53 are exact in JavaScript, and no rounding can creep in.
 *
 *  WHY CENTS AND NOT A BIGINT
 *  --------------------------
 *  The store is JSON, and JSON has no integer type. `BigInt` cannot be
 *  serialised, so a BigInt amount would need a string wrapper on every read and
 *  every write. `Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991 cents -
 *  90 trillion ETB - far beyond any plausible wallet - so integers in a plain
 *  `number` are both exact and trivially serialisable. `assertMinor` enforces
 *  that ceiling on every value that enters the system.
 *
 *  THE RULE
 *  -------
 *  Money never becomes a Minor here through arithmetic or through the UI. It
 *  becomes one through `parseMoney`, the ONLY function that turns anything a
 *  human typed into a stored amount, and it refuses everything it cannot
 *  represent exactly.
 */

/** An integer number of cents. 1 ETB = 100. */
export type Minor = number;

/** The only currency in the system. A type, so a second one cannot leak in. */
export type Currency = "ETB";

/** Minor units per major unit. */
export const MINOR_UNITS = 100;

/**
 * The exactness ceiling. Anything above this cannot be represented without
 * silent precision loss, so it is refused at the boundary rather than
 * silently rounded later.
 */
export const MAX_MINOR = Number.MAX_SAFE_INTEGER;

/** Basis points: 1 bp = 0.01%, so 20% is 2000 bp. Rates are integers for the same reason. */
export type BasisPoints = number;

export const BPS_ONE_HUNDRED_PERCENT = 10_000;

/** Thrown for anything that is not a usable amount. Callers turn this into a 400. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * The single gate every amount passes through.
 *
 * Rejects NaN, Infinity, fractional values and anything past the exact range.
 * A fractional value reaching the ledger is the one bug that cannot be fixed
 * later, because the rounding has already been written down.
 */
export function assertMinor(value: unknown, label = "amount"): Minor {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MoneyError(`${label} must be a finite number.`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be a whole number of cents, not ${value}.`);
  }
  if (Math.abs(value) > MAX_MINOR) {
    throw new MoneyError(`${label} is too large to store exactly.`);
  }
  return value;
}

/** True when `value` is a usable Minor. Used at boundaries that must not throw. */
export function isMinor(value: unknown): value is Minor {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && Math.abs(value) <= MAX_MINOR
  );
}

/** Addition, checked. Refuses to continue past the exact range. */
export function add(a: Minor, b: Minor): Minor {
  return assertMinor(assertMinor(a, "a") + assertMinor(b, "b"), "sum");
}

/** Subtraction, checked. The result may be negative - callers decide if that is legal. */
export function sub(a: Minor, b: Minor): Minor {
  return assertMinor(assertMinor(a, "a") - assertMinor(b, "b"), "difference");
}

/** Negation. `-0` is normalised so it never reaches a comparison. */
export function neg(a: Minor): Minor {
  const value = assertMinor(a);
  return value === 0 ? 0 : -value;
}

export function isZero(a: Minor): boolean {
  return assertMinor(a) === 0;
}

export function isPositive(a: Minor): boolean {
  return assertMinor(a) > 0;
}

/** Sum a list, checked at every step so a bad entry cannot hide inside a total. */
export function sum(amounts: Minor[]): Minor {
  return amounts.reduce<Minor>((total, amount) => add(total, assertMinor(amount)), 0);
}

/**
 * Multiply by a rate in basis points, rounding HALF AWAY FROM ZERO.
 *
 * Rounding is unavoidable - a percentage of an odd number of cents is not
 * always a whole number of cents - so it is defined rather than left to
 * whatever the hardware does. Half away from zero is the convention finance
 * uses, and it is symmetric: `mul(1, 2000)` and `mul(-1, 2000)` round to
 * opposite signs, so a credit and its matching debit never disagree.
 */
export function mulByBps(amount: Minor, bps: BasisPoints): Minor {
  const safeAmount = assertMinor(amount);
  if (!Number.isInteger(bps)) throw new MoneyError("rate must be a whole number of basis points.");
  const product = safeAmount * bps;
  if (Math.abs(product) > Number.MAX_SAFE_INTEGER) {
    throw new MoneyError("percentage overflowed the exact range.");
  }
  const magnitude = Math.round(Math.abs(product) / BPS_ONE_HUNDRED_PERCENT);
  return assertMinor(product < 0 ? -magnitude : magnitude);
}

/** The part of `amount` that is NOT `bps` of it - the remainder, in cents. */
export function remainderAfterBps(amount: Minor, bps: BasisPoints): Minor {
  return sub(assertMinor(amount), mulByBps(amount, bps));
}
/**
 * Split `total` across `weights` so the parts sum to EXACTLY `total`.
 *
 * This is the function that makes a commission split trustworthy. Naive
 * proportional division does not add up: 100 cents at 80/20 happens to work,
 * but 100 cents split three ways gives 33+33+33 = 99 and silently creates a
 * cent that then has to be posted somewhere - usually to Yene by accident.
 *
 * The LARGEST-REMAINDER method fixes it: give everyone their floor, then hand
 * the leftover cents out one each to the largest fractional remainders. Every
 * part is within one cent of exact, and `sum(parts) === total` is guaranteed and
 * asserted before the result is returned.
 *
 * Order matters only for which party receives a leftover cent, and it is
 * stable, so splitting the same total twice gives the same answer.
 */
export function allocate(total: Minor, weights: number[]): Minor[] {
  const safeTotal = assertMinor(total);
  if (weights.length === 0) {
    if (safeTotal !== 0) throw new MoneyError("cannot allocate a non-zero total across no shares.");
    return [];
  }
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
    throw new MoneyError("every allocation weight must be a positive finite number.");
  }

  const weightSum = weights.reduce((running, weight) => running + weight, 0);
  if (!Number.isFinite(weightSum) || weightSum <= 0) {
    throw new MoneyError("allocation weights must add up to a positive number.");
  }

  const sign = safeTotal < 0 ? -1 : 1;
  const magnitude = Math.abs(safeTotal);

  // The exact floor for each share, plus the fraction flooring discarded.
  const shares = weights.map((weight) => {
    const exact = (magnitude * weight) / weightSum;
    const floor = Math.floor(exact);
    return { floor, remainder: exact - floor, weight };
  });

  let leftover = magnitude - shares.reduce((acc, share) => acc + share.floor, 0);

  // Largest remainder first; ties break by the larger weight, then by position,
  // so the outcome is deterministic rather than dependent on sort stability.
  const order = shares
    .map((share, index) => ({ index, ...share }))
    .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index);

  for (const entry of order) {
    if (leftover <= 0) break;
    shares[entry.index].floor += 1;
    leftover -= 1;
  }

  const result = shares.map((share) => assertMinor(sign * share.floor));
  // The entire point of this function. If it ever throws, no caller may proceed.
  if (sum(result) !== safeTotal) {
    throw new MoneyError("allocation did not preserve the total; refusing to post it.");
  }
  return result;
}

/**
 * Parse what a human typed into an exact Minor.
 *
 * This is the ONLY boundary where a decimal string becomes money, which is why
 * it is the only place rounding appears. Deliberately strict:
 *
 *   "1000"      -> 100000        (a bare integer is whole birrs)
 *   "1000.50"   -> 100050
 *   "1000.5"    -> 100050
 *   ".50"       -> 50
 *   "1,000.50"  -> 100050        (a thousands separator is forgiven)
 *   " 1000 "    -> 100000
 *
 * and refuses everything a lenient parser would turn into money nobody
 * intended:
 *
 *   "1e3"       rejected - exponent notation is not a price
 *   "10.005"    rejected - a third decimal place cannot be represented
 *   "abc"       rejected
 *   ""          rejected
 *   "-50"       rejected unless `allowNegative`; a negative deposit is not one
 */
export function parseMoney(input: string | number, allowNegative = false): Minor {
  const text = typeof input === "number" ? String(input) : input.trim();
  if (!text) throw new MoneyError("Enter an amount.");

  const cleaned = text.replace(/,/g, "");
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === "." || cleaned === "-") {
    throw new MoneyError("Enter a valid amount, for example 1000.50");
  }

  const negative = cleaned.startsWith("-");
  if (negative && !allowNegative) {
    throw new MoneyError("Enter an amount greater than zero.");
  }

  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [whole = "0", fraction = ""] = unsigned.split(".");

  if (fraction.length > 2) {
    throw new MoneyError("Use at most two decimal places.");
  }

  const wholePart = Number(whole || "0");
  if (!Number.isFinite(wholePart)) throw new MoneyError("Enter a valid amount.");

  const fractionPart = fraction === "" ? 0 : Number(fraction.padEnd(2, "0"));

  const total = wholePart * MINOR_UNITS + fractionPart;
  if (!Number.isSafeInteger(total) || total > MAX_MINOR) {
    throw new MoneyError("That amount is too large.");
  }
  return assertMinor(negative ? -total : total);
}

/** The exact decimal rendering - no grouping, so it is safe to store and compare. */
export function toDecimalString(amount: Minor): string {
  const safe = assertMinor(amount);
  const sign = safe < 0 ? "-" : "";
  const magnitude = Math.abs(safe);
  const whole = Math.floor(magnitude / MINOR_UNITS);
  const fraction = magnitude % MINOR_UNITS;
  return `${sign}${whole}.${String(fraction).padStart(2, "0")}`;
}

/** For display only. Never feed the result of this back into a calculation. */
export function formatMoney(amount: Minor, currency: Currency = "ETB"): string {
  const safe = assertMinor(amount);
  const sign = safe < 0 ? "-" : "";
  const magnitude = Math.abs(safe);
  const whole = Math.floor(magnitude / MINOR_UNITS);
  const fraction = magnitude % MINOR_UNITS;
  const grouped = whole.toLocaleString("en-US");
  const body =
    fraction === 0
      ? grouped
      : `${grouped}.${String(fraction).padStart(2, "0")}`;
  return `${sign}${body} ${currency}`;
}

/** A signed rendering for transaction rows, where direction is part of the meaning. */
export function formatSigned(amount: Minor, currency: Currency = "ETB"): string {
  const safe = assertMinor(amount);
  const sign = safe > 0 ? "+" : "";
  return `${sign}${formatMoney(safe, currency)}`;
}
