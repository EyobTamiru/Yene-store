/**
 * ============================================================================
 *  FEDERATED IDENTITY - Google and Yoti
 * ============================================================================
 *
 *  Two very different integrations, and the difference matters:
 *
 *  GOOGLE is fully implementable now. The browser gets an ID token from
 *  Google's own button, and we verify that token SERVER-SIDE against Google
 *  before trusting a single field of it. Nothing is taken on the client's word.
 *
 *  YOTI is a real service with a real integration path, but it requires a
 *  commercial agreement and API key. This module implements the SERVER half
 *  completely - the callback contract, the verification call, the record
 *  update - and reports `configured: false` when no key is present. It does NOT
 *  simulate a successful check. A Yoti badge that appears without Yoti having
 *  been called is a forged identity badge, which is precisely the thing an ID
 *  verification product exists to prevent.
 *
 *  THE RULE BOTH SHARE
 *  -------------------
 *  A federated login may ONLY establish WHO you are. It never grants a
 *  business, a role, or store-rental rights. Those come from the local user
 *  record, exactly as they do for a password login.
 */

import { normalizeEmail } from "./store";

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

export interface GoogleTokenInfo {
  /** Google's stable user id (`sub`). The account key. */
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export type GoogleResult =
  | { ok: true; profile: GoogleTokenInfo }
  | { ok: false; configured: boolean; error: string };

/** The Web application client id from the Google Cloud console. */
export function googleClientId(): string | null {
  const value = process.env.GOOGLE_CLIENT_ID?.trim();
  return value ? value : null;
}

export function googleConfigured(): boolean {
  return googleClientId() !== null;
}

/**
 * Verify a Google ID token by asking Google about it.
 *
 * The token is NOT decoded here. `jwt.decode` would only read the payload - it
 * performs no signature check, so a forged token with a well-formed payload
 * would sail through. Instead the token goes to Google's tokeninfo endpoint and
 * the claims come back from Google itself.
 *
 * Two checks matter and both are enforced:
 *   1. `aud` must equal OUR client id, so a token minted for some other
 *      application cannot be replayed against us;
 *   2. `email_verified` must be true, so an unverified Google address cannot
 *      claim a local account.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleResult> {
  const clientId = googleClientId();
  if (!clientId) {
    return {
      ok: false,
      configured: false,
      error: "Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID to enable it.",
    };
  }
  if (!idToken || idToken.length > 4096) {
    return { ok: false, configured: true, error: "Google did not return a valid ID token." };
  }

  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) {
      return { ok: false, configured: true, error: "Google could not verify that sign-in. Please try again." };
    }
    const info = (await response.json()) as Record<string, unknown>;

    if (typeof info.sub !== "string" || !info.sub) {
      return { ok: false, configured: true, error: "Google did not return an account id." };
    }
    if (info.aud !== clientId) {
      // The token is genuine, but it was issued for a different application.
      return { ok: false, configured: true, error: "That Google sign-in was for a different application." };
    }
    if (info.email_verified !== true && info.email_verified !== "true") {
      return { ok: false, configured: true, error: "Your Google email address is not verified." };
    }
    if (typeof info.email !== "string" || !info.email) {
      return { ok: false, configured: true, error: "Google did not return an email address." };
    }

    return {
      ok: true,
      profile: {
        sub: info.sub,
        email: normalizeEmail(info.email),
        email_verified: true,
        name: typeof info.name === "string" ? info.name : undefined,
        picture: typeof info.picture === "string" ? info.picture : undefined,
      },
    };
  } catch (error) {
    console.error("[auth] Google verification failed:", error);
    return { ok: false, configured: true, error: "We could not reach Google. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Yoti
// ---------------------------------------------------------------------------

export interface YotiResult {
  /** Yoti's reference for the completed scan. */
  reference: string | null;
  /** The name Yoti read from the document. Display only - never an identity. */
  verifiedName: string | null;
  configured: boolean;
}

export function yotiConfigured(): boolean {
  return Boolean(process.env.YOTI_API_KEY?.trim());
}

/**
 * The SERVER half of a Yoti check.
 *
 * Yoti's client SDK runs in the browser and hands back a scan result; the
 * server must then confirm that result with Yoti before believing it. This
 * function performs exactly that confirmation.
 *
 * When `YOTI_API_KEY` is absent there is no Yoti to ask, so it returns
 * `configured: false` and the caller records the submission as PENDING REVIEW.
 * It never returns a synthetic reference, because a fabricated reference would
 * let anyone mint a "Yoti verified" badge for free.
 */
export async function verifyYotiScan(payloadToken: string): Promise<YotiResult> {
  const apiKey = process.env.YOTI_API_KEY?.trim();
  if (!apiKey) {
    return { reference: null, verifiedName: null, configured: false };
  }
  if (!payloadToken || payloadToken.length > 8192) {
    return { reference: null, verifiedName: null, configured: true };
  }

  try {
    const response = await fetch("https://api.yoti.com/sdk/v1.0/results", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ payload: payloadToken }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { reference: null, verifiedName: null, configured: true };
    }

    const data = (await response.json()) as {
      referenceId?: string;
      data?: { attributes?: { name?: { value?: string } } };
    };

    return {
      reference: typeof data.referenceId === "string" ? data.referenceId : null,
      verifiedName: data.data?.attributes?.name?.value ?? null,
      configured: true,
    };
  } catch (error) {
    console.error("[auth] Yoti verification failed:", error);
    return { reference: null, verifiedName: null, configured: true };
  }
}
