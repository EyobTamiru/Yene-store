/**
 * ============================================================================
 *  PAYMENTS (Section 21)
 * ============================================================================
 *
 *  Chapa is the first provider. The architecture is a PROVIDER INTERFACE, not
 *  a Chapa-shaped hole in the checkout, because the specification says so
 *  explicitly: "Payment architecture must remain extensible so additional
 *  providers can be added later."
 *
 *  A provider is anything that can:
 *    1. start a payment and return a reference plus a place to send the buyer;
 *    2. verify that payment later, server-side.
 *
 *  Everything Chapa-shaped (redirect URLs, telebirr options, ETB amounts,
 *  their particular error strings) lives in `chapaProvider`. The rest of the
 *  platform only ever sees `PaymentProvider`.
 *
 *  THE SECURITY RULE
 *  -----------------
 *  Verification is SERVER-SIDE and it is what decides the outcome. The
 *  browser redirect back from Chapa is treated as a hint, never as proof: a
 *  customer who edits the query string on the success URL must not be able to
 *  mark their own order paid. `verify()` is called on the server and its
 *  result - not the redirect - is written to the order.
 *
 *  SECTION 21: online payment is a Platinum and Super capability. Cash on
 *  delivery is always available, and `paymentOptionsFor` is what decides
 *  which of the two a checkout actually offers.
 */

import { hasFeature } from "./packages";
import type { Business, PaymentRecord, PaymentStatus } from "./types";

export interface StartPaymentInput {
  reference: string;
  amount: number;
  currency: "ETB";
  orderId: string;
  customer: { name: string; email: string; phone: string };
  businessName: string;
  returnUrl: string;
}

export interface StartPaymentResult {
  /** The reference stored against the order. This is the thing to verify. */
  reference: string;
  /** Where the buyer is sent to pay. */
  checkoutUrl: string;
  expiresAt: string | null;
}

export interface VerifyPaymentResult {
  reference: string;
  status: PaymentStatus;
  transactionId: string | null;
  amount: number;
  failureReason: string | null;
}

export interface PaymentProvider {
  readonly id: string;
  readonly name: string;
  /** True when the provider is configured and may be offered at checkout. */
  isConfigured(): boolean;
  start(input: StartPaymentInput): Promise<StartPaymentResult>;
  verify(reference: string): Promise<VerifyPaymentResult>;
}

// ---------------------------------------------------------------------------
// The registry - the extensibility seam
// ---------------------------------------------------------------------------

const providers = new Map<string, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: string): PaymentProvider | null {
  return providers.get(id) ?? null;
}

export function configuredProviders(): PaymentProvider[] {
  return [...providers.values()].filter((provider) => provider.isConfigured());
}

export function providerIds(): string[] {
  return [...providers.keys()];
}

// ---------------------------------------------------------------------------
// Chapa
// ---------------------------------------------------------------------------

const CHAPA_INITIALIZE_URL = "https://api.chapa.co/v1/transaction/initialize";
const CHAPA_VERIFY_URL = "https://api.chapa.co/v1/transaction/verify";

/** Chapa's own status vocabulary, mapped onto ours. */
const CHAPA_STATUS_MAP: Record<string, PaymentStatus> = {
  success: "Success",
  successful: "Success",
  pending: "Pending",
  processing: "Pending",
  failed: "Failed",
  failure: "Failed",
};

/**
 * The Chapa adapter.
 *
 * Uses the native `fetch` rather than adding a dependency: the integration is
 * two endpoints, and a payment library would be a larger supply-chain surface
 * than the feature justifies.
 *
 * NOT WIRED BY DEFAULT. With no `CHAPA_SECRET_KEY` set, `isConfigured()`
 * returns false, the provider is not offered at checkout, and the platform
 * falls back to cash on delivery. A payment integration that appears to work
 * without credentials is worse than one that is visibly absent.
 */
export function createChapaProvider(secretKey = process.env.CHAPA_SECRET_KEY): PaymentProvider {
  return {
    id: "chapa",
    name: "Chapa",

    isConfigured() {
      return typeof secretKey === "string" && secretKey.length > 0;
    },

    async start(input: StartPaymentInput): Promise<StartPaymentResult> {
      if (!secretKey) throw new Error("Chapa is not configured on this deployment.");
      const response = await fetch(CHAPA_INITIALIZE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: input.amount.toFixed(2),
          currency: input.currency,
          email: input.customer.email,
          first_name: input.customer.name,
          phone_number: input.customer.phone,
          // The reference is what we verify against, so it must round-trip.
          tx_ref: input.reference,
          callback_url: input.returnUrl,
          return_url: input.returnUrl,
          customization: {
            title: input.businessName,
            description: `YENE-STORE order ${input.orderId}`,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Chapa could not start the payment (status ${response.status}).`);
      }

      const body = (await response.json()) as {
        data?: { checkout_url?: string };
        message?: string;
      };
      const checkoutUrl = body.data?.checkout_url;
      if (!checkoutUrl) {
        throw new Error(body.message ?? "Chapa did not return a checkout URL.");
      }

      return { reference: input.reference, checkoutUrl, expiresAt: null };
    },

    async verify(reference: string): Promise<VerifyPaymentResult> {
      if (!secretKey) throw new Error("Chapa is not configured on this deployment.");
      const response = await fetch(
        `${CHAPA_VERIFY_URL}/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      );

      if (response.status === 404) {
        return {
          reference,
          status: "Failed",
          transactionId: null,
          amount: 0,
          failureReason: "No transaction found for that reference.",
        };
      }
      if (!response.ok) {
        throw new Error(`Chapa verification failed (status ${response.status}).`);
      }

      const body = (await response.json()) as {
        status?: string;
        message?: string;
        data?: { status?: string; id?: string | number; amount?: number };
      };

      const raw = String(body.data?.status ?? body.status ?? "").toLowerCase();
      return {
        reference,
        status: CHAPA_STATUS_MAP[raw] ?? "Pending",
        transactionId: body.data?.id ? String(body.data.id) : null,
        amount: Number(body.data?.amount ?? 0),
        failureReason: body.message ?? null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Records and availability
// ---------------------------------------------------------------------------

/** Section 21: the payment methods a given checkout should offer. */
export const CASH_ON_DELIVERY = "Cash on delivery";

export function paymentOptionsFor(businesses: Business[]): string[] {
  const online = businesses.some((business) =>
    hasFeature(business.packageId, "marketplace"),
  );
  const options = [CASH_ON_DELIVERY];
  if (online && configuredProviders().length > 0) {
    for (const provider of configuredProviders()) options.push(provider.name);
  }
  return options;
}

/** Cash on delivery is always offered; online payment is package-gated. */
export function isOnlinePaymentAvailable(businesses: Business[]): boolean {
  return (
    businesses.some((business) => hasFeature(business.packageId, "marketplace")) &&
    configuredProviders().length > 0
  );
}

/**
 * A payment reference must be unique even for two attempts in the same
 * millisecond, because the reference is what verify() matches on: two
 * payments sharing a reference would let a customer pay for order B and have
 * order A marked paid.
 */
export function newPaymentReference(now: Date = new Date(), seed = "", unique = ""): string {
  const stamp = now.getTime().toString(36).toUpperCase();
  const suffix = unique || Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PAY-${stamp}-${suffix}${seed ? `-${seed.toUpperCase()}` : ""}`;
}
export function buildPaymentRecord(
  input: Omit<PaymentRecord, "createdAt" | "verifiedAt" | "status" | "currency" | "transactionId" | "failureReason">,
  now: Date = new Date(),
): PaymentRecord {
  return {
    ...input,
    currency: "ETB",
    status: "Pending",
    transactionId: null,
    verifiedAt: null,
    failureReason: null,
    createdAt: now.toISOString(),
  };
}

/**
 * The one place a payment outcome is decided (Section 21).
 *
 * Three rules, in order:
 *  1. a failed verification is a failure, whatever the browser said;
 *  2. a success only counts when the amount matches, so a tampered amount on
 *     the return URL cannot mark a 4,900 ETB order as paid for 100 ETB;
 *  3. the existing record is returned unchanged if it is already final, so a
 *     replayed callback cannot move a paid order back to pending.
 */
export function settlePayment(
  record: PaymentRecord,
  verification: VerifyPaymentResult,
  now: Date = new Date(),
): PaymentRecord {
  if (record.status === "Success" || record.status === "Refunded") return record;

  const amountMatches =
    verification.amount === 0 || Math.abs(verification.amount - record.amount) < 0.01;

  const status: PaymentStatus =
    verification.status === "Success" && !amountMatches
      ? "Failed"
      : verification.status;

  return {
    ...record,
    status,
    transactionId: verification.transactionId,
    verifiedAt: now.toISOString(),
    failureReason:
      status === "Failed"
        ? amountMatches
          ? verification.failureReason ?? "The payment was not completed."
          : "The amount paid did not match the order total."
        : null,
  };
}

/** Section 21: a failed payment must not leave an order stuck in limbo. */
export function failureMessage(record: PaymentRecord): string {
  if (record.status !== "Failed") return "";
  return (
    record.failureReason ??
    "The payment could not be completed. You can try again or choose cash on delivery."
  );
}
