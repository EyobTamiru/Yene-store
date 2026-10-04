/**
 * ============================================================================
 *  WALLET ROUTER - mounted at /api/wallet
 * ============================================================================
 *
 *  READ-ONLY, AND DELIBERATELY SO.
 *
 *  This router exposes exactly one endpoint, `GET /api/wallet`, which returns
 *  the caller's own balance. It has no POST, PUT, PATCH or DELETE, so there is
 *  no public route anywhere in the system that can modify a balance - which is
 *  the requirement in Part 13 ("Do not implement public endpoints for modifying
 *  user balances") enforced by omission rather than by a guard that could be
 *  bypassed.
 *
 *  MONEY IN AND MONEY OUT arrive in Phases 2-4, and when they do they will
 *  require provider verification before a single cent moves. Adding them here
 *  now, with nothing to verify against, would be the "fake payment success" the
 *  specification forbids.
 *
 *  THE FEATURE GATE
 *  ----------------
 *  When `FINANCE_ENABLED` is not set - the default, in every environment - the
 *  endpoint still answers, and it answers with the gate state rather than an
 *  error. The header needs to know WHY a wallet is not moving, and a 503 alone
 *  cannot say that. A signed-in user on a disabled deployment therefore gets
 *  their real (empty) wallet plus `finance.enabled: false` and a reason, so
 *  the UI can show an honest state instead of an error.
 *
 *  AUTHENTICATION AND OWNERSHIP
 *  ----------------------------
 *  The wallet is resolved from the SESSION, never from the request. There is no
 *  `userId` parameter to get wrong and no path where a caller names somebody
 *  else's wallet. This is the same rule that keeps `businessId` out of every
 *  request body in this codebase, and it is why this router is small enough to
 *  audit in one reading.
 */

import { Router, type Request, type Response } from "express";
import { financeGates } from "../../src/finance/config";
import { resolveAuthContext } from "../auth/sessions";
import { SESSION_COOKIE } from "../auth/types";
import { getOrCreateWallet, toPublicWallet } from "./walletService";

export const walletRouter = Router();

/**
 * A coarse per-IP limit, in the same shape as the auth router's.
 *
 * This endpoint is a cheap read of a small JSON file, so the ceiling is high
 * enough not to be noticed and low enough that a script cannot enumerate
 * accounts by watching response timing. It is keyed on the IP only; there is no
 * per-account limit because there is nothing expensive to protect here.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(req: Request): boolean {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

/** Test seam: forget the counters. */
export function resetWalletRateLimits(): void {
  hits.clear();
}

// ---------------------------------------------------------------------------
// GET /api/wallet - my wallet
// ---------------------------------------------------------------------------

walletRouter.get("/", (req: Request, res: Response) => {
  if (rateLimited(req)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }

  // The gate state travels WITH the response rather than replacing it, so the
  // client learns the reason in the same round trip it learns the balance.
  const gates = financeGates();

  const context = resolveAuthContext(req, SESSION_COOKIE);
  if (!context) {
    // Not signed in. This is not an error - a signed-out visitor simply has no
    // wallet, and the header shows a "sign in to see your balance" affordance.
    return res.status(200).json({
      authenticated: false,
      wallet: null,
      finance: { enabled: gates.enabled, mode: gates.mode, reason: gates.disabledReason },
    });
  }

  const wallet = getOrCreateWallet(context.userId, context.role, new Date().toISOString());

  return res.status(200).json({
    authenticated: true,
    wallet: toPublicWallet(wallet),
    // What this deployment is currently permitted to do. The UI uses it to
    // decide whether to offer "Add money" or explain that the feature is off,
    // rather than letting a user discover it by pressing a button that fails.
    finance: {
      enabled: gates.enabled,
      mode: gates.mode,
      reason: gates.disabledReason,
      depositsEnabled: gates.deposits,
      withdrawalsEnabled: gates.withdrawals,
      walletPaymentsEnabled: gates.walletPayments,
    },
  });
});
