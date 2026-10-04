/**
 * ============================================================================
 *  FINANCE - DOMAIN TYPES
 * ============================================================================
 *
 *  Imported by BOTH the browser client and the Express server, so it stays free
 *  of Node-only and browser-only APIs - exactly like src/platform/types.ts and
 *  src/constants.ts. Nothing here reads `process`, touches the filesystem, or
 *  imports a store; types and pure helpers only.
 *
 *  THE INVARIANTS THIS FILE EXISTS TO PROTECT
 *  -----------------------------------------
 *  1. MONEY IS ALWAYS A `Minor`. No field here is a number of birrs, so a
 *     float cannot be assigned to a balance by accident.
 *
 *  2. THE LEDGER IS THE SOURCE OF TRUTH. A wallet balance is a CACHE of ledger
 *     postings, not an independent truth. `rebuildWallet` can recompute any
 *     wallet from scratch, which is what makes an audit answerable and a
 *     corruption repairable.
 *
 *  3. A USER NEVER OWNS AN AMOUNT, THEY OWN A LIABILITY. Customer and
 *     freelancer balances are money YENE-STORE holds on someone's behalf, which
 *     is why those accounts are liabilities and why the regulatory position in
 *     Part 16 is not optional.
 */

import type { BasisPoints, Currency, Minor } from "./money";


// ---------------------------------------------------------------------------
// Wallets
// ---------------------------------------------------------------------------
/**
 * The four buckets a customer or freelancer account can hold money in.
 *
 *   AVAILABLE  spendable now
 *   PENDING    earned but not yet releasable - a job inside its dispute window,
 *              or a deposit whose provider has not confirmed
 *   RESERVED   earmarked for a withdrawal requested but not yet resolved
 *   WITHHELD   frozen by an administrator or held by a compliance rule
 *
 * The split is what makes "a freelancer may not withdraw pending earnings" and
 * "never release a reserved balance on a timeout" enforceable rather than
 * conventional: the money sits in a bucket the payout path does not read.
 */
export type WalletBucket = "available" | "pending" | "reserved" | "withheld";

export const WALLET_BUCKETS: WalletBucket[] = ["available", "pending", "reserved", "withheld"];

/**
 * Which kind of account a wallet belongs to.
 *
 * Not a presentation choice: the kind decides which ledger accounts the balance
 * posts to, and therefore whether a withdrawal is permitted at all. A customer
 * wallet paying out to a bank account is a policy decision, so the type makes
 * that decision visible in the data rather than buried in a route handler.
 */
export type WalletKind = "customer" | "freelancer" | "seller" | "business" | "admin";

export const WALLET_KINDS: WalletKind[] = ["customer", "freelancer", "seller", "business", "admin"];

export type WalletStatus = "active" | "frozen" | "closed" | "under-review";

export const WALLET_STATUSES: WalletStatus[] = ["active", "frozen", "closed", "under-review"];

export interface Wallet {
  id: string;
  /** The user this wallet belongs to. One user may hold several kinds. */
  userId: string;
  kind: WalletKind;
  currency: Currency;
  /** Every bucket is a `Minor`. Their sum is the wallet's total position. */
  available: Minor;
  pending: Minor;
  reserved: Minor;
  withheld: Minor;
  status: WalletStatus;
  createdAt: string;
  updatedAt: string;
  /**
   * Lifetime counters, maintained as postings are made.
   *
   * Read-optimised totals, NOT the source of truth: each is recomputable by
   * replaying the ledger, and the dashboard cross-checks them against it. A
   * divergence is a bug worth surfacing, not a balance to trust.
   */
  totals: {
    deposits: Minor;
    withdrawals: Minor;
    purchases: Minor;
    earnings: Minor;
    fees: Minor;
  };
  /** Why the wallet is frozen, when it is. Shown to the user, never a secret. */
  frozenReason: string | null;
  frozenBy: string | null;
  frozenAt: string | null;
}


// ---------------------------------------------------------------------------
// The chart of accounts
// ---------------------------------------------------------------------------

/**
 * The five account classes.
 *
 * The rule that matters: a transaction balances when the debits and credits are
 * equal in total, and each entry's side is determined by its account's NORMAL
 * BALANCE. Increasing a liability or a revenue is a credit; increasing an asset
 * or an expense is a debit. Getting the class right is what makes the totals
 * in the admin dashboard mean something.
 */
export type AccountClass = "asset" | "liability" | "equity" | "revenue" | "expense";

/** The side a posting to this account normally falls on. */
export type AccountNormalBalance = "debit" | "credit";

export interface AccountDefinition {
  /** Stable identifier. Never reused or renamed - historical rows use it. */
  id: string;
  name: string;
  accountClass: AccountClass;
  normalBalance: AccountNormalBalance;
  currency: Currency;
  /**
   * True for accounts YENE-STORE does not own the money in.
   *
   * A provider settlement account is money sitting at Chapa before it reaches
   * us; a customer wallet is money we hold for a customer. Both are
   * liabilities to somebody, which is the substance of the regulatory position
   * in Part 16.
   */
  custodial: boolean;
  description: string;
  /** System accounts may not be deleted or re-pointed. */
  system: boolean;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/**
 * The lifecycle of a ledger transaction.
 *
 * Only `posted` moves a balance. `draft` and `pending` are visible to an
 * administrator and invisible to every balance query, which is what stops a
 * provider-initiated-but-unverified deposit from crediting anybody.
 */
export type LedgerStatus = "draft" | "pending" | "posted" | "reversed";

/**
 * Why the money moved.
 *
 * The list is exhaustive on purpose: a transaction whose reason is not
 * recognised is a bug, and an exhaustive union is where that gets caught.
 */
export type LedgerTransactionType =
  | "deposit"
  | "purchase"
  | "freelancer-earning"
  | "seller-earning"
  | "withdrawal"
  | "withdrawal-fee"
  | "provider-fee"
  | "commission"
  | "refund"
  | "reversal"
  | "adjustment";

export const LEDGER_TRANSACTION_TYPES: LedgerTransactionType[] = [
  "deposit",
  "purchase",
  "freelancer-earning",
  "seller-earning",
  "withdrawal",
  "withdrawal-fee",
  "provider-fee",
  "commission",
  "refund",
  "reversal",
  "adjustment",
];

/** Human labels for the transaction history UI (Part 11). */
export const LEDGER_TYPE_LABELS: Record<LedgerTransactionType, string> = {
  deposit: "Deposit",
  purchase: "Purchase",
  "freelancer-earning": "Freelancer earning",
  "seller-earning": "Seller earning",
  withdrawal: "Withdrawal",
  "withdrawal-fee": "Withdrawal fee",
  "provider-fee": "Payment provider fee",
  commission: "Commission",
  refund: "Refund",
  reversal: "Reversal",
  adjustment: "Adjustment",
};

/** One side of a double-entry posting. A transaction has two or more. */
export interface LedgerEntry {
  /** `debit` or `credit`, exactly as the transaction was written. */
  direction: "debit" | "credit";
  accountId: string;
  amount: Minor;
  currency: Currency;
  /**
   * The wallet this entry moves, when it moves one.
   *
   * Present for user money and null for system accounts, which is what lets
   * `rebuildWallet` replay the ledger into a balance without guessing.
   */
  walletId: string | null;
}

/**
 * An immutable double-entry transaction.
 *
 * NEVER edited and NEVER deleted. A correction is a NEW reversing transaction
 * pointing back at the original via `reversesTransactionId`, so the history
 * shows both the mistake and the fix - the only form of history an auditor
 * will accept.
 */
export interface LedgerTransaction {
  id: string;
  /** Human-quotable and unique, e.g. `TXN-2026-000123`. */
  reference: string;
  type: LedgerTransactionType;
  status: LedgerStatus;
  currency: Currency;
  entries: LedgerEntry[];
  /** The deposit, withdrawal, order or payout this money came from. */
  sourceKind: string;
  sourceId: string;
  /** The provider's own reference, when there was one. Never trusted alone. */
  providerId: string | null;
  providerName: string | null;
  /** The user this affected, denormalised so history queries stay cheap. */
  userId: string | null;
  /** A free-text line for the history list. Never contains a secret. */
  description: string;
  /** Set on a reversal to point at what is being undone. */
  reversesTransactionId: string | null;
  /** Which subsystem wrote this: wallet, deposit, withdrawal, earnings, admin. */
  createdBy: string;
  createdAt: string;
  /** The idempotency key that produced it, so a replay is detectable. */
  idempotencyKey: string | null;
}
