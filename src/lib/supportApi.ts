import {
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_LENGTH,
  type ResolutionAnswer,
} from "../constants";
import type { QuickActionCategory } from "../constants";

/** Mirrors the server's response shape. */
export interface ChatResponse {
  reply: string;
  category: QuickActionCategory;
  grounded: boolean;
  needsHuman: boolean;
  needsClarification: boolean;
  sources: { id: string; title: string }[];
  viewer: {
    isAuthenticated: boolean;
    displayName: string | null;
    businessName: string | null;
  };
  sessionId: string;
  escalation?: { reasons: string[]; priority: string };
}

export interface HandoffResponse {
  ok: true;
  ticketId: string;
  status: string;
  message: string;
}

export class SupportUnavailableError extends Error {
  constructor() {
    // The message is intentionally generic: it is the only text the UI is
    // allowed to show for a failed call. Real causes stay in the console.
    super("support_unavailable");
    this.name = "SupportUnavailableError";
  }
}

const SESSION_KEY = "yene-support-session";
const TOKEN_KEY = "yene-support-token";

/** Stable per-browser session id, echoed back to the server for transcripts. */
export function getSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const created = `s_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
    localStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    // Private mode: fall back to a per-tab id.
    return `s_${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * The bearer token for the signed-in user.
 *
 * Replace `readStoredToken` with your real auth provider. It is sent in the
 * Authorization header only; it is never put in a URL or logged.
 */
export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Used by the demo to simulate sign-in as an owner / employee / customer. */
export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked - treat as guest */
  }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Support-Session": getSessionId(),
  };
  const token = readStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("[support] network failure:", error);
    throw new SupportUnavailableError();
  }

  if (!response.ok) {
    // Log the status for developers; never render it.
    console.error(`[support] ${path} returned ${response.status}`);
    throw new SupportUnavailableError();
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    console.error("[support] malformed response:", error);
    throw new SupportUnavailableError();
  }
}

export interface OutgoingTurn {
  role: "user" | "assistant";
  content: string;
}

export function sendMessage(
  message: string,
  history: OutgoingTurn[],
): Promise<ChatResponse> {
  return post<ChatResponse>("/api/support/chat", {
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    history: history.slice(-MAX_HISTORY_MESSAGES),
    page: "widget",
  });
}

export function requestHandoff(
  sessionId: string,
  reason?: string,
): Promise<HandoffResponse> {
  return post<HandoffResponse>("/api/support/handoff", { sessionId, reason });
}

// ---------------------------------------------------------------------------
// Section 7: the post-resolution survey
// ---------------------------------------------------------------------------

export interface SurveyState {
  show: boolean;
  answered: boolean;
  resolved: boolean;
}

/**
 * Ask the server whether the resolution survey should be shown.
 *
 * The decision is server-side and rule-based; the browser never decides that a
 * survey is due. A failure resolves to "do not show" so a support problem can
 * never turn into a broken-looking widget.
 */
export async function fetchSurveyState(): Promise<SurveyState> {
  try {
    const response = await fetch("/api/support/survey", {
      headers: buildHeaders(),
    });
    if (!response.ok) throw new Error(String(response.status));
    const body = (await response.json()) as Partial<SurveyState>;
    return {
      show: body.show === true,
      answered: body.answered === true,
      resolved: body.resolved === true,
    };
  } catch (error) {
    console.error("[support] survey state unavailable:", error);
    return { show: false, answered: false, resolved: false };
  }
}

export interface FeedbackPayload {
  resolved: ResolutionAnswer;
  rating?: number;
  comment?: string;
}

/** Record the survey answer. The rating and the comment are both optional. */
/** Record the survey answer. The rating and the comment are both optional. */
export function submitSurveyFeedback(payload: FeedbackPayload): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/api/support/feedback", payload);
}

// ---------------------------------------------------------------------------
// Section 9, component 8: Customer Support History
// ---------------------------------------------------------------------------

/**
 * A support request as the CUSTOMER sees it.
 *
 * The server has already stripped internal notes, the AI handover summary,
 * attachments and the phone number, so this type has no field for them. Keeping
 * them out of the client type is deliberate: a field that does not exist cannot
 * be rendered by accident.
 */
export interface CustomerTicket {
  ticketId: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  conversation: { role: string; content: string }[];
  events: { id: string; at: string; type: string; actor: string; body?: string; internal: boolean }[];
}

export const fetchMyTickets = () =>
  fetch("/api/support/tickets", { headers: buildHeaders() }).then(async (response) => {
    if (!response.ok) throw new SupportUnavailableError();
    return (await response.json()) as { ok: boolean; tickets: CustomerTicket[] };
  });

export const fetchMyTicket = (id: string) =>
  fetch(`/api/support/ticket/${encodeURIComponent(id)}`, { headers: buildHeaders() }).then(
    async (response) => {
      if (!response.ok) throw new SupportUnavailableError();
      return (await response.json()) as { ok: boolean; ticket: CustomerTicket };
    },
  );

export const closeMyTicket = (id: string) =>
  post<{ ok: boolean; ticket: CustomerTicket }>(
    `/api/support/ticket/${encodeURIComponent(id)}`,
    { status: "Closed" },
  );

