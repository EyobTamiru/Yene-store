/**
 * ============================================================================
 *  MANAGEMENT ACCESS (the "Management System" entry point)
 * ============================================================================
 *
 *  One question, answered in one place: may this caller open the business
 *  Management System, and which of its modules may they see?
 *
 *  IT REUSES THE EXISTING RBAC. There is no new permission store here.
 *
 *      user --(email)--> Employee row --(roleId)--> Role.features
 *                                  \--> UserRole ("owner"/"manager"/...)
 *
 *  intersected with the package ladder, through the `effectiveAccess` helper
 *  that already exists in src/platform/packages.ts: a role may hold a SUBSET of
 *  what the package grants, so an employee can be restricted but never promoted
 *  above the plan. Reusing it is the point - a second entitlement table would
 *  let the browser and the server disagree about what somebody can see.
 *
 *  WHO GETS IN
 *  -----------
 *    owner      yes, bounded by the package
 *    manager    yes, bounded by the package
 *    employee   yes, ONLY with an assigned role (§11)
 *    customer   no  - no business, so nothing to manage
 *    guest      no
 *
 *  A CUSTOMER IS REFUSED BECAUSE THEY HAVE NO `businessId`, which is the same
 *  server-side fact that already refuses every other tenant-scoped route. The
 *  Management System therefore cannot become a second way in.
 */

import type { Request } from "express";
import { resolveIdentity, type PlatformIdentity } from "../platform/auth";
import { allEmployees, allRoles, businessById } from "../platform/store";
import {
  DASHBOARD_MODULES,
  cheapestPackageWith,
  effectiveAccess,
  entitlementsFor,
  hasFeature,
  moduleAccess,
  type ModuleView,
} from "../../src/platform/packages";
import type { FeatureKey, PackageId } from "../../src/platform/types";

/** The roles that may ever be offered the Management System. */
const MANAGEMENT_ROLES: PlatformIdentity["role"][] = ["owner", "manager", "employee"];

/**
 * The feature key that opens the Management System at all.
 *
 * `store` is in EVERY package (the ALWAYS list in packages.ts), so a Silver
 * business is never locked out of its own management area; the richer modules
 * still arrive with Gold, Platinum and Super exactly as before.
 */
export const MANAGEMENT_ENTRY_FEATURE: FeatureKey = "store";

export type ManagementDenial = "not-authenticated" | "no-business" | "role-not-permitted";

export interface ManagementAccess {
  /** May the header show the button, and may the route open? */
  canAccess: boolean;
  /** Why not, when refused. Safe to show to the user. */
  reason: "ok" | ManagementDenial;
  role: PlatformIdentity["role"];
  userId: string;
  displayName: string | null;
  business: { id: string; name: string; subdomain: string; status: string } | null;
  packageId: PackageId | null;
  /** The role's feature list, or null for an owner with no role row. */
  roleFeatures: FeatureKey[] | null;
  roleName: string | null;
  /** Modules with the access decision already applied. */
  modules: ModuleView[];
  /** The package's entitlements, unmodified: the plan, not the person's view. */
  entitlements: Record<FeatureKey, boolean>;
}

/** A uniformly refused answer, so no branch can forget a field. */
function refused(
  identity: PlatformIdentity,
  reason: ManagementDenial,
): ManagementAccess {
  return {
    canAccess: false,
    reason,
    role: identity.role,
    userId: identity.userId,
    displayName: identity.displayName,
    business: null,
    packageId: null,
    roleFeatures: null,
    roleName: null,
    modules: [],
    entitlements: {} as Record<FeatureKey, boolean>,
  };
}

/**
 * The employee row for a signed-in person, matched on NORMALISED email.
 *
 * Normalised because the auth directory lower-cases on write while the employee
 * seed data was typed by hand, and `"A@x.com"` must find `"a@x.com"`.
 */
function employeeByEmail(email: string | null) {
  if (!email) return null;
  const wanted = email.trim().toLowerCase();
  return allEmployees().find((e) => e.email.trim().toLowerCase() === wanted) ?? null;
}

/**
 * Resolve the access answer for a request.
 *
 * Note the signature: it takes the caller's EMAIL, and nothing else. There is
 * deliberately no `businessId` parameter, so no caller can point this at
 * another tenant - the business comes from the session, inside `resolveIdentity`.
 */
export function resolveManagementAccess(req: Request, email: string | null): ManagementAccess {
  const identity = resolveIdentity(req);

  if (!identity.isAuthenticated) return refused(identity, "not-authenticated");

  // A customer, and a platform Super Admin who owns no shop, are both refused
  // here - and for the same reason: there is no tenant to manage.
  const businessId = identity.businessId;
  if (!businessId) return refused(identity, "no-business");

  const business = businessById(businessId);
  if (!business) return refused(identity, "no-business");

  const packageId = business.packageId;

  // An owner or manager is bounded by the package alone. An employee is
  // bounded by their assigned role as well.
  const employee = employeeByEmail(email);
  const role = employee ? allRoles().find((r) => r.id === employee.roleId) ?? null : null;
  const roleFeatures = role ? role.features : null;

  // §11: an employee is NOT owner-level by default. No role row, or a role that
  // grants nothing, means the door stays shut rather than showing an empty
  // dashboard that looks like a bug.
  const roleAllowsEntry =
    identity.isSuperAdmin ||
    identity.role === "owner" ||
    identity.role === "manager" ||
    (identity.role === "employee" && role !== null && role.features.length > 0);

  const packageAllowsEntry = hasFeature(packageId, MANAGEMENT_ENTRY_FEATURE);

  const canAccess = MANAGEMENT_ROLES.includes(identity.role) && roleAllowsEntry && packageAllowsEntry;
  const access = effectiveAccess(packageId, roleFeatures);

  // Each module gets the intersection of the package and the person's role. A
  // module the role does not carry is reported as `locked`, so the existing
  // three-state UI (available / locked-with-explanation / hidden) still works
  // and Section 37's "your data is still here" note is preserved.
  const modules: ModuleView[] = DASHBOARD_MODULES.map((module) => {
    const byPackage = moduleAccess(packageId, module);
    const byRole = module.feature === null || access[module.feature];
    const state: ModuleView["access"] =
      byPackage === "available" && !byRole ? "locked" : byPackage;
    return {
      ...module,
      access: state,
      unlockWith: state === "locked" && module.feature ? cheapestPackageWith(module.feature) : null,
    };
  });

  return {
    canAccess,
    reason: canAccess ? "ok" : roleAllowsEntry ? "no-business" : "role-not-permitted",
    role: identity.role,
    userId: identity.userId,
    displayName: identity.displayName,
    business: {
      id: business.id,
      name: business.name,
      subdomain: business.subdomain,
      status: business.status,
    },
    packageId,
    roleFeatures,
    roleName: role?.name ?? null,
    modules,
    entitlements: entitlementsFor(packageId),
  };
}
