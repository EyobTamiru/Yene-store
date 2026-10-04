/**
 * ============================================================================
 *  PLATFORM IDENTITY (Section 50)
 * ============================================================================
 *
 *  The same shape as api/support/auth.ts, and for the same reason.
 *
 *  THE RULE
 *  -------
 *      businessId comes from the verified token and ONLY from the token.
 *
 *  It must never be read from the request body, a query string, or a header
 *  the browser can freely set. The moment a caller can choose their own
 *  businessId, every isolation guarantee on the platform collapses: one
 *  business could read another's products, orders, customers, stock and
 *  revenue.
 *
 *  The support system already learned this lesson (see api/support/tenant.ts),
 *  so the platform reuses the same development-only identity resolver and the
 *  same fail-closed production behaviour: an unverified request resolves to a
 *  guest, never to a business.
 */

import type { Request } from "express";
import { resolveAuthContext } from "../auth/sessions";
import { SESSION_COOKIE } from "../auth/types";
import type { AuthContext } from "../auth/types";
import type { PlatformRole } from "./types";

/** Identity of the caller, derived from a verified token - never the body. */
export interface PlatformIdentity {
  userId: string;
  businessId: string | null;
  displayName: string | null;
  role: PlatformRole;
  isSuperAdmin: boolean;
  isAuthenticated: boolean;
}

const DEV_TOKEN_PREFIX = "dev";

/**
 * Tokens valid only when AUTH_MODE=development, so the platform can be
 * exercised locally. `production` returns null here and the resolver falls
 * through to the guest path below.
 */
const DEV_IDENTITIES: Record<string, PlatformIdentity> = {
  "dev:owner-platinum": {
    userId: "u-alemayehu",
    businessId: "green-coffee",
    displayName: "Alemayehu (demo owner)",
    role: "owner",
    isSuperAdmin: false,
    isAuthenticated: true,
  },
  "dev:employee-platinum": {
    userId: "u-selam",
    businessId: "green-coffee",
    displayName: "Selam (demo employee)",
    role: "employee",
    isSuperAdmin: false,
    isAuthenticated: true,
  },
  "dev:owner-silver": {
    userId: "u-dawit",
    businessId: "blue-shop",
    displayName: "Dawit (demo Silver owner)",
    role: "owner",
    isSuperAdmin: false,
    isAuthenticated: true,
  },
  "dev:customer": {
    userId: "u-shopper",
    businessId: null,
    displayName: "Demo customer",
    role: "customer",
    isSuperAdmin: false,
    isAuthenticated: true,
  },
  "dev:superadmin": {
    userId: "u-superadmin",
    businessId: null,
    displayName: "Yene Super Admin",
    role: "super-admin",
    isSuperAdmin: true,
    isAuthenticated: true,
  },
};

function isDevelopmentAuthEnabled(): boolean {
  // Never enabled in a production build, whatever the environment says.
  if (process.env.NODE_ENV === "production") return false;
  return process.env.AUTH_MODE === "development";
}

/** A guest: not signed in. The safe default for every failure path. */
export function guestIdentity(): PlatformIdentity {
  return {
    userId: "guest",
    businessId: null,
    displayName: null,
    role: "guest",
    isSuperAdmin: false,
    isAuthenticated: false,
  };
}

export function resolveIdentity(req: Request): PlatformIdentity {
  // ---------------------------------------------------------------------
  //  1. THE REAL SESSION COOKIE
  // ---------------------------------------------------------------------
  // The path the browser actually uses, and tried FIRST.
  //
  // `api/auth/sessions.ts` stores only a `userId` and re-resolves the user
  // record on every request, so the `businessId` returned here comes from the
  // USER RECORD and never from anything the caller sent. That is the
  // multi-tenant guarantee this module exists to protect.
  //
  // Previously the platform accepted ONLY an `Authorization: Bearer` header.
  // The browser never sends one for a cookie session, so every real signed-in
  // owner resolved to a guest and the whole business management area stayed
  // closed even though sign-in had succeeded.
  const session = resolveAuthContext(req, SESSION_COOKIE);
  if (session) return fromAuthContext(session);

  // ---------------------------------------------------------------------
  //  2. A BEARER SESSION ID, or a development identity
  // ---------------------------------------------------------------------
  // `resolveAuthContext` also reads a session id from the Authorization header,
  // so this covers a native or mobile client that cannot use cookies. Still
  // server-side, and still no businessId from the caller.
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) {
      const bearer = resolveAuthContext(req, SESSION_COOKIE);
      if (bearer) return fromAuthContext(bearer);
    }

    // -------------------------------------------------------------------
    //  3. DEVELOPMENT IDENTITIES
    // -------------------------------------------------------------------
    // The `dev:*` tokens used by the verification suites and the local demo
    // panel. Never available in production, whatever the environment says.
    if (token && isDevelopmentAuthEnabled() && token.startsWith(`${DEV_TOKEN_PREFIX}:`)) {
      return DEV_IDENTITIES[token] ?? guestIdentity();
    }
  }

  // No usable credential: a guest. Every failure path lands here, which keeps
  // the fail-closed default the platform has always had.
  return guestIdentity();
}

/** Project an auth context onto the platform identity shape. */
function fromAuthContext(context: AuthContext): PlatformIdentity {
  return {
    userId: context.userId,
    businessId: context.businessId,
    displayName: context.name,
    role: mapUserRoleToPlatformRole(context.role, context.isSuperAdmin),
    isSuperAdmin: context.isSuperAdmin,
    isAuthenticated: true,
  };
}

/**
 * Map the auth module's role vocabulary onto the platform's.
 *
 * `UserRole` is "owner | manager | employee | customer | super-admin";
 * `PlatformRole` adds "guest" for the unauthenticated case. An unrecognised
 * value maps to the MOST RESTRICTIVE role rather than a permissive one, so a
 * role nobody has thought about cannot accidentally inherit owner rights.
 */
function mapUserRoleToPlatformRole(role: string, isSuperAdmin: boolean): PlatformRole {
  if (isSuperAdmin) return "super-admin";
  switch (role) {
    case "owner":
      return "owner";
    case "manager":
      return "manager";
    case "employee":
      return "employee";
    case "customer":
      return "customer";
    default:
      return "guest";
  }
}

/** May this caller act on behalf of `businessId`? */
export function canAccessBusiness(
  identity: PlatformIdentity,
  businessId: string,
): { allowed: boolean; reason: "ok" | "not-authenticated" | "different-business" } {
  if (!identity.isAuthenticated) return { allowed: false, reason: "not-authenticated" };
  if (identity.isSuperAdmin) return { allowed: true, reason: "ok" };
  if (identity.businessId !== businessId) return { allowed: false, reason: "different-business" };
  return { allowed: true, reason: "ok" };
}

export function requireSuperAdmin(identity: PlatformIdentity): boolean {
  return identity.isAuthenticated && identity.isSuperAdmin;
}
