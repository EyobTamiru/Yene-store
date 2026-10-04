import { randomBytes } from "node:crypto";
import path from "node:path";
import { createJsonCollection } from "../lib/jsonCollection";

/**
 * ============================================================================
 *  LIVE CHAT STORE
 * ============================================================================
 *
 *  The thread behind the AI <-> human handoff. A thread is durable so the
 *  conversation survives a restart and the customer never has to start over.
 *
 *  A thread holds every field the specification requires: conversation id,
 *  user, business, messages, sender type, timestamp, ticket id, agent and
 *  status.
 *
 *  WHAT IS DELIBERATELY NOT HERE
 *  -----------------------------
 *  Internal notes and the AI handover summary are NOT part of a thread. They
 *  live on the ticket, and a thread never copies them across. That is what
 *  makes "the AI knows a ticket exists but must not expose internal notes"
 *  true by construction rather than by filtering.
 *
 *  ACCESS CONTROL
 *  --------------
 *  Enforced by `canReadThread` / `canWriteThread`, which compare the caller's
 *  verified identity to the thread owner. No thread endpoint accepts an owner
 *  id from the client.
 */

export type ChatMode = "ai" | "human";
export type SenderType = "customer" | "agent" | "ai" | "system";
export type ThreadStatus = "waiting-for-agent" | "active" | "resolved" | "closed";

export interface LiveMessage {
  id: string;
  senderType: SenderType;
  senderId: string;
  senderName: string;
  body: string;
  at: string;
  readByCustomer: boolean;
  readByAgent: boolean;
}

export interface LiveThread {
  /** Doubles as the conversation id. */
  threadId: string;
  customerUserId: string;
  customerName: string;
  businessId: string | null;
  businessName: string;
  mode: ChatMode;
  ticketId: string | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  status: ThreadStatus;
  messages: LiveMessage[];
  createdAt: string;
  updatedAt: string;
  customerLastReadAt: string | null;
  agentLastReadAt: string | null;
  /**
   * A ticket that a human already handled. Used when the customer returns to
   * AI mode so the assistant knows help already happened - it carries the
   * ticket id and status ONLY, never notes or the internal summary.
   */
  priorTicketId: string | null;
  priorTicketStatus: string | null;
}

/** `YENE_DATA_DIR` is honoured, for the same reason as ticketStore.ts. */
const chatDataDir = process.env.YENE_DATA_DIR
  ? path.resolve(process.env.YENE_DATA_DIR)
  : path.resolve(process.cwd(), "data");

const store = createJsonCollection<LiveThread>(
  path.join(chatDataDir, "live-chat.json"),
  "live-chat",
  2000,
);

const persist = store.touch;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return randomBytes(8).toString("hex");
}

export function allThreads(): LiveThread[] {
  return store.all();
}

export function getThread(threadId: string): LiveThread | null {
  return store.all().find((thread) => thread.threadId === threadId) ?? null;
}

/** The customer's own thread for a conversation id, if one exists. */
export function findThreadForCustomer(
  conversationId: string,
  customerUserId: string,
): LiveThread | null {
  return (
    store
      .all()
      .find((t) => t.threadId === conversationId && t.customerUserId === customerUserId) ?? null
  );
}

export interface CreateThreadInput {
  threadId: string;
  customerUserId: string;
  customerName: string;
  businessId: string | null;
  businessName: string;
  ticketId: string | null;
  /** The AI conversation so far, carried into the thread on handoff. */
  carryOver: { senderType: SenderType; senderId: string; senderName: string; body: string }[];
}

export function createThread(input: CreateThreadInput): LiveThread {
  const at = nowIso();
  const thread: LiveThread = {
    threadId: input.threadId,
    customerUserId: input.customerUserId,
    customerName: input.customerName,
    businessId: input.businessId,
    businessName: input.businessName,
    mode: "human",
    ticketId: input.ticketId,
    assignedAgentId: null,
    assignedAgentName: null,
    status: "waiting-for-agent",
    messages: input.carryOver.map((message) => ({
      id: newId(),
      senderType: message.senderType,
      senderId: message.senderId,
      senderName: message.senderName,
      body: message.body,
      at,
      // The customer wrote their own messages, so they have read them.
      readByCustomer: true,
      readByAgent: false,
    })),
    createdAt: at,
    updatedAt: at,
    customerLastReadAt: at,
    agentLastReadAt: null,
    priorTicketId: null,
    priorTicketStatus: null,
  };

  store.all().push(thread);
  persist();
  return thread;
}

export function updateThread(
  threadId: string,
  mutator: (thread: LiveThread) => void,
): LiveThread | null {
  const thread = getThread(threadId);
  if (!thread) return null;
  mutator(thread);
  thread.updatedAt = nowIso();
  persist();
  return thread;
}

export function appendMessage(
  thread: LiveThread,
  message: Omit<LiveMessage, "id" | "at" | "readByCustomer" | "readByAgent">,
): LiveMessage {
  const full: LiveMessage = {
    id: newId(),
    at: nowIso(),
    // An incoming message starts unread by the other side.
    readByCustomer: message.senderType === "customer",
    readByAgent: message.senderType !== "customer",
    ...message,
  };
  thread.messages.push(full);
  thread.updatedAt = full.at;
  persist();
  return full;
}

/** Threads nobody has answered yet, oldest first - the support queue. */
export function queueThreads(): LiveThread[] {
  return store
    .all()
    .filter((t) => t.status === "waiting-for-agent" && t.assignedAgentId === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Threads assigned to a specific agent. */
export function threadsForAgent(agentId: string): LiveThread[] {
  return store
    .all()
    .filter((t) => t.assignedAgentId === agentId && t.status === "active")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}
