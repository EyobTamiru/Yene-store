import type { Response } from "express";
import { randomBytes } from "node:crypto";

/**
 * ============================================================================
 *  LIVE EVENT HUB
 * ============================================================================
 *
 *  One publish/subscribe fan-out behind Server-Sent Events.
 *
 *  WHY SSE AND NOT WEBSOCKETS
 *  -------------------------
 *  This project has no real-time infrastructure, and adding a WebSocket
 *  dependency was not worth it for a text conversation. SSE is built into
 *  Express and Node, needs no dependency, auto-reconnects in the browser, and
 *  is a better fit for a server-to-client stream like this one (chat is
 *  fundamentally: the server talks, the client mostly listens).
 *
 *  THE FALLBACK
 *  ------------
 *  The client polls the same endpoints when SSE is unavailable or the stream
 *  drops, so the chat keeps working either way. See `src/lib/liveApi.ts`.
 *
 *  A subscriber may only ever be registered against a topic it is entitled to,
 *  because the hub has no idea who is listening - authorisation happens in
 *  the route that calls `subscribe`, not here.
 */

export type LiveEventType =
  | "snapshot"
  | "message"
  | "typing"
  | "presence"
  | "thread"
  | "heartbeat";

export interface LiveEvent {
  type: LiveEventType;
  topic: string;
  at: string;
  payload: unknown;
}

interface Subscriber {
  id: string;
  topics: Set<string>;
  write: (event: LiveEvent) => void;
}

const subscribers = new Set<Subscriber>();

/** Topics a subscriber already has, so a payload can fan out narrowly. */
const topicIndex = new Map<string, Set<Subscriber>>();

function addTopic(topic: string, sub: Subscriber) {
  sub.topics.add(topic);
  let set = topicIndex.get(topic);
  if (!set) {
    set = new Set();
    topicIndex.set(topic, set);
  }
  set.add(sub);
}

function removeTopic(topic: string, sub: Subscriber) {
  sub.topics.delete(topic);
  const set = topicIndex.get(topic);
  if (set) {
    set.delete(sub);
    if (set.size === 0) topicIndex.delete(topic);
  }
}

/** Serialise one SSE frame. */
function frame(event: LiveEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Attach an SSE stream for the given topics.
 *
 * `initial` is written immediately after the stream is registered, so the UI is
 * correct before the first event arrives. It MUST be passed here rather than
 * written by the caller first: writing to the response before the headers are
 * sent makes Node send them implicitly, and the explicit `writeHead` below
 * would then throw - leaving the subscriber unregistered and every later
 * publish silently dropped.
 *
 * Returns a disposer to call when the request closes.
 */
export function subscribe(
  res: Response,
  topics: string[],
  initial?: { event: LiveEventType; payload: unknown },
  heartbeatMs = 25_000,
): () => void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Tell the browser to wait 2s before reconnecting so a flapping server does
  // not get hammered.
  res.write("retry: 2000\n\n");

  const sub: Subscriber = {
    id: randomBytes(6).toString("hex"),
    topics: new Set(),
    write: (event) => res.write(frame(event)),
  };
  for (const topic of topics) addTopic(topic, sub);
  subscribers.add(sub);

  if (initial) {
    const event: LiveEvent = {
      type: initial.event,
      topic: topics[0] ?? "",
      at: new Date().toISOString(),
      payload: initial.payload,
    };
    res.write(frame(event));
  }

  // Comment frames keep proxies from closing an idle stream.
  const timer = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* the close handler will clean up */
    }
  }, heartbeatMs);

  const dispose = () => {
    clearInterval(timer);
    if (!subscribers.has(sub)) return;
    subscribers.delete(sub);
    for (const topic of sub.topics) removeTopic(topic, sub);
  };

  res.on("close", dispose);
  res.on("error", dispose);
  return dispose;
}

/** Fan an event out to every subscriber of the topic. */
export function publish(topic: string, type: LiveEventType, payload: unknown): void {
  const set = topicIndex.get(topic);
  if (!set || set.size === 0) return;

  const event: LiveEvent = { type, topic, at: new Date().toISOString(), payload };

  for (const sub of set) {
    try {
      sub.write(event);
    } catch {
      // A dead subscriber must never break delivery to the others.
      subscribers.delete(sub);
      for (const t of sub.topics) removeTopic(t, sub);
    }
  }
}

/** Publish to several topics at once (a thread topic and the staff inbox). */
export function publishTo(topics: string[], type: LiveEventType, payload: unknown): void {
  for (const topic of new Set(topics)) publish(topic, type, payload);
}

/** Diagnostics for the health endpoint. */
export function hubStats() {
  return { subscribers: subscribers.size, topics: topicIndex.size };
}

/** The topic a thread's live events are published on. */
export function threadTopic(threadId: string): string {
  return `thread:${threadId}`;
}
