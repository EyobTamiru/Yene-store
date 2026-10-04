/**
 * ============================================================================
 *  THE CHART OF ACCOUNTS
 * ============================================================================
 *
 *  A fixed, closed set. No operator can invent an account at runtime and no
 *  account can be deleted, because a ledger whose accounts can change shape
 *  cannot be compared across time - which is the entire reason for keeping one.
 *
 *  EVERY TRANSACTION THE SYSTEM POSTS, AND WHY IT BALANCES
 *  -------------------------------------------------------
 *
 *  1. Customer deposits 1,000 ETB (money arrives at Chapa, then becomes ours)
 *       DR  provider:chapa:settlement      1,000
 *           CR  wallet:user:<id>              1,000
 *     The customer now holds a claim on 1,000 ETB, and our provider account holds
 *     the matching asset. Both sides are custodial: neither is YENE's money.
 *
 *  2. Customer spends 700 ETB on a service (560 freelancer / 140 commission)
 *       DR  wallet:user:<id>                700
 *           CR  payable:freelancer:<id>      560
 *           CR  revenue:commission          140
 *     One debit, two credits. This is why `allocate` must sum exactly: a
 *     rounding remainder here would unbalance the whole posting.
 *
 *  3. Freelancer withdraws 500 ETB
 *       DR  payable:freelancer:<id>        500
 *           CR  provider:chapa:settlement    500
 *     The obligation leaves our books and the cash leaves the provider account.
 *
 *  4. Withdrawal fee of 10 ETB, charged to the freelancer
 *       DR  payable:freelancer:<id>         10
 *           CR  revenue:withdrawal_fee       10
 *     Charged as its own transaction (Part 9), never netted into the payout, so
 *     the fee is visible in the history and in the commission dashboard.
 *
 *  5. A provider charges 25 ETB on a deposit
 *       DR  expense:provider_fee            25
 *           CR  provider:chapa:settlement    25
 *     The provider account absorbs it, which is exactly what the settlement
 *     reconciliation compares against on the provider's own statement.
 *
 *  THE TWO RULES THAT MAKE THE ABOVE SAFE
 *  --------------------------------------
 *  * A transaction must be BALANCED: total debits === total credits. Enforced
 *    in `assertBalanced`, which refuses to build the transaction at all.
 *  * An account's class decides its normal side, and `entryFor` derives the
 *    direction from it. No caller chooses "debit" or "credit" by hand, so a
 *    sign error cannot be typed in.
 */

import type { AccountDefinition } from "./types";

/**
 * Provider settlement accounts exist PER PROVIDER.
 *
 * Reconciliation compares each provider's statement against its own account, so
 * one shared "provider" account would make a mismatch unattributable.
 */
export const PROVIDER_SETTLEMENT_ACCOUNT = (providerId: string): string =>
  `provider:${providerId.toLowerCase()}:settlement`;

/** The custodial liability that a user's wallet posts to. */
export const USER_WALLET_ACCOUNT = (userId: string): string => `wallet:user:${userId}`;

/** What YENE-STORE owes a freelancer for completed work. */
export const FREELANCER_PAYABLE_ACCOUNT = (userId: string): string => `payable:freelancer:${userId}`;

/** What YENE-STORE owes a seller/business for goods sold. */
export const SELLER_PAYABLE_ACCOUNT = (ownerId: string): string => `payable:seller:${ownerId}`;

/** Platform revenue from commissions. */
export const COMMISSION_REVENUE_ACCOUNT = "revenue:commission";

/** Platform revenue from withdrawal fees. */
export const WITHDRAWAL_FEE_REVENUE_ACCOUNT = "revenue:withdrawal_fee";

/** A provider's processing cost. An expense, never netted into revenue. */
export const PROVIDER_FEE_EXPENSE_ACCOUNT = "expense:provider_fee";

/**
 * The non-provider accounts, which are fixed forever.
 *
 * Provider settlement accounts are generated on demand and are deliberately not
 * listed here - they are derived from `PROVIDER_SETTLEMENT_ACCOUNT` so a new
 * provider needs no edit to this table.
 */
export const SYSTEM_ACCOUNTS: AccountDefinition[] = [
  {
    id: "equity:opening",
    name: "Opening balances",
    accountClass: "equity",
    normalBalance: "credit",
    currency: "ETB",
    custodial: false,
    description: "Balances in force when the financial system was enabled.",
    system: true,
  },
  {
    id: "revenue:commission",
    name: "YENE commission revenue",
    accountClass: "revenue",
    normalBalance: "credit",
    currency: "ETB",
    custodial: false,
    description: "YENE-STORE's share of every marketplace transaction.",
    system: true,
  },
  {
    id: "revenue:withdrawal_fee",
    name: "Withdrawal fee revenue",
    accountClass: "revenue",
    normalBalance: "credit",
    currency: "ETB",
    custodial: false,
    description: "Fees charged on a completed withdrawal, posted separately from the payout.",
    system: true,
  },
  {
    id: "expense:provider_fee",
    name: "Payment provider fees",
    accountClass: "expense",
    normalBalance: "debit",
    currency: "ETB",
    custodial: false,
    description: "What the providers charge us, reconciled against their statements.",
    system: true,
  },
  {
    id: "liability:provider_payable",
    name: "Payable to payment providers",
    accountClass: "liability",
    normalBalance: "credit",
    currency: "ETB",
    custodial: true,
    description: "Money owed to a provider for a payout we have initiated but not yet settled.",
    system: true,
  },
  {
    id: "asset:unreconciled",
    name: "Unreconciled differences",
    accountClass: "asset",
    normalBalance: "debit",
    currency: "ETB",
    custodial: true,
    description:
      "Holds a provider mismatch while an administrator investigates. Never auto-settled against a user balance.",
    system: true,
  },
];


/** Derived, so a new provider needs no edit to this table. */
function providerAccount(providerId: string): AccountDefinition {
  const id = PROVIDER_SETTLEMENT_ACCOUNT(providerId);
  return {
    id,
    name: `${providerId.toUpperCase()} settlement`,
    accountClass: "asset",
    normalBalance: "debit",
    currency: "ETB",
    custodial: true,
    description:
      "Money held at, or in transit from, this provider. An asset to YENE-STORE only in the sense that it is receivable; the amount belongs to users and is owed back out.",
    system: true,
  };
}

/** Derived per user, so a user never needs a row written for them in advance. */
function userWalletAccount(userId: string): AccountDefinition {
  return {
    id: USER_WALLET_ACCOUNT(userId),
    name: `Customer wallet (${userId})`,
    accountClass: "liability",
    normalBalance: "credit",
    currency: "ETB",
    custodial: true,
    description: "Money YENE-STORE holds on this user's behalf. A liability, never revenue.",
    system: true,
  };
}

function freelancerPayableAccount(userId: string): AccountDefinition {
  return {
    id: FREELANCER_PAYABLE_ACCOUNT(userId),
    name: `Freelancer payable (${userId})`,
    accountClass: "liability",
    normalBalance: "credit",
    currency: "ETB",
    custodial: true,
    description: "Completed work this freelancer has earned and not yet been paid for.",
    system: true,
  };
}

function sellerPayableAccount(ownerId: string): AccountDefinition {
  return {
    id: SELLER_PAYABLE_ACCOUNT(ownerId),
    name: `Seller payable (${ownerId})`,
    accountClass: "liability",
    normalBalance: "credit",
    currency: "ETB",
    custodial: true,
    description: "Goods sold by this business that have not yet been settled out.",
    system: true,
  };
}

/**
 * The accounts that actually exist: the fixed set plus every provider and every
 * user account that has been touched.
 *
 * `userIds` and `providerIds` come from the live data, so this reflects the
 * accounts in use rather than a hard-coded roster that would go stale.
 */
export function chartOfAccounts(userIds: string[], providerIds: string[]): AccountDefinition[] {
  const accounts = [...SYSTEM_ACCOUNTS];
  for (const providerId of providerIds) accounts.push(providerAccount(providerId));
  for (const userId of userIds) {
    accounts.push(userWalletAccount(userId));
    accounts.push(freelancerPayableAccount(userId));
    accounts.push(sellerPayableAccount(userId));
  }
  return accounts;
}

/**
 * The definition for an account id, or null when the id is not in the chart.
 *
 * Returning null rather than inventing a default is deliberate: a posting to an
 * account nobody defined must fail loudly, not be quietly absorbed somewhere.
 */
export function accountDefinition(
  accountId: string,
  knownUserIds: string[],
  knownProviderIds: string[],
): AccountDefinition | null {
  const inSystem = SYSTEM_ACCOUNTS.find((account) => account.id === accountId);
  if (inSystem) return inSystem;

  if (accountId.startsWith("provider:")) {
    const providerId = accountId.split(":")[1] ?? "";
    // Only a provider that is actually known gets an account, so a typo in a
    // provider id cannot silently create a real-looking ledger account.
    return knownProviderIds.some((id) => id.toLowerCase() === providerId.toLowerCase())
      ? providerAccount(providerId)
      : null;
  }

  const userScoped = [
    { prefix: "wallet:user:", build: userWalletAccount },
    { prefix: "payable:freelancer:", build: freelancerPayableAccount },
    { prefix: "payable:seller:", build: sellerPayableAccount },
  ];
  for (const entry of userScoped) {
    if (!accountId.startsWith(entry.prefix)) continue;
    const userId = accountId.slice(entry.prefix.length);
    if (!knownUserIds.includes(userId)) return null;
    return entry.build(userId);
  }
  return null;
}
