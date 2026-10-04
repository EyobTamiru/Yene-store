/**
 * ============================================================================
 *  WALLET SERVICE - read path
 * ============================================================================
 *
 *  This service can CREATE a wallet and READ one. It cannot change a balance.
 *
 *  WHY THERE IS NO SET-BALANCE FUNCTION
 *  ------------------------------------
 *  Part 2 says "Do not allow users to directly edit their balances. All balance
 *  changes must be performed through validated backend financial transactions."
 *  The strongest way to honour that in code is for no such function to EXIST.
 *  There is no `setBalance`, no `adjustBalance`, no `credit` and no `debit` in
 *  this file. When deposits and purchases are built (Phases 2 and 3) they will
 *  post through the ledger and update the wallet in the same operation, in a
 *  `postingService` - not here.
 *
 *  A GETTER THAT CREATES
 *  --------------------
 *  `getOrCreateWallet` creates an empty wallet on first read. That is deliberate
 *  and is NOT a way to invent money: a new wallet is born with every bucket at
 *  exactly zero, so "just created" and "no wallet" are the same observable
 *  state. It exists so a signed-in customer sees a real zero balance rather than
 *  an error, and so the header has something honest to show.
 *
 *  IDEMPOTENT
 *  ----------
 *  Re-reading never duplicates a wallet: the lookup is by (userId, kind), and
 *  two kinds for one user are two different wallets, which is what lets a
 *  customer also be a seller without one balance shadowing the other.
 *
 *  THE PROJECTION
 *  --------------
 *  `toPublicWallet` is the ONLY shape that leaves the server, and it carries no
 *  secrets - no user id, no internal account ids, no provider references. It is
 *  the same discipline as `toPublicUser` in api/auth/types.ts.
 */

import { randomBytes } from "node:crypto";
import { isMinor, type Minor } from "../../src/finance/money";
import type { Wallet, WalletBucket, WalletKind, WalletStatus } from "../../src/finance/types";
import { allWallets, persistWallets } from "./store";

/** Which wallet a given user role gets on first read. */
const DEFAULT_KIND_BY_ROLE: Record<string, WalletKind> = {
  customer: "customer",
  owner: "business",
  manager: "business",
  employee: "business",
  "super-admin": "admin",
};

export function defaultWalletKind(role: string): WalletKind {
  return DEFAULT_KIND_BY_ROLE[role] ?? "customer";
}

/** A wallet with every bucket at exactly zero. The only way one is born. */
export function emptyWallet(userId: string, kind: WalletKind, now: string): Wallet {
  return {
    id: `wal-${randomBytes(8).toString("hex")}`,
    userId,
    kind,
    currency: "ETB",
    available: 0,
    pending: 0,
    reserved: 0,
    withheld: 0,
    status: "active",
    createdAt: now,
    updatedAt: now,
    totals: { deposits: 0, withdrawals: 0, purchases: 0, earnings: 0, fees: 0 },
    frozenReason: null,
    frozenBy: null,
    frozenAt: null,
  };
}

/** The wallet for a user of a given kind, or null. Never creates. */
export function walletFor(userId: string, kind: WalletKind): Wallet | null {
  if (!userId) return null;
  return allWallets().find((wallet) => wallet.userId === userId && wallet.kind === kind) ?? null;
}

/** Every wallet a user holds, whatever the kind. */
export function walletsForUser(userId: string): Wallet[] {
  if (!userId) return [];
  return allWallets().filter((wallet) => wallet.userId === userId);
}

/**
 * The user's wallet of the default kind, created empty on first read.
 *
 * Idempotent: a second call for the same user returns the same wallet and
 * writes nothing.
 */
export function getOrCreateWallet(userId: string, role: string, now: string): Wallet {
  const kind = defaultWalletKind(role);
  const existing = walletFor(userId, kind);
  if (existing) return existing;

  const wallet = emptyWallet(userId, kind, now);
  allWallets().push(wallet);
  persistWallets();
  return wallet;
}

/** The sum of every bucket - the wallet's total position. */
export function walletTotal(wallet: Wallet): Minor {
  return wallet.available + wallet.pending + wallet.reserved + wallet.withheld;
}

/** A single bucket, or zero when there is no wallet. */
export function balanceOf(wallet: Wallet | null, bucket: WalletBucket = "available"): Minor {
  if (!wallet) return 0;
  return wallet[bucket];
}

/**
 * The shape a browser receives.
 *
 * Deliberately omits `userId` (the caller already knows who they are) and every
 * internal identifier. Amounts are the raw integer `Minor` values, NOT formatted
 * strings: formatting is a presentation concern and belongs in the client, and a
 * formatted string in an API response invites somebody parsing it back into a
 * number.
 */
export interface PublicWallet {
  id: string;
  kind: WalletKind;
  currency: "ETB";
  available: Minor;
  pending: Minor;
  reserved: Minor;
  withheld: Minor;
  total: Minor;
  status: WalletStatus;
  createdAt: string;
  updatedAt: string;
  totals: Wallet["totals"];
  /** Shown to the user when frozen. Never a secret. */
  frozenReason: string | null;
  /** True when this wallet may request a payout, per the limits policy. */
  canWithdraw: boolean;
}

export function toPublicWallet(wallet: Wallet): PublicWallet {
  return {
    id: wallet.id,
    kind: wallet.kind,
    currency: wallet.currency,
    available: wallet.available,
    pending: wallet.pending,
    reserved: wallet.reserved,
    withheld: wallet.withheld,
    total: walletTotal(wallet),
    status: wallet.status,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
    totals: wallet.totals,
    frozenReason: wallet.frozenReason,
    // Mirrors PAYOUT_PERMITTED_KINDS, so the UI does not offer a button the
    // server would refuse. The server re-checks regardless - this is
    // convenience, never the control.
    canWithdraw: wallet.kind !== "customer",
  };
}

/**
 * A defensive read used by the verification suites.
 *
 * Every bucket must be an exact integer. A wallet holding a fractional value
 * is reported rather than silently formatted, because that is the corruption
 * this whole system is designed to make impossible - and a suite that could not
 * see it would be a suite that could not catch it.
 */
export function walletIsSane(wallet: Wallet): boolean {
  return (
    isMinor(wallet.available) &&
    isMinor(wallet.pending) &&
    isMinor(wallet.reserved) &&
    isMinor(wallet.withheld) &&
    isMinor(wallet.totals.deposits) &&
    isMinor(wallet.totals.withdrawals) &&
    isMinor(wallet.totals.purchases) &&
    isMinor(wallet.totals.earnings) &&
    isMinor(wallet.totals.fees)
  );
}
