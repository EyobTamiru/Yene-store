/**
 * ============================================================================
 *  SUBSCRIPTION BILLING ENGINE (Sections 31-40)
 * ============================================================================
 *
 *  Pure functions. No store, no clock of its own, no I/O - every rule below is
 *  a function of its arguments, so `scripts/verify-platform.ts` can prove each
 *  one with a literal taken from the specification.
 *
 *  THE FOUR NUMERIC RULES
 *  -----------------------
 *  32  Upgrade mid-period  -> pay the DIFFERENCE now:
 *                           newPrice - currentPrice.
 *  33  Same rule on a four-month subscription, and the difference applies to
 *      the REMAINING period.
 *  34  At renewal the customer pays the FULL price of the package being
 *      renewed. The upgrade payment is not a discount and must not persist.
 *  35  Downgrade -> refund of 0. Not cash, not credit.
 *
 *  HOW RULE 34 IS MADE UNFORGETTABLE
 *  ---------------------------------
 *  Rule 34 is the one that quietly breaks in real systems. The usual bug is
 *  carrying the upgrade price forward as a "negotiated" or "effective" price,
 *  so the fourth month bills 2,500 instead of 5,000.
 *
 *  Here the upgrade charge is recorded as a DISCRETE SURCHARGE EVENT in a
 *  ledger held next to the subscription, not as a new price.
 *  `renewalInvoice()` reads `PACKAGES[current].monthlyPrice` and nothing else.
 *  `Subscription` has no field that could hold a discounted monthly price, so
 *  the bug is not "remembered not to happen" - it cannot be written down.
 *
 *  Section 37: nothing in this file deletes anything. A downgrade writes a
 *  status and a date and returns; the business's products, customers, orders
 *  and reports are not even in scope here.
 */

import { PACKAGE_ORDER, PACKAGES, isDowngrade, isUpgrade, monthlyPrice } from "./packages";
import type {
  ChangeType,
  Invoice,
  PackageChangeRecord,
  PackageId,
  Subscription,
} from "./types";

export const ETB = "ETB" as const;

/** Section 9 / 31 / 54. All money in this engine is ETB, whole numbers. */
export function formatEtb(amount: number): string {
  return `${Math.round(amount).toLocaleString("en-US")} ETB`;
}

/**
 * Section 32: the amount an upgrade costs today.
 *
 *   Silver 2,500 -> Gold 5,000  =  5,000 - 2,500  =  2,500 ETB
 *
 * Note what this is NOT: it is not a prorated fraction of the remaining
 * period, and it is not a full new month. The specification states the rule
 * once and gives the same answer regardless of how much time is left, so the
 * function ignores the remaining period entirely.
 */
export function upgradeCharge(from: PackageId, to: PackageId): number {
  const difference = monthlyPrice(to) - monthlyPrice(from);
  // Guard: a non-upgrade can never produce a negative charge. Charging a
  // customer negative money would be a refund by another name (Section 35).
  return difference > 0 ? difference : 0;
}

/** Section 35, stated as code: the refund is zero, always. */
export const NO_REFUND = 0 as const;

export function refundForDowngrade(): typeof NO_REFUND {
  return NO_REFUND;
}

/**
 * Section 36: when does a change take effect?
 *
 *  - Upgrade  : immediately. The business paid the difference for this
 *               period, so it should not have to wait for it.
 *  - Downgrade: at `currentPeriodEnd` - the renewal boundary. Section 36 is
 *               explicit: "Do not unexpectedly remove already-paid
 *               higher-package access."
 */
export function effectiveDateFor(
  from: PackageId,
  to: PackageId,
  subscription: Subscription,
): { effectiveAt: string; immediate: boolean } {
  if (isUpgrade(from, to)) {
    return { effectiveAt: new Date().toISOString(), immediate: true };
  }
  return { effectiveAt: subscription.currentPeriodEnd, immediate: false };
}

export interface ChangeQuote {
  fromPackage: PackageId;
  toPackage: PackageId;
  changeType: ChangeType;
  /** What the customer pays right now. 0 for a downgrade. */
  amountDue: number;
  /** Always 0. See Section 35 and the type note in types.ts. */
  refundAmount: typeof NO_REFUND;
  /** Any note that MUST be shown to the customer before they confirm. */
  notice: string;
  effectiveAt: string;
  immediate: boolean;
  /** Section 34: the full price the next renewal will charge. */
  nextRenewalAmount: number;
  renewalDate: string;
}

/**
 * Build the quote a customer is shown before changing package.
 *
 * Every branch states its section, because these are the numbers Yene
 * Business Group will be held to.
 */
export function quotePackageChange(
  subscription: Subscription,
  to: PackageId,
  now: Date = new Date(),
): ChangeQuote {
  const from = subscription.packageId;
  const renewalDate = subscription.currentPeriodEnd;

  if (from === to) {
    return {
      fromPackage: from,
      toPackage: to,
      changeType: "Renewal",
      amountDue: monthlyPrice(to),
      refundAmount: NO_REFUND,
      notice: `You are already on ${PACKAGES[to].name}. Renewing keeps the same package.`,
      effectiveAt: renewalDate,
      immediate: false,
      nextRenewalAmount: monthlyPrice(to),
      renewalDate,
    };
  }

  if (isUpgrade(from, to)) {
    const charge = upgradeCharge(from, to);
    return {
      fromPackage: from,
      toPackage: to,
      changeType: "Upgrade",
      amountDue: charge,
      refundAmount: NO_REFUND,
      // Section 33: applies to the remaining period, renewal is full price.
      notice:
        `Upgrading to ${PACKAGES[to].name} now costs the difference: ` +
        `${formatEtb(monthlyPrice(to))} - ${formatEtb(monthlyPrice(from))} = ${formatEtb(charge)}. ` +
        `${PACKAGES[to].name} is available for the rest of your current period. ` +
        `At renewal you pay the full ${formatEtb(monthlyPrice(to))}. ` +
        `This upgrade payment is not a permanent discount.`,
      effectiveAt: now.toISOString(),
      immediate: true,
      nextRenewalAmount: monthlyPrice(to),
      renewalDate,
    };
  }

  // Section 35 / 36: downgrade.
  const isDown = isDowngrade(from, to);
  return {
    fromPackage: from,
    toPackage: to,
    changeType: isDown ? "Downgrade" : "Renewal",
    amountDue: 0,
    refundAmount: refundForDowngrade(),
    notice:
      `Downgrading your package does not generate a refund or credit for the price difference. ` +
      `You keep ${PACKAGES[from].name} access until ${renewalDate.slice(0, 10)}, when ` +
      `${PACKAGES[to].name} becomes active at ${formatEtb(monthlyPrice(to))}.`,
    effectiveAt: renewalDate,
    immediate: false,
    nextRenewalAmount: monthlyPrice(to),
    renewalDate,
  };
}

export interface AppliedChange {
  subscription: Subscription;
  /** The Section 39 history row, written by the caller once paid. */
  changeType: ChangeType;
  amountPaid: number;
  effectiveAt: string;
  invoice: Invoice | null;
  ledger: SurchargeLedger;
}

/**
 * Apply a package change to a subscription.
 *
 * UPGRADE (Sections 32/33)
 *   - the package changes immediately;
 *   - `currentPeriodEnd` is NOT moved, because the business paid a difference
 *     for the period it already has, not for a new period;
 *   - the difference is appended to the surcharges ledger.
 *
 * DOWNGRADE (Sections 35/36)
 *   - the package is NOT lowered yet;
 *   - a `pendingChange` is recorded for the renewal boundary;
 *   - `amountPaid` is 0 and no refund is produced.
 *
 * NOTHING IS DELETED (Section 37). This function mutates one object. It has
 * no reference to products, orders, customers, reviews or reports, so there is
 * no code path here that could remove a customer's history.
 */
export function applyPackageChange(
  subscription: Subscription,
  quote: ChangeQuote,
  invoice: Invoice | null,
  ledger: SurchargeLedger,
  now: Date = new Date(),
): AppliedChange {
  const next: Subscription = { ...subscription, pendingChange: subscription.pendingChange };
  let amountPaid = 0;
  let nextLedger = ledger;
  let effectiveAt = quote.effectiveAt;

  if (quote.changeType === "Upgrade") {
    next.packageId = quote.toPackage;
    next.status = "Active";
    next.pendingChange = null;
    amountPaid = quote.amountDue;
    // Rule 34: the ledger remembers the payment; the price does not change.
    nextLedger = {
      surcharges: [
        ...ledger.surcharges,
        {
          id: `sc_${now.getTime()}_${ledger.surcharges.length + 1}`,
          label: `Upgrade to ${PACKAGES[quote.toPackage].name}`,
          amount: quote.amountDue,
          at: now.toISOString(),
          periodEnd: subscription.currentPeriodEnd,
        },
      ],
    };
  } else if (quote.changeType === "Downgrade") {
    // Effective at the renewal boundary, not now (Section 36).
    next.pendingChange = {
      toPackageId: quote.toPackage,
      changeType: "Downgrade",
      effectiveAt: quote.effectiveAt,
    };
    amountPaid = 0;
  } else {
    effectiveAt = subscription.currentPeriodEnd;
  }

  return {
    subscription: next,
    changeType: quote.changeType,
    amountPaid,
    effectiveAt,
    invoice,
    ledger: nextLedger,
  };
}

/**
 * Section 34: renew a subscription at the FULL price of its current package.
 *
 * The amount is read from the package table every single time. It is never
 * derived from what the customer last paid, which is what would turn the
 * Section 32 upgrade into a permanent discount by accident.
 *
 *   Customer:   Silver -> Gold
 *   Paid on upgrade: 2,500 ETB   (a surcharge, already in the ledger)
 *   Charged here:    5,000 ETB   (the full Gold price)
 */
export function renewalInvoice(
  subscription: Subscription,
  now: Date = new Date(),
): { subscription: Subscription; invoice: Invoice } {
  const pkg = PACKAGES[subscription.packageId];
  const amount = pkg.monthlyPrice;
  const periodStart = now.toISOString();
  const periodEnd = addPeriod(periodStart);

  const invoice: Invoice = {
    id: `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${subscription.businessId}`,
    businessId: subscription.businessId,
    type: "subscription",
    packageId: subscription.packageId,
    amount,
    currency: "ETB",
    periodStart,
    periodEnd,
    paymentReference: null,
    status: "Pending",
    issuedAt: now.toISOString(),
    lines: [
      { label: `${pkg.name} package - ${formatEtb(amount)} per month`, amount },
    ],
  };

  return {
    invoice,
    subscription: {
      ...subscription,
      status: "Active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      pendingChange: null,
    },
  };
}

/**
 * Section 36, applied on the renewal boundary: a pending downgrade becomes the
 * real package at this moment, and nothing else.
 */
export function applyPendingChange(
  subscription: Subscription,
  now: Date = new Date(),
): Subscription {
  const pending = subscription.pendingChange;
  if (!pending) return subscription;
  if (new Date(pending.effectiveAt).getTime() > now.getTime()) return subscription;
  return { ...subscription, packageId: pending.toPackageId, pendingChange: null };
}

/** Section 31: the billing dashboard card. */
export interface SubscriptionSummary {
  packageName: string;
  priceLabel: string;
  status: string;
  renewalDate: string;
  pendingChangeLabel: string | null;
  canUpgrade: PackageId[];
  canDowngrade: PackageId[];
}

export function subscriptionSummary(subscription: Subscription): SubscriptionSummary {
  const pkg = PACKAGES[subscription.packageId];
  return {
    packageName: pkg.name.toUpperCase(),
    priceLabel: `${formatEtb(pkg.monthlyPrice)}/month`,
    status: subscription.status,
    renewalDate: subscription.currentPeriodEnd,
    pendingChangeLabel: subscription.pendingChange
      ? `${PACKAGES[subscription.pendingChange.toPackageId].name} from ${subscription.pendingChange.effectiveAt.slice(0, 10)}`
      : null,
    canUpgrade: PACKAGE_ORDER.filter((id) => monthlyPrice(id) > pkg.monthlyPrice),
    canDowngrade: PACKAGE_ORDER.filter((id) => monthlyPrice(id) < pkg.monthlyPrice),
  };
}

/** Section 39: build a change history row from an applied change. */
export function buildChangeRecord(
  input: Omit<PackageChangeRecord, "id" | "at" | "previousPackage" | "newPackage"> & {
    previousPackage: PackageId;
    newPackage: PackageId;
  },
  now: Date = new Date(),
): PackageChangeRecord {
  return { ...input, id: `PC-${now.getTime()}`, at: now.toISOString() };
}


/** One month, used for the renewal boundary. 30 days keeps it arithmetic. */
export const PERIOD_DAYS = 30;

export function addPeriod(fromIso: string, days = PERIOD_DAYS): string {
  const date = new Date(fromIso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/**
 * A one-off charge that must never become a recurring price (Sections 33/34).
 */
export interface Surcharge {
  id: string;
  label: string;
  amount: number;
  at: string;
  /** Which period it was paid for. Purely for the history row. */
  periodEnd: string;
}

export interface SurchargeLedger {
  /** Every upgrade payment ever made. Read for history, never for billing. */
  surcharges: Surcharge[];
}

export function emptyLedger(): SurchargeLedger {
  return { surcharges: [] };
}

