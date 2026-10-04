/**
 * ============================================================================
 *  STORE RENTAL CLIENT
 * ============================================================================
 *
 *  The browser can apply for a counter and search the queue, but it can never
 *  DECIDE anything about an approval. `review` sends a decision, not a verdict,
 *  and the server resolves who it applies to - so a caller cannot approve a
 *  stranger by asking nicely, and cannot see a shortlist the server did not
 *  agree to show.
 *
 *  Mirrors `VerifyError`'s contract (`userMessage` the UI shows verbatim) so it
 *  behaves identically to the other client modules while staying separately
 *  catchable from an `AuthError`.
 */

export class RentalError extends Error {
  readonly userMessage: string;
  /** Set when the server refused an ambiguous match and offered candidates. */
  readonly candidates: SearchCandidate[];
  readonly ambiguous: boolean;
  constructor(userMessage: string, candidates: SearchCandidate[] = [], ambiguous = false) {
    super("rental_failed");
    this.name = "RentalError";
    this.userMessage = userMessage;
    this.candidates = candidates;
    this.ambiguous = ambiguous;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    console.error("[rental] network failure:", error);
    throw new RentalError("We could not reach YENE-STORE. Please check your connection.");
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const message =
      typeof body.error === "string" ? body.error : "Something went wrong. Please try again.";
    throw new RentalError(
      message,
      Array.isArray(body.candidates) ? (body.candidates as SearchCandidate[]) : [],
      body.ambiguous === true,
    );
  }
  return body as T;
}

/** How the server found an applicant. Shown so the decision is never blind. */
export type MatchTier = "fayda" | "tin" | "phone" | "name" | "none";

export interface SearchCandidate {
  id: string;
  fullName: string;
  businessName: string;
  phone: string;
  tier: MatchTier;
  confidence: number;
}

export interface RentalUnit {
  number: string;
  floor: string;
  sizeSqm: number;
  monthlyRentEtb: number;
}

export interface RentalApplication {
  id: string;
  businessName: string;
  fullName: string;
  phone: string;
  /** e.g. "911 23• 4567" - enough to confirm, not enough to leak on a screen. */
  phoneMasked: string;
  mallId: string;
  mallName: string;
  floor: string;
  rooms: string[];
  packageId: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  matchedBy: string | null;
  matchedQuery: string | null;
}

/** One row of the administrator's queue. */
export interface QueueRow extends RentalApplication {
  accountName: string | null;
  identityStatus: "not-started" | "pending-review" | "verified" | "rejected";
  faydaMasked: string | null;
  identityVerified: boolean;
  units: { number: string; sizeSqm: number; monthlyRentEtb: number; status: string }[];
  match?: { tier: MatchTier; confidence: number; reason: string };
}

export interface QueueResponse {
  applications: QueueRow[];
  query: string | null;
  /** True when the search named more than one person. Blocks one-click approve. */
  ambiguous: boolean;
  reason: string | null;
  matchedBy?: string;
  counts?: { pending: number; total: number };
}

// ---------------------------------------------------------------------------
// Applicant
// ---------------------------------------------------------------------------

export const fetchUnits = (mall: string) =>
  call<{ mall: { id: string; name: string; floors: string[] }; units: RentalUnit[] }>(
    `/api/rental/units?mall=${encodeURIComponent(mall)}`,
  );

/**
 * Apply for a counter.
 *
 * `fullName` and `phone` are required by the server, and deliberately so: they
 * are what makes the application findable by an administrator later.
 */
export const applyForRental = (details: {
  businessName: string;
  fullName: string;
  phone: string;
  mall: string;
  floor: string;
  rooms: string[];
  packageId?: string;
}) =>
  call<{
    success: boolean;
    message: string;
    application: RentalApplication;
    units: string[];
    identityVerified: boolean;
  }>("/api/rental/apply", { method: "POST", body: JSON.stringify(details) });

export const fetchMyApplications = () =>
  call<{ applications: Array<RentalApplication & { units: string[] }> }>("/api/rental/mine");

// ---------------------------------------------------------------------------
// Administrator
// ---------------------------------------------------------------------------

/**
 * The queue, optionally searched.
 *
 * `q` is the one box that takes a phone number OR a name. Nothing is approved by
 * calling this - it only ever returns rows for a human to act on.
 */
export const fetchQueue = (options: { status?: string; query?: string } = {}) => {
  const params = new URLSearchParams();
  params.set("status", options.status ?? "pending");
  if (options.query) params.set("q", options.query);
  return call<QueueResponse>(`/api/rental/admin/applications?${params.toString()}`);
};

/**
 * Approve or reject, naming the applicant either by id or by the same query the
 * search box used.
 *
 * Passing `query` rather than `id` is the point: the administrator can clear the
 * queue without ever learning an internal id, typing the number they were given
 * on the phone. The server refuses if that query is ambiguous.
 */
export const reviewRental = (details: {
  id?: string;
  query?: string;
  decision: "approve" | "reject";
  reason?: string;
}) =>
  call<{
    success: boolean;
    message: string;
    application: RentalApplication;
    business?: { id: string; name: string; subdomain: string };
    identityVerified: boolean;
  }>("/api/rental/admin/review", { method: "POST", body: JSON.stringify(details) });