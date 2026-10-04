/**
 * ============================================================================
 *  SUPPORT STAFF ROLES AND PERMISSIONS
 * ============================================================================
 *
 *  Platform support staff are a DIFFERENT population from Yene-Store business
 *  users. A business owner, employee or customer is a customer of the support
 *  system, not a user of it.
 *
 *  The single most important rule in this file:
 *
 *      A business/customer token must NEVER be accepted as support staff.
 *
 *  Support staff authenticate through a separate token and a separate resolver
 *  (`resolveSupportStaff`). Business tokens carry no support role, so there is
 *  no path by which signing in as a business owner grants access to
 *  platform-wide tickets.
 */

export const SUPPORT_ROLES = [
  "support-agent",
  "senior-support-agent",
  "support-manager",
  "super-admin",
] as const;

export type SupportRoleName = (typeof SUPPORT_ROLES)[number];

/** Every distinct thing a staff member can be allowed to do. */
export const SUPPORT_CAPABILITIES = [
  "dashboard.view",
  "ticket.view",
  "ticket.view.all",
  "ticket.reply",
  "ticket.assign",
  "ticket.priority.change",
  "ticket.status.change",
  "ticket.note.add",
  "ticket.note.view",
  "ticket.attach",
  "ticket.request-info",
  "ticket.resolve",
  "ticket.reopen",
  "customer.contact.view",
  "customer.phone.view",
  /**
   * Section 7 platform-wide analytics.
   *
   * Deliberately withheld from `support-agent` and `senior-support-agent`:
   * the report is platform-wide by definition, so "authorized administrators"
   * means managers and super admins rather than anybody who can see a ticket.
   * An agent already gets the per-ticket view it needs.
   */
  "analytics.view",
  "knowledge-gap.manage",
  /**
   * Section 8: reading the audit log.
   *
   * Managers and super admins only. The log records who accessed what, so an
   * ordinary agent must not be able to browse another agent's activity.
   */
  "audit.view",
  "staff.manage",
] as const;

export type SupportCapability = (typeof SUPPORT_CAPABILITIES)[number];

/**
 * The permission matrix.
 *
 * Read it as: what can this role do? Anything absent is refused.
 *
 * Two capabilities are withheld from the base agent role on purpose:
 *  - `ticket.view.all`  so an agent cannot read another agent's conversations
 *  - `customer.phone.view`  so a customer phone number needs a senior decision
 */
const MATRIX: Record<SupportRoleName, ReadonlySet<SupportCapability>> = {
  "support-agent": new Set<SupportCapability>([
    "ticket.view",
    "ticket.reply",
    "ticket.status.change",
    "ticket.note.add",
    "ticket.attach",
    "ticket.request-info",
  ]),
  "senior-support-agent": new Set<SupportCapability>([
    "dashboard.view",
    "ticket.view",
    "ticket.reply",
    "ticket.status.change",
    "ticket.note.add",
    "ticket.note.view",
    "ticket.attach",
    "ticket.request-info",
    "ticket.priority.change",
    "ticket.resolve",
    "customer.contact.view",
    "customer.phone.view",
  ]),
  "support-manager": new Set<SupportCapability>([
    "dashboard.view",
    "ticket.view",
    "ticket.view.all",
    "ticket.reply",
    "ticket.assign",
    "ticket.priority.change",
    "ticket.status.change",
    "ticket.note.add",
    "ticket.note.view",
    "ticket.attach",
    "ticket.request-info",
    "ticket.resolve",
    "ticket.reopen",
    "customer.contact.view",
    "customer.phone.view",
    "analytics.view",
    "knowledge-gap.manage",
    "audit.view",
  ]),
  "super-admin": new Set<SupportCapability>(SUPPORT_CAPABILITIES),
};

export const ROLE_LABELS: Record<SupportRoleName, string> = {
  "support-agent": "Support Agent",
  "senior-support-agent": "Senior Support Agent",
  "support-manager": "Support Manager",
  "super-admin": "Super Admin",
};

export interface SupportStaff {
  id: string;
  name: string;
  email: string;
  role: SupportRoleName;
}

export function can(role: SupportRoleName, capability: SupportCapability): boolean {
  return MATRIX[role].has(capability);
}

/** True when the role may see every ticket rather than only its own. */
export function seesAllTickets(role: SupportRoleName): boolean {
  return can(role, "ticket.view.all");
}

/**
 * May this staff member open this specific ticket?
 *
 * Agents see the tickets assigned to them. Roles with `ticket.view.all` see
 * everything. This is what stops one agent reading another agent's customer
 * conversations.
 */
export function canViewTicket(staff: SupportStaff, assignedTo: string | null): boolean {
  if (seesAllTickets(staff.role)) return true;
  return assignedTo !== null && assignedTo === staff.id;
}

/** Dev-only staff identities, mirroring the business dev identities. */
const DEV_STAFF: Record<string, SupportStaff> = {
  "staff:agent": {
    id: "staff-1", name: "Bereket (support agent)",
    email: "bereket@yenebusinessgroup.com", role: "support-agent",
  },
  "staff:senior": {
    id: "staff-2", name: "Selam (senior agent)",
    email: "selam@yenebusinessgroup.com", role: "senior-support-agent",
  },
  "staff:manager": {
    id: "staff-3", name: "Yonas (support manager)",
    email: "yonas@yenebusinessgroup.com", role: "support-manager",
  },
  "staff:admin": {
    id: "staff-4", name: "Admin (super admin)",
    email: "admin@yenebusinessgroup.com", role: "super-admin",
  },
};

function devStaffEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.AUTH_MODE === "development";
}

/**
 * Resolve support staff from a bearer token.
 *
 * Returns null for anyone who is not support staff, including signed-in
 * business users. There is deliberately no "promote a customer token" path.
 */
export function resolveSupportStaff(bearerToken: string | null): SupportStaff | null {
  if (!bearerToken) return null;

  if (devStaffEnabled() && bearerToken.startsWith("staff:")) {
    return DEV_STAFF[bearerToken] ?? null;
  }

  // ---------------------------------------------------------------------
  //  PRODUCTION INTEGRATION POINT
  // ---------------------------------------------------------------------
  //  Verify the staff session and return a record ONLY when the subject has a
  //  support role:
  //
  //    const claims = await verifyStaffToken(bearerToken);
  //    if (!claims) return null;
  //    if (!SUPPORT_ROLES.includes(claims.supportRole)) return null;
  //    return { id: claims.sub, name: claims.name, email: claims.email, role: claims.supportRole };
  //
  //  Until this is wired up every request resolves to null and the dashboard
  //  is unreachable, which is the safe default.
  return null;
}

/** Dev helper: the staff identities available in development mode. */
export function listDevStaff(): SupportStaff[] {
  return Object.values(DEV_STAFF);
}
