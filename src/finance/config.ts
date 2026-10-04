/**
 * ============================================================================
 *  FINANCE CONFIGURATION AND FEATURE GATES
 * ============================================================================
 *
 *  Everything an operator can change about the financial system, in one place,
 *  with the RULES that make the unsafe states unreachable rather than merely
 *  discouraged.
 *
 *  THE CENTRAL RULE: NOTHING FINANCIAL IS ON BY DEFAULT
 *  -------------------------------------------------
 *  `FINANCE_ENABLED` defaults to FALSE. With it off:
 *
 *    * no deposit can be initiated;
 *    * no withdrawal can be requested;
 *    * no wallet balance moves;
 *    * the admin finance screens read as data, not as controls.
 *
 *  That is the correct default for a feature that can hold customer funds. Part
 *  16 lists regulatory approvals YENE does not yet have, and shipping a wallet
 *  that is live by default would mean the first deployment accidentally accepts
 *  real money before those approvals exist.
 *
 *  A SECOND GATE ON TOP OF THAT
 *  ---------------------------
 *  In production the system refuses to run even if an operator sets
 *  `FINANCE_ENABLED=true` without also setting `FINANCE_PRODUCTION_APPROVED=true`.
 *  Two switches exist so that "we are still building this" and "we have the
 *  approvals" are separate, deliberate statements rather than one boolean
 *  standing in for both.
 */

import type { Minor } from "./money";

// ---------------------------------------------------------------------------
// Feature gates
// ---------------------------------------------------------------------------

export interface FinanceGates {
  /** The master switch. Nothing financial happens while this is false. */
  enabled: boolean;
  /** Deposits (money in). */
  deposits: boolean;
  /** Wallet-funded purchases. */
  walletPayments: boolean;
  /** Withdrawals (money out). The riskiest switch in the system. */
  withdrawals: boolean;
  /** Whether this environment is production. */
  production: boolean;
  /** The operator has asserted the Part 16 approvals are in place. */
  productionApproved: boolean;
  /** The mode label shown in the admin UI. */
  mode: "off" | "sandbox" | "production";
  /** A refusal every gated endpoint can return, with one explanation. */
  disabledReason: string;
}

function flag(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

/**
 * Read the gates from the environment.
 *
 * `sandbox` is the mode used when finance is enabled outside production. It
 * permits full behaviour against test credentials, so the whole flow can be
 * exercised without a merchant account - which is exactly what Part 15 asks for
 * when it says "never send real money during development testing".
 */
export function financeGates(): FinanceGates {
  const production = process.env.NODE_ENV === "production";
  const productionApproved = flag("FINANCE_PRODUCTION_APPROVED");

  // The master switch. Unset means off, everywhere, in every environment.
  let enabled = flag("FINANCE_ENABLED");

  // The production override. An unapproved production deployment cannot turn
  // finance on by flipping one variable.
  if (production && enabled && !productionApproved) {
    enabled = false;
  }

  const mode: FinanceGates["mode"] = !enabled ? "off" : production ? "production" : "sandbox";

  const disabledReason = !enabled
    ? production && flag("FINANCE_ENABLED")
      ? "The financial system is disabled: FINANCE_PRODUCTION_APPROVED is not set. " +
        "Set it only once the Part 16 regulatory and provider approvals are in place."
      : "The financial system is disabled on this deployment. An administrator must enable it."
    : "";

  // Sub-switches default to the master switch, so enabling finance does not
  // silently enable withdrawals on the same deploy.
  const sub = (name: string): boolean => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return enabled;
    return enabled && raw.trim().toLowerCase() === "true";
  };

  return {
    enabled,
    deposits: sub("FINANCE_DEPOSITS_ENABLED"),
    walletPayments: sub("FINANCE_WALLET_PAYMENTS_ENABLED"),
    withdrawals: sub("FINANCE_WITHDRAWALS_ENABLED"),
    production,
    productionApproved,
    mode,
    disabledReason,
  };
}

/** Thrown by a gated operation. The router turns it into a 503. */
export class FinanceDisabledError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "FinanceDisabledError";
    this.reason = reason;
  }
}

function requireGate(allowed: boolean, reason: string): void {
  if (!allowed) throw new FinanceDisabledError(reason);
}

export function requireFinanceEnabled(): void {
  const gates = financeGates();
  requireGate(gates.enabled, gates.disabledReason);
}

export function requireDepositsEnabled(): void {
  const gates = financeGates();
  requireGate(gates.enabled, gates.disabledReason);
  requireGate(gates.deposits, "Deposits are not enabled on this deployment.");
}

export function requireWalletPaymentsEnabled(): void {
  const gates = financeGates();
  requireGate(gates.enabled, gates.disabledReason);
  requireGate(gates.walletPayments, "Paying with a wallet balance is not enabled on this deployment.");
}

export function requireWithdrawalsEnabled(): void {
  const gates = financeGates();
  requireGate(gates.enabled, gates.disabledReason);
  requireGate(gates.withdrawals, "Withdrawals are not enabled on this deployment.");
}
