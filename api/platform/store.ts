/**
 * ============================================================================
 *  PLATFORM DATA STORE
 * ============================================================================
 *
 *  One durable JSON collection per aggregate, all under `YENE_DATA_DIR` (or
 *  ./data), reusing api/lib/jsonCollection.ts so the write strategy - atomic,
 *  coalesced, fail-safe - is shared rather than reimplemented.
 *
 *  SINGLE-WRITER, like the support stores. These are fine on one instance;
 *  swap the bodies for a database before scaling out. The function names are
 *  the seam, and no caller reaches past them.
 *
 *  WHAT IS DELIBERATELY NOT HERE
 *  -----------------------------
 *  There is no `deleteProduct`, no `deleteOrder`, no `purgeBusiness`. Section
 *  37 is a product requirement, and the shape of this store is how it is kept:
 *  when a package changes, the subscription row changes and NOTHING ELSE IS
 *  TOUCHED. A downgrade cannot reach a customer's history because the function
 *  that performs a downgrade is not connected to any of these collections.
 */

import path from "node:path";
import { createJsonCollection } from "../lib/jsonCollection";
import { INITIAL_CATEGORIES, buildInitialSubcategories, subcategoryId } from "../../src/platform/categories";
import { emptyLedger, type SurchargeLedger } from "../../src/platform/billing";
import { PACKAGES } from "../../src/platform/packages";
import { notSubmitted } from "../../src/platform/marketplace";
import { buildMallPlacement, roomNumbersFor, slugify } from "../../src/platform/malls";
import { buildMallUnits } from "../../src/platform/rental";
import type {
  Business,
  BusinessOrder,
  Category,
  CustomerOrder,
  CustomQuoteRequest,
  InventoryItem,
  Invoice,
  Mall,
  MallUnit,
  MallUnitStatus,
  MallAgreement,
  StoreLease,
  MarketplaceSubmission,
  Notification,
  PackageChangeRecord,
  Product,
  Promotion,
  Review,
  Subscription,
  WishlistItem,
  CustomerProfile,
  Supplier,
  PurchaseOrder,
  Employee,
  Expense,
  Role,
  WarehouseNode,
  StockMovement,
  PaymentRecord,
} from "../../src/platform/types";

const dataDir = process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data");

function collection<T>(file: string, label: string, limit = 20_000) {
  return createJsonCollection<T>(path.join(dataDir, file), label, limit);
}

const businesses = collection<Business>("platform-businesses.json", "businesses");
const products = collection<Product>("platform-products.json", "products");
const submissions = collection<MarketplaceSubmission>("platform-submissions.json", "submissions");
const categories = collection<Category>("platform-categories.json", "categories", 500);
const businessOrders = collection<BusinessOrder>("platform-business-orders.json", "business-orders");
const customerOrders = collection<CustomerOrder>("platform-customer-orders.json", "customer-orders");
const payments = collection<PaymentRecord>("platform-payments.json", "payments");
const reviews = collection<Review>("platform-reviews.json", "reviews");
const wishlists = collection<WishlistItem>("platform-wishlists.json", "wishlists");
const promotions = collection<Promotion>("platform-promotions.json", "promotions");
const inventoryItems = collection<InventoryItem>("platform-inventory-items.json", "inventory-items");
const nodes = collection<WarehouseNode>("platform-nodes.json", "warehouse-nodes", 2000);
const movements = collection<StockMovement>("platform-movements.json", "stock-movements", 50_000);
const customers = collection<CustomerProfile>("platform-customers.json", "customers");
const suppliers = collection<Supplier>("platform-suppliers.json", "suppliers");
const purchases = collection<PurchaseOrder>("platform-purchases.json", "purchases");
const employees = collection<Employee>("platform-employees.json", "employees");
const expenses = collection<Expense>("platform-expenses.json", "expenses");
const roles = collection<Role>("platform-roles.json", "roles");
const notifications = collection<Notification>("platform-notifications.json", "notifications");
const invoices = collection<Invoice>("platform-invoices.json", "invoices");
const changes = collection<PackageChangeRecord>("platform-package-changes.json", "package-changes");
const quotes = collection<CustomQuoteRequest>("platform-quotes.json", "quote-requests");

/**
 * Section 41: the malls stores can register under.
 *
 * A NEW FILE, so adding this cannot touch an existing collection. Malls are
 * reference data rather than tenant data: they are the shopping centres, not
 * the shops, and a mall exists whether or not anybody has registered in it yet.
 */
const malls = collection<Mall>("platform-malls.json", "malls", 2_000);

// Section 41: the real, rentable units inside each mall. A separate file from
// the businesses, because a unit's status changes as applications are approved
// and that must never be able to corrupt a business row.
const mallUnits = collection<MallUnit>("platform-mall-units.json", "mall-units", 20_000);

// Section 41: the agreement between YENE-STORE and each mall's owner, and the
// lease each tenant signs for a counter. Both are money, so both are kept OUT of
// the mall and unit rows - editing a price must never be able to disturb a signed
// agreement.
const mallAgreements = collection<MallAgreement>("platform-mall-agreements.json", "mall-agreements", 2_000);
const storeLeases = collection<StoreLease>("platform-store-leases.json", "store-leases", 20_000);

/**
 * Subscriptions and the surcharge ledger live in the same file.
 *
 * They are together on purpose: the ledger is only ever meaningful next to
 * the subscription it was paid against, and a separate file could drift out
 * of step with it.
 */
interface SubscriptionRecord {
  subscription: Subscription;
  ledger: SurchargeLedger;
}
const subscriptions = collection<SubscriptionRecord>("platform-subscriptions.json", "subscriptions");

// ---------------------------------------------------------------------------
// Accessors
//
// Read paths take an optional businessId filter. There is deliberately no
// unfiltered "get me everything a tenant owns" helper for write paths: a
// caller that has an identity passes it, and the store refuses to guess.
// ---------------------------------------------------------------------------

export const allBusinesses = businesses.all;
export const allProducts = products.all;
export const allSubmissions = submissions.all;
export const allCategories = categories.all;
export const allBusinessOrders = businessOrders.all;
export const allCustomerOrders = customerOrders.all;
export const allPayments = payments.all;
export const allReviews = reviews.all;
export const allWishlistItems = wishlists.all;
export const allPromotions = promotions.all;
export const allInventoryItems = inventoryItems.all;
export const allNodes = nodes.all;
export const allMovements = movements.all;
export const allCustomers = customers.all;
export const allSuppliers = suppliers.all;
export const allPurchases = purchases.all;
export const allEmployees = employees.all;
export const allExpenses = expenses.all;
export const allRoles = roles.all;
export const allNotifications = notifications.all;
export const allInvoices = invoices.all;
export const allChanges = changes.all;
export const allQuotes = quotes.all;
export const allMalls = malls.all;
export const allMallUnits = mallUnits.all;
export const allMallAgreements = mallAgreements.all;
export const allStoreLeases = storeLeases.all;

export const persistMallAgreements = mallAgreements.touch;
export const persistStoreLeases = storeLeases.touch;

/** Insert or replace a lease by id. */
export function saveLease(lease: StoreLease): void {
  const list = storeLeases.all();
  const index = list.findIndex((entry) => entry.id === lease.id);
  if (index === -1) list.push(lease);
  else list[index] = lease;
  persistStoreLeases();
}

/** Insert or replace a mall agreement by id. */
export function saveMallAgreement(agreement: MallAgreement): void {
  const list = mallAgreements.all();
  const index = list.findIndex((entry) => entry.id === agreement.id);
  if (index === -1) list.push(agreement);
  else list[index] = agreement;
  persistMallAgreements();
}

/** The agreement currently in force for a mall, or null. */
export function activeAgreementFor(mallId: string): MallAgreement | null {
  return (
    mallAgreements.all().find(
      (agreement) => agreement.mallId === mallId && agreement.status === "active",
    ) ?? null
  );
}

/** Delete a unit. Refused by the caller while anything is leased or held. */
export function deleteUnit(unitId: string): boolean {
  const list = mallUnits.all();
  const index = list.findIndex((unit) => unit.id === unitId);
  if (index === -1) return false;
  list.splice(index, 1);
  persistMallUnits();
  return true;
}

/** Delete a mall's row. Its units go with it; the caller checks safety first. */
export function deleteMallRow(mallId: string): boolean {
  const list = malls.all();
  const index = list.findIndex((mall) => mall.id === mallId);
  if (index === -1) return false;
  list.splice(index, 1);
  for (const unit of mallUnits.all().filter((entry) => entry.mallId === mallId)) {
    deleteUnit(unit.id);
  }
  persist.malls();
  return true;
}

/**
 * Mark units as changed. Separate from `persist.malls` on purpose: approving a
 * rental changes unit status without changing the mall, and one writer must not
 * imply the other.
 */
export const persistMallUnits = mallUnits.touch;

/**
 * Build the unit directory for any mall that has none.
 *
 * ADDITIVE AND IDEMPOTENT, on the same pattern as `seedMalls`. A mall added
 * later gets its units the first time it is read, and an installation that
 * already has units is left alone - so a landlord's real figures are never
 * overwritten by this.
 */
export function seedMallUnits(): void {
  for (const mall of allMalls()) {
    const already = mallUnits.all().some((unit) => unit.mallId === mall.id);
    if (already) continue;
    mallUnits.all().push(...buildMallUnits(mall));
  }
  persistMallUnits();
}

/** Move units into the states an approval leaves behind. */
export function markUnits(
  mallId: string,
  rooms: readonly string[],
  patch: { status: MallUnitStatus; businessId: string | null; applicationId: string | null },
): void {
  const wanted = new Set(rooms.map((room) => room.trim().toUpperCase()));
  for (const unit of mallUnits.all()) {
    if (unit.mallId !== mallId) continue;
    if (!wanted.has(unit.number.trim().toUpperCase())) continue;
    unit.status = patch.status;
    unit.businessId = patch.businessId;
    unit.applicationId = patch.applicationId;
  }
  persistMallUnits();
}

export const persist = {
  businesses: businesses.touch,
  products: products.touch,
  submissions: submissions.touch,
  categories: categories.touch,
  malls: malls.touch,
  businessOrders: businessOrders.touch,
  customerOrders: customerOrders.touch,
  payments: payments.touch,
  reviews: reviews.touch,
  wishlists: wishlists.touch,
  promotions: promotions.touch,
  inventoryItems: inventoryItems.touch,
  nodes: nodes.touch,
  movements: movements.touch,
  customers: customers.touch,
  suppliers: suppliers.touch,
  purchases: purchases.touch,
  employees: employees.touch,
  expenses: expenses.touch,
  roles: roles.touch,
  notifications: notifications.touch,
  invoices: invoices.touch,
  changes: changes.touch,
  quotes: quotes.touch,
  subscriptions: subscriptions.touch,
};

/** Force every pending write to disk. Used by the verification suites. */
export function flushAll(): void {
  for (const store of [
    businesses, products, submissions, categories, businessOrders, customerOrders,
    payments, reviews, wishlists, promotions, inventoryItems, nodes, movements,
    customers, suppliers, purchases, employees, expenses, roles, notifications,
    invoices, changes, quotes, subscriptions, malls, mallUnits,
  ]) {
    store.flush();
  }
}

export function mallById(id: string): Mall | null {
  return allMalls().find((mall) => mall.id === id) ?? null;
}

/**
 * Find a mall from an id OR a name, as typed.
 *
 * Sign-up sends whichever identifier the form had, and the directory is the
 * only place either is resolved - so a caller cannot invent a mall by typing a
 * new name.
 */
export function mallByIdOrName(idOrName: string): Mall | null {
  const wanted = String(idOrName ?? "").trim();
  if (!wanted) return null;
  return (
    allMalls().find((mall) => mall.id === wanted) ??
    allMalls().find((mall) => mall.slug === slugify(wanted)) ??
    null
  );
}

/** Create or update a mall. The only writer of a mall row. */
export function saveMall(mall: Mall): void {
  const list = allMalls();
  const index = list.findIndex((entry) => entry.id === mall.id);
  if (index === -1) list.push(mall);
  else list[index] = mall;
  persist.malls();
}

export function businessById(id: string): Business | null {
  return allBusinesses().find((business) => business.id === id) ?? null;
}

export function businessBySubdomain(subdomain: string): Business | null {
  const wanted = subdomain.toLowerCase();
  return allBusinesses().find((business) => business.subdomain.toLowerCase() === wanted) ?? null;
}

export function productById(id: string): Product | null {
  return allProducts().find((product) => product.id === id) ?? null;
}

export function productsForBusiness(businessId: string): Product[] {
  return allProducts().filter((product) => product.businessId === businessId);
}

export function submissionForProduct(productId: string): MarketplaceSubmission | null {
  return allSubmissions().find((submission) => submission.productId === productId) ?? null;
}

export function ordersForBusiness(businessId: string): BusinessOrder[] {
  return allBusinessOrders().filter((order) => order.businessId === businessId);
}

export function ordersForCustomer(customerId: string): BusinessOrder[] {
  return allBusinessOrders().filter((order) => order.customerId === customerId);
}

export function customerOrderById(id: string): CustomerOrder | null {
  return allCustomerOrders().find((order) => order.id === id) ?? null;
}

export function reviewsForProduct(productId: string): Review[] {
  return allReviews().filter((review) => review.productId === productId);
}

export function wishlistForCustomer(customerId: string): WishlistItem[] {
  return allWishlistItems().filter((item) => item.customerId === customerId);
}

export function promotionsForBusiness(businessId: string): Promotion[] {
  return allPromotions().filter((promotion) => promotion.businessId === businessId);
}

export function changesForBusiness(businessId: string): PackageChangeRecord[] {
  return allChanges()
    .filter((change) => change.businessId === businessId)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export function invoicesForBusiness(businessId: string): Invoice[] {
  return allInvoices()
    .filter((invoice) => invoice.businessId === businessId)
    .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
}

export function notificationsForBusiness(businessId: string): Notification[] {
  return allNotifications()
    .filter((notification) => notification.businessId === businessId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export function subscriptionFor(businessId: string): SubscriptionRecord | null {
  return subscriptions.all().find((record) => record.subscription.businessId === businessId) ?? null;
}

export function allSubscriptions(): Subscription[] {
  return subscriptions.all().map((record) => record.subscription);
}

export function saveSubscription(subscription: Subscription, ledger: SurchargeLedger): void {
  const list = subscriptions.all();
  const index = list.findIndex((record) => record.subscription.businessId === subscription.businessId);
  const next = { subscription, ledger };
  if (index === -1) list.push(next);
  else list[index] = next;
  persist.subscriptions();
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * The trading name a seeded product is attributed to.
 *
 * Read off the business id so every product names a store that really exists -
 * the previous single ternary called every non-coffee, non-electronics product
 * "ABC Fashion", which would have mislabelled the jewellery outright.
 */
function supplierOf(businessId: string): string {
  switch (businessId) {
    case "green-coffee":
      return "Green Coffee Exporters";
    case "blue-shop":
      return "Blue Shop Electronics";
    case "hub-jewellery":
      return "Hub Jewellery";
    default:
      return "ABC Fashion";
  }
}

/** Section 41: the second store registered in the seeded mall. */
const HUB_JEWELLERY_ID = "hub-jewellery";

let seeded = false;

/**
 * Section 41: the malls sellers can register under.
 *
 * Seeded SEPARATELY from the businesses, and additively, because the two answer
 * different questions. The business seed only runs on an empty database - it is
 * demo catalogue. The mall directory is reference data: Dembel City Center is a
 * real shopping centre whether or not this installation has any shops in it, so
 * an existing installation gains the directory without gaining demo stores, and
 * nothing already written is touched.
 *
 * `seedIfEmpty()` calls this too, so a fresh install gets both in one pass.
 */
export function seedMalls(): void {
  if (allMalls().length > 0) return;
  allMalls().push(...INITIAL_MALLS.map((mall) => ({ ...mall })));
  persist.malls();
}

/**
 * The malls the specification names, plus the level prefixes their directories
 * use.
 *
 * Dembel City Center is the mall in the specification's own Section 41 example,
 * so it carries the agreement id that grants its stores a free subdomain.
 */
const INITIAL_MALLS: Mall[] = [
  {
    id: "mall-dembel-city-center",
    name: "Dembel City Center",
    slug: "dembel-city-center",
    city: "Addis Ababa",
    address: "Bole Road, Dembel",
    description:
      "Fashion, accessories and lifestyle stores in the centre of Addis Ababa. " +
      "Registered sellers trade from their own mall counter on YENE-STORE.",
    // `G` is the ground floor's prefix - which is why Hub Jewellery's rooms read
    // GFS-024 and GFS-030 rather than 0F-24.
    floors: ["GFS", "1F", "2F", "3F"],
    agreementId: "MALL-DCC-2026",
    // Public by default; a Super Admin switches it off from the mall admin screen.
    visible: true,
    logoUrl: null,
    coverImageUrl: null,
    createdAt: new Date().toISOString(),
  },
];

/**
 * Add the Section 41 demo store if it is not already there.
 *
 * ADDITIVE AND IDEMPOTENT, following `seedUsersFromBusinesses` in
 * api/auth/store.ts: keyed on a fixed id, so a store already carrying it is left
 * exactly as it is - including anything its owner has since edited - and
 * running again changes nothing.
 *
 * This is separate from `seedIfEmpty` on purpose. That function is demo
 * catalogue and only runs on an empty database. Section 41's whole point is that
 * a mall holds MANY stores, and that cannot be demonstrated on an installation
 * that already has data unless the second store is added additively.
 */
export function seedMallDemoStore(): void {
  const list = allBusinesses();
  if (list.some((business) => business.id === HUB_JEWELLERY_ID)) return;

  const mall = mallById("mall-dembel-city-center");
  if (!mall) return;

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

  list.push({
    id: HUB_JEWELLERY_ID,
    name: "Hub Jewellery",
    type: "mall",
    // TWO rooms, written the way a lease writes them. `parseRoomNumbers` splits
    // this into two entries rather than storing the whole string - which is the
    // case the specification's single-room example could not show.
    mall: buildMallPlacement({
      mall,
      floor: "GFS",
      rooms: "GFS-024 & GFS-030",
      agreementId: mall.agreementId,
    }),
    subdomain: "hubjewellery.yene-store.com",
    status: "Active",
    packageId: "gold",
    trustedSeller: false,
    location: mall.city,
    rating: 4.6,
    createdAt: daysAgo(75),
    customization: {
      logoUrl: null,
      coverImageUrl: null,
      businessName: "Hub Jewellery",
      description:
        "Gemstones, gold, silver and platinum jewellery, made to order and ready " +
        "to collect from either of our mall counters.",
      businessInformation:
        "Two counters in Dembel City Center: GFS-024 on the ground floor, and " +
        "GFS-030 beside the main escalator. Both are open six days a week.",
      theme: "yene",
      featuredProductIds: [],
      bannerProductIds: [],
      socialLinks: [],
      contact: {
        phone: "+251 911000004",
        email: "hello@hubjewellery.example",
        address: `${mall.name}, GFS-024 & GFS-030`,
      },
      policies: {
        returns: "Exchange within 14 days with a receipt.",
        shipping: "Collection from GFS-024 or GFS-030.",
        terms: "Prices include VAT. Custom pieces are quoted individually.",
        privacy: "We never share customer data.",
      },
      delivery: {
        freeAbove: 20_000,
        options: [
          { id: "pickup", label: "In-mall pickup", fee: 0, etaDays: 1 },
          { id: "courier", label: "Insured courier", fee: 300, etaDays: 2 },
        ],
      },
      // Section 21: online payment is Platinum+, so a Gold store offers cash on
      // delivery and says so rather than failing at checkout.
      paymentOptions: ["Cash on delivery"],
    },
  });
  persist.businesses();

  // An ACTIVE Gold subscription: it carries the marketplace feature but not
  // online payment, which is why paymentOptions above has no online option.
  saveSubscription(
    {
      businessId: HUB_JEWELLERY_ID,
      packageId: "gold",
      status: "Active",
      startedAt: daysAgo(75),
      currentPeriodStart: daysAgo(5),
      currentPeriodEnd: new Date(now.getTime() + 25 * 86_400_000).toISOString(),
      autoRenew: true,
      pendingChange: null,
      lastUpgradeAmount: 0,
    },
    emptyLedger(),
  );

  // The store's catalogue: one product per material, so the range the section
  // names - gemstone, gold, silver, platinum - is visible in real data rather
  // than only described in the shop's profile. Additive like the store itself.
  const now2 = new Date();
  const seededProducts: Product[] = [
    {
      id: "p-011", name: "Blue Sapphire Ring", price: 18_500, stock: 3, soldCount: 9, viewCount: 70,
      description: "Natural blue sapphire, 18k gold setting. Made to order in 10 days.",
    },
    {
      id: "p-012", name: "Emerald Pendant", price: 12_500, discountPrice: 11_500, stock: 5, soldCount: 12, viewCount: 65,
      description: "Colombian emerald pendant on a gold chain, hallmarked.",
    },
    {
      id: "p-013", name: "22ct Gold Chain", price: 32_000, stock: 8, soldCount: 21, viewCount: 95,
      description: "Solid 22ct gold chain, 45cm. Collected at GFS-024 or GFS-030.",
    },
    {
      id: "p-014", name: "Sterling Silver Bracelet", price: 2_400, discountPrice: 2_100, stock: 16, soldCount: 30, viewCount: 45,
      description: "Hand-finished sterling silver bracelet, adjustable length.",
    },
    {
      id: "p-015", name: "Platinum Wedding Band", price: 41_000, stock: 4, soldCount: 7, viewCount: 88,
      description: "950 platinum band. Certification included.",
    },
  ].map((entry) => ({
    id: entry.id,
    businessId: HUB_JEWELLERY_ID,
    name: entry.name,
    description: entry.description,
    images: [],
    videoUrl: null,
    categoryId: "fashion",
    subcategoryId: null,
    brand: "Hub",
    sku: `HUB-${entry.id.toUpperCase()}`,
    price: entry.price,
    discountPrice: entry.discountPrice ?? null,
    stock: entry.stock,
    variants: [],
    attributes: [],
    deliveryInfo: "Collect from GFS-024 or GFS-030.",
    publishToOwnStore: true,
    // Not submitted to the marketplace: Section 13 says a listing is a separate
    // act, and leaving these unsubmitted keeps the moderation queue honest.
    publishToMarketplace: false,
    status: "active" as const,
    createdAt: daysAgo(60),
    updatedAt: now2.toISOString(),
    viewCount: entry.viewCount,
    soldCount: entry.soldCount,
  }));

  const existingProducts = allProducts();
  const missing = seededProducts.filter(
    (entry) => !existingProducts.some((product) => product.id === entry.id),
  );
  if (missing.length > 0) {
    existingProducts.push(...missing);
    persist.products();
  }
}
/**
 * Section 17: give the seeded main categories their subcategories.
 *
 * ADDITIVE AND IDEMPOTENT, on the same pattern as `seedMalls`. The main
 * categories already exist on an installation that predates subcategories, and
 * without this they would stay a flat list of fourteen - which is the state the
 * header used to render, and the reason "Fashion" was too coarse to browse.
 *
 * Keyed on id, so a subcategory a Super Admin has renamed or disabled is left
 * exactly as it is. Only genuinely missing rows are added.
 */
export function seedSubcategories(): void {
  const existing = allCategories();
  const missing = buildInitialSubcategories().filter(
    (entry) => !existing.some((category) => category.id === entry.id),
  );
  if (missing.length === 0) return;

  existing.push(...missing);
  persist.categories();
}

/**
 * Assign each seeded product to the subcategory that describes it.
 *
 * SEPARATE FROM `seedSubcategories` because of ordering: the category rows have
 * to exist before a product can point at one, but the products themselves are
 * written at the very end of `seedIfEmpty`. Running both from one call would
 * file nothing on a fresh install, because at that moment there are no products
 * yet - which is exactly what happened the first time this was wired up.
 *
 * The plan names BOTH levels, because two seeded products were re-filed in their
 * own right (a power bank is a phone accessory; a backpack is a bag) and an
 * installation seeded before that change still has them under Electronics and
 * Office. Reconciling only the subcategory would leave them unfiled forever,
 * so a seed row whose main category disagrees is corrected to match the plan.
 *
 * A product whose `subcategoryId` is already set is NEVER touched - a merchant
 * who filed it deliberately keeps their choice.
 */
export function fileProductsInSubcategories(): void {
  const plan: Record<string, { category: string; sub: string }> = {
    "p-001": { category: "food", sub: "Coffee & Tea" },
    "p-002": { category: "food", sub: "Coffee & Tea" },
    "p-003": { category: "food", sub: "Coffee & Tea" },
    "p-004": { category: "phones", sub: "Smartphones" },
    "p-005": { category: "phones", sub: "Smartphones" },
    "p-006": { category: "phones", sub: "Phone Accessories" },
    "p-007": { category: "fashion", sub: "Men Clothes" },
    "p-008": { category: "fashion", sub: "Women Clothes" },
    "p-009": { category: "fashion", sub: "Bags & Accessories" },
    "p-010": { category: "fashion", sub: "Bags & Accessories" },
    // Hub Jewellery (Section 41): all five sit under Fashion / Jewellery, which
    // is what makes that subcategory worth having.
    "p-011": { category: "fashion", sub: "Jewellery" },
    "p-012": { category: "fashion", sub: "Jewellery" },
    "p-013": { category: "fashion", sub: "Jewellery" },
    "p-014": { category: "fashion", sub: "Jewellery" },
    "p-015": { category: "fashion", sub: "Jewellery" },
  };

  let changed = 0;
  for (const product of allProducts()) {
    const wanted = plan[product.id];
    if (!wanted || product.subcategoryId) continue;
    // The main category is corrected first, so the subcategory is built against
    // the parent it actually belongs to.
    if (product.categoryId !== wanted.category) product.categoryId = wanted.category;
    const child = subcategoryId(product.categoryId, wanted.sub);
    if (!allCategories().some((category) => category.id === child)) continue;
    product.subcategoryId = child;
    changed += 1;
  }
  if (changed > 0) persist.products();
}

/**
 * Bring an existing installation's mall records up to the current shape.
 *
 * WHY THIS EXISTS
 * ---------------
 * `MallPlacement` gained `mallId` and `roomNumbers` after the first release, so
 * rows already on disk carry only `mallName` / `floor` / `roomNumber`. Without
 * this step those stores would be invisible to `storesInMall` on an install
 * that was not freshly seeded - the exact silent-data-loss failure Section 37
 * exists to prevent.
 *
 * It is a MIGRATION, not a seed: it only ever ADDS the two new fields, keyed on
 * the mall's own name, and never rewrites a name, a room, an agreement or any
 * other row. Running it twice changes nothing.
 */
export function upgradeMallPlacements(): void {
  if (allMalls().length === 0) return;
  let changed = false;

  for (const business of allBusinesses()) {
    const placement = business.mall;
    if (!placement || !placement.mallName) continue;

    // The directory is the authority on identity: match on the name so a record
    // written before malls had ids still lands on the right row.
    const mall = allMalls().find(
      (entry) => entry.id === placement.mallId || entry.slug === slugify(placement.mallName),
    );

    const rooms = roomNumbersFor(placement);
    if (placement.mallId && placement.mallId === mall?.id && rooms.length > 0) continue;

    business.mall = {
      ...placement,
      mallId: mall?.id ?? placement.mallId ?? null,
      roomNumbers: rooms,
      roomNumber: placement.roomNumber || rooms[0] || "",
    };
    changed = true;
  }

  if (changed) persist.businesses();
}

/**
 * A small, realistic catalogue so the platform is demonstrable immediately.
 *
 * Deliberately includes the awkward cases, because those are the ones that
 * break: a Silver business (no marketplace feature), a mall business with a
 * free subdomain under agreement, a product that is live in its own store but
 * has never been submitted to the marketplace, and a product sitting in the
 * moderation queue.
 */
export function seedIfEmpty(): void {
  if (seeded) return;
  // The mall directory is reference data and is seeded whether or not the
  // database already holds businesses.
  seedMalls();
  // Section 17: the subcategories under each main category, additively.
  seedSubcategories();
  // Then any pre-existing store placement is brought up to the current shape,
  // so an installation that predates `mallId` / `roomNumbers` keeps working and
  // its mall stores stay visible in the directory.
  upgradeMallPlacements();
  // And the real unit directory for every mall, so `availableUnits()` has a
  // genuine rent roll to offer rather than a generated list.
  seedMallUnits();

  // The emptiness check has to happen BEFORE the additive mall demo store is
  // added. Adding that store first would make the database non-empty, and the
  // catalogue below would then be skipped on a brand new installation - which
  // is exactly how Hub Jewellery ended up being the only seeded business.
  if (allBusinesses().length > 0) {
    seeded = true;
    // Only on an existing installation: the Section 41 demo store, additively.
    // See its own comment.
    seedMallDemoStore();
    // Its catalogue is already on disk by now, so it can be filed too.
    fileProductsInSubcategories();
    return;
  }
  seeded = true;

  const now = new Date();
  const iso = now.toISOString();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const daysAhead = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();

  allCategories().push(...INITIAL_CATEGORIES.map((category) => ({ ...category })));
  persist.categories();

  const greenCoffee: Business = {
    id: "green-coffee",
    name: "Green Coffee Exporters",
    type: "standalone",
    mall: null,
    subdomain: "greencoffee.yene-store.com",
    status: "Active",
    packageId: "platinum",
    trustedSeller: false,
    location: "Addis Ababa",
    rating: 4.7,
    createdAt: daysAgo(120),
    customization: {
      logoUrl: null,
      coverImageUrl: null,
      businessName: "Green Coffee Exporters",
      description: "Specialty Ethiopian coffee, roasted and shipped worldwide.",
      businessInformation:
        "Founded in 2014 in Addis Ababa. We work directly with washing stations in Sidama, Yirgacheffe and Guji.",
      theme: "emerald",
      featuredProductIds: [],
      bannerProductIds: [],
      socialLinks: [
        { platform: "Instagram", url: "https://instagram.com/greencoffee" },
        { platform: "Facebook", url: "https://facebook.com/greencoffee" },
      ],
      contact: {
        phone: "+251 911000001",
        email: "hello@greencoffee.example",
        address: "Bole, Addis Ababa",
      },
      policies: {
        returns: "Returns accepted within 7 days of delivery.",
        shipping: "Ships nationwide in 2-4 working days.",
        terms: "Prices include VAT.",
        privacy: "We never share customer data.",
      },
      delivery: {
        freeAbove: 5000,
        options: [
          { id: "standard", label: "Standard delivery", fee: 250, etaDays: 3 },
          { id: "express", label: "Express delivery", fee: 500, etaDays: 1 },
        ],
      },
      paymentOptions: ["Cash on delivery", "Chapa"],
    },
  };

  const blueShop: Business = {
    id: "blue-shop",
    name: "Blue Shop Electronics",
    type: "standalone",
    mall: null,
    subdomain: "blueshop.yene-store.com",
    status: "Active",
    packageId: "silver",
    trustedSeller: false,
    location: "Addis Ababa",
    rating: 4.2,
    createdAt: daysAgo(60),
    customization: {
      logoUrl: null,
      coverImageUrl: null,
      businessName: "Blue Shop Electronics",
      description: "Phones, accessories and everyday electronics.",
      businessInformation: "A family-run electronics retailer since 2011.",
      theme: "yene",
      featuredProductIds: [],
      bannerProductIds: [],
      socialLinks: [],
      contact: {
        phone: "+251 911000002",
        email: "sales@blueshop.example",
        address: "Merkato, Addis Ababa",
      },
      policies: {
        returns: "7-day returns with the original packaging.",
        shipping: "Pickup or delivery within Addis Ababa.",
        terms: "Warranty is handled by the manufacturer.",
        privacy: "We store only what an order needs.",
      },
      delivery: {
        freeAbove: null,
        options: [{ id: "pickup", label: "Store pickup", fee: 0, etaDays: 1 }],
      },
      // Section 21: online payment is a Platinum+ capability, so Silver shows
      // cash on delivery only. The store says so rather than failing at checkout.
      paymentOptions: ["Cash on delivery"],
    },
  };

  const abcfashion: Business = {
    id: "abcfashion",
    name: "ABC Fashion",
    type: "mall",
    // Section 41: a mall business, with the subdomain granted by the agreement.
    // Built through `buildMallPlacement` so the primary room and the room list
    // can never disagree.
    mall: buildMallPlacement({
      mall: mallById("mall-dembel-city-center"),
      requestedName: "Dembel City Center",
      floor: "3F",
      rooms: "3F-24",
      // The mall's agreement covers its registered stores.
      agreementId: "MALL-DCC-2026",
    }),
    subdomain: "abcfashion.yene-store.com",
    status: "Active",
    packageId: "platinum",
    trustedSeller: true,
    location: "Addis Ababa",
    rating: 4.5,
    createdAt: daysAgo(90),
    customization: {
      logoUrl: null,
      coverImageUrl: null,
      businessName: "ABC Fashion",
      description: "Modern Ethiopian and international fashion for every season.",
      businessInformation: "Find us at Dembel City Center, 3F-24.",
      theme: "sand",
      featuredProductIds: [],
      bannerProductIds: [],
      socialLinks: [{ platform: "Instagram", url: "https://instagram.com/abcfashion" }],
      contact: {
        phone: "+251 911000003",
        email: "hello@abcfashion.example",
        address: "Dembel City Center, 3F-24",
      },
      policies: {
        returns: "Exchange within 14 days with a receipt.",
        shipping: "Available for in-mall collection.",
        terms: "Prices include VAT.",
        privacy: "We never share customer data.",
      },
      delivery: { freeAbove: 3000, options: [{ id: "pickup", label: "In-mall pickup", fee: 0, etaDays: 1 }] },
      paymentOptions: ["Cash on delivery", "Chapa"],
    },
  };

  allBusinesses().push(greenCoffee, blueShop, abcfashion);
  persist.businesses();

  const product = (
    id: string,
    businessId: string,
    name: string,
    brand: string,
    categoryId: string,
    price: number,
    discountPrice: number | null,
    stock: number,
    soldCount: number,
    ageDays: number,
    extra: Partial<Product> = {},
  ): Product => ({
    id,
    businessId,
    name,
    description: `${name} from ${brand}, supplied by ${supplierOf(businessId)}.`,
    images: [],
    videoUrl: null,
    categoryId,
    subcategoryId: null,
    brand,
    sku: `${brand.slice(0, 3).toUpperCase()}-${id.toUpperCase()}`,
    price,
    discountPrice,
    stock,
    variants: [],
    attributes: [],
    deliveryInfo: "Delivered nationwide.",
    publishToOwnStore: true,
    publishToMarketplace: false,
    status: "active",
    createdAt: daysAgo(ageDays),
    updatedAt: iso,
    viewCount: soldCount * 12,
    soldCount,
    ...extra,
  });

  const catalogue: Product[] = [
    product("p-001", "green-coffee", "Yirgacheffe Coffee 1kg", "Green Coffee", "food", 1200, 950, 40, 180, 30),
    product("p-002", "green-coffee", "Sidama Natural 1kg", "Green Coffee", "food", 1100, null, 25, 120, 45),
    product("p-003", "green-coffee", "Guji Coffee Beans 500g", "Green Coffee", "food", 650, 550, 60, 95, 20),
    product("p-004", "blue-shop", "Samsung Galaxy A15", "Samsung", "phones", 18500, 17500, 12, 40, 25),
    product("p-005", "blue-shop", "Tecno Spark 20", "Tecno", "phones", 11000, null, 8, 30, 50),
    // A power bank IS a phone accessory, so it is filed under Phones rather
    // than Electronics - which is what makes the Phones / Phone Accessories
    // subcategory return a real result.
    product("p-006", "blue-shop", "Anker PowerBank 20000mAh", "Anker", "phones", 2400, 2100, 35, 70, 35),
    product("p-007", "abcfashion", "Oxford Shirt", "ABC", "fashion", 2200, 1800, 22, 55, 18),
    product("p-008", "abcfashion", "Traditional Dress", "ABC", "fashion", 3500, null, 14, 48, 60),
    product("p-009", "abcfashion", "Leather Belt", "ABC", "fashion", 900, 750, 50, 60, 12),
    // Likewise a backpack is a bag: Fashion / Bags & Accessories.
    product("p-010", "blue-shop", "Laptop Backpack", "Generic", "fashion", 1500, null, 0, 25, 15),
  ];
  allProducts().push(...catalogue);
  persist.products();

  // A featured product for Green Coffee's own store (Section 11).
  greenCoffee.customization.featuredProductIds = ["p-001", "p-003"];
  persist.businesses();

  // Section 13: submissions REFERENCE products. p-001 is published, p-004 is
  // published, p-007 is queued for review, and the rest are Not Submitted.
  allSubmissions().push(
    { ...notSubmitted("p-001", "green-coffee"), status: "Published", autoPublished: false, reviewedBy: "super-admin", reviewedAt: daysAgo(28), submittedAt: daysAgo(29) },
    { ...notSubmitted("p-002", "green-coffee"), status: "Published", autoPublished: false, reviewedBy: "super-admin", reviewedAt: daysAgo(20), submittedAt: daysAgo(21) },
    { ...notSubmitted("p-004", "blue-shop"), status: "Rejected", reviewedBy: "super-admin", reviewedAt: daysAgo(5), submittedAt: daysAgo(6), reviewNote: "Please add a clear product image before we can publish this.", changesRequested: true },
    { ...notSubmitted("p-007", "abcfashion"), status: "Pending Review", submittedAt: daysAgo(1) },
  );
  persist.submissions();

  allReviews().push(
    { id: "r-001", productId: "p-001", businessId: "green-coffee", customerId: "u-shopper", customerName: "Demo customer", rating: 5, body: "Excellent Yirgacheffe. Fast delivery.", images: [], verifiedPurchase: true, businessResponse: "Thank you for buying from us.", status: "published", createdAt: daysAgo(10) },
    { id: "r-002", productId: "p-001", businessId: "green-coffee", customerId: "u-other", customerName: "Another customer", rating: 4, body: "Very good, though the packaging could be better.", images: [], verifiedPurchase: true, businessResponse: null, status: "published", createdAt: daysAgo(6) },
    { id: "r-003", productId: "p-004", businessId: "blue-shop", customerId: "u-shopper", customerName: "Demo customer", rating: 4, body: "Good phone for the price.", images: [], verifiedPurchase: false, businessResponse: null, status: "published", createdAt: daysAgo(3) },
  );
  persist.reviews();

  allPromotions().push(
    {
      id: "pr-001",
      businessId: "green-coffee",
      title: "Flash Deal: 20% off all coffee",
      description: "Limited-time discount on every coffee product.",
      imageUrl: null,
      productId: null,
      serviceId: null,
      type: "Percentage discount",
      amount: 20,
      startAt: daysAgo(1),
      endAt: daysAhead(3),
      cta: "Shop the deal",
      terms: "Applies to coffee products in stock.",
      status: "Active",
      placements: ["Homepage", "Flash Deals", "Promotions page"],
      createdAt: daysAgo(2),
    },
    {
      id: "pr-002",
      businessId: "abcfashion",
      title: "Seasonal collection",
      description: "New season arrivals at Dembel City Center.",
      imageUrl: null,
      productId: null,
      serviceId: null,
      type: "Seasonal promotion",
      amount: 0,
      startAt: daysAgo(5),
      endAt: daysAhead(20),
      cta: "View the collection",
      terms: "In-store collection only.",
      status: "Active",
      placements: ["Homepage", "Category page", "Business Spotlight"],
      createdAt: daysAgo(6),
    },
  );
  persist.promotions();

  // Section 27: the hierarchy the specification draws.
  allNodes().push(
    { id: "n-wh", businessId: "green-coffee", name: "Main Warehouse", type: "warehouse", parentId: null },
    { id: "n-r1", businessId: "green-coffee", name: "Room 1", type: "room", parentId: "n-wh" },
    { id: "n-r2", businessId: "green-coffee", name: "Room 2", type: "room", parentId: "n-wh" },
    { id: "n-s1", businessId: "green-coffee", name: "Shelf A", type: "shelf", parentId: "n-wh" },
    { id: "n-b1", businessId: "green-coffee", name: "Branch 1", type: "branch", parentId: null },
    { id: "n-b1s", businessId: "green-coffee", name: "Store", type: "store", parentId: "n-b1" },
    { id: "n-b1st", businessId: "green-coffee", name: "Storage", type: "storage", parentId: "n-b1" },
    { id: "n-b2", businessId: "green-coffee", name: "Branch 2", type: "branch", parentId: null },
    { id: "n-b2s", businessId: "green-coffee", name: "Store", type: "store", parentId: "n-b2" },
  );
  allInventoryItems().push(
    { id: "i-001", businessId: "green-coffee", name: "Yirgacheffe Coffee 1kg", sku: "GRN-001", barcode: "1000000000017", categoryId: "food-agriculture-farming", brand: "Green Coffee", unit: "kg", variants: [], minStock: 10, maxStock: 100, reorderLevel: 15, unitCost: 620, productId: "p-001", createdAt: daysAgo(90) },
    { id: "i-002", businessId: "green-coffee", name: "Sidama Natural 1kg", sku: "GRN-002", barcode: "1000000000024", categoryId: "food-agriculture-farming", brand: "Green Coffee", unit: "kg", variants: [], minStock: 10, maxStock: 80, reorderLevel: 12, unitCost: 560, productId: "p-002", createdAt: daysAgo(80) },
    { id: "i-003", businessId: "green-coffee", name: "Guji Coffee Beans 500g", sku: "GRN-003", barcode: "1000000000031", categoryId: "food-agriculture-farming", brand: "Green Coffee", unit: "g", variants: [], minStock: 5, maxStock: 60, reorderLevel: 8, unitCost: 300, productId: "p-003", createdAt: daysAgo(70) },
  );
  allMovements().push(
    { id: "sm-001", businessId: "green-coffee", itemId: "i-001", type: "Opening stock", quantity: 60, fromNodeId: null, toNodeId: "n-wh", note: "Opening balance", reference: null, at: daysAgo(60) },
    { id: "sm-002", businessId: "green-coffee", itemId: "i-002", type: "Opening stock", quantity: 40, fromNodeId: null, toNodeId: "n-wh", note: "Opening balance", reference: null, at: daysAgo(60) },
    { id: "sm-003", businessId: "green-coffee", itemId: "i-003", type: "Stock transfer", quantity: 10, fromNodeId: "n-wh", toNodeId: "n-r1", note: "Moved to Room 1", reference: null, at: daysAgo(20) },
  );
  persist.nodes();
  persist.inventoryItems();
  persist.movements();

  // Subscriptions, each in a different state so the billing UI has something
  // real to show: an active Platinum, a Silver whose renewal is due, and a
  // Super trial. Section 31 lists all three statuses, so the demo data has
  // all three.

  saveSubscription(
    {
      businessId: "green-coffee",
      packageId: "platinum",
      status: "Active",
      startedAt: daysAgo(20),
      currentPeriodStart: daysAgo(20),
      currentPeriodEnd: daysAhead(10),
      autoRenew: true,
      pendingChange: null,
      lastUpgradeAmount: 0,
    },
    emptyLedger(),
  );

  // Hub Jewellery is on an ACTIVE Gold plan, which is the package that carries
  // the marketplace feature but not online payment - so its storefront offers
  // cash on delivery and says so (Section 21).
  saveSubscription(
    {
      businessId: "hub-jewellery",
      packageId: "gold",
      status: "Active",
      startedAt: daysAgo(75),
      currentPeriodStart: daysAgo(5),
      currentPeriodEnd: daysAhead(25),
      autoRenew: true,
      pendingChange: null,
      lastUpgradeAmount: 0,
    },
    emptyLedger(),
  );

  // Silver is 10 days PAST its period end, so its renewal is due. That is
  // where Section 31 "Payment Due" comes from in the demo data.

  saveSubscription(
    {
      businessId: "blue-shop",
      packageId: "silver",
      status: "Payment Due",
      startedAt: daysAgo(40),
      currentPeriodStart: daysAgo(40),
      currentPeriodEnd: daysAgo(10),
      autoRenew: true,
      pendingChange: null,
      lastUpgradeAmount: 0,
    },
    emptyLedger(),
  );

  saveSubscription(
    {
      businessId: "abcfashion",
      packageId: "super",
      status: "Trial",
      startedAt: daysAgo(5),
      currentPeriodStart: daysAgo(5),
      currentPeriodEnd: daysAhead(25),
      autoRenew: false,
      pendingChange: null,
      lastUpgradeAmount: 0,
    },
    emptyLedger(),
  );
  // Section 38: a role holds a NAMED SUBSET of the package features. The owner
  // role holds the full Platinum set; staff hold only what their job needs.
  // `effectiveAccess` intersects the two, so a role can restrict a user but
  // never promote them above the plan.
  allRoles().push(
    {
      id: "r-gc-owner",
      businessId: "green-coffee",
      name: "Owner",
      features: [...PACKAGES.platinum.features],
    },
    {
      id: "r-gc-staff",
      businessId: "green-coffee",
      name: "Store staff",
      features: ["store", "promotions", "analytics"],
    },
  );
  persist.roles();

  allEmployees().push({
    id: "e-001",
    businessId: "green-coffee",
    name: "Selam Bekele",
    email: "selam@greencoffee.example",
    roleId: "r-gc-staff",
    branchId: "n-b1",
    department: "Sales",
    active: true,
  });
  allCustomers().push({
    id: "u-shopper",
    businessId: "green-coffee",
    name: "Demo customer",
    email: "shopper@example.com",
    phone: "+251 911000099",
    segment: "Returning",
    orderCount: 3,
    totalSpent: 5400,
    createdAt: daysAgo(50),
  });
  allSuppliers().push({
    id: "sup-001",
    businessId: "green-coffee",
    name: "Sidama Washing Stations Union",
    contact: "+251 911000200",
    itemsSupplied: 3,
    createdAt: daysAgo(200),
  });
  allExpenses().push({
    id: "ex-001",
    businessId: "green-coffee",
    category: "Delivery",
    amount: 800,
    note: "Courier for the week",
    at: daysAgo(7),
  });
  persist.roles();
  persist.employees();
  persist.customers();
  persist.suppliers();
  persist.expenses();

  // Section 41: the second store inside the seeded mall. Added here, at the END
  // of the fresh-install seed, rather than before it - see the note in
  // `seedIfEmpty` about why the order matters. It is additive and idempotent, so
  // it is safe to call on either path.
  seedMallDemoStore();
  // Last of all, because filing needs the products to already exist.
  fileProductsInSubcategories();
}

/** Test seam: forget that seeding happened so a suite can start from empty. */
export function resetSeedFlag(): void {
  seeded = false;
}
