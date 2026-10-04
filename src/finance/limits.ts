/**
 * ============================================================================
 *  LIMITS, ELIGIBILITY AND FRAUD RULES
 * ============================================================================
 *
 *  Pure predicates. Every rule answers "may this happen?" and returns a
 *  structured refusal rather than a boolean, because a boolean loses the reason
 *  and the reason is what the user and the audit log both need.
 *
 *  WHY A SEPARATE FILE
 *  -------------------
 *  Limits change with policy; the ledger must not. Keeping the rules here means
 *  an administrator can move a limit without touching a posting function, and
 *  `scripts/verify-finance.ts` can test each rule against a literal boundary
 *  (one cent below, exactly at, one cent above) rather than through a request.
 *
 *  A REFUSAL IS A VALUE, NOT AN EXCEPTION
 *  --------------------------------------
 *  Business rules refuse; the money layer throws. A withdrawal over the daily
 *  limit is a normal outcome to report to the user, while an unbalanced ledger
 *  entry is a bug. Mixing the two is how a system ends up returning a 500 for
 *  "you typed too many zeros".
 */

import { formatMoney, isPositive, type Minor } from "./money";
import type { Wallet, WalletBucket, WalletKind } from "./types";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface FinanceLimits {
  deposit: { min: Minor; max: Minor; daily: Minor };
  withdrawal: { min: Minor; max: Minor; daily: Minor; feeBps: number; flatFee: Minor };
  purchase: { min: Minor; max: Minor };
  /** Balance a single wallet may hold - an anti-money-laundering ceiling. */
  walletCeiling: Minor;
  /** How long a deposit may stay PENDING before it is expired. */
  depositExpiryMs: number;
  /** How long a freelancer's earnings stay PENDING before release. */
  earningsReleaseMs: number;
  /** Days a completed job stays open for dispute before earnings release. */
  disputeWindowDays: number;
}

/**
 * The shipped defaults.
 *
 * Every one is a PLACEHOLDER an administrator must confirm against YENE's actual
 * merchant agreements and the regulator's limits before live use (Part 16).
 * They are collected in one object precisely so that confirmation is a single
 * review rather than a search through the code.
 */
export const DEFAULT_LIMITS: FinanceLimits = {
  deposit: { min: 10_00, max: 500_000_00, daily: 1_000_000_00 },
  withdrawal: { min: 50_00, max: 300_000_00, daily: 500_000_00, feeBps: 200, flatFee: 0 },
  purchase: { min: 1_00, max: 1_000_000_00 },
  walletCeiling: 5_000_000_00,
  depositExpiryMs: 30 * 60 * 1000,
  earningsReleaseMs: 7 * 24 * 60 * 60 * 1000,
  disputeWindowDays: 7,
};

/** A refusal with a reason the user can act on. */
export interface Refusal {
  allowed: boolean;
  reason: string | null;
  /** A machine-readable code, for the UI and the audit log. */
  code:
    | "ok"
    | "wallet-missing"
    | "wallet-frozen"
    | "wallet-closed"
    | "insufficient-balance"
    | "bucket-empty"
    | "below-minimum"
    | "above-maximum"
    | "daily-limit"
    | "ceiling-exceeded"
    | "payout-not-permitted"
    | "amount-invalid";
}

const OK: Refusal = { allowed: true, reason: null, code: "ok" };

function refuse(code: Refusal["code"], reason: string): Refusal {
  return { allowed: false, reason, code };
}

// ---------------------------------------------------------------------------
// Wallet state
// ---------------------------------------------------------------------------

/**
 * May this wallet be used at all?
 *
 * Checked before any balance question, because a frozen wallet must refuse even
 * an operation that would leave its balance alone - otherwise a frozen account
 * with a pending withdrawal would still process the payout.
 */
export function checkWalletUsable(wallet: Wallet | null): Refusal {
  if (!wallet) return refuse("wallet-missing", "No wallet exists for this account yet.");
  if (wallet.status === "frozen") {
    const why = wallet.frozenReason ? ` (${wallet.frozenReason})` : "";
    return refuse("wallet-frozen", `This wallet is frozen${why}. Contact support.`);
  }
  if (wallet.status === "closed") return refuse("wallet-closed", "This wallet is closed.");
  if (wallet.status === "under-review") {
    return refuse("wallet-frozen", "This wallet is under review. Contact support.");
  }
  return OK;
}

/** A read of a bucket, treating an absent wallet as zero rather than throwing. */
export function bucketBalance(wallet: Wallet | null, bucket: WalletBucket): Minor {
  if (!wallet) return 0;
  return wallet[bucket];
}

/**
 * Enough of a bucket to cover `amount`?
 *
 * The comparison is `<`, never `<=`: spending the whole balance is allowed, and
 * a `<=` here would refuse a withdrawal of exactly the available balance - a
 * bug that looks like a rounding problem and is not one.
 */
export function hasSufficient(wallet: Wallet | null, bucket: WalletBucket, amount: Minor): Refusal {
  if (!isPositive(amount)) return refuse("amount-invalid", "Enter an amount greater than zero.");
  const available = bucketBalance(wallet, bucket);
  if (available < amount) {
    return refuse("insufficient-balance", `Not enough ${bucket} balance. Available: ${formatMoney(available)}.`);
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Deposit limits
// ---------------------------------------------------------------------------

export function checkDepositAllowed(
  wallet: Wallet | null,
  amount: Minor,
  alreadyToday: Minor,
  limits: FinanceLimits = DEFAULT_LIMITS,
): Refusal {
  const usable = checkWalletUsable(wallet);
  if (!usable.allowed) return usable;

  if (!isPositive(amount)) return refuse("amount-invalid", "Enter an amount greater than zero.");
  if (amount < limits.deposit.min) {
    return refuse("below-minimum", `The minimum deposit is ${formatMoney(limits.deposit.min)}.`);
  }
  if (amount > limits.deposit.max) {
    return refuse("above-maximum", `The maximum single deposit is ${formatMoney(limits.deposit.max)}.`);
  }

  if (alreadyToday + amount > limits.deposit.daily) {
    return refuse(
      "daily-limit",
      `That would exceed the daily deposit limit of ${formatMoney(limits.deposit.daily)}.`,
    );
  }

  // A deposit that would push the wallet past the ceiling is refused BEFORE the
  // money moves, not after.
  const projected = bucketBalance(wallet, "available") + amount;
  if (projected > limits.walletCeiling) {
    return refuse(
      "ceiling-exceeded",
      `A single wallet may hold at most ${formatMoney(limits.walletCeiling)}.`,
    );
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Withdrawal limits
// ---------------------------------------------------------------------------

/**
 * Which wallet kinds may withdraw?
 *
 * A deliberate policy, not an oversight. A CUSTOMER wallet exists to hold money a
 * customer paid us with; letting a customer push it to an arbitrary bank account
 * is a different product, a different risk, and almost certainly a different
 * regulatory answer. Sellers, businesses and freelancers are the parties the
 * marketplace actually pays.
 *
 * Turning this on for customers is a one-line config change, made deliberately
 * by an administrator, rather than an accident of route wiring.
 */
export const PAYOUT_PERMITTED_KINDS: WalletKind[] = ["freelancer", "seller", "business"];

export function checkPayoutPermitted(wallet: Wallet | null): Refusal {
  if (!wallet) return refuse("wallet-missing", "No wallet exists for this account yet.");
  if (!PAYOUT_PERMITTED_KINDS.includes(wallet.kind)) {
    return refuse(
      "payout-not-permitted",
      "Withdrawals are not available on this type of wallet. Contact support.",
    );
  }
  return OK;
}

/** The withdrawal fees an administrator can configure. */
export interface WithdrawalFee {
  /** Percentage of the requested amount, in basis points. 200 = 2%. */
  bps: number;
  /** A fixed amount added on top. */
  flat: Minor;
}

export function withdrawalFeeFor(requested: Minor, fee: WithdrawalFee): Minor {
  if (!isPositive(requested)) return 0;
  const percent = Math.round((requested * fee.bps) / 10_000);
  return Math.max(0, fee.flat + percent);
}

/** The fee, and the amount that actually reaches the bank. */
export interface WithdrawalQuote {
  requested: Minor;
  fee: Minor;
  net: Minor;
}

/**
 * Quote a withdrawal BEFORE it is confirmed.
 *
 * Part 6 requires the fee to be shown and the net confirmed by the user, so the
 * fee is computed by a pure function that both the form and the server call -
 * one implementation, so the number the user approved is the number the server
 * charges.
 *
 * The net is computed by subtraction from the requested amount, so the three
 * numbers always reconcile:  requested - fee === net
 * A net of zero is refused: reporting a completed withdrawal that paid nothing
 * would inflate the withdrawal count and hide a real failure.
 */
export function quoteWithdrawal(
  requested: Minor,
  fee: WithdrawalFee,
  limits: FinanceLimits = DEFAULT_LIMITS,
): WithdrawalQuote | Refusal {
  if (!isPositive(requested)) return refuse("amount-invalid", "Enter an amount greater than zero.");
  if (requested < limits.withdrawal.min) {
    return refuse("below-minimum", `The minimum withdrawal is ${formatMoney(limits.withdrawal.min)}.`);
  }
  if (requested > limits.withdrawal.max) {
    return refuse("above-maximum", `The maximum single withdrawal is ${formatMoney(limits.withdrawal.max)}.`);
  }

  const charge = withdrawalFeeFor(requested, fee);
  const net = requested - charge;
  if (net <= 0) {
    return refuse(
      "above-maximum",
      "The amount is too small to cover the withdrawal fee. Increase it and try again.",
    );
  }
  return { requested, fee: charge, net };
}

export function checkWithdrawalAllowed(
  wallet: Wallet | null,
  requested: Minor,
  alreadyToday: Minor,
  fee: WithdrawalFee,
  limits: FinanceLimits = DEFAULT_LIMITS,
): Refusal {
  const usable = checkWalletUsable(wallet);
  if (!usable.allowed) return usable;

  const permitted = checkPayoutPermitted(wallet);
  if (!permitted.allowed) return permitted;

  const quote = quoteWithdrawal(requested, fee, limits);
  if (!("requested" in quote)) return quote;

  if (alreadyToday + requested > limits.withdrawal.daily) {
    return refuse(
      "daily-limit",
      `That would exceed the daily withdrawal limit of ${formatMoney(limits.withdrawal.daily)}.`,
    );
  }

  // The check that enforces Part 5: pending earnings sit in a bucket this does
  // not read, so an unfunded "available" balance cannot pay out.
  return hasSufficient(wallet, "available", quote.requested);
}

