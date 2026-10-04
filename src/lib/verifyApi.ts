/**
 * ============================================================================
 *  IDENTITY VERIFICATION CLIENT
 * ============================================================================
 *
 *  The browser can submit a Fayda ID, a TIN and document images, but it can
 *  never DECIDE anything about them - the status it renders is whatever the
 *  server reports. That is why there is no client-side "mark as verified" call.
 *
 *  Mirrors `AuthError`'s contract (a `userMessage` the UI shows verbatim) so both
 *  client modules behave identically, while staying separately catchable.
 */

/**
 * A verification failure. Distinct from AuthError so a caller can tell a
 * rejected document from a rejected login.
 */
export class VerifyError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super("verify_failed");
    this.name = "VerifyError";
    this.userMessage = userMessage;
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
    console.error("[verify] network failure:", error);
    throw new VerifyError("We could not reach YENE-STORE. Please check your connection.");
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const message =
      typeof body.error === "string" ? body.error : "Something went wrong. Please try again.";
    throw new VerifyError(message);
  }
  return body as T;
}

export type VerificationStatus = "not-started" | "pending-review" | "verified" | "rejected";

export interface VerificationState {
  status: VerificationStatus;
  faydaId: string | null;
  tinNumber: string | null;
  fullName: string | null;
  phone: string | null;
  hasFront: boolean;
  hasBack: boolean;
  provider: string | null;
  reason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  approvedForRental: boolean;
}

export const fetchVerification = () =>
  call<{
    verification: VerificationState;
    externalVerifierConfigured: boolean;
    canRentStore: boolean;
  }>("/api/verify/me");

export const submitVerificationProfile = (details: {
  faydaId: string;
  tinNumber: string;
  fullName?: string;
  phone?: string;
}) =>
  call<{ success: boolean; message: string; verification: VerificationState }>(
    "/api/verify/profile",
    { method: "POST", body: JSON.stringify(details) },
  );

/**
 * Read a File as a base64 data URL. Done here rather than server-side so the
 * upload is a single JSON request and the project needs no multipart library.
 */
function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new VerifyError("We could not read that file."));
    reader.readAsDataURL(file);
  });
}

/** Upload one side of the Fayda card. Front and back are both optional. */
export async function uploadDocument(side: "front" | "back", file: File) {
  const dataUrl = await toDataUrl(file);
  return call<{ success: boolean; verification: VerificationState }>("/api/verify/document", {
    method: "POST",
    body: JSON.stringify({ side, dataUrl }),
  });
}

/** Fetch my own stored image, for the preview. Same-origin so the cookie rides. */
export const documentUrl = (side: "front" | "back") => `/api/verify/document/${side}`;
