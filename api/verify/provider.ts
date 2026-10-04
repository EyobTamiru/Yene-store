/**
 * ============================================================================
 *  EXTERNAL ID VERIFICATION PROVIDER
 * ============================================================================
 *
 *  The requirement is to verify a Fayda ID and a TIN against an external
 *  service. This module is the seam for that.
 *
 *  WHAT IT WILL AND WILL NOT DO
 *  ----------------------------
 *  When `ETRADE_VERIFY_URL` and `ETRADE_API_KEY` are set, it makes a real HTTPS
 *  call and maps the response onto a verdict.
 *
 *  When they are NOT set, it returns `pending-review`. It does not return
 *  "verified", and it does not invent a reference number. This is the single
 *  most important line of behaviour in the whole verification feature: the
 *  only ways to reach a `verified` state are a genuine provider response or an
 *  explicit super-admin approval (see router.ts). Nothing else.
 *
 *  WHY A SEAM RATHER THAN A HARDCODED CALL
 *  ---------------------------------------
 *  The exact e-trade / Fayda endpoint, auth scheme and response shape are a
 *  commercial arrangement this repository does not have. Hard-coding a guessed
 *  URL would look finished and fail silently in production. A documented seam
 *  with one function to implement makes the integration a five-minute change
 *  once credentials exist, and is honest about its state until then.
 *
 *  RESPONSE SHAPE WE EXPECT (and normalise)
 *  -----------------------------------------
 *  Any of these, so a real integration is unlikely to need code changes:
 *      { "status": "valid" }            { "valid": true }
 *      { "result": "VERIFIED" }         { "matched": true }
 */

export interface VerifyInput {
  faydaId: string;
  tinNumber: string;
  fullName: string | null;
}

export type Verdict = "verified" | "rejected" | "pending-review";

export interface ProviderResult {
  verdict: Verdict;
  /** The provider's own reference, for the audit trail. Null when unverified. */
  reference: string | null;
  /** Shown to the applicant when rejected. */
  reason: string | null;
  provider: string | null;
}

function config(): { url: string; key: string } | null {
  const url = process.env.ETRADE_VERIFY_URL?.trim();
  const key = process.env.ETRADE_API_KEY?.trim();
  return url && key ? { url, key } : null;
}

export function externalVerificationConfigured(): boolean {
  return config() !== null;
}

/** Coerce a provider response into one of our three verdicts. */
function toVerdict(payload: Record<string, unknown>): Verdict {
  const status = String(payload.status ?? payload.result ?? "").toUpperCase();
  if (payload.valid === true || payload.matched === true) return "verified";
  if (["VALID", "VERIFIED", "MATCHED", "OK", "FOUND", "ACTIVE"].includes(status)) return "verified";
  if (["INVALID", "REJECTED", "NOT_FOUND", "MISMATCH", "INACTIVE", "CANCELLED"].includes(status)) {
    return "rejected";
  }
  // A response we do not understand is NOT a pass. Defaulting to "pending"
  // means an unexpected shape delays a decision instead of granting one.
  return "pending-review";
}

/**
 * Ask the external verifier about this Fayda ID + TIN pair.
 *
 * A network error, a timeout, or a malformed response all resolve to
 * `pending-review`. A provider being down must never be read as either a
 * rejection (a real person wrongly blocked) or an approval (an unchecked
 * account let through).
 */
export async function verifyWithProvider(input: VerifyInput): Promise<ProviderResult> {
  const settings = config();
  if (!settings) {
    return {
      verdict: "pending-review",
      reference: null,
      reason: null,
      provider: null,
    };
  }

  try {
    const response = await fetch(settings.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.key}`,
        Accept: "application/json",
      },
      body: JSON.stringify({
        faydaId: input.faydaId,
        tin: input.tinNumber,
        name: input.fullName,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.error(`[verify] provider responded ${response.status}`);
      return { verdict: "pending-review", reference: null, reason: null, provider: "etrade" };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const verdict = toVerdict(payload);
    const reference =
      typeof payload.reference === "string"
        ? payload.reference
        : typeof payload.referenceId === "string"
          ? payload.referenceId
          : null;

    return {
      verdict,
      reference: verdict === "verified" ? reference : null,
      reason:
        verdict === "rejected"
          ? "The Fayda ID and TIN could not be matched by the verification service."
          : null,
      provider: "etrade",
    };
  } catch (error) {
    console.error("[verify] provider call failed:", error);
    return { verdict: "pending-review", reference: null, reason: null, provider: "etrade" };
  }
}
