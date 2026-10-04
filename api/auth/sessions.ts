/**
 * ============================================================================
 *  SESSIONS (specification sections 10, 12, 20, 21)
 * ============================================================================
 *
 *  A session stores ONE thing: a `userId`. Not a businessId, not a role, not a
 *  bag of claims.
 *
 *  That is the whole of section 10 and section 12:
 *
 *      Authenticated Session -> User ID -> User record -> Business -> businessId
 *
 *  The business is re-resolved from the user record on EVERY request, so:
 *
 *    * there is no code path where a caller supplies a businessId;
 *    * a user who moves to another business is re-resolved immediately, rather
 *      than carrying a stale tenant inside a token until it expires;
 *    * `businessId` is never something the browser has seen and can replay.
 *
 *  Sessions are carried by an HTTP-only cookie (preferred) or an
 *  `Authorization: Bearer` value, so the same server logic serves both the
 *  browser and any future mobile or API client.
 */

import { generateSessionId } from "./crypto";
import { SESSION_TTL_MS, type AuthContext, type Session, type User } from "./types";
import { allSessions, persistSessions, userById } from "./store";
import type { Request, Response } from "express";

export function createSession(
  userId: string,
  ip: string | null,
  userAgent: string | null = null,
): Session {
  const now = Date.now();
  const session: Session = {
    id: generateSessionId(),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    revokedAt: null,
    userAgent,
    ip,
  };
  allSessions().push(session);
  persistSessions();
  return session;
}

export function isSessionValid(session: Session, now = Date.now()): boolean {
  return session.revokedAt === null && new Date(session.expiresAt).getTime() > now;
}

/** Section 20: logout revokes the session; it is not merely forgotten. */
export function revokeSession(sessionId: string): boolean {
  const session = allSessions().find((entry) => entry.id === sessionId);
  if (!session || session.revokedAt !== null) return false;
  session.revokedAt = new Date().toISOString();
  persistSessions();
  return true;
}

export function revokeAllForUser(userId: string): number {
  let revoked = 0;
  for (const session of allSessions()) {
    if (session.userId === userId && session.revokedAt === null) {
      session.revokedAt = new Date().toISOString();
      revoked += 1;
    }
  }
  if (revoked > 0) persistSessions();
  return revoked;
}

/** Section 24: drop sessions that are expired or already revoked. */
export function sweepSessions(now = Date.now()): number {
  const list = allSessions();
  const before = list.length;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!isSessionValid(list[i], now)) list.splice(i, 1);
  }
  const removed = before - list.length;
  if (removed > 0) persistSessions();
  return removed;
}

// ---------------------------------------------------------------------------
// Reading the session off a request
// ---------------------------------------------------------------------------

/** Parse a Cookie header without a dependency. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function sessionIdFrom(req: Request, cookieName: string): string | null {
  const cookie = readCookie(req, cookieName);
  if (cookie) return cookie;
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const value = header.slice("Bearer ".length).trim();
    // A `dev:` value is the development identity, not a session.
    if (value && !value.startsWith("dev:")) return value;
  }
  return null;
}

/**
 * Resolve the caller to a full AuthContext, or null.
 *
 * `businessId` is read from the USER RECORD here, and nowhere else.
 */
export function resolveAuthContext(
  req: Request,
  cookieName: string,
): AuthContext | null {
  const id = sessionIdFrom(req, cookieName);
  if (!id) return null;

  const session = allSessions().find((entry) => entry.id === id);
  if (!session || !isSessionValid(session)) return null;

  const user = userById(session.userId);
  if (!user || !user.active) return null;

  // Refresh `lastSeenAt` at most once a minute, so a busy session does not
  // rewrite the file on every request.
  if (Date.now() - new Date(session.lastSeenAt).getTime() > 60_000) {
    session.lastSeenAt = new Date().toISOString();
    persistSessions();
  }

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    // THE LINE THAT MAKES TENANT ISOLATION WORK.
    businessId: user.businessId,
    role: user.role,
    isSuperAdmin: user.role === "super-admin",
    sessionId: session.id,
  };
}

/** Section 12: set the session cookie. HTTP-only, SameSite=Lax, Secure in prod. */
export function setSessionCookie(res: Response, sessionId: string, cookieName: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000,
    )}${secure}`,
  );
}

export function clearSessionCookie(res: Response, cookieName: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`,
  );
}

/** The public shape of a signed-in user. Never includes the business id. */
export function publicUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
