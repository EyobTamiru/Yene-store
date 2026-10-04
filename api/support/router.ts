import { Router, type Request, type Response } from "express";
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_LENGTH } from "../../src/constants";
import { knowledgeBaseStats } from "../../src/knowledge/retrieval";
import { getIssues } from "../../src/knowledge/repository";
import { answerSupportQuestion, isAiConfigured } from "./ai";
import { resolveIdentity } from "./auth";
import { evaluateEscalation, indicatesStillUnresolved } from "./escalation";
import { getAccountContext } from "./account";
import { buildHandoffSummary } from "./summary";
import {
  createTicketFromChat,
  getTicketForOwner,
  getSession,
  getUnresolvedStreak,
  listTicketsForCaller,
  notifyTicketCreated,
  recordTurn,
  ticketForCustomer,
  updateTicketStatusForOwner,
} from "./tickets";
import { TICKET_STATUSES, type ChatTurn, type ChatResponseBody, type EscalationReason, type HandoffRequestBody, type SupportIdentity, type TicketStatus } from "./types";
import { markEscalated, recordTurn as recordAnalyticsTurnRaw } from "./analyticsStore";
import { getSurveyState, indicatesResolved, parseSubmission, submitFeedback } from "./satisfaction";

export const supportRouter = Router();

// ---------------------------------------------------------------------------
// Basic abuse protection
// ---------------------------------------------------------------------------
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Return a customer-safe 400 without echoing the raw payload. */
function badRequest(res: Response, message: string): Response {
  return res.status(400).json({ error: message });
}

// ---------------------------------------------------------------------------
// Sanitisation helpers - the browser is never trusted
// ---------------------------------------------------------------------------
function sanitizeMessage(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function sanitizeHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_HISTORY_MESSAGES)
    .filter(
      (turn): turn is Record<string, unknown> =>
        !!turn && typeof turn === "object",
    )
    .filter((turn) => turn.role === "user" || turn.role === "assistant")
    .map((turn) => ({
      role: turn.role as ChatTurn["role"],
      content: sanitizeMessage(turn.content),
    }))
    .filter((turn) => turn.content.length > 0);
}

/** Server-generated session id; anything the client sends is ignored. */
function ensureSessionId(req: Request, res: Response): string {
  const existing = req.headers["x-support-session"];
  if (typeof existing === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
    return existing;
  }
  const created = `s_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  res.setHeader("X-Support-Session", created);
  return created;
}

/**
 * Section 7: fold one answered turn into the analytics store.
 *
 * Derives everything from data the pipeline already produced - grounding,
 * cited sources, escalation reasons - so nothing is judged twice and the model
 * is never asked about metrics. Deliberately best-effort: `recordTurn` swallows
 * its own errors, so an analytics problem can never fail a support reply.
 */
function recordAnalyticsTurn(
  sessionId: string,
  message: string,
  result: { category: ChatResponseBody["category"]; grounded: boolean; sources: { id: string }[]; escalation?: { reasons: EscalationReason[] } },
  identity: SupportIdentity,
): void {
  recordAnalyticsTurnRaw({
    conversationId: sessionId,
    question: message,
    category: result.category,
    grounded: result.grounded,
    sourceIds: result.sources.map((source) => source.id),
    escalationReasons: result.escalation?.reasons ?? [],
    customerSignedOff: indicatesResolved(message),
    wasAuthenticated: identity.isAuthenticated,
  });
}

// ---------------------------------------------------------------------------
// POST /api/support/chat
// ---------------------------------------------------------------------------
supportRouter.post("/chat", async (req: Request, res: Response) => {
  if (rateLimited(clientKey(req))) {
    return res.status(429).json({
      error: "Too many messages. Please wait a moment and try again.",
    });
  }

  const identity = resolveIdentity(req);
  const sessionId = ensureSessionId(req, res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const message = sanitizeMessage(body.message);

  if (!message) return badRequest(res, "Please type a message.");

  const history = sanitizeHistory(body.history);
  const streak = getUnresolvedStreak(sessionId);
  const stillUnresolved = indicatesStillUnresolved(message);

  try {
    const result = await answerSupportQuestion(
      message,
      history,
      identity,
      sessionId,
      streak,
    );

    const session = getSession(sessionId, identity);
    const account = session?.account ?? { facts: [] };

    // Keep the transcript for the handoff, never for anything else.
    recordTurn(sessionId, { role: "user", content: message }, identity, {
      account,
      incrementUnresolved: stillUnresolved,
    });
    recordTurn(sessionId, { role: "assistant", content: result.reply }, identity, {
      account,
    });

    // Section 7: record how this turn went, for aggregate reporting only.
    // Placed after the reply is produced so a tracking failure can never delay
    // or alter what the customer receives.
    recordAnalyticsTurn(sessionId, message, result, identity);

    return res.status(200).json(result);
  } catch (error) {
    // answerSupportQuestion is designed not to throw; this is the last resort.
    console.error("[support] chat handler failed:", error);
    return res.status(503).json({
      error: "Yene AI Support is temporarily unavailable.",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/support/handoff - open a support ticket
//
// Builds the AI handover summary and the ticket, then notifies the team.
// The customer receives a ticket id they can quote.
// ---------------------------------------------------------------------------
supportRouter.post("/handoff", async (req: Request, res: Response) => {
  if (rateLimited(clientKey(req))) {
    return res.status(429).json({
      error: "Too many requests. Please wait a moment and try again.",
    });
  }

  const identity = resolveIdentity(req);
  const sessionId = ensureSessionId(req, res);
  const body = (req.body ?? {}) as HandoffRequestBody;

  const reason = typeof body.reason === "string" ? sanitizeMessage(body.reason) : "";

  try {
    const session = getSession(sessionId, identity);
    // The session may have been recorded before any account data was read
    // (for example when the AI backend was unavailable). Re-read if needed so
    // the ticket is not left with a business id instead of a business name.
    let account = session?.account ?? { facts: [] };
    if (account.facts.length === 0 && identity.isAuthenticated) {
      account = await getAccountContext(identity);
    }

    // Build a transcript that always includes the reason the customer gave,
    // even if the browser did not send the conversation.
    const transcript: ChatTurn[] = [...(session?.turns ?? [])];
    if (reason) transcript.push({ role: "user", content: reason });

    const escalation = evaluateEscalation(
      {
        message: reason || transcript[transcript.length - 1]?.content || "",
        isAuthenticated: identity.isAuthenticated,
        unresolvedStreak: session?.unresolvedStreak ?? 0,
      },
      false,
    );

    const aiSummary = buildHandoffSummary({
      identity,
      account,
      transcript,
      escalation,
      grounded: false,
      citedArticleIds: [],
      offeredHuman: true,
      askedClarification: false,
    });

    const ticket = createTicketFromChat({
      sessionId,
      identity,
      account,
      escalation,
      transcript,
      description: reason || aiSummary.customerProblem,
      aiSummary,
    });

    // Section 7: the conversation genuinely became a human conversation.
    markEscalated(sessionId, escalation.reasons, ticket.ticketId);

    // Fire and forget - a failed notification must not fail the request.
    void notifyTicketCreated(ticket);

    return res.status(200).json({
      ok: true,
      ticketId: ticket.ticketId,
      status: ticket.status,
      message:
        transcript.length > 0
          ? "A support agent has been notified and our conversation has been shared with them, so you don't need to explain everything again."
          : "A support agent has been notified and will contact you.",
    });
  } catch (error) {
    console.error("[support] handoff failed:", error);
    return res.status(503).json({
      error:
        "I could not open the request automatically. Please contact Yene Business Group support directly.",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/support/tickets - the caller's OWN support requests
//
// Component 8 of the specification: Customer Support History.
//
// Returns only what the caller is entitled to, already passed through
// `ticketForCustomer`, so internal notes, the AI summary, attachments and the
// phone number are stripped in the same place as everywhere else. There is no
// query parameter that can widen this to another business.
// ---------------------------------------------------------------------------
supportRouter.get("/tickets", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  // A guest has no identity, so they have no history. An empty list is the
  // honest answer; prompting them to sign in would be a lie about what we hold.
  const tickets = listTicketsForCaller(identity);
  return res.status(200).json({ ok: true, tickets });
});

// ---------------------------------------------------------------------------
// GET /api/support/ticket/:id - the caller's own ticket, customer view
//
// Internal notes, the AI summary and the customer phone number are stripped by
// `ticketForCustomer`. A customer can never see them.
// ---------------------------------------------------------------------------
supportRouter.get("/ticket/:id", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  const ticket = getTicketForOwner(req.params.id, identity);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });
  return res.status(200).json({ ok: true, ticket: ticketForCustomer(ticket) });
});

// ---------------------------------------------------------------------------
// PATCH /api/support/ticket/:id - change status
// ---------------------------------------------------------------------------
supportRouter.patch("/ticket/:id", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  const status = (req.body ?? {}).status as TicketStatus;

  if (!status || !(TICKET_STATUSES as readonly string[]).includes(status)) {
    return badRequest(res, `status must be one of: ${TICKET_STATUSES.join(", ")}`);
  }

  const result = updateTicketStatusForOwner(req.params.id, status, identity);
  if (!result.ok) return res.status(400).json({ error: result.error });

  return res.status(200).json({
    ok: true,
    ticket: ticketForCustomer(result.ticket!),
  });
});

// ---------------------------------------------------------------------------
// GET /api/support/survey - should the resolution survey be shown?
//
// The decision is made on the server, for this caller's own conversation only.
// A 200 is returned either way so the UI can simply render nothing.
// ---------------------------------------------------------------------------
supportRouter.get("/survey", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  const sessionId = ensureSessionId(req, res);
  return res.status(200).json({ ok: true, ...getSurveyState(sessionId, identity) });
});

// ---------------------------------------------------------------------------
// POST /api/support/feedback - record the resolution survey answer
//
// The rating and the comment are optional. The answer is attached to the
// caller's own conversation and nowhere else.
// ---------------------------------------------------------------------------
supportRouter.post("/feedback", (req: Request, res: Response) => {
  if (rateLimited(clientKey(req))) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
  }

  const identity = resolveIdentity(req);
  const sessionId = ensureSessionId(req, res);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const parsed = parseSubmission(body);
  if (parsed.ok === false) return badRequest(res, parsed.error);

  const stored = submitFeedback(sessionId, identity, parsed.value);
  if (!stored) {
    // Nothing to attach it to. The customer still gets a graceful result: a
    // survey is never worth showing them an error.
    return res.status(200).json({ ok: true, recorded: false });
  }

  return res.status(200).json({ ok: true, recorded: true });
});

// ---------------------------------------------------------------------------
// GET /api/support/health
// ---------------------------------------------------------------------------
supportRouter.get("/health", (_req: Request, res: Response) => {
  const stats = knowledgeBaseStats();
  return res.status(200).json({
    ok: stats.errors === 0,
    aiConfigured: isAiConfigured(),
    knowledgeBase: stats,
    // Surface the problem, never the internals of it.
    issues: getIssues()
      .filter((issue) => issue.level === "error")
      .slice(0, 10)
      .map((issue) => ({ file: issue.file, message: issue.message })),
  });
});
