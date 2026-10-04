/**
 * ============================================================================
 *  MANAGEMENT SECTION REGISTRY
 * ============================================================================
 *
 *  One entry per Management System module, and each entry answers the only
 *  question that matters before drawing a button: what actually exists behind
 *  this section?
 *
 *  WHY THIS FILE IS DATA AND NOT JUST A LIST OF NAMES
 *  ---------------------------------------------------
 *  The specification forbids "inactive links, empty placeholder pages, or
 *  buttons without actions", and it separately forbids assuming "a feature
 *  exists in the backend just because its dashboard link exists".
 *
 *  Those two rules pull against each other for most of these sections, so the
 *  resolution is to stop guessing in the component and RECORD the truth here.
 *  `capabilities` says which verbs the backend genuinely implements, and the UI
 *  renders exactly that: a section with `write: false` shows its data and an
 *  honest note, never a Save button that silently does nothing.
 *
 *  THE AUDIT BEHIND THIS TABLE
 *  ---------------------------
 *  Read from `api/platform/router.ts` and `api/management/router.ts`. `read` is
 *  true only where a GET returns this business's own records; `write` is true
 *  only where a POST changes them server-side.
 *
 *  Of the twenty-two modules, exactly two have write endpoints today (orders,
 *  and product marketplace submission). The rest are read-only or have no
 *  backend at all. That is recorded here rather than papered over.
 *
 *  `missing` is shown to the user, so a section cannot quietly regress into an
 *  empty page.
 */

export interface SectionDefinition {
  /** Matches `DASHBOARD_MODULES[].key` in src/platform/packages.ts. */
  key: string;
  label: string;
  /** One line for the section header. */
  summary: string;
  capabilities: { read: boolean; write: boolean };
  /**
   * Plain language describing what is NOT built.
   *
   * Shown only when the section is open, never as a nag. An empty string means
   * the section is complete for its declared capabilities.
   */
  missing: string;
  /** The endpoint backing the read, kept here as the audit trail. */
  endpoint: string | null;
}

/**
 * The twenty-two modules, in the order the server returns them.
 *
 * The keys MUST match `DASHBOARD_MODULES` exactly; `verify-management.ts`
 * asserts that, so a module renamed in one file and not the other fails the
 * suite rather than rendering a dead tile.
 */
export const MANAGEMENT_SECTIONS: SectionDefinition[] = [
  {
    key: "dashboard",
    label: "Overview",
    summary: "Sales, orders, customers and stock alerts for your business.",
    capabilities: { read: true, write: false },
    missing: "",
    endpoint: "GET /api/management/overview",
  },
  {
    key: "store",
    label: "Store",
    summary: "Your public storefront: branding, subdomain and what customers see.",
    capabilities: { read: true, write: false },
    missing:
      "Viewing your live storefront works. Editing the name, logo, cover image or subdomain needs a store-settings endpoint that has not been built yet, so those fields are shown read-only rather than with a Save button that would do nothing.",
    endpoint: "GET /api/platform/store/:subdomain",
  },
  {
    key: "products",
    label: "Products",
    summary: "Your catalogue and its marketplace review status.",
    capabilities: { read: true, write: true },
    missing:
      "Listing and submitting a product for marketplace review work. Creating, editing or deleting a product needs product write endpoints that have not been built yet.",
    endpoint: "GET /api/platform/products",
  },
  {
    key: "categories",
    label: "Categories",
    summary: "The product category tree your catalogue is organised into.",
    capabilities: { read: true, write: false },
    missing:
      "The category tree is shown as it stands. Category editing is a platform-administrator function today, not a per-business one.",
    endpoint: "GET /api/platform/categories",
  },
  {
    key: "orders",
    label: "Orders",
    summary: "Every order placed against your business, and where each one is.",
    capabilities: { read: true, write: true },
    missing: "",
    endpoint: "GET /api/platform/orders/business",
  },
  {
    key: "customers",
    label: "Customers",
    summary: "Customer profiles who have bought from your business.",
    capabilities: { read: true, write: false },
    missing:
      "Customer records are shown as they are captured at checkout. Editing a customer profile needs a customer write endpoint that has not been built yet.",
    endpoint: "GET /api/platform/operations",
  },
  {
    key: "inventory",
    label: "Inventory",
    summary: "Stock on hand, low-stock alerts and recent movements.",
    capabilities: { read: true, write: false },
    missing:
      "Stock levels and movement history are shown. Recording a receipt, adjustment or transfer needs inventory write endpoints that have not been built yet.",
    endpoint: "GET /api/platform/inventory",
  },
  {
    key: "promotions",
    label: "Promotions",
    summary: "Discounts and campaigns running against your products.",
    capabilities: { read: true, write: false },
    missing:
      "Active promotions are listed. Creating, editing and ending a promotion needs promotion write endpoints that have not been built yet.",
    endpoint: "GET /api/platform/promotions",
  },
  {
    key: "analytics",
    label: "Analytics",
    summary: "How your business is performing.",
    capabilities: { read: true, write: false },
    missing:
      "Live totals are shown. A dated range, a trend chart or a comparison against a previous period needs an analytics endpoint that aggregates over time, and that has not been built yet.",
    endpoint: "GET /api/management/overview",
  },
  {
    key: "employees",
    label: "Employees",
    summary: "Your team and the role each person holds.",
    capabilities: { read: true, write: false },
    missing:
      "Your team is listed from the employee records already in the system. Adding, editing or removing a person needs employee write endpoints that have not been built yet.",
    endpoint: "GET /api/platform/operations",
  },
  {
    key: "expenses",
    label: "Expenses",
    summary: "Business costs recorded so far.",
    capabilities: { read: true, write: false },
    missing:
      "Recorded expenses are listed. Adding or categorising one needs expense write endpoints that have not been built yet.",
    endpoint: "GET /api/platform/operations",
  },
  {
    key: "suppliers",
    label: "Suppliers",
    summary: "Who you buy from, and how to reach them.",
    capabilities: { read: true, write: false },
    missing:
      "Supplier records are listed. Adding or editing one needs supplier write endpoints that have not been built yet.",
    endpoint: "GET /api/platform/operations",
  },
  {
    key: "purchases",
    label: "Purchases",
    summary: "Purchase orders and what has been received against them.",
    capabilities: { read: true, write: false },
    missing:
      "Purchase records are listed. Raising a new purchase order or receiving goods against one needs purchase write endpoints that have not been built yet.",
    endpoint: "GET /api/platform/operations",
  },

  {
    key: "reports",
    label: "Reports",
    summary: "Exportable business reports.",
    capabilities: { read: false, write: false },
    missing:
      "There is no reports backend yet. A report needs a server-side aggregation and an export format, and neither exists, so this page will not pretend to produce one.",
    endpoint: null,
  },
  {
    key: "users",
    label: "Users",
    summary: "Everyone with an account on your business.",
    capabilities: { read: false, write: false },
    missing:
      "There is no per-business user directory yet. The authentication module knows who exists, but it does not expose a business-scoped user list, so there is nothing to show that would be honestly scoped to you.",
    endpoint: null,
  },
  {
    key: "roles",
    label: "Roles",
    summary: "Permission roles and what each one grants.",
    capabilities: { read: true, write: false },
    missing:
      "Your roles and their feature lists are shown. Creating a role or changing what it grants needs role write endpoints that have not been built yet.",
    endpoint: "GET /api/platform/operations",
  },
  {
    key: "billing",
    label: "Packages & Billing",
    summary: "Your current package, what it includes, and billing history.",
    capabilities: { read: true, write: true },
    missing: "",
    endpoint: "GET /api/platform/subscription",
  },
  {
    key: "support",
    label: "Support",
    summary: "Raise a request and follow it through to an answer.",
    capabilities: { read: true, write: true },
    missing: "",
    endpoint: "/api/support",
  },
  {
    key: "settings",
    label: "Settings",
    summary: "Business, store, notification and account settings.",
    capabilities: { read: false, write: false },
    missing:
      "There is no settings backend yet. Nothing here can be read or saved, so this page does not offer controls that would discard what you typed.",
    endpoint: null,
  },
  // ---- Section 55: growth tools ----
  //
  // Both are available at EVERY package, which is why they carry no feature key
  // upstream. A Silver business must be able to promote itself and rent its
  // storefront out - gating growth tools behind an upgrade is how a small
  // business never becomes a large one.
  {
    key: "promote",
    label: "Promote your store",
    summary: "Your storage allowance, media uploads, and the package ladder.",
    capabilities: { read: true, write: true },
    // Complete for what it declares: usage really is read from the filesystem,
    // and uploads really do write.
    missing: "",
    endpoint: "GET /api/media/usage",
  },
  {
    key: "rent-out",
    label: "Rent to others",
    summary: "Offer a storefront slot to another business and earn a share.",
    capabilities: { read: true, write: true },
    missing: "",
    endpoint: "GET /api/platform/rental-out/mine",
  },
  {
    key: "pos",
    label: "Point of Sale",
    summary: "A till workflow for in-person sales.",
    capabilities: { read: false, write: false },
    missing:
      "There is no point-of-sale backend. A POS that could not decrement stock or record a payment would misrepresent a sale, so nothing is offered here yet.",
    endpoint: null,
  },
  {
    key: "automations",
    label: "Automations",
    summary: "Triggers and actions that run for you.",
    capabilities: { read: false, write: false },
    missing:
      "There is no automation backend. A workflow that appeared to run but had nothing to execute against would be worse than absent.",
    endpoint: null,
  },
  {
    key: "integrations",
    label: "Integrations & APIs",
    summary: "Connected services and API credentials.",
    capabilities: { read: false, write: false },
    missing:
      "There is no integrations backend. No credential is ever displayed here, because none is stored yet, and a page that looked like it held keys without holding any would be a security problem waiting to happen.",
    endpoint: null,
  },
  {
    key: "custom-erp",
    label: "Custom ERP",
    summary: "Yene Business Group's customised ERP and inventory modules.",
    capabilities: { read: false, write: false },
    missing:
      "This is a bespoke engagement, not a self-service feature, and it is not unlocked by any package. It is available only under a signed custom agreement with Yene Business Group.",
    endpoint: null,
  },
];

/** Look one up by its module key. */
export function sectionFor(key: string): SectionDefinition | null {
  return MANAGEMENT_SECTIONS.find((section) => section.key === key) ?? null;
}

/** True when the section has any backend at all to show. */
export function isSectionAvailable(section: SectionDefinition): boolean {
  return section.capabilities.read || section.capabilities.write;
}
