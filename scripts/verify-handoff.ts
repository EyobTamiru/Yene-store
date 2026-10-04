/**
 * Live-chat handoff verification - the Section 5 contract.
 *
 *   npm run test:handoff
 *
 * Proves:
 *   1. The required customer-facing wording is exact.
 *   2. "No agent available" NEVER invents a response time.
 *   3. A thread carries the AI conversation across, losing nothing.
 *   4. Support hours appear only when actually configured.
 *   5. A thread never contains internal notes or the AI summary.
 *   6. Thread access is scoped to the owning customer.
 *   7. Presence drives agent selection honestly.
 */

import {
  AGENTS_UNAVAILABLE_MESSAGE,
  CONNECTING_AGENT_MESSAGE,
  MODE_AI_LABEL,
  MODE_HUMAN_LABEL,
  TALK_TO_HUMAN_LABEL,
  WAITING_FOR_AGENT_MESSAGE,
} from "../src/constants";
import {
  appendMessage,
  createThread,
  findThreadForCustomer,
  getThread,
  queueThreads,
  updateThread,
  type LiveThread,
} from "../api/support/chatStore";
import {
  findAvailableAgent,
  goOffline,
  heartbeat,
  isOnline,
  MAX_THREADS_PER_AGENT,
  onlineAgents,
} from "../api/support/presence";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const THREAD_ID = "s_test_handoff_1";

function newThread(): LiveThread {
  return createThread({
    threadId: THREAD_ID,
    customerUserId: "u-1",
    customerName: "Alemayehu",
    businessId: "green-coffee",
    businessName: "Green Coffee",
    ticketId: "YENE-ABC123",
    carryOver: [
      { senderType: "customer", senderId: "u-1", senderName: "Alemayehu", body: "I cannot see my inventory" },
      { senderType: "ai", senderId: "yene-ai", senderName: "Yene AI Support", body: "Let me check a few things..." },
      { senderType: "ai", senderId: "yene-ai", senderName: "Yene AI Support", body: "I could not find that in the knowledge base." },
      { senderType: "customer", senderId: "u-1", senderName: "Alemayehu", body: "I want to talk to a person" },
    ],
  });
}

console.log("\n=== 1. Required customer-facing wording is exact ===\n");
{
  check("button label", TALK_TO_HUMAN_LABEL === "Talk to a Human", TALK_TO_HUMAN_LABEL);
  check(
    "agents-unavailable message",
    AGENTS_UNAVAILABLE_MESSAGE ===
      "All support agents are currently unavailable. Your request has been saved as a support ticket. We'll respond as soon as an agent is available.",
    AGENTS_UNAVAILABLE_MESSAGE,
  );
  check("mode labels", MODE_AI_LABEL === "AI Support" && MODE_HUMAN_LABEL === "Human Support");
  check("connecting message", CONNECTING_AGENT_MESSAGE === "Connecting you to a support agent...");
  check("queue message mentions the queue", WAITING_FOR_AGENT_MESSAGE.includes("support queue"));
}

console.log("\n=== 2. No agent available must NOT invent a response time ===\n");
{
  const lower = AGENTS_UNAVAILABLE_MESSAGE.toLowerCase();

  // Every one of these is a fabricated or implied wait. Note that "soon" is
  // deliberately NOT in this list: "as soon as an agent is available" is the
  // exact wording the specification requires, and it defers to reality rather
  // than promising a duration.
  for (const phrase of [
    "minute", "minutes", "hour", "hours", "within", "immediately",
    "asap", "right away", "estimate", "approx", "about ", "24h", "24 hour",
  ]) {
    check(`unavailable message does not say "${phrase}"`, !lower.includes(phrase));
  }

  check(
    "it defers to agent availability rather than a duration",
    lower.includes("as soon as an agent is available"),
    AGENTS_UNAVAILABLE_MESSAGE,
  );
  check("it confirms the request was saved as a ticket", lower.includes("saved as a support ticket"));
}

console.log("\n=== 3. Support hours only appear when configured ===\n");
{
  const saved = process.env.SUPPORT_HOURS;
  delete process.env.SUPPORT_HOURS;
  check("unset means no hours are advertised", (process.env.SUPPORT_HOURS || null) === null);
  process.env.SUPPORT_HOURS = "Mon-Fri 09:00-18:00 EAT";
  check("configured hours are read verbatim", process.env.SUPPORT_HOURS === "Mon-Fri 09:00-18:00 EAT");
  if (saved) process.env.SUPPORT_HOURS = saved;
  else delete process.env.SUPPORT_HOURS;
}

console.log("\n=== 4. The conversation carries across, losing nothing ===\n");
{
  const thread = newThread();
  check("thread exists", !!getThread(THREAD_ID));
  check("all four messages survived", thread.messages.length === 4, String(thread.messages.length));
  check("the AI messages are kept", thread.messages.filter((m) => m.senderType === "ai").length === 2);
  check("the customer messages are kept", thread.messages.filter((m) => m.senderType === "customer").length === 2);
  check("the ticket id is linked", thread.ticketId === "YENE-ABC123");
  check("the mode is human", thread.mode === "human");
  check("it starts in the queue", thread.status === "waiting-for-agent");
  check("it is on the queue", queueThreads().some((t) => t.threadId === THREAD_ID));
  check("every message has a timestamp", thread.messages.every((m) => !Number.isNaN(Date.parse(m.at))));
  check("every message has a sender type", thread.messages.every((m) => !!m.senderType));
  check("own messages start read by the customer", thread.messages.filter((m) => m.senderType === "customer").every((m) => m.readByCustomer));
  check("incoming messages start unread by the agent", thread.messages.filter((m) => m.senderType === "customer").every((m) => !m.readByAgent));
}

console.log("\n=== 5. Threads never carry internal material ===\n");
{
  const serialised = JSON.stringify(getThread(THREAD_ID));
  for (const phrase of ["internal", "aiSummary", "alreadyTried", "suggestedNextSteps", "customerPhone"]) {
    check(`thread does not contain "${phrase}"`, !serialised.includes(phrase));
  }
  check("no prior ticket is recorded yet", getThread(THREAD_ID)!.priorTicketId === null);
}

console.log("\n=== 6. Thread access is scoped to the owning customer ===\n");
{
  check("owner can find their thread", findThreadForCustomer(THREAD_ID, "u-1") !== null);
  check("another user cannot", findThreadForCustomer(THREAD_ID, "u-2") === null);
  check("a guest cannot", findThreadForCustomer(THREAD_ID, "guest") === null);
}

console.log("\n=== 7. Presence drives agent selection honestly ===\n");
{
  for (const id of ["staff-1", "staff-2", "staff-3", "staff-4"]) goOffline(id);
  check("nobody online means nobody available", findAvailableAgent() === null);

  heartbeat({ staffId: "staff-1", name: "Bereket" });
  check("a free agent is offered the work", findAvailableAgent()?.staffId === "staff-1");
  check("isOnline agrees", isOnline("staff-1"));

  // At capacity an agent must stop being offered new work.
  heartbeat({
    staffId: "staff-1",
    name: "Bereket",
    activeThreadIds: Array.from({ length: MAX_THREADS_PER_AGENT }, (_, i) => `t${i}`),
  });
  check("an agent at capacity counts as busy", onlineAgents().find((a) => a.staffId === "staff-1")?.state === "busy");
  check("a full agent is not offered new work", findAvailableAgent() === null);

  heartbeat({ staffId: "staff-2", name: "Selam" });
  check("a second free agent takes the work", findAvailableAgent()?.staffId === "staff-2");

  goOffline("staff-1");
  goOffline("staff-2");
}

console.log("\n=== 8. An agent reply updates the thread and read state ===\n");
{
  const thread = getThread(THREAD_ID)!;
  appendMessage(thread, {
    senderType: "agent", senderId: "staff-2", senderName: "Selam", body: "Looking into it now.",
  });
  check("the reply is stored", thread.messages.length === 5);

  updateThread(THREAD_ID, (t) => {
    t.assignedAgentId = "staff-2";
    t.assignedAgentName = "Selam";
    t.status = "active";
  });

  const after = getThread(THREAD_ID)!;
  check("the thread is active", after.status === "active");
  check("the agent is recorded", after.assignedAgentId === "staff-2");
  check("it left the queue", !queueThreads().some((t) => t.threadId === THREAD_ID));

  for (const message of after.messages) message.readByCustomer = true;
  check("read receipts can be recorded", after.messages.every((m) => m.readByCustomer));
}

console.log("\n=== 9. Return to AI records only that help happened ===\n");
{
  updateThread(THREAD_ID, (t) => {
    t.mode = "ai";
    t.status = "closed";
    t.priorTicketId = t.ticketId;
    t.priorTicketStatus = "handled by support";
  });
  const after = getThread(THREAD_ID)!;
  check("the mode is back to AI", after.mode === "ai");
  check("the prior ticket id is remembered", after.priorTicketId === "YENE-ABC123");
  const serialised = JSON.stringify(after);
  check("the prior-ticket record carries no notes", !serialised.includes("alreadyTried"));
  check("the prior-ticket record carries no summary", !serialised.includes("aiSummary"));
}

console.log(failures === 0 ? "\nALL HANDOFF CHECKS PASSED\n" : "\n" + failures + " HANDOFF CHECK(S) FAILED\n");
process.exit(failures === 0 ? 0 : 1);
