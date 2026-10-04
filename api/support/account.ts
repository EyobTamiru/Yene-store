import { canReadAccountData } from "./auth";
import type { SupportAccountContext, SupportIdentity } from "./types";

/**
 * ============================================================================
 *  ACCOUNT CONTEXT PROVIDER
 * ============================================================================
 *
 *  Reads the caller's OWN account through the platform's secure API and turns
 *  it into a small set of plain sentences the model is allowed to quote.
 *
 *  Three rules this file enforces:
 *    1. No businessId argument exists. The only way in is the verified
 *       identity, so a caller cannot request another tenant's data.
 *    2. Anything that cannot be read comes back absent. Absent means
 *       "not available", never "assume a sensible value".
 *    3. Raw objects are never passed to the model - only these sentences -
 *       so unrelated account fields cannot leak into an answer by accident.
 *
 *  ---------------------------------------------------------------------
 *  PRODUCTION INTEGRATION POINT
 *  ---------------------------------------------------------------------
 *  `loadAccountFromPlatform` below is the seam. Replace its body with calls to
 *  your real account/orders/subscriptions service, always filtering on the
 *  businessId from the identity.
 */

const EMPTY: SupportAccountContext = { facts: [] };

/**
 * Replace with the real read. Keep every query filtered by `businessId`.
 * Return partial data rather than throwing - a missing section should not
 * disable the whole conversation.
 */
async function loadAccountFromPlatform(
  businessId: string,
): Promise<SupportAccountContext> {
  if (process.env.NODE_ENV !== "production" && process.env.AUTH_MODE === "development") {
    // Demo data so the authenticated flow can be exercised locally. Note the
    // values below are FAKE and are only reachable via dev:* tokens.
    const demo: Record<string, SupportAccountContext> = {
      "green-coffee": {
        businessName: "Green Coffee Roasters (demo)",
        packageName: "Demo package - not a real plan",
        subscriptionStatus: "Demo active",
        contactEmail: "owner@greencoffee.example",
        contactPhone: "+251 900 000 001",
        facts: [
          "The signed-in business is Green Coffee Roasters (demo). This is sample data, not a real account.",
          "The account is on the 'Demo package - not a real plan'. This is sample data.",
          "The subscription status is 'Demo active'. This is sample data.",
        ],
      },
    };
    return demo[businessId] ?? EMPTY;
  }

  // Production: no data source is connected yet, so report nothing rather
  // than risk leaking or inventing account details.
  return EMPTY;
}

/**
 * Build the account context for the caller, or an empty context when the
 * caller is a guest / customer and therefore not entitled to it.
 */
export async function getAccountContext(
  identity: SupportIdentity,
): Promise<SupportAccountContext> {
  if (!canReadAccountData(identity)) return EMPTY;

  try {
    const context = await loadAccountFromPlatform(identity.businessId as string);
    return { ...context, facts: Array.isArray(context.facts) ? context.facts : [] };
  } catch (error) {
    // Log server-side, stay silent to the user.
    console.error("[support] failed to load account context:", error);
    return EMPTY;
  }
}
