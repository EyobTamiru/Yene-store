import { Router, type Request, type Response } from "express";
import { MAX_MESSAGE_LENGTH } from "../../src/constants";
import {
  appendMessage,
  getThread,
  queueThreads,
  threadsForAgent,
  updateThread,
  type LiveThread,
} from "../support/chatStore";
import { publish, publishTo, subscribe, threadTopic } from "../support/hub";
import {
  goOffline,
  heartbeat,
  onlineAgents,
  setTyping,
  type Presence,
} from "../support/presence";
import { can, resolveSupportStaff, type SupportStaff } from "../support/roles";
import { getTicketById, updateTicket } from "../support/ticketStore";

/**
 * ============================================================================
 *  LIVE CHAT - STAFF API
 * ============================================================================
 *
 *  What an agent needs to actually work a live conversation: presence, the
 *  queue, a way to claim one, replies, typing, and resolving.
 *
 *  VISIBILITY
 *  ----------
 *  An agent sees the queue plus the threads assigned to them. A role with
 *  `ticket.view.all` sees every thread. Opening a thread that is neither yours
 *  nor on the queue is refused - otherwise two agents could read the same
 *  customer conversation.
 */
export const liveStaffRouter = Router();

liveStaffRouter.use((req: Request, res: Response, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const staff = resolveSupportStaff(token);

  if (!staff) {
    res.status(header ? 403 : 401).json({
      error: header
        ? "This area is restricted to Yene Business Group support staff."
        : "Sign in as support staff to continue.",
    });
    return;
  }
  res.locals.staff = staff;
  next();
});

const staffOf = (res: Response): SupportStaff => res.locals.staff as SupportStaff;

function canSeeThread(staff: SupportStaff, thread: LiveThread): boolean {
  if (can(staff.role, "ticket.view.all")) return true;
  if (thread.assignedAgentId === staff.id) return true;
  // Anyone may see an unclaimed thread so they can claim it.
  return thread.assignedAgentId === null;
}

/** Load a thread this agent is allowed to work on. */
function loadThread(req: Request, res: Response): LiveThread | null {
  const staff = staffOf(res);
  const thread = getThread(req.params.id);
  if (!thread) {
    res.status(404).json({ error: "Conversation not found." });
    return null;
  }
  if (!canSeeThread(staff, thread)) {
    res.status(403).json({ error: "This conversation is assigned to another agent." });
    return null;
  }
  return thread;
}

/** Staff view of a thread - adds the customer and business for the agent. */
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
    unread: thread.messages.filter((m) => m.senderType === "customer" && !m.readByAgent).length,
    updatedAt: thread.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// POST /presence - heartbeat. Also how an agent goes offline.
// ---------------------------------------------------------------------------
liveStaffRouter.post("/presence", (req: Request, res: Response) => {
  const staff = staffOf(res);
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (body.state === "offline") {
    goOffline(staff.id);
    publish("staff:presence", "presence", { staffId: staff.id, state: "offline" });
    return res.status(200).json({ ok: true, presence: null });
  }

  const presence = heartbeat({
    staffId: staff.id,
    name: staff.name,
    state: body.state === "busy" ? "busy" : "available",
    activeThreadIds: Array.isArray(body.activeThreadIds)
      ? (body.activeThreadIds as string[]).slice(0, 10)
      : undefined,
  });

  publish("staff:presence", "presence", { staffId: staff.id, state: presence.state });
  res.status(200).json({ ok: true, presence });
});

// ---------------------------------------------------------------------------
// GET /presence - who is online
// ---------------------------------------------------------------------------
liveStaffRouter.get("/presence", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, agents: onlineAgents() });
});

// ---------------------------------------------------------------------------
// GET /inbox - the queue plus my active conversations
// ---------------------------------------------------------------------------
liveStaffRouter.get("/inbox", (req: Request, res: Response) => {
  const staff = staffOf(res);
  const mine = threadsForAgent(staff.id);
  const queue = can(staff.role, "ticket.view.all")
    ? undefined
    : queueThreads().filter((t) => t.assignedAgentId === null);

  res.status(200).json({
    ok: true,
    mine: mine.map(threadView),
    queue: (queue ?? []).map(threadView),
    agents: onlineAgents(),
  });
});

// ---------------------------------------------------------------------------
// GET /inbox/stream - push notifications for the agent
// ---------------------------------------------------------------------------
liveStaffRouter.get("/inbox/stream", (_req: Request, res: Response) => {

  subscribe(res, ["staff:inbox", "staff:presence"], { event: "snapshot", payload: { ok: true } });
});

// ---------------------------------------------------------------------------
// POST /threads/:id/claim - take a conversation from the queue
// ---------------------------------------------------------------------------
liveStaffRouter.post("/threads/:id/claim", (req: Request, res: Response) => {
  const staff = staffOf(res);
  const thread = getThread(req.params.id);
  if (!thread) return res.status(404).json({ error: "Conversation not found." });

  if (thread.assignedAgentId && thread.assignedAgentId !== staff.id) {
    return res.status(409).json({ error: "Another agent already took this conversation." });
  }

  const updated = updateThread(thread.threadId, (t) => {
    t.assignedAgentId = staff.id;
    t.assignedAgentName = staff.name;
    t.status = "active";
    t.mode = "human";
  });

  heartbeat({ staffId: staff.id, name: staff.name, activeThreadIds: threadsForAgent(staff.id).map((t) => t.threadId) });

  const hello = appendMessage(updated!, {
    senderType: "agent",
    senderId: staff.id,
    senderName: staff.name,
    body: "Hello, I am one of the Yene Business Group support agents. I can see the conversation you had with our assistant, so you do not need to start again. How can I help?",
  });

  publishTo([threadTopic(thread.threadId), "staff:inbox"], "message", {
    threadId: thread.threadId,
    message: hello,
  });

  res.status(200).json({ ok: true, thread: threadView(updated!) });
});

// ---------------------------------------------------------------------------
// GET /threads/:id - one conversation
// ---------------------------------------------------------------------------
liveStaffRouter.get("/threads/:id", (req: Request, res: Response) => {
  const thread = loadThread(req, res);
  if (!thread) return;
  res.status(200).json({ ok: true, thread: threadView(thread) });
});

// ---------------------------------------------------------------------------
// POST /threads/:id/messages - agent reply
// ---------------------------------------------------------------------------
liveStaffRouter.post("/threads/:id/messages", (req: Request, res: Response) => {
  const staff = staffOf(res);
  const thread = loadThread(req, res);
  if (!thread) return;

  const raw = (req.body ?? {}).body;
  const body = typeof raw === "string" ? raw.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  if (!body) return res.status(400).json({ error: "A reply cannot be empty." });

  const message = appendMessage(thread, {
    senderType: "agent",
    senderId: staff.id,
    senderName: staff.name,
    body,
  });
  setTyping(staff.id, null);

  publishTo([threadTopic(thread.threadId), "staff:inbox"], "message", {
    threadId: thread.threadId,
    message,
  });

  res.status(200).json({ ok: true, message });
});

// ---------------------------------------------------------------------------
// POST /threads/:id/typing - typing indicator
// ---------------------------------------------------------------------------
liveStaffRouter.post("/threads/:id/typing", (req: Request, res: Response) => {
  const staff = staffOf(res);
  const thread = loadThread(req, res);
  if (!thread) return;

  const typing = (req.body ?? {}).typing === true;
  setTyping(staff.id, typing ? thread.threadId : null);

  publish(threadTopic(thread.threadId), "typing", {
    threadId: thread.threadId,
    staffId: staff.id,
    name: staff.name,
    typing,
  });

  res.status(200).json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /threads/:id/read - agent read receipts
// ---------------------------------------------------------------------------
liveStaffRouter.post("/threads/:id/read", (req: Request, res: Response) => {
  const thread = loadThread(req, res);
  if (!thread) return;

  let changed = 0;
  for (const message of thread.messages) {
    if (message.senderType === "customer" && !message.readByAgent) {
      message.readByAgent = true;
      changed += 1;
    }
  }
  thread.agentLastReadAt = new Date().toISOString();

  if (changed > 0) {
    publish(threadTopic(thread.threadId), "message", {
      threadId: thread.threadId,
      read: { by: "agent", at: thread.agentLastReadAt, count: changed },
    });
  }
  res.status(200).json({ ok: true, read: changed });
});

// ---------------------------------------------------------------------------
// POST /threads/:id/resolve - close the live chat
//
// The linked ticket is moved to Resolved at the same time, so the dashboard
// and the live chat can never disagree about the outcome.
// ---------------------------------------------------------------------------
liveStaffRouter.post("/threads/:id/resolve", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!can(staff.role, "ticket.resolve")) {
    return res.status(403).json({ error: `Your role (${staff.role}) cannot resolve tickets.` });
  }

  const thread = loadThread(req, res);
  if (!thread) return;

  const note = typeof (req.body ?? {}).body === "string"
    ? String((req.body as Record<string, unknown>).body).slice(0, 2000)
    : "";

  updateThread(thread.threadId, (t) => {
    t.status = "resolved";
    t.mode = "human";
  });

  appendMessage(thread, {
    senderType: "system",
    senderId: "system",
    senderName: "System",
    body: "This conversation has been marked as resolved. You can return to AI Support at any time.",
  });

  if (thread.ticketId) {
    const ticket = updateTicket(thread.ticketId, (t) => {
      if (t.status !== "Closed") {
        t.status = "Resolved";
        t.resolvedAt = new Date().toISOString();
      }
    });
    if (ticket && !ticket.firstResponseAt) {
      ticket.firstResponseAt = new Date().toISOString();
    }
  }

  publishTo([threadTopic(thread.threadId), "staff:inbox"], "thread", {
    threadId: thread.threadId,
    status: "resolved",
  });

  res.status(200).json({ ok: true, thread: threadView(thread) });
});

// ---------------------------------------------------------------------------
// GET /threads/:id/stream - one conversation, pushed
// ---------------------------------------------------------------------------
liveStaffRouter.get("/threads/:id/stream", (req: Request, res: Response) => {
  const thread = loadThread(req, res);
  if (!thread) return;

  subscribe(res, [threadTopic(thread.threadId)], {
    event: "snapshot",
    payload: { thread: threadView(thread) },
  });
});

