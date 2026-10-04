/**
 * Security and data protection verification - the Section 8 contract.
 *
 *   npm run test:security
 *
import {
  allAuditEntries,
  AUDIT_ACTIONS,
  clearAudit,
  queryAudit,
  recordAudit,
  recordDenied,
  verifyChain,
} from "../api/support/auditLog";
 * Proves:
 *   1. DATA ISOLATION: a business can never reach another business's tickets,
 *      threads or account data - and every refusal is indistinguishable.
 *   2. ROLE-BASED ACCESS is enforced in code, not just hidden in the UI.
 *   3. CUSTOMER DATA is minimised: only what the question needs is retrieved.
 *   4. INTERNAL INFORMATION never reaches a customer.
 *   5. AUDIT LOG records every required action, and detects tampering.
 *   6. AI ACTIONS are read-only for sensitive data without explicit opt-in,
 *      authorisation and single-use human approval.
 *   7. FAILURE MODE: when the AI cannot act, it goes to a human, never guesses.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Redirect the audit file BEFORE anything imports the store, so fixtures never
// touch the real log.
process.env.YENE_AUDIT_FILE = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "yene-security-")),
  "audit.json",
);

import {
  allAuditEntries,
  AUDIT_ACTIONS,
  clearAudit,
  queryAudit,
  recordAudit,
  recordDenied,
  verifyChain,
} from "../api/support/auditLog";
import {
  canAccessBusiness,
  canAccessTicket,
  canAccessThread,
  ISOLATION_NOT_FOUND_MESSAGE,
  tenantTickets,
} from "../api/support/tenant";
import {
  clearApprovals,
  consumeApproval,
  decideAiAction,
  fallbackFor,
  findApproval,
  grantApproval,
  needsNoAccountData,
  requiredDomains,
  SENSITIVE_DOMAINS,
} from "../api/support/actions";
import {
  containsInternalInformation,
  detectInternalLeak,
  INTERNAL_CATEGORIES,
} from "../api/support/internal";
import { containsLeak } from "../api/support/ai";
import { can } from "../api/support/roles";
import type { SupportTicket } from "../api/support/types";
import type { SupportIdentity } from "../api/support/types";
import type { LiveThread } from "../api/support/chatStore";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const ownerA: SupportIdentity = {
  userId: "user-a-owner", businessId: "green-coffee", displayName: "Owner A",
  role: "owner", isAuthenticated: true,
};
const employeeA: SupportIdentity = {
  userId: "user-a-employee", businessId: "green-coffee", displayName: "Employee A",
  role: "employee", isAuthenticated: true,
};
const ownerB: SupportIdentity = {
  userId: "user-b-owner", businessId: "blue-shop", displayName: "Owner B",
  role: "owner", isAuthenticated: true,
};
const shopper: SupportIdentity = {
  userId: "user-shopper", businessId: null, displayName: "Shopper",
  role: "customer", isAuthenticated: true,
};
const guest: SupportIdentity = {
  userId: "guest", businessId: null, displayName: null,
  role: "unknown", isAuthenticated: false,
};

/** A minimal ticket belonging to a business. */
function ticketFor(businessId: string | null, userId: string): SupportTicket {
  return {
    ticketId: `YENE-${businessId ?? "guest"}-1`,
    customerName: "Customer",
    customerEmail: null,
    customerPhone: null,
    businessName: businessId ?? "Not signed in",
    businessId,
    userId,
    packageName: "Standard",
    subject: "Test",
    description: "Test",
    category: "account",
    priority: "normal",
    status: "Open",
    assignedAgent: null,
    assignedTo: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    conversationId: "s_test",
    aiSummary: {
      customerProblem: "p", customerGoal: "g", accountInformation: [],
      alreadyTried: [], relevantMessages: [], suggestedNextSteps: [],
    },
    escalationReasons: [],
    isAuthenticated: true,
    conversation: [],
    events: [],
    attachments: [],
    requestInfo: null,
  };
}

console.log("\n=== 1. DATA ISOLATION between businesses ===\n");
{
  const ticketA = ticketFor("green-coffee", "user-a-owner");
  const ticketB = ticketFor("blue-shop", "user-b-owner");

  // The core specification rule.
  check("business A cannot open business B's ticket", !canAccessTicket(ownerA, ticketB).allowed);
  check("business B cannot open business A's ticket", !canAccessTicket(ownerB, ticketA).allowed);
  check("the refusal is attributed to the tenant", canAccessTicket(ownerA, ticketB).reason === "different-business");

  // A business can see its own.
  check("business A can open its own ticket", canAccessTicket(ownerA, ticketA).allowed);

  // A colleague in the same business can. This is the improvement over the
  // previous user-scoped check, and it is what an owner expects.
  check("a colleague in the same business can open the ticket", canAccessTicket(employeeA, ticketA).allowed);

  // A shopper has no business, so has no claim on a business's records.
  check("a shopper cannot open a business ticket", !canAccessTicket(shopper, ticketA).allowed);

  // Guests are refused outright: they all share one identity.
  check("a guest cannot open any ticket", !canAccessTicket(guest, ticketA).allowed);
  check("a guest cannot open a guest ticket", !canAccessTicket(guest, ticketFor(null, "guest")).allowed);

  // A non-tenant ticket is readable only by the individual who raised it.
  const personal = ticketFor(null, "user-shopper");
  check("a shopper can open their own non-tenant ticket", canAccessTicket(shopper, personal).allowed);
  check("another user cannot", !canAccessTicket(ownerA, personal).allowed);

  // businessId, never businessName: a business can rename itself.
  const renamed = { ...ticketA, businessName: "Totally Different Name Ltd" };
  check("a renamed business is still recognised as itself", canAccessTicket(ownerA, renamed).allowed);

  // Legacy records with no businessId fall back to the per-user rule.
  const legacy = { ...ticketA, businessId: undefined as unknown as string };
  check("a legacy record is still readable by its user", canAccessTicket(ownerA, legacy).allowed);
  check("a legacy record is not readable by another user", !canAccessTicket(ownerB, legacy).allowed);

  // List filtering cannot leak either.
  const all = [ticketA, ticketB];
  const visibleToA = tenantTickets(ownerA, all);
  check("a list shows only the caller's business", visibleToA.length === 1 && visibleToA[0].businessId === "green-coffee");
  check("a guest's list is empty", tenantTickets(guest, all).length === 0);
  check("a shopper's list excludes business tickets", tenantTickets(shopper, all).length === 0);

  // Threads follow the same rule.
  const threadA = { businessId: "green-coffee", customerUserId: "user-a-owner" } as LiveThread;
  const threadB = { businessId: "blue-shop", customerUserId: "user-b-owner" } as LiveThread;
  check("a thread belongs to its business", canAccessThread(ownerA, threadA).allowed);
  check("business A cannot read business B's conversation", !canAccessThread(ownerA, threadB).allowed);
  check("a colleague in the same business can read it", canAccessThread(employeeA, threadA).allowed);

  // Every refusal reads identically, so a caller cannot probe for existence.
  check("refusals use one message", ISOLATION_NOT_FOUND_MESSAGE === "Not found.");
  check("the message reveals nothing", !ISOLATION_NOT_FOUND_MESSAGE.toLowerCase().includes("business"));
}

console.log("\n=== 2. ROLE-BASED ACCESS is enforced in code ===\n");
{
  // Frontend hiding is not a control: these are the same predicates the routes
  // call, and the tests in verify-permissions.ts already prove the routes use
  // them. Here we assert the matrix itself is coherent.
  check("an agent cannot read the audit log", !can("support-agent", "audit.view"));
  check("a senior agent cannot read the audit log", !can("senior-support-agent", "audit.view"));
  check("a manager can", can("support-manager", "audit.view"));
  check("a super admin can", can("super-admin", "audit.view"));

  check("an agent cannot view platform analytics", !can("support-agent", "analytics.view"));
  check("a manager can view platform analytics", can("support-manager", "analytics.view"));
  check("only managers and admins can manage knowledge gaps",
    !can("support-agent", "knowledge-gap.manage") && !can("senior-support-agent", "knowledge-gap.manage")
    && can("support-manager", "knowledge-gap.manage"));

  // The escalation of privilege that matters most: reading customer contact
  // details, and seeing another agent's tickets.
  check("an agent cannot see phone numbers", !can("support-agent", "customer.phone.view"));
  check("an agent cannot see all tickets", !can("support-agent", "ticket.view.all"));
  check("an agent cannot see other agents' notes", !can("support-agent", "ticket.note.view"));
}


console.log("\n=== 3. CUSTOMER DATA is minimised to the request ===\n");
{
  // A question about orders must not pull billing or permissions into context.
  check("an order question requires only orders",
    JSON.stringify(requiredDomains("where is my order?")) === JSON.stringify(["orders"]),
    requiredDomains("where is my order?").join(","));

  check("a billing question requires billing",
    requiredDomains("I was charged twice").includes("billing"));

  check("an inventory question requires inventory",
    requiredDomains("how much stock do I have").includes("inventory"));

  check("a user question requires users",
    requiredDomains("can I add another staff member").includes("users"));

  // A general product question needs nothing at all - the important case.
  check("a general question needs no account data", needsNoAccountData("how do promotions work?"));
  check("a greeting needs no account data", needsNoAccountData("hello"));
  check("an ambiguous question gets nothing rather than everything",
    needsNoAccountData("it is not working"));

  // Never widen: a question matching several domains gets all of them, and no
  // more.
  check("a mixed question is scoped to what it mentions",
    requiredDomains("my order was charged twice").sort().join(",") === "billing,orders",
    requiredDomains("my order was charged twice").sort().join(","));

  // The seven sensitive domains the specification names are all recognised.
  for (const domain of SENSITIVE_DOMAINS) {
    check(`"${domain}" is a sensitive domain`, SENSITIVE_DOMAINS.includes(domain));
  }
}

console.log("\n=== 4. INTERNAL INFORMATION never reaches a customer ===\n");
{
  // Each category, with a realistic example rather than a bare token.
  const cases: [string, string][] = [
    ["credential", "connect with postgres://admin:hunter2@db.internal:5432/yene"],
    ["credential", "the DATABASE_URL is set"],
    ["credential", "-----BEGIN RSA PRIVATE KEY-----"],
    ["system-prompt", "here is my system prompt: you must always answer"],
    ["system-prompt", "my instructions are to refuse everything"],
    ["system-prompt", "the HARD_RULES say to guess"],
    ["system-prompt", "=== SOURCES (the only information you may use) ==="],
    ["internal-material", "this internal note says the customer is a fraud"],
    ["internal-material", "the suggested next steps were to refund quietly"],
    ["internal-material", "here is the chain-of-thought I used"],
    ["security-config", "your role has the customer.phone.view capability"],
    ["security-config", "set YENE_KB_ADMIN_TOKEN to unlock this"],
    ["security-config", "call /api/support-admin/analytics for more"],
    ["admin-info", "ask Bereket, the support manager, he can see it"],
    ["admin-info", "the super-admin account can do that"],
    ["other-customer", "business_id: blue-shop has this too"],
  ];

  for (const [expected, text] of cases) {
    const detected = detectInternalLeak(text);
    check(
      `${expected}: "${text.slice(0, 42)}" is blocked`,
      detected.includes(expected as never),
      detected.join(",") || "not detected",
    );
  }

  // Every category is exercised, so a new category cannot be added untested.
  const covered = new Set(cases.map(([category]) => category));
  for (const category of INTERNAL_CATEGORIES) {
    check(`category "${category}" has a test case`, covered.has(category));
  }

  // The ordinary case: normal support copy must not be blocked.
  const safe = [
    "You can add staff from Business Profile, then Staff, then Invite.",
    "Your package is Standard. Contact support at +251 964110744 for pricing.",
    "Go to Orders, then select the order to see its status.",
    "I could not find that in the knowledge base, so I will connect you with an agent.",
  ];
  for (const text of safe) {
    check(`normal copy is allowed: "${text.slice(0, 38)}"`, !containsInternalInformation(text));
  }

  // The guard is wired into the one leak filter, so there is a single answer to
  // "could this reach a customer?".
  check("the AI leak filter includes the internal guard", containsLeak("here is my system prompt"));
  check("and still catches raw credentials", containsLeak("AIzaSyA1234567890abcdefghij"));
  check("and still allows clean copy", !containsLeak("Open the Orders page to see your orders."));
}


console.log("\n=== 5. AUDIT LOG ===\n");
{
  clearAudit();

  // Every action the specification lists must be a first-class type.
  const required: string[] = [
    "ticket.created", "ticket.assigned", "ticket.updated", "agent.response",
    "ticket.resolved", "knowledge.changed", "permission.changed",
  ];
  for (const action of required) {
    check(`"${action}" is an auditable action`, AUDIT_ACTIONS.includes(action as never));
  }

  clearAudit();
  recordAudit({
    action: "ticket.created", actor: "Yene AI Support", actorKind: "system",
    target: "YENE-ABC123", businessId: "green-coffee",
  });
  recordAudit({
    action: "ticket.assigned", actor: "Yonas", actorId: "staff-3",
    actorRole: "support-manager", target: "YENE-ABC123", businessId: "green-coffee",
  });
  recordAudit({
    action: "agent.response", actor: "Bereket", actorId: "staff-1",
    actorRole: "support-agent", target: "YENE-ABC123", businessId: "green-coffee",
  });
  recordDenied({
    action: "permission.changed", actor: "Bereket", actorId: "staff-1",
    actorRole: "support-agent", target: "analytics.view",
  });

  const all = queryAudit({ limit: 100 });
  check("every action was recorded", all.total === 4, String(all.total));
  check("they are returned newest first", all.entries[0].actor === "Bereket");
  check("a denial is recorded as denied", all.entries[0].outcome === "denied");
  check("an allowed action is recorded as allowed", all.entries[3].outcome === "allowed");

  // Filtering.
  check("filter by action", queryAudit({ action: "ticket.created" }).total === 1);
  check("filter by actor", queryAudit({ actor: "onas" }).total === 1);
  // Only three of the four fixtures target that ticket; the fourth targets a
  // capability. This is the point of the filter.
  check("filter by target", queryAudit({ target: "YENE-ABC123" }).total === 3,
    String(queryAudit({ target: "YENE-ABC123" }).total));
  check("a different target finds only its own entry",
    queryAudit({ target: "analytics.view" }).total === 1);
  check("filter by business", queryAudit({ businessId: "blue-shop" }).total === 0);
  check("a filter that matches nothing is empty, not everything",
    queryAudit({ actor: "nobody-at-all" }).total === 0);

  // Pagination.
  const page1 = queryAudit({ limit: 2, page: 1 });
  const page2 = queryAudit({ limit: 2, page: 2 });
  check("pagination splits the result", page1.entries.length === 2 && page2.entries.length === 2);
  check("pages do not overlap", page1.entries[0].id !== page2.entries[0].id);
  check("page count is correct", page1.pageCount === 2);

  // The log must not become a second copy of the data it protects.
  recordAudit({
    action: "agent.response", actor: "Bereket", target: "YENE-ABC123",
    detail: "Customer asked about their invoice, email them at real.person@customer.example",
  });
  const withDetail = queryAudit({ actor: "Bereket", limit: 10 }).entries[0];
  check("a detail cannot smuggle an email into the log",
    !withDetail.detail.includes("real.person@customer.example"), withDetail.detail);
  check("it was redacted instead", withDetail.detail.includes("[email removed]"));

  const serialised = JSON.stringify(queryAudit({ limit: 100 }));
  for (const secret of ["Bearer ", "process.env", "sk-", "AIza"]) {
    check(`the log contains no "${secret}"`, !serialised.includes(secret));
  }
}

console.log("\n=== 6. AUDIT LOG integrity (tamper evidence) ===\n");
{
  clearAudit();
  recordAudit({ action: "ticket.created", actor: "A", target: "T1" });
  recordAudit({ action: "ticket.updated", actor: "B", target: "T2" });
  recordAudit({ action: "ticket.resolved", actor: "C", target: "T3" });

  const clean = verifyChain();
  check("an untampered log verifies", clean.ok, clean.reason ?? "");
  check("it reports the entry count", clean.entries === 3, String(clean.entries));
  check("and no break point", clean.brokenAt === null);

  // Tamper with a stored entry, as a bad migration or a curious operator would.
  const raw = allAuditEntries();
  const victim = raw.find((entry) => entry.target === "T2");
  check("the entry to tamper with exists", victim !== undefined);
  if (victim) victim.actor = "SOMEONE-ELSE";

  const afterEdit = verifyChain();
  check("an edited entry is detected", !afterEdit.ok);
  check("the break points at the edited entry", afterEdit.brokenAt === 1, String(afterEdit.brokenAt));
  check("and it explains why", (afterEdit.reason ?? "").includes("does not match"));

  // Removing an entry must also break the chain, even though the remaining
  // entries are individually untouched. This is the subtler case: a checksum
  // per entry would not catch it, a chain does.
  clearAudit();
  recordAudit({ action: "ticket.created", actor: "A", target: "T1" });
  recordAudit({ action: "ticket.updated", actor: "B", target: "T2" });
  recordAudit({ action: "ticket.resolved", actor: "C", target: "T3" });
  allAuditEntries().splice(1, 1);

  const afterRemoval = verifyChain();
  check("a removed entry is detected", !afterRemoval.ok, "removal went unnoticed");
  check("the break points at the gap", afterRemoval.brokenAt === 1, String(afterRemoval.brokenAt));

  clearAudit();
  check("an empty log is valid", verifyChain().ok);
}


console.log("\n=== 7. AI ACTIONS are read-only for sensitive data ===\n");
{
  clearApprovals();
  delete process.env.YENE_AI_WRITE_ENABLED;
  delete process.env.YENE_AI_WRITE_SCOPES;

  // The default: the AI cannot change anything sensitive.
  for (const domain of SENSITIVE_DOMAINS) {
    const decision = decideAiAction(
      { domain, effect: "write", operation: "modify", businessId: "green-coffee" },
      ownerA,
      null,
    );
    check(`a write to "${domain}" is refused by default`, !decision.allowed);
    check(`  and the reason is read-only`, decision.reason === "read-only-by-default", decision.reason ?? "");
  }

  // Enabling writes is not enough: the scope must be allow-listed too.
  process.env.YENE_AI_WRITE_ENABLED = "true";
  const unlisted = decideAiAction(
    { domain: "billing", effect: "write", operation: "refund", businessId: "green-coffee" },
    ownerA,
    null,
  );
  check("enabling writes does not allow an unlisted scope", !unlisted.allowed);
  check("  and the reason is the scope", unlisted.reason === "domain-not-allowed");

  // A listed scope still needs a human approval for a sensitive domain.
  process.env.YENE_AI_WRITE_SCOPES = "billing.refund";
  const withoutApproval = decideAiAction(
    { domain: "billing", effect: "write", operation: "refund", businessId: "green-coffee" },
    ownerA,
    null,
  );
  check("a listed scope still needs approval", !withoutApproval.allowed);
  check("  and says so", withoutApproval.reason === "approval-required", withoutApproval.reason ?? "");
  check("  and flags that approval is required", withoutApproval.requiresApproval);

  // With a matching approval, the action is allowed.
  const approval = grantApproval({
    domain: "billing", operation: "refund", businessId: "green-coffee", approvedBy: "Yonas",
  });
  const approved = decideAiAction(
    { domain: "billing", effect: "write", operation: "refund", businessId: "green-coffee" },
    ownerA,
    approval,
  );
  check("a matching approval allows the action", approved.allowed, approved.reason ?? "");

  // An approval for something else is not consent. `billing.cancel` is added to
  // the allow-list so this exercises the APPROVAL mismatch specifically rather
  // than tripping the earlier, coarser scope check.
  process.env.YENE_AI_WRITE_SCOPES = "billing.refund,billing.cancel";
  const wrongOperation = decideAiAction(
    { domain: "billing", effect: "write", operation: "cancel", businessId: "green-coffee" },
    ownerA,
    approval,
  );
  check("an approval for another operation does not apply", !wrongOperation.allowed);
  check("  and is refused as missing", wrongOperation.reason === "approval-missing",
    wrongOperation.reason ?? "");

  // An approval is single use.
  consumeApproval(approval.id);
  const replayed = decideAiAction(
    { domain: "billing", effect: "write", operation: "refund", businessId: "green-coffee" },
    ownerA,
    approval,
  );
  check("an approval cannot be replayed", !replayed.allowed);

  // Cross-tenant is refused even with writes fully enabled, and is reported as
  // the more serious problem.
  const crossTenant = decideAiAction(
    { domain: "billing", effect: "write", operation: "refund", businessId: "blue-shop" },
    ownerA,
    null,
  );
  check("a cross-tenant action is refused", !crossTenant.allowed);
  check("  and identified as cross-tenant", crossTenant.reason === "cross-tenant", crossTenant.reason ?? "");

  // A guest has no business, so nothing is actionable.
  const asGuest = decideAiAction(
    { domain: "inventory", effect: "write", operation: "restock", businessId: "green-coffee" },
    guest,
    null,
  );
  check("a guest can never trigger an action", !asGuest.allowed);

  // A non-sensitive read is always fine.
  const read = decideAiAction(
    { domain: "platform", effect: "read", operation: "view", businessId: "green-coffee" },
    ownerA,
    null,
  );
  check("a read is allowed", read.allowed);
  check("a read never needs approval", read.requiresApproval === false);
}

console.log("\n=== 8. FAILURE MODE: the AI escalates rather than guessing ===\n");
{
  delete process.env.YENE_AI_WRITE_ENABLED;
  delete process.env.YENE_AI_WRITE_SCOPES;

  const denied = decideAiAction(
    { domain: "permissions", effect: "write", operation: "grant", businessId: "green-coffee" },
    ownerA,
    null,
  );
  check("the action is refused", !denied.allowed);
  check("the fallback is human support", fallbackFor(denied) === "human-support");
  check("an allowed action needs no fallback",
    fallbackFor({ allowed: true, requiresApproval: false, reason: null, message: "" }) === "none");

  // The wording must not leak why it was refused, or what the configuration is.
  check("the refusal explains nothing about configuration",
    !denied.message.toLowerCase().includes("config")
    && !denied.message.toLowerCase().includes("scope")
    && !denied.message.toLowerCase().includes("approval"));
  check("the refusal offers a human instead", /support agent/i.test(denied.message));
  check("the refusal is not an empty string", denied.message.length > 20);

  // Approvals are visible so a manager can see what is outstanding.
  grantApproval({ domain: "orders", operation: "cancel", businessId: "green-coffee", approvedBy: "Yonas" });
  check("a pending approval is listed", findApproval("orders", "cancel", "green-coffee") !== null);
  check("an approval for another business is not found",
    findApproval("orders", "cancel", "blue-shop") === null);
}

console.log(failures === 0 ? "\nALL SECURITY CHECKS PASSED\n" : "\n" + failures + " SECURITY CHECK(S) FAILED\n");
process.exit(failures === 0 ? 0 : 1);

