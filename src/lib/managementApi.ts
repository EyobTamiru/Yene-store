/**
 * ============================================================================
 *  MANAGEMENT CLIENT
 * ============================================================================
 *
 *  Two calls, and note what is NOT here: there is no function that takes a
 *  businessId. The browser cannot ask for another tenant's dashboard because it
 *  has no way to express the question - `/api/management/overview` has no
 *  parameters at all.
 *
 *  The access call is also how the header decides whether to draw the button.
 *  That is a convenience only: the server re-checks on every call, so hiding
 *  the button is never what enforces anything.
 */

export type ManagementDenial = "not-authenticated" | "no-business" | "role-not-permitted";

export interface ManagementModule {
  key: string;
  label: string;
  feature: string | null;
  access: "available" | "locked" | "hidden";
  unlockWith: string | null;
}

export interface ManagementAccess {
  canAccess: boolean;
  reason: "ok" | ManagementDenial;
  role: "owner" | "manager" | "employee" | "customer" | "super-admin" | "guest";
  userId: string;
  displayName: string | null;
  business: { id: string; name: string; subdomain: string; status: string } | null;
  packageId: string | null;
  roleFeatures: string[] | null;
  roleName: string | null;
  modules: ManagementModule[];
  entitlements: Record<string, boolean>;
}

export interface ManagementOverview {
  ok: true;
  business: ManagementAccess["business"];
  packageId: string | null;
  role: ManagementAccess["role"];
  roleName: string | null;
  displayName: string | null;
  modules: ManagementModule[];
  stats: {
    todaySales: number;
    todayOrders: number;
    orders: number;
    customers: number;
    products: number;
    lowStock: number;
    lowStockItems: { itemId: string; name: string; onHand: number; reorderLevel: number; status: string }[];
    expenses: number;
  };
}

export class ManagementError extends Error {
  readonly userMessage: string;
  readonly status: number;

  constructor(userMessage: string, status: number) {
    super("management_unavailable");
    this.name = "ManagementError";
    this.userMessage = userMessage;
    this.status = status;
  }
}

async function call<T>(path: string): Promise<T> {
  let response: Response;
  try {
    // The session cookie must ride along, exactly as in authApi.
    response = await fetch(path, { credentials: "same-origin" });
  } catch (error) {
    console.error("[management] network failure:", error);
    throw new ManagementError("We could not reach YENE-STORE. Please check your connection.", 0);
  }
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const message =
      typeof body.error === "string" ? body.error : "Something went wrong. Please try again.";
    throw new ManagementError(message, response.status);
  }
  return body as T;
}

/** May this person see the button? Never throws - a failure means "no". */
export async function fetchManagementAccess(): Promise<ManagementAccess | null> {
  try {
    return await call<ManagementAccess>("/api/management/access");
  } catch {
    // A network problem or an expired session means the button stays hidden,
    // which is the safe direction to fail.
    return null;
  }
}

/** The dashboard figures. Throws on 401/403 so the screen can explain why. */
export const fetchManagementOverview = () => call<ManagementOverview>("/api/management/overview");
