import { Router, type Request, type Response } from "express";
import {
  AGENT_CONNECTED_PREFIX,
  AGENTS_UNAVAILABLE_MESSAGE,
  MAX_MESSAGE_LENGTH,
  RESOLVED_RETURN_PROMPT,
} from "../../src/constants";
import { getAccountContext } from "../support/account";
import { resolveIdentity } from "../support/auth";
import {
  appendMessage,
  createThread,
  findThreadForCustomer,
  getThread,
  type LiveMessage,
  type LiveThread,
} from "../support/chatStore";
import { findAvailableAgent } from "../support/presence";
import { publish, publishTo, subscribe, threadTopic } from "../support/hub";
import { buildHandoffSummary } from "../support/summary";
import { createTicketFromChat, getSession } from "../support/tickets";
import { evaluateEscalation } from "../support/escalation";
import { markEscalated } from "../support/analyticsStore";

/**
 * ============================================================================
 *  LIVE CHAT - CUSTOMER API
 * ============================================================================
 *
 *  The AI <-> human handoff, from the customer's side.
 *
 *  Access control: a thread belongs to exactly one customer identity. Every
 *  route re-derives ownership from the verified token - no route accepts a
 *  customer id, so one customer can never read or post into another's thread.
 *
 *  TWO TRANSPORTS, ONE CONTRACT
 *  ---------------------------
 *  `GET /stream` is Server-Sent Events: the server pushes messages, typing state
 *  and presence. `GET /poll` returns the same state on an interval for when SSE
 *  is blocked by a proxy. The client prefers SSE and falls back to polling, so
 *  the conversation works either way.
 */
export const liveRouter = Router();

const POLL_MIN_MS = 2_000;
const POLL_MAX_MS = 15_000;

const BRAND_AI_ID = "yene-ai";
const BRAND_AI_NAME = "Yene AI Support";

/** The customer's own thread, or null. */
function ownThread(req: Request, res: Response): LiveThread | null {
  const identity = resolveIdentity(req);
  const threadId = String(req.params.id ?? req.query.threadId ?? "");
  if (!threadId) {
    res.status(400).json({ error: "A conversation id is required." });
    return null;
  }

  const thread = getThread(threadId);
  if (!thread || thread.customerUserId !== identity.userId) {
    // 404 rather than 403: do not confirm that someone else's thread exists.
    res.status(404).json({ error: "Conversation not found." });
    return null;
  }
  return thread;
}

/** The customer's view of a thread. Never includes internal material. */
function threadView(thread: LiveThread) {
  return {
    threadId: thread.threadId,
    conversationId: thread.threadId,
    mode: thread.mode,
    status: thread.status,
    ticketId: thread.ticketId,
    agent: thread.assignedAgentName,
    agentId: thread.assignedAgentId,
    customerName: thread.customerName,
    businessName: thread.businessName,
    messages: thread.messages,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    /** Only shown when the team has actually published hours. */
    supportHours: process.env.SUPPORT_HOURS || null,
  };
}

// ---------------------------------------------------------------------------
// POST /handoff - "Talk to a Human"
//
// Creates or locates the ticket, carries the whole AI conversation across,
// places the customer in the queue, and connects an agent if one is free.
// ---------------------------------------------------------------------------
liveRouter.post("/handoff", async (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId.slice(0, 64) : "";
  if (!conversationId) return res.status(400).json({ error: "A conversation id is required." });

  const account = await getAccountContext(identity);
  const session = getSession(conversationId, identity);
  const transcript = session?.turns ?? [];

  // 1 + 2 + 3: create or locate the ticket, with history and the AI summary.
  let thread = findThreadForCustomer(conversationId, identity.userId);
  let ticketId = thread?.ticketId ?? null;

  if (!ticketId) {
    const escalation = evaluateEscalation(
      {
        message: transcript[transcript.length - 1]?.content ?? "customer requested a human agent",
        isAuthenticated: identity.isAuthenticated,
        unresolvedStreak: 0,
      },
      false,
    );
    if (!escalation.reasons.includes("customer-requested-human")) {
      escalation.reasons.push("customer-requested-human");
    }

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
      sessionId: conversationId,
      identity,
      account,
      escalation,
      transcript,
      description: aiSummary.customerProblem,
      aiSummary,
    });
    ticketId = ticket.ticketId;

    // Section 7: this conversation reached a human, so it counts as an
    // escalation in the platform report.
    markEscalated(conversationId, escalation.reasons, ticket.ticketId);

    // Carry the whole AI conversation into the thread so nothing is lost.
    thread = createThread({
      threadId: conversationId,
      customerUserId: identity.userId,
      customerName: identity.displayName ?? "Guest customer",
      businessId: identity.businessId,
      businessName: account.businessName ?? identity.businessId ?? "Not signed in",
      ticketId,
      carryOver: transcript.map((turn) => ({
        senderType: turn.role === "assistant" ? ("ai" as const) : ("customer" as const),
        senderId: turn.role === "assistant" ? BRAND_AI_ID : identity.userId,
        senderName: turn.role === "assistant" ? BRAND_AI_NAME : identity.displayName ?? "Customer",
        body: turn.content,
      })),
    });
  }

  if (!thread) return res.status(500).json({ error: "Could not start the conversation." });

  // 4 + 6: place in the queue, then connect an available agent if there is one.
  const agent = findAvailableAgent();
  let connected = false;

  if (agent) {
    connected = true;
    thread.assignedAgentId = agent.staffId;
    thread.assignedAgentName = agent.name;
    thread.status = "active";
    agent.activeThreadIds.push(thread.threadId);
    const hello = appendMessage(thread, {
      senderType: "agent",
      senderId: agent.staffId,
      senderName: agent.name,
      body: "Hello, I am one of the Yene Business Group support agents. I can see the conversation you had with our assistant, so you do not need to start again. How can I help?",
    });
    publishTo([threadTopic(thread.threadId), "staff:inbox"], "message", { threadId: thread.threadId, message: hello });
  } else {
    thread.status = "waiting-for-agent";
    publishTo(["staff:inbox"], "thread", { threadId: thread.threadId, status: "waiting-for-agent" });
  }

  // 5: tell every agent something changed.
  publish("staff:presence", "presence", { reason: connected ? "assigned" : "queued" });

  return res.status(200).json({
    ok: true,
    connected,
    ticketId,
    thread: threadView(thread),
    message: connected
      ? `${AGENT_CONNECTED_PREFIX} (${thread.assignedAgentName}).`
      : AGENTS_UNAVAILABLE_MESSAGE,
  });
});

// ---------------------------------------------------------------------------
// GET /:id - current state of the customer's thread
// ---------------------------------------------------------------------------
liveRouter.get("/:id", (req: Request, res: Response) => {
  const thread = ownThread(req, res);
  if (!thread) return;
  res.status(200).json({ ok: true, thread: threadView(thread) });
});

// ---------------------------------------------------------------------------
// GET /:id/stream - Server-Sent Events (the push transport)
// ---------------------------------------------------------------------------
liveRouter.get("/:id/stream", (req: Request, res: Response) => {
  const thread = ownThread(req, res);
  if (!thread) return;
  // subscribe() sends the headers and registers the subscriber; the snapshot
  // rides along as its first frame. Writing to the response before subscribe()
  // makes Node send headers implicitly, so the subscription would be lost.
  subscribe(res, [threadTopic(thread.threadId)], {
    event: "snapshot",
    payload: { thread: threadView(thread) },
  });
});

// ---------------------------------------------------------------------------
// GET /:id/poll - the fallback transport
// ---------------------------------------------------------------------------
liveRouter.get("/:id/poll", (req: Request, res: Response) => {
  const thread = ownThread(req, res);
  if (!thread) return;

  const requested = Number(req.query.since) || 0;
  const since = Number.isFinite(requested) ? requested : 0;

  // Only return what the customer has not already seen.
  const fresh = thread.messages.filter(
    (message) => new Date(message.at).getTime() > since,
  );

  res.status(200).json({
    ok: true,
    thread: threadView(thread),
    messages: fresh,
    serverTime: Date.now(),
    supportHours: process.env.SUPPORT_HOURS || null,
  });
});

// ---------------------------------------------------------------------------
// POST /:id/messages - customer sends a message to the agent
// ---------------------------------------------------------------------------
liveRouter.post("/:id/messages", (req: Request, res: Response) => {
  const thread = ownThread(req, res);
  if (!thread) return;

  const identity = resolveIdentity(req);
  const raw = (req.body ?? {}).body;
  const body = typeof raw === "string" ? raw.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  if (!body) return res.status(400).json({ error: "A message cannot be empty." });

  // A resolved thread is read-only until the customer goes back to the AI.
  if (thread.status === "resolved" || thread.status === "closed") {
    return res.status(409).json({
      error: "This conversation has been resolved. Return to AI Support to continue.",
    });
  }

  const message = appendMessage(thread, {
    senderType: "customer",
    senderId: identity.userId,
    senderName: identity.displayName ?? "Customer",
    body,
  });

  publishTo([threadTopic(thread.threadId), "staff:inbox"], "message", {
    threadId: thread.threadId,
    message,
  });
  publish("staff:presence", "presence", { reason: "customer-message" });

  res.status(200).json({ ok: true, message });
});

// ---------------------------------------------------------------------------
// POST /:id/read - read receipts
// ---------------------------------------------------------------------------
liveRouter.post("/:id/read", (req: Request, res: Response) => {
  const thread = ownThread(req, res);
  if (!thread) return;

  const now = new Date().toISOString();
  let changed = 0;
  for (const message of thread.messages) {
    if (!message.readByCustomer) {
      message.readByCustomer = true;
      changed += 1;
    }
  }
  thread.customerLastReadAt = now;
  thread.updatedAt = now;

  // Tell the agent their replies have been seen.
  if (changed > 0) {
    publishTo([threadTopic(thread.threadId), "staff:inbox"], "message", {
      threadId: thread.threadId,
      read: { by: "customer", at: now, count: changed },
    });
  }
  res.status(200).json({ ok: true, read: changed });
});

// ---------------------------------------------------------------------------
// POST /:id/return-to-ai - back to AI Support
//
// The thread records THAT a human already handled this, and nothing more. The
// AI is told a ticket exists and its status; internal notes and the AI summary
// are never copied into the chat context.
// ---------------------------------------------------------------------------
liveRouter.post("/:id/return-to-ai", (req: Request, res: Response) => {
  const thread = ownThread(req, res);
  if (!thread) return;

  const message = appendMessage(thread, {
    senderType: "system",
    senderId: "system",
    senderName: "System",
    body: "Returned to AI Support.",
  });

  thread.mode = "ai";
  thread.status = "closed";
  thread.priorTicketId = thread.ticketId;
  thread.priorTicketStatus = thread.ticketId ? "handled by support" : null;
  thread.updatedAt = message.at;

  publishTo([threadTopic(thread.threadId), "staff:inbox"], "thread", {
    threadId: thread.threadId,
    mode: "ai",
  });

  res.status(200).json({
    ok: true,
    mode: "ai",
    // Deliberately minimal: an id and a fact, never internal content.
    priorTicket: thread.ticketId
      ? {
          ticketId: thread.ticketId,
          note: "A support agent has already worked on this conversation.",
        }
      : null,
    thread: threadView(thread),
  });
});
