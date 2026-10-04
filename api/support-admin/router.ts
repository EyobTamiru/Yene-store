import { Router, type Request, type Response } from "express";
import { computeMetrics, queryTickets, type SortField } from "../support/dashboard";
import {
  buildAnalyticsReport,
  computeKnowledgeGaps,
  resolveRange,
} from "../support/analytics";
import { saveGapAction } from "../support/analyticsStore";
import {
  AUDIT_ACTIONS, AUDIT_ACTION_LABELS, queryAudit, recordAudit, recordDenied, verifyChain,
  type AuditAction,
} from "../support/auditLog";
import {
  can,
  canViewTicket,
  listDevStaff,
  resolveSupportStaff,
  ROLE_LABELS,
  SUPPORT_CAPABILITIES,
  type SupportCapability,
  type SupportStaff,
} from "../support/roles";
import {
  addEvent,
  getTicketById,
  STATUS_TRANSITIONS,
  ticketPriorities,
  ticketStatuses,
  updateTicket,
} from "../support/ticketStore";
import type {
  SupportTicket,
  TicketAttachment,
  TicketEventType,
  TicketPriority,
  TicketStatus,
} from "../support/types";

/**
 * ============================================================================
 *  SUPPORT DASHBOARD API
 * ============================================================================
 *
 *  Backs the Customer Support section of the Yene-Store admin system. Every
 *  route requires SUPPORT STAFF - not merely a signed-in user. A business owner
 *  or customer token is rejected with 403, because platform-wide support
 *  tickets are not theirs to read.
 *
 *  Each action is gated on a specific capability, so permissions are checked
 *  where the action happens rather than in the UI where they can be bypassed.
 */
export const supportAdminRouter = Router();

/** Bearer token from the request, or null. */
function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

/** Load the staff member, or respond 401/403 and return null. */
function requireStaff(req: Request, res: Response): SupportStaff | null {
  const token = bearer(req);

  if (!token) {
    // Vague on purpose: do not confirm which tokens exist.
    res.status(401).json({ error: "Sign in as support staff to continue." });
    return null;
  }

  const staff = resolveSupportStaff(token);
  if (!staff) {
    // 403, not 404 - a signed-in BUSINESS user is a real user, just not staff.
    res.status(403).json({
      error: "This area is restricted to Yene Business Group support staff.",
    });
    return null;
  }

  return staff;
}

/** Gate a single action on a capability. */
function requireCapability(
  staff: SupportStaff,
  capability: SupportCapability,
  res: Response,
): boolean {
  if (can(staff.role, capability)) return true;
  // Section 8: a refused permission is itself an auditable event. A
  // permission change or an unusual pattern of refusals is exactly what an
  // operator needs to see, and it is invisible unless it is recorded.
  recordDenied({
    action: "permission.changed",
    actor: staff.name,
    actorId: staff.id,
    actorRole: staff.role,
    target: capability,
    detail: `Denied: role lacks ${capability}`,
  });
  res.status(403).json({
    error: `Your role (${ROLE_LABELS[staff.role]}) cannot perform this action.`,
    requiredCapability: capability,
  });
  return false;
}

supportAdminRouter.use((req: Request, res: Response, next) => {
  if (req.path === "/whoami") return next();
  const staff = requireStaff(req, res);
  if (!staff) return;
  res.locals.staff = staff;
  next();
});

function staffOf(res: Response): SupportStaff {
  return res.locals.staff as SupportStaff;
}

/**
 * Record one ticket action in the Section 8 audit log.
 *
 * A single helper, so every mutating route records the same fields and a new
 * route has an obvious thing to call. `businessId` is carried so the log can be
 * filtered per tenant without re-deriving ownership from the ticket.
 */
function auditTicket(
  staff: SupportStaff,
  action: AuditAction,
  ticket: SupportTicket,
  detail: string,
): void {
  recordAudit({
    action,
    actor: staff.name,
    actorId: staff.id,
    actorRole: staff.role,
    actorKind: "staff",
    target: ticket.ticketId,
    detail,
    businessId: ticket.businessId,
  });
}

// ---------------------------------------------------------------------------
// GET /whoami - who am I, and what may I do?
// ---------------------------------------------------------------------------
supportAdminRouter.get("/whoami", (req: Request, res: Response) => {
  const staff = requireStaff(req, res);
  if (!staff) return;
  res.status(200).json({
    ok: true,
    staff: {
      id: staff.id, name: staff.name, email: staff.email,
      role: staff.role, roleLabel: ROLE_LABELS[staff.role],
      capabilities: SUPPORT_CAPABILITIES.filter((c) => can(staff.role, c)),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /meta - option lists for the UI filters
// ---------------------------------------------------------------------------
supportAdminRouter.get("/meta", (_req: Request, res: Response) => {
  const staff = staffOf(res);
  const devMode =
    process.env.NODE_ENV !== "production" && process.env.AUTH_MODE === "development";
  res.status(200).json({
    statuses: ticketStatuses,
    priorities: ticketPriorities,
    roles: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
    assignableStaff: can(staff.role, "ticket.assign") ? (devMode ? listDevStaff() : []) : [],
    canAssign: can(staff.role, "ticket.assign"),
    canViewAll: can(staff.role, "ticket.view.all"),
    // Section 8: the audit log's action vocabulary, for the filter control.
    auditActions: AUDIT_ACTIONS,
    auditActionLabels: AUDIT_ACTION_LABELS,
    canViewAudit: can(staff.role, "audit.view"),
  });
});

// ---------------------------------------------------------------------------
// GET /dashboard - the headline metrics
// ---------------------------------------------------------------------------
supportAdminRouter.get("/dashboard", (_req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "dashboard.view", res)) return;
  res.status(200).json({ ok: true, metrics: computeMetrics(staff) });
});

// ---------------------------------------------------------------------------
// GET /tickets - search, filter, sort, paginate
// ---------------------------------------------------------------------------
supportAdminRouter.get("/tickets", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.view", res)) return;

  const q = req.query;
  const list = (value: unknown): string[] =>
    typeof value === "string" ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];

  const result = queryTickets(staff, {
    search: typeof q.search === "string" ? q.search : undefined,
    status: list(q.status) as TicketStatus[],
    priority: list(q.priority) as TicketPriority[],
    category: list(q.category),
    assignedTo: typeof q.assignedTo === "string" ? q.assignedTo : undefined,
    sort: (typeof q.sort === "string" ? q.sort : "createdAt") as SortField,
    direction: q.direction === "asc" ? "asc" : "desc",
    page: Number(q.page) || 1,
    pageSize: Number(q.pageSize) || 20,
  });

  res.status(200).json({ ok: true, ...result });
});

/**
 * Strip fields the viewer is not entitled to.
 *
 * The customer phone number needs `customer.phone.view`; internal notes need
 * `ticket.note.view`. Both are removed here so no route can leak them.
 */
function ticketForStaff(ticket: SupportTicket, staff: SupportStaff) {
  const maySeePhone = can(staff.role, "customer.phone.view");
  const maySeeNotes = can(staff.role, "ticket.note.view");

  return {
    ...ticket,
    customerPhone: maySeePhone ? ticket.customerPhone : null,
    customerPhoneWithheld: !maySeePhone,
    events: maySeeNotes ? ticket.events : ticket.events.filter((e) => !e.internal),
    internalNotesWithheld: !maySeeNotes,
  };
}

// ---------------------------------------------------------------------------
// GET /tickets/:id - full ticket detail
// ---------------------------------------------------------------------------
supportAdminRouter.get("/tickets/:id", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.view", res)) return;

  const ticket = getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });

  // An agent cannot open a ticket assigned to somebody else.
  if (!canViewTicket(staff, ticket.assignedTo)) {
    return res.status(403).json({ error: "This ticket is not assigned to you." });
  }

  res.status(200).json({ ok: true, ticket: ticketForStaff(ticket, staff) });
});

// ---------------------------------------------------------------------------
// Shared helper: load a ticket this staff member is allowed to act on
// ---------------------------------------------------------------------------
function loadActionable(req: Request, res: Response): SupportTicket | null {
  const staff = staffOf(res);
  const ticket = getTicketById(req.params.id);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found." });
    return null;
  }
  // Anyone who can act on a ticket must also be able to see it.
  if (!canViewTicket(staff, ticket.assignedTo)) {
    res.status(403).json({ error: "This ticket is not assigned to you." });
    return null;
  }
  return ticket;
}

const text = (value: unknown, max = 5000): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** The first time an agent acts on a ticket, stamp the response time. */
function markFirstResponse(ticket: SupportTicket): void {
  if (!ticket.firstResponseAt) ticket.firstResponseAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// POST /tickets/:id/reply
// ---------------------------------------------------------------------------
supportAdminRouter.post("/tickets/:id/reply", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.reply", res)) return;
  const ticket = loadActionable(req, res);
  if (!ticket) return;

  const body = text((req.body ?? {}).body);
  if (!body) return res.status(400).json({ error: "A reply cannot be empty." });

  const updated = updateTicket(ticket.ticketId, (t) => {
    markFirstResponse(t);
    addEvent(t, {
      type: "agent-reply",
      actor: staff.name,
      actorRole: staff.role,
      body,
      // A reply to the customer is NOT internal.
      internal: false,
    });
  });

  auditTicket(staff, "agent.response", updated!, "Replied to the customer");
  res.status(200).json({ ok: true, ticket: ticketForStaff(updated!, staff) });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/note - INTERNAL ONLY
// ---------------------------------------------------------------------------
supportAdminRouter.post("/tickets/:id/note", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.note.add", res)) return;
  const ticket = loadActionable(req, res);
  if (!ticket) return;

  const body = text((req.body ?? {}).body, 4000);
  if (!body) return res.status(400).json({ error: "A note cannot be empty." });

  const updated = updateTicket(ticket.ticketId, (t) => {
    addEvent(t, {
      type: "internal-note",
      actor: staff.name,
      actorRole: staff.role,
      body,
      internal: true, // Never leaves the staff side.
    });
  });
  res.status(200).json({ ok: true, ticket: ticketForStaff(updated!, staff) });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/assign - managers only
// ---------------------------------------------------------------------------
supportAdminRouter.post("/tickets/:id/assign", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.assign", res)) return;

  const ticket = getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const assigneeId = text(body.staffId, 100);
  const assigneeName = text(body.staffName, 120);

  if (!assigneeId) return res.status(400).json({ error: "staffId is required." });

  const updated = updateTicket(ticket.ticketId, (t) => {
    const previous = t.assignedAgent ?? "Unassigned";
    t.assignedTo = assigneeId;
    t.assignedAgent = assigneeName || assigneeId;
    addEvent(t, {
      type: "assignment",
      actor: staff.name,
      actorRole: staff.role,
      internal: false,
      meta: { from: previous, to: t.assignedAgent },
    });
  });

  auditTicket(staff, "ticket.assigned", updated!, "Assigned");
  res.status(200).json({ ok: true, ticket: ticketForStaff(updated!, staff) });
});

// ---------------------------------------------------------------------------
// PATCH /tickets/:id/priority
// ---------------------------------------------------------------------------
supportAdminRouter.patch("/tickets/:id/priority", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.priority.change", res)) return;
  const ticket = loadActionable(req, res);
  if (!ticket) return;

  const priority = text((req.body ?? {}).priority, 20) as TicketPriority;
  if (!ticketPriorities.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${ticketPriorities.join(", ")}` });
  }

  const updated = updateTicket(ticket.ticketId, (t) => {
    const previous = t.priority;
    t.priority = priority;
    addEvent(t, {
      type: "priority-change",
      actor: staff.name, actorRole: staff.role, internal: false,
      meta: { from: previous, to: priority },
    });
  });
  auditTicket(staff, "ticket.updated", updated!, "Priority changed");
  res.status(200).json({ ok: true, ticket: ticketForStaff(updated!, staff) });
});

// ---------------------------------------------------------------------------
// PATCH /tickets/:id/status
// ---------------------------------------------------------------------------
supportAdminRouter.patch("/tickets/:id/status", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.status.change", res)) return;
  const ticket = loadActionable(req, res);
  if (!ticket) return;

  const status = text((req.body ?? {}).status, 40) as TicketStatus;
  if (!ticketStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ticketStatuses.join(", ")}` });
  }
  if (!STATUS_TRANSITIONS[ticket.status].includes(status)) {
    return res.status(400).json({
      error: `Cannot move a ticket from "${ticket.status}" to "${status}".`,
    });
  }

  const updated = updateTicket(ticket.ticketId, (t) => {
    const previous = t.status;
    t.status = status;
    if (status === "Resolved") t.resolvedAt = new Date().toISOString();
    if (status === "Closed") t.closedAt = new Date().toISOString();
    addEvent(t, {
      type: "status-change", actor: staff.name, actorRole: staff.role, internal: false,
      meta: { from: previous, to: status },
    });
  });
  auditTicket(staff, "ticket.updated", updated!, `Status changed to ${status}`);
  res.status(200).json({ ok: true, ticket: ticketForStaff(updated!, staff) });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/request-info
// ---------------------------------------------------------------------------
supportAdminRouter.post("/tickets/:id/request-info", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.request-info", res)) return;
  const ticket = loadActionable(req, res);
  if (!ticket) return;

  const body = text((req.body ?? {}).body, 2000);
  if (!body) return res.status(400).json({ error: "Describe what you need from the customer." });

  const updated = updateTicket(ticket.ticketId, (t) => {
    t.requestInfo = body;
    markFirstResponse(t);
    addEvent(t, {
      type: "info-request", actor: staff.name, actorRole: staff.role,
      body, internal: false,
    });
  });
  res.status(200).json({ ok: true, ticket: ticketForStaff(updated!, staff) });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/attachments
//
// Metadata only. The file itself belongs in your object storage; `storageKey`
// is the reference the dashboard uses to fetch it.
// ---------------------------------------------------------------------------
supportAdminRouter.post("/tickets/:id/attachments", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.attach", res)) return;
  const ticket = loadActionable(req, res);
  if (!ticket) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = text(body.name, 200);
  if (!name) return res.status(400).json({ error: "An attachment needs a name." });

  const attachment: TicketAttachment = {
    name,
    size: Number(body.size) || 0,
    contentType: text(body.contentType, 120) || "application/octet-stream",
    uploadedBy: staff.name,
    uploadedAt: new Date().toISOString(),
    storageKey: text(body.storageKey, 400) || `pending/${ticket.ticketId}/${name}`,
  };

  const updated = updateTicket(ticket.ticketId, (t) => {
    t.attachments.push(attachment);
    addEvent(t, {
      type: "attachment", actor: staff.name, actorRole: staff.role, internal: false,
      meta: { name: attachment.name, size: String(attachment.size) },
    });
  });
  res.status(200).json({ ok: true, ticket: ticketForStaff(updated!, staff) });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/resolve  and  /reopen
// ---------------------------------------------------------------------------
supportAdminRouter.post("/tickets/:id/resolve", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.resolve", res)) return;
  const ticket = loadActionable(req, res);
  if (!ticket) return;

  const note = text((req.body ?? {}).body, 2000);
  const updated = updateTicket(ticket.ticketId, (t) => {
    markFirstResponse(t);
    t.status = "Resolved";
    t.resolvedAt = new Date().toISOString();
    addEvent(t, {
      type: "resolved", actor: staff.name, actorRole: staff.role,
      body: note || undefined, internal: false,
    });
  });
  auditTicket(staff, "ticket.resolved", updated!, "Resolved");
  res.status(200).json({ ok: true, ticket: ticketForStaff(updated!, staff) });
});

supportAdminRouter.post("/tickets/:id/reopen", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "ticket.reopen", res)) return;
  const ticket = loadActionable(req, res);
  if (!ticket) return;

  const reason = text((req.body ?? {}).body, 2000);
  const updated = updateTicket(ticket.ticketId, (t) => {
    t.status = "Open";
    t.resolvedAt = null;
    t.closedAt = null;
    addEvent(t, {
      type: "reopened", actor: staff.name, actorRole: staff.role,
      body: reason || undefined, internal: false,
    });
  });
  auditTicket(staff, "ticket.reopened", updated!, "Reopened");
  res.status(200).json({ ok: true, ticket: ticketForStaff(updated!, staff) });
});

// ---------------------------------------------------------------------------
// Section 7: support analytics
// ---------------------------------------------------------------------------
//
// Platform-wide reporting over AI conversations, human tickets and customer
// satisfaction.
//
// AUTHORIZATION
// -------------
// Gated on `analytics.view`, which only support managers and super admins hold.
// A support agent can see the tickets assigned to them, but the aggregate
// report covers the whole platform - every business, every package, every
// conversation - which is exactly the exposure the specification restricts to
// authorized administrators. The check is here rather than in the UI because a
// hidden button is not an authorization control.
//
// The payload contains no customer identity and no raw conversation text. See
// api/support/privacy.ts for the full argument.

// GET /analytics?days=30 - the whole report. 0 or absent means all history.
supportAdminRouter.get("/analytics", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "analytics.view", res)) return;

  const days = Number(req.query.days) || 0;
  res.status(200).json({ ok: true, report: buildAnalyticsReport(days) });
});

// POST /analytics/gaps - record what an administrator decided about a gap
//
// This is the action half of the knowledge-gap loop: analytics finds the
// question, an administrator decides "we are writing this article" or "this is
// expected, it is not a gap", and the decision is stored so the same question
// stops reappearing as an unaddressed item on every future report.
supportAdminRouter.post("/analytics/gaps", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "knowledge-gap.manage", res)) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const fingerprint = text(body.fingerprint, 64);
  if (!fingerprint) return res.status(400).json({ error: "A gap fingerprint is required." });

  const action = text(body.action, 32);
  if (action !== "planned" && action !== "dismissed" && action !== "published") {
    return res.status(400).json({
      error: 'action must be one of: planned, dismissed, published.',
    });
  }

  const saved = saveGapAction(fingerprint, action, staff.name, text(body.note, 500));
  res.status(200).json({ ok: true, decision: saved });
});

// GET /analytics/gaps - the knowledge-gap list on its own
supportAdminRouter.get("/analytics/gaps", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "analytics.view", res)) return;

  const days = Number(req.query.days) || 0;
  res.status(200).json({ ok: true, gaps: computeKnowledgeGaps(resolveRange(days)) });
});


// ---------------------------------------------------------------------------
// Section 8: the audit log
// ---------------------------------------------------------------------------
//
// WHO MAY READ IT
// ---------------
// Gated on `audit.view`, held by support managers and super admins only.
//
// An audit log lists who accessed what, which is exactly the sort of record an
// ordinary support agent must not be able to browse - it would let one agent
// see the pattern of another agent's work. Managers supervise, so they read it;
// agents act, so they do not.

// GET /audit - the log, filterable and paginated
supportAdminRouter.get("/audit", (req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "audit.view", res)) return;

  const q = req.query;
  const action = typeof q.action === "string" ? (q.action as AuditAction) : undefined;

  // An unknown action filter is ignored rather than passed through, so the
  // query can never widen the result set to "everything".
  const validAction =
    action && AUDIT_ACTIONS.includes(action) ? action : undefined;

  res.status(200).json({
    ok: true,
    ...queryAudit({
      action: validAction,
      actor: typeof q.actor === "string" ? q.actor : undefined,
      target: typeof q.target === "string" ? q.target : undefined,
      businessId: typeof q.businessId === "string" ? q.businessId : undefined,
      since: typeof q.since === "string" ? q.since : undefined,
      limit: Number(q.limit) || 50,
      page: Number(q.page) || 1,
    }),
  });
});

// GET /audit/integrity - has the log been altered?
//
// Recomputes the hash chain and reports the index of the first entry that does
// not match. A manager should be able to ask this question without trusting the
// log's own claim to be intact.
supportAdminRouter.get("/audit/integrity", (_req: Request, res: Response) => {
  const staff = staffOf(res);
  if (!requireCapability(staff, "audit.view", res)) return;

  res.status(200).json({ ok: true, integrity: verifyChain() });
});

