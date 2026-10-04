/**
 * Support dashboard verification - the security-critical Section 4 rules.
 *
 *   npm run test:permissions
 *
 * Proves:
 *   1. Business/customer tokens are NOT support staff.
 *   2. The permission matrix matches the specification.
 *   3. Agents only see their own tickets; managers see all.
 *   4. Internal notes are stripped from the customer view.
 */

import {
  can,
  canViewTicket,
  ROLE_LABELS,
  resolveSupportStaff,
  seesAllTickets,
  SUPPORT_ROLES,
  type SupportRoleName,
  type SupportStaff,
} from "../api/support/roles";
import { ticketForCustomer } from "../api/support/tickets";
import type { SupportTicket } from "../api/support/types";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

const staff = (role: SupportRoleName, id: string): SupportStaff => ({
  id, name: `Test ${role}`, email: `${role}@yene.example`, role,
});

const agent = staff("support-agent", "s1");
const senior = staff("senior-support-agent", "s2");
const manager = staff("support-manager", "s3");

console.log("\n=== 1. Business users are never support staff ===\n");
{
  process.env.AUTH_MODE = "development";

  check("staff:manager resolves to a manager", resolveSupportStaff("staff:manager")?.role === "support-manager");
  check("staff:admin resolves to a super admin", resolveSupportStaff("staff:admin")?.role === "super-admin");

  // Business/customer tokens must NOT resolve to staff, even though they are
  // valid Yene-Store identities on the customer side.
  for (const token of ["dev:green-coffee", "dev:staff-member", "dev:shopper"]) {
    check(`business token "${token}" is not support staff`, resolveSupportStaff(token) === null);
  }
  check("no token is not staff", resolveSupportStaff(null) === null);
  check("a KB admin token is not support staff", resolveSupportStaff("test-admin-token-12345") === null);
  check("random token is not staff", resolveSupportStaff("nope") === null);
}

console.log("\n=== 2. The four required roles exist and are labelled ===\n");
{
  check("exactly four roles", SUPPORT_ROLES.length === 4, SUPPORT_ROLES.join(", "));
  for (const role of SUPPORT_ROLES) {
    check(`${role} has a human label`, !!ROLE_LABELS[role]);
  }
}

console.log("\n=== 3. Permission matrix ===\n");
{
  check("agent does not see all tickets", !seesAllTickets("support-agent"));
  check("senior does not see all tickets", !seesAllTickets("senior-support-agent"));
  check("manager sees all tickets", seesAllTickets("support-manager"));
  check("super admin sees all tickets", seesAllTickets("super-admin"));

  check("agent cannot assign", !can("support-agent", "ticket.assign"));
  check("senior cannot assign", !can("senior-support-agent", "ticket.assign"));
  check("manager can assign", can("support-manager", "ticket.assign"));
  check("super admin can assign", can("super-admin", "ticket.assign"));

  check("agent cannot change priority", !can("support-agent", "ticket.priority.change"));
  check("senior can change priority", can("senior-support-agent", "ticket.priority.change"));

  check("agent cannot see phone", !can("support-agent", "customer.phone.view"));
  check("senior can see phone", can("senior-support-agent", "customer.phone.view"));

  check("agent can add a note", can("support-agent", "ticket.note.add"));
  check("agent cannot READ notes", !can("support-agent", "ticket.note.view"));
  check("senior can read notes", can("senior-support-agent", "ticket.note.view"));

  check("agent cannot reopen", !can("support-agent", "ticket.reopen"));
  check("manager can reopen", can("support-manager", "ticket.reopen"));
}

console.log("\n=== 4. Agents only see their own tickets ===\n");
{
  check("agent sees a ticket assigned to them", canViewTicket(agent, "s1"));
  check("agent cannot see another agent's ticket", !canViewTicket(agent, "s2"));
  check("agent cannot see an unassigned ticket", !canViewTicket(agent, null));
  check("manager sees an unassigned ticket", canViewTicket(manager, null));
  check("manager sees any ticket", canViewTicket(manager, "s9"));
  check("senior cannot see an unassigned ticket", !canViewTicket(senior, null));
}

console.log("\n=== 5. Customers never see internal notes ===\n");
{
  const ticket = {
    ticketId: "YENE-TEST01",
    customerName: "Alemayehu",
    customerEmail: "a@example.com",
    customerPhone: "+251 900 000 001",
    businessName: "Green Coffee",
    userId: "u1",
    packageName: "Standard",
    subject: "Inventory issue",
    description: "Cannot see inventory",
    category: "inventory",
    priority: "normal",
    status: "Open",
    assignedAgent: "Bereket",
    assignedTo: "s1",
    createdAt: "2026-09-27T10:00:00.000Z",
    updatedAt: "2026-09-27T10:05:00.000Z",
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    conversationId: "s1",
    aiSummary: {
      customerProblem: "INTERNAL problem statement",
      customerGoal: "INTERNAL goal",
      accountInformation: ["INTERNAL account line"],
      alreadyTried: ["INTERNAL tried"],
      relevantMessages: [],
      suggestedNextSteps: ["INTERNAL next step"],
    },
    escalationReasons: ["unknown-answer"],
    isAuthenticated: true,
    conversation: [
      { role: "user", content: "customer question" },
      { role: "assistant", content: "AI answer" },
    ],
    events: [
      { id: "e1", at: "2026-09-27T10:00:00.000Z", type: "created", actor: "AI", internal: false },
      { id: "e2", at: "2026-09-27T10:05:00.000Z", type: "internal-note", actor: "Bereket", internal: true, body: "SECRET NOTE: customer disputes balance" },
    ],
    attachments: [],
    requestInfo: null,
  } as unknown as SupportTicket;

  const view = ticketForCustomer(ticket);
  const serialised = JSON.stringify(view);

  check("internal notes are not included", !serialised.includes("SECRET NOTE"));
  check("the internal event is filtered out", !(view.events ?? []).some((e) => e.id === "e2"));
  check("the public 'created' event survives", (view.events ?? []).some((e) => e.id === "e1"));
  check("the AI summary is not included", !serialised.includes("INTERNAL problem statement"));
  check("the account information is not included", !serialised.includes("INTERNAL account line"));
  check("the next steps are not included", !serialised.includes("INTERNAL next step"));
  check("the phone number is not included", !serialised.includes("900 000 001"));
  check("customer conversation is included", (view.conversation ?? []).some((c) => c.content === "customer question"));
  check("AI replies are not echoed back", !(view.conversation ?? []).some((c) => c.role === "assistant"));
  check("attachments are not included", !("attachments" in (view as object)));
  check("assigned agent is not included", !("assignedTo" in (view as object)));
  check("ticket id is included", view.ticketId === "YENE-TEST01");
}

console.log(failures === 0 ? "\nALL PERMISSION CHECKS PASSED\n" : "\n" + failures + " PERMISSION CHECK(S) FAILED\n");
process.exit(failures === 0 ? 0 : 1);
