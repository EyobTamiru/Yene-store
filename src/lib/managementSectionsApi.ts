/**
 * ============================================================================
 *  SECTION DATA CLIENT
 * ============================================================================
 *
 *  One function per backend route that actually exists, and nothing for the
 *  sections that have none. Deliberately no generic `fetchSection(key)` - such a
 *  switch would be a place to add a call without noticing the section is
 *  unsupported, and the point of the registry is that a section cannot quietly
 *  acquire a fake capability.
 *
 *  TENANT ISOLATION
 *  ----------------
 *  Not one function here takes a `businessId`. The browser has no way to ask for
 *  another tenant's records, which is the property `managementApi` already
 *  relies on and the reason `/api/platform/operations` returns only the
 *  caller's own shop. The `store` call is the one exception and it is a PUBLIC
 *  storefront lookup by subdomain - a URL, not a tenant selector.
 *
 *  AMOUNTS
 *  -------
 *  The platform API returns whole-number ETB amounts (`amount: number`), not
 *  the integer-cents `Minor` the finance system uses. These are separate
 *  systems and the types say so, so nobody assumes a platform price is safe to
 *  post to a wallet.
 */

import { ManagementError } from "./managementApi";

async function call<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin" });
  } catch {
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

/** POST, for the sections that genuinely have a write endpoint. */
async function send<T>(path: string, payload: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
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

// ---------------------------------------------------------------------------
// The shapes the routes actually return.
// ---------------------------------------------------------------------------

export interface SectionProduct {
  product: {
    id: string;
    name: string;
    price: number;
    categoryId: string | null;
    stock: number;
    description: string;
    imageUrl: string | null;
    publishToMarketplace: boolean;
  };
  marketplaceStatus: string;
}

export interface SectionOrder {
  id: string;
  customerId: string;
  customerName: string;
  total: number;
  status: string;
  createdAt: string;
  paymentStatus: string;
}

export interface SectionOperations {
  customers: { id: string; name: string; email: string; phone: string; createdAt: string }[];
  suppliers: { id: string; name: string; email: string; phone: string }[];
  purchases: { id: string; supplierId: string; total: number; status: string; createdAt: string }[];
  employees: { id: string; name: string; email: string; role: string }[];
  expenses: { id: string; category: string; amount: number; note: string; createdAt: string }[];
  roles: { id: string; name: string; features: string[] }[];
}

export interface SectionSubscription {
  subscription: {
    packageId: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    autoRenew: boolean;
    pendingChange: { toPackage: string; effectiveAt: string } | null;
  };
  summary: { packageName: string; monthlyPrice: number; daysRemaining: number } | null;
  entitlements: Record<string, boolean>;
  modules: { key: string; label: string }[];
  packages: { id: string; name: string; monthlyPrice: number; tagline: string }[];
  changeHistory: { id: string; type: string; fromPackage: string; toPackage: string; at: string }[];
  invoices: { id: string; number: string; total: number; status: string; issuedAt: string }[];
}

// --- Reads -----------------------------------------------------------------

export const fetchSectionProducts = () =>
  call<{ ok: true; products: SectionProduct[] }>("/api/platform/products");

export const fetchSectionOrders = () =>
  call<{ ok: true; orders: SectionOrder[] }>("/api/platform/orders/business");

export const fetchSectionOperations = () => call<{ ok: true } & SectionOperations>("/api/platform/operations");

export const fetchSectionInventory = () => call<{ ok: true } & SectionInventory>("/api/platform/inventory");

export const fetchSectionCategories = () =>
  call<{
    ok: true;
    categories: { id: string; name: string; parentId: string | null; enabled: boolean }[];
  }>("/api/platform/categories");

/** A PUBLIC storefront lookup, addressed by subdomain rather than by tenant. */
export const fetchSectionStore = (subdomain: string) =>
  call<{
    business: { id: string; name: string; status: string; subdomain: string };
    products: { id: string; name: string; price: number; imageUrl: string | null }[];
    customization: {
      businessName: string;
      description: string;
      contact: { phone: string; email: string; address: string };
    };
    rating: number;
  }>(`/api/platform/store/${encodeURIComponent(subdomain)}`);

export const fetchSectionPromotions = () =>
  call<{
    promotions: {
      id: string;
      businessId: string;
      businessName: string;
      label: string;
      code: string;
      percentOff: number;
      startsAt: string;
      endsAt: string;
      active: boolean;
    }[];
  }>("/api/platform/promotions");

export const fetchSectionSubscription = () => call<{ ok: true } & SectionSubscription>("/api/platform/subscription");

// --- The writes that genuinely exist ---------------------------------------

/** Section 13 -> 14: submit a product for marketplace review. */
export const submitProductForReview = (productId: string) =>
  send<{ ok: true; submission: { status: string } }>(
    `/api/platform/products/${encodeURIComponent(productId)}/submit`,
    {},
  );

/** Section 22: move an order along its lifecycle. */
export const updateOrderStatus = (orderId: string, status: string, note = "") =>
  send<{ ok: true; order: SectionOrder }>(
    `/api/platform/orders/${encodeURIComponent(orderId)}/status`,
    { status, note },
  );

/** Section 32-36: move to another package. */
export const changePackage = (toPackage: string) =>
  send<{ ok: true }>("/api/platform/subscription/change", { toPackage });

/** Section 34: pay the full price of the current package for the next period. */
export const renewPackage = () => send<{ ok: true }>("/api/platform/subscription/renew", {});


export interface SectionInventory {
  items: { id: string; name: string; sku: string; onHand: number; reorderLevel: number; unit: string }[];
  nodes: { id: string; name: string; kind: string }[];
  report: Record<string, number>;
  lowStock: string[];
  movements: { id: string; itemId: string; itemName: string; kind: string; quantity: number; at: string }[];
}
