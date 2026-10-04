/**
 * ============================================================================
 *  THE DOUBLE-ENTRY LEDGER - pure functions, no I/O
 * ============================================================================
 *
 *  This file builds and checks ledger transactions. It does not store them, does
 *  not read a clock and does not touch a wallet. That separation is the point:
 *  `scripts/verify-finance.ts` can prove every balancing rule here with literal
 *  numbers, and the service layer that DOES write stays small enough to read in
 *  one sitting.
 *
 *  THE ONE INVARIANT
 *  -----------------
 *  For every POSTED transaction, the sum of the debits equals the sum of the
 *  credits. Not "usually", not "within a tolerance" - equal, as integers.
 *  `assertBalanced` refuses to build a transaction that is not, so an unbalanced
 *  transaction cannot reach storage at all. There is no `force` parameter.
 *
 *  WHY THAT MATTERS MORE THAN IT SOUNDS
 *  ------------------------------------
 *  A ledger that does not balance cannot be reconciled, and a financial system
 *  that cannot be reconciled cannot be audited, which means it cannot be
 *  regulated. Part 16 requires exactly this. A system that "mostly balances"
 *  and patches drift with manual adjustments is the failure mode this design
 *  removes by construction.
 *
 *  A NOTE ON THE JSON STORE
 *  -----------------------
 *  A real database would give this ACID transactions. This store cannot: writes
 *  are coalesced and a crash between two files could leave them out of step. Two
 *  things compensate, and both are load-bearing:
 *
 *    1. `assertBalanced` runs BEFORE anything is written, so an unbalanced
 *       transaction is never persisted and there is nothing to reconcile.
 *    2. `verifyLedger` replays every posted transaction and can prove the store
 *       is internally consistent, so a crash-induced divergence is detectable
 *       rather than silent.
 *
 *  The honest limit: a single-writer JSON store is not multi-process safe. That
 *  is the existing project-wide trade-off documented in api/lib/jsonCollection,
 *  not something this module introduces.
 */

import { assertMinor, sum, type Minor } from "./money";
import type {
  AccountDefinition,
  LedgerEntry,
  LedgerStatus,
  LedgerTransaction,
  LedgerTransactionType,
} from "./types";

/** Thrown when a transaction cannot be built. Never swallowed by this module. */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

/**
 * A side of a posting, before the direction is known.
 *
 * The caller states the ECONOMICS - "this account goes up", "this account goes
 * down" - and `entryFor` derives debit or credit from the account's normal
 * balance. No caller ever types "debit" or "credit" by hand, which removes an
 * entire class of sign error.
 */
export interface Side {
  accountId: string;
  /** The absolute amount. Always positive; the direction carries the sign. */
  amount: Minor;
  walletId?: string | null;
  /** True to move the account against its normal balance. */
  opposite?: boolean;
}

/**
 * Derive a ledger entry from a side and the account's normal balance.
 *
 *   An increase in an asset/expense is a DEBIT.
 *   An increase in a liability/revenue/equity is a CREDIT.
 *   `opposite: true` flips it, which is what a withdrawal or a reversal needs.
 *
 * A zero amount is refused rather than posted. A zero-value leg is noise that
 * still has to balance, so refusing it here means a caller who computed the
 * wrong amount finds out at the point of the mistake.
 */
export function entryFor(side: Side, account: AccountDefinition): LedgerEntry {
  const amount = assertMinor(side.amount, `${account.id} amount`);
  if (amount < 0) {
    throw new LedgerError(
      `${account.id} was given a negative amount. State direction with "opposite", not a sign.`,
    );
  }
  if (amount === 0) {
    throw new LedgerError(
      `${account.id} has a zero-amount leg; a posting with nothing in it is not a posting.`,
    );
  }

  const increases = !side.opposite;
  const debit = account.normalBalance === "debit" ? increases : !increases;

  return {
    direction: debit ? "debit" : "credit",
    accountId: account.id,
    amount,
    currency: account.currency,
    walletId: side.walletId ?? null,
  };
}

/**
 * THE BALANCING CHECK.
 *
 * Total debits must equal total credits. Equal is the only accepted answer -
 * there is no tolerance parameter, because a tolerance is a licence to be off
 * by money.
 *
 * Also enforced here rather than left to the caller:
 *   * at least two entries, since one entry cannot balance against itself;
 *   * one currency across the transaction, so no cross-rate appears in it;
 *   * both a debit and a credit must be present.
 */
export function assertBalanced(entries: LedgerEntry[]): LedgerEntry[] {
  if (entries.length < 2) {
    throw new LedgerError("A ledger transaction needs at least two entries to balance.");
  }

  const currencies = new Set(entries.map((entry) => entry.currency));
  if (currencies.size > 1) {
    throw new LedgerError("A transaction may not mix currencies; post two transactions instead.");
  }

  const sides = new Set(entries.map((entry) => entry.direction));
  if (!sides.has("debit") || !sides.has("credit")) {
    throw new LedgerError("A transaction must contain both a debit and a credit.");
  }

  const debits = sum(entries.filter((e) => e.direction === "debit").map((e) => e.amount));
  const credits = sum(entries.filter((e) => e.direction === "credit").map((e) => e.amount));
  if (debits !== credits) {
    throw new LedgerError(
      `Transaction does not balance: debits ${debits} vs credits ${credits} (difference ${debits - credits}).`,
    );
  }

  return entries;
}

/** True when the entries balance. Never throws - for dashboards and tests. */
export function isBalanced(entries: LedgerEntry[]): boolean {
  try {
    assertBalanced(entries);
    return true;
  } catch {
    return false;
  }
}

/** The signed effect of one entry on an account, in its normal-balance frame. */
export function signedEffect(entry: LedgerEntry, account: AccountDefinition): Minor {
  const increases =
    account.normalBalance === "debit" ? entry.direction === "debit" : entry.direction === "credit";
  return increases ? entry.amount : -entry.amount;
}

/** What a draft transaction needs before it can be built. */
export interface PostInput {
  type: LedgerTransactionType;
  entries: LedgerEntry[];
  sourceKind: string;
  sourceId: string;
  description: string;
  createdBy: string;
  userId?: string | null;
  providerName?: string | null;
  providerId?: string | null;
  reversesTransactionId?: string | null;
  idempotencyKey?: string | null;
  status?: LedgerStatus;
}

/**
 * Build a transaction, refusing to build an unbalanced one.
 *
 * `id` and `reference` are passed in rather than generated here: this module has
 * no clock and no randomness, so the caller supplies both and a test can assert
 * on an exact transaction. The service layer uses a monotonic counter for the
 * reference, which is what makes a human-quotable `TXN-2026-000123` possible.
 *
 * A non-`posted` status skips the balance check deliberately: a `pending` or
 * `draft` transaction is a placeholder for money that has not been confirmed,
 * and it is invisible to every balance query until it is posted.
 */
export function buildTransaction(
  id: string,
  reference: string,
  input: PostInput,
  createdAt: string,
): LedgerTransaction {
  const status = input.status ?? "posted";
  // Validate every amount first, so a malformed entry is reported as a
  // malformed entry rather than as a balancing failure further down.
  for (const entry of input.entries) assertMinor(entry.amount, `${entry.accountId} amount`);

  if (status === "posted") assertBalanced(input.entries);

  return {
    id,
    reference,
    type: input.type,
    status,
    currency: input.entries[0]?.currency ?? "ETB",
    entries: input.entries,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    providerId: input.providerId ?? null,
    providerName: input.providerName ?? null,
    userId: input.userId ?? null,
    description: input.description,
    reversesTransactionId: input.reversesTransactionId ?? null,
    createdBy: input.createdBy,
    createdAt,
    idempotencyKey: input.idempotencyKey ?? null,
  };
}

/**
 * A reversal: every entry of the original, with its direction flipped.
 *
 * A reversal of a balanced transaction is balanced by construction - the same
 * amounts, the other way round - so there is nothing new to check. The original
 * is left exactly as it was, which is what makes the pair readable as history.
 */
export function reversalEntries(original: LedgerTransaction): LedgerEntry[] {
  return original.entries.map((entry) => ({
    ...entry,
    direction: entry.direction === "debit" ? "credit" : "debit",
  }));
}

/** Sum of one side, for totals and dashboards. */
export function totalFor(entries: LedgerEntry[], direction: "debit" | "credit"): Minor {
  return sum(entries.filter((entry) => entry.direction === direction).map((entry) => entry.amount));
}

/** Every distinct account the transaction touches. */
export function accountsTouched(entries: LedgerEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.accountId))];
}

/** True when the transaction moves a particular wallet. */
export function touchesWallet(transaction: LedgerTransaction, walletId: string): boolean {
  return transaction.entries.some((entry) => entry.walletId === walletId);
}
