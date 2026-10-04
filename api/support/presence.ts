/**
 * ============================================================================
 *  AGENT PRESENCE
 * ============================================================================
 *
 *  "Is anyone actually available?" is the question the whole handoff turns on,
 *  and it must not be answered by guessing. Presence is a heartbeat: an agent
 * posts on an interval, and goes offline when the heartbeat stops.
 *
 *  Deliberately IN MEMORY. Presence is a property of this moment, not a
 *  business record - it must not survive a restart, and a stale "online" from
 *  last week is worse than no answer at all.
 */

export type PresenceState = "available" | "busy" | "offline";

export interface Presence {
  staffId: string;
  name: string;
  state: PresenceState;
  lastSeen: number;
  /** Threads this agent is currently handling. */
  activeThreadIds: string[];
  /** Set while the agent is composing a reply. */
  typingInThreadId: string | null;
}

/** An agent is considered online while a heartbeat arrived within this window. */
export const PRESENCE_TTL_MS = 45_000;

/** How many live threads one agent can take before they count as "busy". */
export const MAX_THREADS_PER_AGENT = 3;

const presence = new Map<string, Presence>();

function isFresh(entry: Presence): boolean {
  return Date.now() - entry.lastSeen < PRESENCE_TTL_MS;
}

/** Drop entries whose heartbeat has lapsed. Called before every read. */
function sweep(): void {
  for (const [id, entry] of presence) {
    if (!isFresh(entry)) presence.delete(id);
  }
}

export function heartbeat(input: {
  staffId: string;
  name: string;
  state?: PresenceState;
  activeThreadIds?: string[];
}): Presence {
  const existing = presence.get(input.staffId);
  const active = input.activeThreadIds ?? existing?.activeThreadIds ?? [];

  const entry: Presence = {
    staffId: input.staffId,
    name: input.name,
    state: input.state ?? existing?.state ?? "available",
    lastSeen: Date.now(),
    activeThreadIds: active,
    typingInThreadId: existing?.typingInThreadId ?? null,
  };
  // Full capacity means busy, whatever the client claims.
  if (entry.state === "available" && active.length >= MAX_THREADS_PER_AGENT) {
    entry.state = "busy";
  }

  presence.set(input.staffId, entry);
  return entry;
}

export function setTyping(staffId: string, threadId: string | null): void {
  const entry = presence.get(staffId);
  if (!entry) return;
  entry.typingInThreadId = threadId;
  entry.lastSeen = Date.now();
}

export function goOffline(staffId: string): void {
  presence.delete(staffId);
}

export function isOnline(staffId: string): boolean {
  sweep();
  const entry = presence.get(staffId);
  return !!entry && entry.state !== "offline";
}

/** Everyone currently reachable, for the staff dashboard. */
export function onlineAgents(): Presence[] {
  sweep();
  return [...presence.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pick someone to take a new conversation.
 *
 * Prefers an available agent with spare capacity, then the least loaded one, so
 * work spreads out instead of piling onto whoever answered last. Returns null
 * when nobody is available - and the caller must then say so, not guess a time.
 */
export function findAvailableAgent(): Presence | null {
  sweep();
  const candidates = [...presence.values()].filter(
    (entry) => entry.state === "available" && entry.activeThreadIds.length < MAX_THREADS_PER_AGENT,
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.activeThreadIds.length - b.activeThreadIds.length);
  return candidates[0];
}
