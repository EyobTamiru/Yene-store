/**
 * ============================================================================
 *  AUTH API CLIENT
 * ============================================================================
 *
 *  Credentials: `credentials: "same-origin"` on every call, because the session
 *  lives in an HTTP-only cookie that JavaScript cannot read. That is the whole
 *  point of the cookie - an XSS bug cannot exfiltrate the session.
 *
 *  Note what is NOT here: any function that sends a `businessId`. The client
 *  never chooses a tenant. It asks "who am I" and renders whatever the server
 *  says, which is how the frontend is prevented from selecting another
 *  business even if it wanted to.
 */

export class AuthError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string) {
    super("auth_failed");
    this.name = "AuthError";
    this.userMessage = userMessage;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      // The session cookie must ride along.
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    console.error("[auth] network failure:", error);
    throw new AuthError("We could not reach YENE-STORE. Please check your connection.");
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : "Something went wrong. Please try again.";
    throw new AuthError(message);
  }
  return body as T;
}

const post = <T,>(path: string, payload: unknown) =>
  call<T>(path, { method: "POST", body: JSON.stringify(payload) });

/** Section 1 step 1: ask for a code. The response never reveals whether the
 *  account exists, and never contains the code. */
export const requestCode = (email: string) =>
  post<{ success: boolean; message: string; expiresAt?: string }>("/api/auth/request-token", {
    email,
  });

/** Section 1 step 2: submit the code and receive a session. */
export const verifyCode = (email: string, token: string) =>
  post<{ success: boolean; message: string; user: { id: string; name: string; email: string; role: string } }>(
    "/api/auth/verify-token",
    { email, token },
  );

/** Section 10: register a business and its owner. */
export const signUp = (details: {
  businessName: string;
  email: string;
  phone?: string;
  location?: string;
  packageId?: string;
  type?: "standalone" | "mall";
  /** Section 41: the mall's id from the directory picker. */
  mall?: string;
  floor?: string;
  /**
   * Section 41: every room the store occupies. Sent as a list because a shop
   * may trade out of more than one counter; the server re-parses separators so
   * a single "GFS-024 & GFS-030" entry still lands as two rooms.
   */
  rooms?: string[];
}) =>
  post<{
    success: boolean;
    message: string;
    business: { id: string; name: string; subdomain: string };
    nextStep: string;
  }>("/api/auth/signup", details);

/** Sign in with an EMAIL or a USERNAME plus a password. */
export const signInWithPassword = (identifier: string, password: string) =>
  post<{ success: boolean; message: string; user: PublicUser }>("/api/auth/signin", {
    identifier,
    password,
  });

/**
 * Ask for a password reset link.
 *
 * The server's reply is deliberately identical for a known and an unknown
 * address, so `message` is shown verbatim and nothing here can be used to work
 * out whether somebody has an account. The token never appears in this
 * response - it only ever exists in the email.
 */
export const requestPasswordReset = (email: string) =>
  post<{ success: boolean; message: string }>("/api/auth/forgot-password", { email });

/**
 * Redeem a reset link.
 *
 * `token` is the `token=` value from the emailed link. On success the response
 * is a 200 and the new password is live; every way a token can fail returns the
 * same message, so the UI cannot tell "wrong link" from "expired link".
 */
export const resetPassword = (token: string, password: string) =>
  post<{ success: boolean; message: string; user: PublicUser }>("/api/auth/reset-password", {
    token,
    password,
  });

/**
 * Reads the `token` query parameter out of a `#/reset-password?token=...` link.
 *
 * Kept next to the two calls above so the shape of the emailed link is defined
 * in exactly one place. Returns null for anything unparseable, which the screen
 * treats as "no link" rather than as an error worth showing.
 */
export function resetTokenFromLocation(hash: string = window.location.hash): string | null {
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) return null;
  try {
    return new URLSearchParams(hash.slice(queryIndex + 1)).get("token");
  } catch {
    return null;
  }
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: string;
  identityProvider: "email-code" | "password" | "google" | "yoti";
  hasPassword: boolean;
  yotiVerifiedName: string | null;
  storeRentalApproved: boolean;
}

/** Register a CUSTOMER. Open to anyone; renting a store stays gated. */
export const registerCustomer = (details: {
  name: string;
  email: string;
  username: string;
  password: string;
}) => post<{ success: boolean; message: string; user: PublicUser }>("/api/auth/register", details);

/** Which federated sign-in providers this server can actually use. */
export const fetchProviders = () =>
  call<{ google: boolean; googleClientId: string | null; yoti: boolean }>("/api/auth/providers");

/** Exchange a Google ID token (already verified in the browser) for a session. */
export const signInWithGoogle = (idToken: string) =>
  post<{ success: boolean; message: string; user: PublicUser; created: boolean }>("/api/auth/google", {
    idToken,
  });

/** Attach a completed Yoti scan to the signed-in account. */
export const submitYotiScan = (payloadToken: string) =>
  post<{ success: boolean; user: PublicUser }>("/api/auth/yoti", { payloadToken });

export interface MeResponse {
  authenticated: boolean;
  user?: PublicUser;
  business?: {
    id: string;
    name: string;
    subdomain: string;
    status: string;
    packageId: string;
  } | null;
  isSuperAdmin?: boolean;
}

export const fetchMe = () => call<MeResponse>("/api/auth/me");

/** Section 20: logout. The cookie is cleared and the session revoked. */
export const signOut = () => post<{ success: boolean }>("/api/auth/logout", {});
