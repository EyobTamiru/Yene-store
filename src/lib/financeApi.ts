/**
 * ============================================================================
 *  FINANCE API CLIENT
 * ============================================================================
 *
 *  Thin, like every other client in this folder: it carries the session cookie,
 *  it returns parsed JSON, and it never decides a financial outcome.
 *
 *  ONE RULE WORTH WRITING DOWN
 *  ---------------------------
 *  There is no function here that MOVES money. A `deposit`, a `withdraw` or a
 *  `purchase` call belongs in this file only once a payment provider exists to
 *  verify it against, and the server must be the thing that decides the result
 *  (Part 3: "Never credit a customer wallet based only on... a client-side
 *  success message"). Adding one now would create the exact affordance the
 *  specification warns against.
 *
 *  Amounts arrive as INTEGER CENTS, never as strings. `WalletResponse.wallet`
 *  mirrors the server's `PublicWallet`, and the client formats for display
 *  using `formatMoney` from src/finance/money - so there is exactly one place
 *  where a number of cents becomes a number of birrs, and it is not this file.
 */

export class FinanceError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string) {
    super("finance_failed");
    this.name = "FinanceError";
    this.userMessage = userMessage;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      // The session cookie must ride along: the wallet is resolved from the
      // session, never from anything the page can set.
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    // Deliberately says nothing about finance. A network failure is reported
    // as a connectivity problem, which is all we actually know.
    throw new FinanceError("We could not reach YENE-STORE. Please check your connection.");
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
    throw new FinanceError(message);
  }
  return body as T;
}

/** Mirrors `PublicWallet` in api/finance/walletService.ts. All amounts are cents. */
export interface WalletResponse {
  id: string;
  kind: "customer" | "freelancer" | "seller" | "business" | "admin";
  currency: "ETB";
  available: number;
  pending: number;
  reserved: number;
  withheld: number;
  total: number;
  status: "active" | "frozen" | "closed" | "under-review";
  createdAt: string;
  updatedAt: string;
  totals: {
    deposits: number;
    withdrawals: number;
    purchases: number;
    earnings: number;
    fees: number;
  };
  frozenReason: string | null;
  canWithdraw: boolean;
}

/** What this deployment is currently permitted to do. */
export interface FinanceState {
  enabled: boolean;
  mode: "off" | "sandbox" | "production";
  reason: string;
  depositsEnabled?: boolean;
  withdrawalsEnabled?: boolean;
  walletPaymentsEnabled?: boolean;
}

export interface WalletEnvelope {
  authenticated: boolean;
  wallet: WalletResponse | null;
  finance: FinanceState;
}

/**
 * The caller's own wallet.
 *
 * Safe to call while signed out: it answers with `authenticated: false` and a
 * null wallet rather than an error, which is what lets the header render a
 * "sign in" affordance without special-casing the error path.
 *
 * `wallet` is null only when signed out. A signed-in user always gets a real
 * wallet object, created empty on first read - never a fabricated balance.
 */
export const fetchWallet = () => call<WalletEnvelope>("/api/wallet");

export { formatMoney, formatSigned, toDecimalString } from "../finance/money";
export type { Minor } from "../finance/money";
