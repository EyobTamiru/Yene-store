/**
 * ============================================================================
 *  PACKAGES, ENTITLEMENTS AND MODULE ACCESS (Sections 9, 26, 38, 44, 54)
 * ============================================================================
 *
 *  This is the single source of truth for "what does a package get?".
 *
 *  WHY IT IS ONE TABLE
 *  -------------------
 *  The specification says the same thing in four places: Section 26 ("only
 *  modules included in the business's package should be available"), Section
 *  38 (a feature-key map), Section 44 ("modules must be package-controlled")
 *  and Section 37 (a feature that drops out is LOCKED, never deleted). Four
 *  places is four chances to implement it four different ways.
 *
 *  So there is one. Everything else asks it.
 *
 *      Package -> entitlements -> business account -> user permission
 *
 *  THE PACKAGE LADDER
 *  ------------------
 *  Silver 2,500 | Gold 5,000 | Platinum 15,000 | Super 30,000+
 *
 *  Each package is a strict superset of the one below it. That is what makes
 *  "upgrade = the difference" (Section 32) arithmetically true rather than a
 *  special case: the price ladder and the feature ladder move together.
 */

import { FEATURE_KEYS, type FeatureKey, type PackageDefinition, type PackageId } from "./types";
import { STORAGE_BYTES } from "./storage";

/** The published prices, in ETB per month. Section 9. */
export const PACKAGE_PRICES: Record<PackageId, number> = {
  silver: 2_500,
  gold: 5_000,
  platinum: 15_000,
  super: 30_000,
};

/** The ladder order. Used for upgrade vs downgrade, never for price maths. */
export const PACKAGE_ORDER: PackageId[] = ["silver", "gold", "platinum", "super"];

/** Features every package has: a store is the product, not an upgrade. */
const ALWAYS: FeatureKey[] = ["store", "promotions", "analytics"];

export const PACKAGES: Record<PackageId, PackageDefinition> = {
  silver: {
    id: "silver",
    name: "Silver",
    tier: 1,
    monthlyPrice: 2_500,
    customPricing: false,
    tagline: "Get your business online.",
    summary: "A professional digital presence for your business.",
    features: [...ALWAYS],
    limits: {
      products: 25,
      stores: 1,
      teamMembers: 1,
      includesSubdomain: false,
      // Section 55: 2 GB of included media storage.
      storageBytes: STORAGE_BYTES.silver,
    },
  },
  gold: {
    id: "gold",
    name: "Gold",
    tier: 2,
    monthlyPrice: 5_000,
    customPricing: false,
    tagline: "Connect with your customers.",
    summary: "Digital presence plus customer communication and a branded subdomain.",
    features: [...ALWAYS, "crm", "employees"],
    limits: {
      products: 100,
      stores: 1,
      teamMembers: 5,
      includesSubdomain: true,
      // Section 55: 10 GB of included media storage.
      storageBytes: STORAGE_BYTES.gold,
    },
  },
  platinum: {
    id: "platinum",
    name: "Platinum",
    tier: 3,
    monthlyPrice: 15_000,
    customPricing: false,
    tagline: "Sell online and manage your business.",
    summary:
      "E-commerce, online payments, marketplace publishing, delivery and custom inventory management developed by Yene Business Group.",
    features: [
      ...ALWAYS,
      "crm",
      "employees",
      "marketplace",
      "inventory",
      "custom_inventory",
      "suppliers",
      "purchases",
      "advanced_reports",
    ],
    limits: {
      products: null,
      stores: 1,
      teamMembers: 25,
      includesSubdomain: true,
      // Section 55: 50 GB of included media storage.
      storageBytes: STORAGE_BYTES.platinum,
    },
  },
  super: {
    id: "super",
    name: "Super",
    tier: 4,
    // "30,000 ETB/month+" - the starting point of a quotation (Section 40).
    monthlyPrice: 30_000,
    customPricing: true,
    tagline: "Let Yene Business Group build the system your business needs.",
    summary:
      "Everything in Platinum, plus advanced inventory, multi-branch operations, automation, POS, integrations, APIs and custom ERP, CRM and inventory development.",
    features: [...FEATURE_KEYS],
    limits: {
      products: null,
      stores: null,
      teamMembers: null,
      includesSubdomain: true,
      // Section 55: 250 GB rising to 1 TB and beyond by quotation.
      storageBytes: STORAGE_BYTES.super,
    },
  },
};

export function isPackageId(value: unknown): value is PackageId {
  return typeof value === "string" && value in PACKAGES;
}

/**
 * The complete entitlement map for a package: every one of the seventeen
 * Section 38 feature keys mapped to true or false.
 *
 * Returning ALL keys (rather than a sparse set) is deliberate. A caller can
 * then ask about a key without wondering whether "missing" means false or
 * means "nobody has implemented this yet" - it means false.
 */
export function entitlementsFor(id: PackageId): Record<FeatureKey, boolean> {
  const granted = new Set<FeatureKey>(PACKAGES[id].features);
  const map = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURE_KEYS) map[key] = granted.has(key);
  return map;
}

export function hasFeature(id: PackageId, feature: FeatureKey): boolean {
  return PACKAGES[id].features.includes(feature);
}

/**
 * The seventeen feature keys a package does NOT have.
 *
 * Section 37 uses this: the data behind these keys is preserved, merely
 * locked. Returning the list rather than a boolean is what lets the UI say
 * "locked because you are on Silver" instead of pretending the module does
 * not exist.
 */
export function lockedFeatures(id: PackageId): FeatureKey[] {
  return FEATURE_KEYS.filter((key) => !hasFeature(id, key));
}

/**
 * Section 26 / 44: the business dashboard module list, each one gated.
 *
 * `feature: null` means the module is in every package (Settings, Packages &
 * Billing, Support) because a business must always be able to see its
 * subscription or ask for help, whatever it is paying for.
 */
export interface DashboardModule {
  key: string;
  label: string;
  feature: FeatureKey | null;
  /** Super-only modules are visibly marked rather than silently hidden. */
  superOnly?: boolean;
}

export const DASHBOARD_MODULES: DashboardModule[] = [
  { key: "dashboard", label: "Dashboard", feature: null },
  { key: "store", label: "Store", feature: "store" },
  { key: "products", label: "Products", feature: "store" },
  { key: "categories", label: "Categories", feature: "store" },
  { key: "orders", label: "Orders", feature: "store" },
  { key: "customers", label: "Customers", feature: "crm" },
  { key: "inventory", label: "Inventory", feature: "inventory" },
  { key: "promotions", label: "Promotions", feature: "promotions" },
  { key: "analytics", label: "Analytics", feature: "analytics" },
  { key: "employees", label: "Employees", feature: "employees" },
  { key: "expenses", label: "Expenses", feature: "crm" },
  { key: "suppliers", label: "Suppliers", feature: "suppliers" },
  { key: "purchases", label: "Purchases", feature: "purchases" },
  { key: "reports", label: "Reports", feature: "advanced_reports" },
  { key: "users", label: "Users", feature: "employees" },
  { key: "roles", label: "Roles", feature: "employees" },
  { key: "billing", label: "Packages & Billing", feature: null },
  { key: "support", label: "Support", feature: null },
  { key: "settings", label: "Settings", feature: null },
  // ---- Section 55: growth tools, available to EVERY package ----
  //
  // These two carry `feature: null`, which means "available at every tier".
  // That is deliberate and is the requirement: a business on Silver must still
  // be able to promote itself, and must still be able to rent its storefront on
  // to somebody else. Gating growth tools behind an upgrade is how a small
  // business never becomes a large one.
  { key: "promote", label: "Promote your store", feature: null },
  { key: "rent-out", label: "Rent to others", feature: null },
  // Super (Sections 29 / 45): present but locked below Super.
  { key: "pos", label: "Point of Sale", feature: "pos", superOnly: true },
  { key: "automations", label: "Automations", feature: "automation", superOnly: true },
  {
    key: "integrations",
    label: "Integrations & APIs",
    feature: "api_integrations",
    superOnly: true,
  },
  { key: "custom-erp", label: "Custom ERP", feature: "custom_erp", superOnly: true },
];

export type ModuleAccess = "available" | "locked" | "hidden";

/**
 * Resolve one dashboard module for a package.
 *
 * The three outcomes, and why all three exist:
 *  - `available`  the business may use it.
 *  - `locked`     it is outside the package, but the business is told so and
 *                 told which package would open it. This is Section 37: the
 *                 data is preserved and visible, the write action is closed.
 *  - `hidden`     Super-only custom-system modules below Super, which have
 *                 no data to preserve yet, so there is nothing to lock.
 */
export function moduleAccess(id: PackageId, module: DashboardModule): ModuleAccess {
  if (module.superOnly && !hasFeature(id, "custom_erp")) return "hidden";
  if (module.feature === null) return "available";
  return hasFeature(id, module.feature) ? "available" : "locked";
}

/** The cheapest package whose entitlement set includes `feature`. */

/**
 * Section 54: the four package cards, in ladder order.
 *
 * Super's card shows "30,000 ETB+" rather than a fixed number, because its
 * price is a quotation (Section 40) and presenting a single figure would be a
 * promise Yene Business Group has not made.
 */
export interface PackageCard {
  id: PackageId;
  name: string;
  price: number;
  priceLabel: string;
  customPricing: boolean;
  tagline: string;
  summary: string;
  features: string[];
}

export function packageCards(): PackageCard[] {
  return PACKAGE_ORDER.map((id) => {
    const pkg = PACKAGES[id];
    return {
      id,
      name: pkg.name,
      price: pkg.monthlyPrice,
      priceLabel: pkg.customPricing
        ? `${pkg.monthlyPrice.toLocaleString("en-US")} ETB+`
        : `${pkg.monthlyPrice.toLocaleString("en-US")} ETB`,
      customPricing: pkg.customPricing,
      tagline: pkg.tagline,
      summary: pkg.summary,
      features: pkg.features.map(labelForFeature),
    };
  });
}

/** Human labels for the Section 38 keys, used in cards and lock notices. */
const FEATURE_LABELS: Record<FeatureKey, string> = {
  store: "Digital storefront",
  marketplace: "Main YENE marketplace publishing",
  promotions: "Promotions and campaigns",
  analytics: "Store and sales analytics",
  inventory: "Inventory management",
  crm: "Customer management (CRM)",
  employees: "Employee accounts and roles",
  suppliers: "Supplier management",
  purchases: "Purchasing and purchase orders",
  multi_branch: "Multiple branches",
  automation: "Workflow automation",
  advanced_reports: "Advanced reporting",
  pos: "Point of Sale",
  custom_erp: "Custom ERP",
  custom_inventory: "Custom inventory",
  api_integrations: "API and third-party integrations",
  advanced_support: "Priority Yene support",
};

export function labelForFeature(key: FeatureKey): string {
  return FEATURE_LABELS[key];
}

/**
 * Section 38, drawn end to end:
 *
 *   Package -> Feature Entitlements -> Business Account -> User Permissions
 *            -> Feature Access
 *
 * A role can only ever hold a subset of what the package already grants, so
 * an employee can be restricted but never promoted above the plan.
 */
export function effectiveAccess(
  packageId: PackageId,
  roleFeatures: FeatureKey[] | null,
): Record<FeatureKey, boolean> {
  const base = entitlementsFor(packageId);
  if (!roleFeatures) return base;
  const allowed = new Set(roleFeatures);
  const result = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURE_KEYS) result[key] = base[key] && allowed.has(key);
  return result;
}

export function cheapestPackageWith(feature: FeatureKey): PackageId {
  return PACKAGE_ORDER.find((id) => hasFeature(id, feature)) ?? "super";
}

export interface ModuleView extends DashboardModule {
  access: ModuleAccess;
  /** The cheapest package that would open it, for the "Upgrade to ..." hint. */
  unlockWith: PackageId | null;
}

export function dashboardModulesFor(id: PackageId): ModuleView[] {
  return DASHBOARD_MODULES.map((module) => {
    const access = moduleAccess(id, module);
    return {
      ...module,
      access,
      unlockWith:
        access === "locked" && module.feature ? cheapestPackageWith(module.feature) : null,
    };
  });
}


export function packageById(id: PackageId): PackageDefinition {
  return PACKAGES[id];
}

export function monthlyPrice(id: PackageId): number {
  return PACKAGES[id].monthlyPrice;
}

/** True when `to` is a higher package than `from` (Section 32). */
export function isUpgrade(from: PackageId, to: PackageId): boolean {
  return PACKAGES[to].tier > PACKAGES[from].tier;
}

export function isDowngrade(from: PackageId, to: PackageId): boolean {
  return PACKAGES[to].tier < PACKAGES[from].tier;
}
