
// ---------------------------------------------------------------------------
// Server-only platform types
// ---------------------------------------------------------------------------

/** Who is calling. Distinct from the support bot's role vocabulary. */
export type PlatformRole =
  | "owner"
  | "manager"
  | "employee"
  | "customer"
  | "super-admin"
  | "guest";

/** Section 45: the Super Admin surface. */
export const SUPER_ADMIN_AREAS = [
  "Businesses",
  "Stores",
  "Packages",
  "Subscriptions",
  "Payments",
  "Users",
  "Roles",
  "Permissions",
  "Marketplace",
  "Products",
  "Categories",
  "Marketplace submissions",
  "Reviews",
  "Orders",
  "Promotions",
  "Campaigns",
  "Banners",
  "Featured stores",
  "Sponsored products",
  "Promotion approvals",
  "Platform",
  "Settings",
  "Security",
  "Analytics",
  "Audit logs",
  "Support",
  "AI knowledge base",
  "Payment configuration",
  "Delivery configuration",
] as const;

export type SuperAdminArea = (typeof SUPER_ADMIN_AREAS)[number];

/** Section 40: the Super quotation inputs, verbatim from the specification. */
export const QUOTE_FACTORS = [
  "Business size",
  "Branches",
  "Users",
  "Warehouses",
  "Inventory complexity",
  "ERP requirements",
  "CRM requirements",
  "POS",
  "Integrations",
  "Automation",
  "Custom development",
  "Hosting",
  "Support",
  "Documentation",
] as const;

export type QuoteFactor = (typeof QUOTE_FACTORS)[number];

/**
 * Section 29: the commercial name for the custom system.
 *
 * Stated explicitly rather than implied, because getting this wrong is a
 * misrepresentation: this is NOT Frappe ERP/ERPNext. It is a system built by
 * Yene Business Group "inspired by modern ERP workflows and customized to the
 * customer's operational requirements".
 */
export const CUSTOM_ERP_NAME = "Yene Custom Business ERP & Inventory System";

export const CUSTOM_ERP_DESCRIPTION =
  "A custom-built business management and inventory platform developed by Yene Business Group, " +
  "inspired by modern ERP workflows and customized to the customer operational requirements.";
