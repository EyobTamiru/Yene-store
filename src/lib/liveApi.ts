/**
 * Client for live (human) support.
 *
 * TRANSPORT STRATEGY
 * ------------------
 * The server offers the same state two ways: Server-Sent Events for push, and
 * a poll endpoint for when SSE is blocked (corporate proxies often buffer or
 * drop it). This module prefers SSE and silently falls back to polling, so the
 * conversation keeps working either way and the user never has to know which
 * one is active.
 *
 * Poll interval backs off while nothing is happening, so an idle tab does not
 * hammer the server.
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
  threadId: string;
  conversationId: string;
  mode: ChatMode;
  status: ThreadStatus;
  ticketId: string | null;
  agent: string | null;
  agentId: string | null;
  customerName: string;
  businessName: string;
  messages: LiveMessage[];
  createdAt: string;
  updatedAt: string;
  supportHours: string | null;
}

export interface HandoffResult {
  ok: true;
  connected: boolean;
  ticketId: string | null;
  thread: LiveThread;
  message: string;
}

export class LiveChatError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "LiveChatError";
  }
}

/** Reads the same business token the chat already uses. */
function authHeaders(): Record<string, string> {
  const base: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const token = localStorage.getItem("yene-support-token");
    if (token) base.Authorization = `Bearer ${token}`;
  } catch {
    /* storage blocked - treat as guest */
  }
  return base;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new LiveChatError(message, response.status);
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  fetch(path, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body ?? {}),
  }).then(json<T>);

const get = <T>(path: string) => fetch(path, { headers: authHeaders() }).then(json<T>);

export const requestHuman = (conversationId: string) =>
  post<HandoffResult>("/api/live/handoff", { conversationId });

export const getThread = (threadId: string) =>
  get<{ ok: true; thread: LiveThread }>(`/api/live/${encodeURIComponent(threadId)}`);

export const sendMessage = (threadId: string, body: string) =>
  post<{ ok: true; message: LiveMessage }>(
    `/api/live/${encodeURIComponent(threadId)}/messages`,
    { body },
  );

export const markRead = (threadId: string) =>
  post<{ ok: true; read: number }>(`/api/live/${encodeURIComponent(threadId)}/read`);

export const returnToAi = (threadId: string) =>
  post<{
    ok: true;
    mode: "ai";
    priorTicket: { ticketId: string; note: string } | null;
    thread: LiveThread;
  }>(`/api/live/${encodeURIComponent(threadId)}/return-to-ai`);

export interface PollState {
  thread: LiveThread;
  messages: LiveMessage[];
  serverTime: number;
  supportHours: string | null;
}

export const pollThread = (threadId: string, since: number) =>
  get<PollState>(
    `/api/live/${encodeURIComponent(threadId)}/poll?since=${since}`,
  );

export interface LiveHandlers {
  onSnapshot?: (thread: LiveThread) => void;
  onMessage?: (message: LiveMessage) => void;
  onThread?: (thread: LiveThread) => void;
  onTyping?: (info: { name: string; typing: boolean }) => void;
  onTransport?: (transport: "sse" | "polling") => void;
}

const IDLE_POLL_MS = 15_000;
const BUSY_POLL_MS = 2_000;

/**
 * Watch a conversation.
 *
 * Returns a disposer. Uses SSE when available and falls back to polling on
 * error, or when the stream never opens, so the chat degrades instead of
 * breaking.
 */
export function watchThread(
  threadId: string,
  handlers: LiveHandlers,
): () => void {
  let disposed = false;
  let source: EventSource | null = null;
  let timer: number | null = null;
  let lastSeen = 0;
  let idleTicks = 0;
  let usingPolling = false;

  const startPolling = () => {
    if (disposed || usingPolling) return;
    usingPolling = true;
    handlers.onTransport?.("polling");

    const tick = async () => {
      if (disposed) return;
      try {
        const state = await pollThread(threadId, lastSeen);
        if (state.messages.length > 0) {
          lastSeen = state.serverTime;
          handlers.onSnapshot?.(state.thread);
          for (const message of state.messages) handlers.onMessage?.(message);
          idleTicks = 0;
        } else {
          idleTicks += 1;
        }
        // Busy: check often. Idle: back off so an open tab stays cheap.
        timer = window.setTimeout(
          tick,
          idleTicks === 0 ? BUSY_POLL_MS : Math.min(IDLE_POLL_MS, BUSY_POLL_MS * idleTicks),
        );
      } catch {
        // Transient failure: keep trying rather than tearing the chat down.
        timer = window.setTimeout(tick, 5_000);
      }
    };
    void tick();
  };

  const read = (event: Event): unknown => {
    try {
      return JSON.parse((event as MessageEvent).data as string);
    } catch {
      return null;
    }
  };

  try {
    source = new EventSource(`/api/live/${encodeURIComponent(threadId)}/stream`);

    source.addEventListener("open", () => {
      if (!disposed) handlers.onTransport?.("sse");
    });

    source.addEventListener("snapshot", (event) => {
      const data = read(event) as { thread: LiveThread } | null;
      if (data?.thread) {
        lastSeen = Date.now();
        handlers.onSnapshot?.(data.thread);
      }
    });

    source.addEventListener("message", (event) => {
      const data = read(event) as { message?: LiveMessage } | null;
      if (data?.message) {
        lastSeen = Date.now();
        handlers.onMessage?.(data.message);
      }
    });

    source.addEventListener("typing", (event) => {
      const data = read(event) as { name: string; typing: boolean } | null;
      if (data) handlers.onTyping?.(data);
    });

    source.addEventListener("thread", (event) => {
      const data = read(event) as { threadId?: string } | null;
      if (!data?.threadId) return;
      void getThread(data.threadId)
        .then((result) => handlers.onThread?.(result.thread))
        .catch(() => undefined);
    });

    source.addEventListener("error", () => {
      // EventSource retries by itself, but if the stream is blocked outright we
      // fall back to polling so the user still receives messages.
      if (source && source.readyState === EventSource.CLOSED) {
        source.close();
        source = null;
        startPolling();
      }
    });
  } catch {
    startPolling();
  }

  return () => {
    disposed = true;
    if (timer) window.clearTimeout(timer);
    source?.close();
  };
}
