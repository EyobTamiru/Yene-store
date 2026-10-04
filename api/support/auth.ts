import type { Request } from "express";
import type { SupportIdentity, SupportRole } from "./types";

/**
 * ============================================================================
 *  IDENTITY RESOLUTION - the security boundary for the support bot
 * ============================================================================
 *
 *  The single most important rule in this file:
 *
 *      businessId comes from the verified token and ONLY from the token.
 *
 *  It must never be read from the request body, a query string, or a header
 *  the browser can freely set. If a caller could choose their own businessId,
 *  every isolation guarantee in the product would collapse and one business
 *  could read another's account, orders and stock.
 *
 *  Every handler in router.ts takes the identity as an argument precisely so
 *  that this cannot be bypassed by accident.
 */

const DEV_TOKEN_PREFIX = "dev";

/** Tokens valid in development mode, so the bot can be exercised locally. */
const DEV_IDENTITIES: Record<string, SupportIdentity> = {
  "dev:green-coffee": {
    userId: "dev-user-1",
    businessId: "green-coffee",
    displayName: "Alemayehu (demo owner)",
    role: "owner",
    isAuthenticated: true,
  },
  "dev:staff-member": {
    userId: "dev-user-2",
    businessId: "green-coffee",
    displayName: "Demo employee",
    role: "employee",
    isAuthenticated: true,
  },
  "dev:shopper": {
    userId: "dev-user-3",
    businessId: null,
    displayName: "Demo customer",
    role: "customer",
    isAuthenticated: true,
  },
};

function isDevelopmentAuthEnabled(): boolean {
  // Refuse the demo resolver unless the operator explicitly opted in, and
  // never allow it to be switched on in a production build.
  if (process.env.NODE_ENV === "production") return false;
  return process.env.AUTH_MODE === "development";
}

/** A guest: not signed in. Safe default for every failure path. */
export function guestIdentity(): SupportIdentity {
  return {
    userId: "guest",
    businessId: null,
    displayName: null,
    role: "unknown",
    isAuthenticated: false,
  };
}

/**
 * Resolve the caller from the Authorization header.
 *
 * Returns a guest identity rather than throwing when no valid token is
 * present - the chat endpoint is usable by guests, it just cannot reveal
 * account data for them.
 */
export function resolveIdentity(req: Request): SupportIdentity {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return guestIdentity();

  const token = header.slice("Bearer ".length).trim();
  if (!token) return guestIdentity();

  if (isDevelopmentAuthEnabled() && token.startsWith(`${DEV_TOKEN_PREFIX}:`)) {
    return DEV_IDENTITIES[token] ?? guestIdentity();
  }

  // ---------------------------------------------------------------------
  //  PRODUCTION INTEGRATION POINT
  // ---------------------------------------------------------------------
  //  Replace this block with a real verification, e.g.:
  //
  //    const claims = await verifySessionToken(token);   // your auth provider
  //    if (!claims) return guestIdentity();
  //    return {
  //      userId: claims.sub,
  //      businessId: claims.businessId,   // from the signed claim, not the body
  //      displayName: claims.name ?? null,
  //      role: mapRole(claims.role),
  //      isAuthenticated: true,
  //    };
  //
  //  Until that is wired up, every production request resolves to a guest, so
  //  the bot degrades safely: it answers general questions and offers human
  //  support rather than risking a cross-tenant data leak.
  return guestIdentity();
}

/** Roles may read account data. Customers and guests may not. */
export function canReadAccountData(identity: SupportIdentity): boolean {
  return identity.isAuthenticated && identity.businessId !== null;
}
