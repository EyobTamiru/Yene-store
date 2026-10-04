/**
 * ============================================================================
 *  YENE-STORE PLATFORM - SHARED DOMAIN TYPES (Sections 10-55)
 * ============================================================================
 *
 *  Imported by BOTH the browser client and the Express server, so it stays
 *  free of Node-only and browser-only APIs, exactly like src/constants.ts.
 *
 *  Sections 1-9 (Yene AI Support) are unchanged and still live in api/support
 *  and src/components/support. Nothing here replaces any of it: the platform
 *  calls into the support system, it does not fork it.
 *
 *  THE THREE INVARIANTS THIS FILE EXISTS TO PROTECT
 *  -----------------------------------------------
 *  1. ONE AUTHORITATIVE PRODUCT (Section 13).
 *     A marketplace listing REFERENCES a business product; it is never a copy.
 *     MarketplaceSubmission.productId is the only link, and the submission
 *     holds no name, price or image of its own.
 *
 *  2. NO DATA LOSS ON PACKAGE CHANGE (Section 37).
 *     A package change moves a status and a date. It never deletes a product,
 *     customer, order, review, report or store. A feature that falls outside
 *     the new package is LOCKED and the rows stay exactly where they are.
 *
 *  3. NO REFUND, EVER (Section 35).
 *     ChangeQuote.refundAmount is typed as the literal 0, so a downgrade
 *     cannot produce a credit even by accident - the type does not admit one.
 */

// ---------------------------------------------------------------------------
// 9 / 38 / 54 - packages and entitlements
// ---------------------------------------------------------------------------

export const PACKAGE_IDS = ["silver", "gold", "platinum", "super"] as const;
export type PackageId = (typeof PACKAGE_IDS)[number];

/**
 * Section 38: the complete, centralised feature vocabulary.
 *
 * This is the ONLY place feature access is decided. Every menu, button, route
 * and API guard resolves through entitlementsFor(packageId) in packages.ts, so
 * "which package can do what" is one table rather than forty scattered
 * conditionals.
 */
export const FEATURE_KEYS = [
  "store",
  "marketplace",
  "promotions",
  "analytics",
  "inventory",
  "crm",
  "employees",
  "suppliers",
  "purchases",
  "multi_branch",
  "automation",
  "advanced_reports",
  "pos",
  "custom_erp",
  "custom_inventory",
  "api_integrations",
  "advanced_support",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface PackageLimits {
  /** null means unlimited. */
  products: number | null;
  stores: number;
  teamMembers: number | null;
  /** Subdomain is included from Gold; malls may grant it free (Section 41). */
  includesSubdomain: boolean;
  /**
   * Section 55: included media storage, in BYTES.
   *
   * A byte count rather than "2 GB" because a human label is derived from it at
   * the edge (see `storageLabel`). Writing both invites the pair to disagree.
   *
   * Super is the 250 GB floor of a quoted band, not a ceiling - it is read
   * together with `customPricing`, never shown as a hard limit on its own.
   */
  storageBytes: number;
}

export interface PackageDefinition {
  id: PackageId;
  name: string;
  /** Ordering used by upgrade/downgrade decisions, never a price comparison. */
  tier: 1 | 2 | 3 | 4;
  monthlyPrice: number;
  /** Super is "30,000 ETB/month+" - a quotation, never an automatic plan. */
  customPricing: boolean;
  tagline: string;
  summary: string;
  /** The Section 38 feature keys this package unlocks. */
  features: FeatureKey[];
  limits: PackageLimits;
}

// ---------------------------------------------------------------------------
// 10 - rented digital stores
// ---------------------------------------------------------------------------

/** Section 10: the six declared store statuses, and no others. */
export const STORE_STATUSES = [
  "Trial",
  "Active",
  "Payment Due",
  "Suspended",
  "Expired",
  "Cancelled",
] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export type BusinessType = "standalone" | "mall";
/**
 * Section 41: a shopping mall that sellers register their stores under.
 *
 * A mall is its own record, NOT a string typed into a store's profile. That is
 * the whole point of the section: one mall holds MANY registered stores, so a
 * shopper has to be able to ask "who trades in Dembel City Center?" - and the
 * answer has to come from data rather than from grouping free text at render
 * time.
 */
export interface Mall {
  id: string;
  name: string;
  /** URL/lookup-safe form of the name, unique across malls. */
  slug: string;
  city: string;
  address: string;
  description: string;
  /** Directory levels a store may sit on, e.g. ["B1", "1F", "2F", "3F"]. */
  floors: string[];
  /** Non-null when covered by a YENE-STORE mall agreement. */
  agreementId: string | null;
  /**
   * Is this mall offered to the public at all?
   *
   * Distinct from `enabled` on the category model: this is the landlord's
   * commercial decision. A mall under renovation, or one whose owner has not
   * signed yet, is switched off and disappears from the mall directory, its
   * stores stop being browsable as mall stores, and its unclaimed rooms stop
   * being advertised - without deleting a single row.
   */
  visible: boolean;
  logoUrl: string | null;
  coverImageUrl: string | null;
  createdAt: string;
}

/**
 * Section 41: the agreement between YENE-STORE and a mall's owner.
 *
 * A mall with no agreement is a mall YENE-STORE has not agreed terms with, and
 * its stores do NOT receive a free subdomain from the platform - they get one
 * like anybody else. Recording the agreement is therefore a commercial fact with
 * a technical consequence, which is why it is a row and not a boolean.
 */
export type MallAgreementStatus = "draft" | "active" | "expired" | "terminated";

export interface MallAgreement {
  id: string;
  mallId: string;
  /** The mall owner's trading or legal name. */
  landlordName: string;
  landlordPhone: string;
  landlordEmail: string;
  status: MallAgreementStatus;
  /** ETB. What the owner pays YENE-STORE, NOT what a tenant pays. */
  monthlyFeeEtb: number;
  /** Share of collected rent returned to the owner, as a percentage. */
  revenueSharePercent: number;
  startDate: string;
  /** Null means open-ended. */
  endDate: string | null;
  signedByLandlord: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Section 10: the lease between a tenant and the mall for ONE counter.
 *
 * Created when a rental application is approved, so the rent a store actually
 * pays is a recorded fact rather than whatever the unit's asking price said on
 * the day. A negotiated discount is a normal part of leasing a shop, and a
 * rent roll that could not represent one would not be a rent roll.
 */
export interface StoreLease {
  id: string;
  unitId: string;
  mallId: string;
  businessId: string;
  applicationId: string;
  /** ETB per month. What this tenant agreed, which may differ from the unit's
   *  listed `monthlyRentEtb` because a lease was negotiated. */
  monthlyRentEtb: number;
  /** ETB. Held against damage and unpaid rent. */
  depositEtb: number;
  startDate: string;
  /** Null means a rolling month-to-month tenancy. */
  endDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Section 41: where one store sits inside its mall.
 *
 * ADDITIVE, WHICH IS WHY `roomNumber` IS STILL HERE
 * -------------------------------------------------
 * The specification's own example has ONE room (3F-24) and the verification
 * suite asserts it, so it stays as the PRIMARY room. A real shop often trades
 * out of more than one - Hub Jewellery holds GFS-024 and GFS-030 - so
 * `roomNumbers` carries the full set and `roomNumber` is always its first
 * entry.
 *
 * Records written before `roomNumbers` existed are still on disk, so read the
 * set through `roomNumbersFor()` in malls.ts rather than touching
 * `placement.roomNumbers` directly: that helper falls back to the single
 * legacy value instead of rendering an empty room list.
 */
export interface MallPlacement {
  /** The mall's own id, when it is a mall YENE-STORE knows about. */
  mallId: string | null;
  mallName: string;
  floor: string;
  /** The primary room, and always `roomNumbers[0]` when rooms are set. */
  roomNumber: string;
  /** Every room / shop number this store occupies, in order. */
  roomNumbers: string[];
  /** Non-null when covered by a YENE-STORE mall agreement. */
  agreementId: string | null;
}

/**
 * A real, rentable unit inside a mall.
 *
 * WHY THIS EXISTS RATHER THAN GENERATING ROOM NUMBERS
 * -----------------------------------------------------
 * `malls.ts` previously produced available rooms by inventing `${floor}-01` up
 * to `${floor}-22`, which is fine for demonstrating a browse UI and wrong for
 * running a mall: a landlord cannot lease a counter that only exists in a
 * `for` loop. A unit carries the things a lease actually needs - a floor, a
 * number, a size, a monthly rent, and whether it is free, held or leased.
 *
 * `number` is stored EXACTLY as written on the lease ("GFS-024", "1F-12") so
 * that what the tenant is told and what the sign is on the wall agree.
 */
export type MallUnitStatus = "available" | "held" | "leased";

/**
 * Is this unit OFFERED to applicants?
 *
 * Separate from `status` on purpose, because they answer different questions.
 * `status` is where the unit is in the leasing pipeline; `listable` is whether
 * the landlord is ADVERTISING it. A landlord keeps a unit occupied but
 * unlisted between tenants, and lists a unit as "coming soon" before it is
 * ready to show - neither state can be expressed by `status` alone.
 *
 * This is what drives the public "Rooms still available in <mall>" panel: a
 * unit that is `available` but not `listable` is deliberately withheld, so an
 * administrator can hold a prime corner back from the market.
 */
export interface MallUnit {
  id: string;
  /** The mall this unit belongs to. */
  mallId: string;
  /** Directory level, e.g. "GFS" or "2F". */
  floor: string;
  /** The room / shop number, as written on the lease. */
  number: string;
  sizeSqm: number;
  /** Monthly rent in ETB. Whole numbers, like every other amount here. */
  monthlyRentEtb: number;
  status: MallUnitStatus;
  /**
   * Whether this unit appears in the public list of rooms still available.
   *
   * Default true. A landlord switches it off to stop applications for a unit
   * that is being refurbished, or to hold a location back from the market.
   */
  listable: boolean;
  /** The business leasing it, or null when nobody holds it. */
  businessId: string | null;
  /**
   * The rental application holding it while it is under review.
   *
   * This is what stops two applicants chasing the same corner: a pending
   * application marks the unit `held`, so `availableUnits()` stops offering it
   * before anyone has signed a lease.
   */
  applicationId: string | null;
  createdAt: string;
}

/** How an administrator identified an applicant before approving them. */
export type RentalMatchField = "id" | "fayda" | "tin" | "phone" | "name";

export type RentalApplicationStatus = "pending" | "approved" | "rejected";

/**
 * Section 10: a request to rent a shop.
 *
 * This is the record an administrator resolves BY NAME OR PHONE NUMBER. It is
 * deliberately separate from `VerificationRecord`, which answers "is this
 * person's identity proven?" - this one answers "do they want this specific
 * counter, and what did they say they are called and reachable on?".
 *
 * `phoneNormalized` is stored because matching is done on the canonical form
 * (see `normalizeEthiopianPhone`), so "0911 234 567" and "+251911234567" are
 * one applicant rather than two. The raw `phone` is kept for display.
 */
export interface RentalApplication {
  id: string;
  userId: string;
  /** The trading name they want to register. */
  businessName: string;
  /** Who they say they are. Matchable. */
  fullName: string;
  /** How they can be reached. Matchable, and required - see rental.ts. */
  phone: string;
  /** Canonical form of `phone`, written on submit. The matching key. */
  phoneNormalized: string;
  email: string;

  mallId: string;
  /** Denormalised from the directory for display, as `MallPlacement` does. */
  mallName: string;
  floor: string;
  /** Every counter requested. A shop may want more than one. */
  rooms: string[];

  packageId: PackageId;
  status: RentalApplicationStatus;
  /** Populated only when `status` is "rejected". */
  reason: string | null;

  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** Which field resolved this applicant, for the audit trail. */
  matchedBy: RentalMatchField | null;
  /** What the administrator actually typed, for the audit trail. */
  matchedQuery: string | null;

  createdAt: string;
  updatedAt: string;
}

export type StoreTheme = "yene" | "midnight" | "sand" | "emerald";

export interface SocialLink {
  platform: string;
  url: string;
}

export interface DeliveryOption {
  id: string;
  label: string;
  fee: number;
  etaDays: number;
}

/** Section 11: everything a business may customise about its storefront. */
export interface StoreCustomization {
  logoUrl: string | null;
  coverImageUrl: string | null;
  businessName: string;
  description: string;
  businessInformation: string;
  theme: StoreTheme;
  featuredProductIds: string[];
  bannerProductIds: string[];
  socialLinks: SocialLink[];
  contact: { phone: string; email: string; address: string };
  policies: { returns: string; shipping: string; terms: string; privacy: string };
  delivery: { options: DeliveryOption[]; freeAbove: number | null };
  /** Section 10: "payment options where supported" - empty when unsupported. */
  paymentOptions: string[];
}

export interface Business {
  id: string;
  name: string;
  type: BusinessType;
  mall: MallPlacement | null;
  /** e.g. "abcfashion.yene-store.com". Unique, derived from the business name. */
  subdomain: string;
  status: StoreStatus;
  packageId: PackageId;
  customization: StoreCustomization;
  /**
   * Section 14: a trusted business may skip manual marketplace review, and
   * only when a Super Admin sets this. Off by default.
   */
  trustedSeller: boolean;
  location: string;
  rating: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 12 / 13 / 14 - products and the marketplace listing
// ---------------------------------------------------------------------------

export interface ProductVariant {
  id: string;
  label: string;
  sku: string;
  price: number | null;
  stock: number;
}

export interface ProductAttribute {
  name: string;
  value: string;
}

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface Product {
  id: string;
  businessId: string;
  name: string;
  description: string;
  images: string[];
  videoUrl: string | null;
  categoryId: string;
  subcategoryId: string | null;
  brand: string;
  sku: string;
  price: number;
  discountPrice: number | null;
  stock: number;
  variants: ProductVariant[];
  attributes: ProductAttribute[];
  deliveryInfo: string;
  /** Section 12: the "Publish to My Store" checkbox. */
  publishToOwnStore: boolean;
  /** Optional. A business can sell from its own store without this. */
  publishToMarketplace: boolean;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  viewCount: number;
  soldCount: number;
}

export const MARKETPLACE_STATUSES = [
  "Not Submitted",
  "Pending Review",
  "Approved",
  "Rejected",
  "Published",
  "Unpublished",
] as const;
export type MarketplaceStatus = (typeof MARKETPLACE_STATUSES)[number];

/**
 * Section 13: a submission REFERENCES the product. It carries no name, no
 * price and no image of its own, which makes duplication structurally
 * impossible rather than merely discouraged.
 */
export interface MarketplaceSubmission {
  id: string;
  productId: string;
  businessId: string;
  status: MarketplaceStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  changesRequested: boolean;
  featured: boolean;
  sponsored: boolean;
  /** Section 14: set when a trusted seller auto-published. */
  autoPublished: boolean;
}

/** A marketplace row as the marketplace renders it: a view over Product. */
export interface MarketplaceListing {
  submissionId: string;
  productId: string;
  businessId: string;
  businessName: string;
  name: string;
  price: number;
  discountPrice: number | null;
  rating: number;
  imageUrl: string | null;
  status: MarketplaceStatus;
  featured: boolean;
  sponsored: boolean;
}

// ---------------------------------------------------------------------------
// 17 - categories
// ---------------------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  /** Display order, editable by Super Admin (Section 17: "reorder"). */
  position: number;
  enabled: boolean;
  /**
   * How many listings sit in this category, as the marketplace displays it.
   *
   * Section 17 treats categories as DATA rather than a fixed list, and a
   * classifieds board is browsed by volume: a shopper deciding where to look
   * first is reading these numbers, so they are part of the category record
   * rather than something a component invents.
   *
   * This is a DISPLAYED FIGURE, not a computed one. It is deliberately NOT
   * derived from the product table, because a classifieds category counts
   * offers to sell, not units in stock - and because seeding must not make the
   * demo numbers jump every time a product is added. `null` on a subcategory
   * means "no count is shown", which is what the nav renders.
   */
  listingCount: number | null;
}

// ---------------------------------------------------------------------------
// 20 - multi-vendor cart
// ---------------------------------------------------------------------------

export interface CartLine {
  productId: string;
  businessId: string;
  variantId: string | null;
  quantity: number;
}

/** Section 20: the cart is GROUPED BY STORE before any total is produced. */
export interface CartStoreGroup {
  businessId: string;
  businessName: string;
  lines: { product: Product; variant: ProductVariant | null; quantity: number }[];
  subtotal: number;
  discount: number;
  delivery: number;
  tax: number;
  total: number;
}

export interface CartTotals {
  groups: CartStoreGroup[];
  itemCount: number;
  productSubtotal: number;
  storeSubtotalTotal: number;
  discounts: number;
  delivery: number;
  taxes: number;
  grandTotal: number;
}

// ---------------------------------------------------------------------------
// 21 / 22 - checkout, orders, payments
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = [
  "Pending",
  "Confirmed",
  "Processing",
  "Preparing",
  "Shipped",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
  "Returned",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderLine {
  productId: string;
  name: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderAddress {
  name: string;
  phone: string;
  line1: string;
  city: string;
  note: string;
}

export const CHECKOUT_STEPS = [
  "Customer Information",
  "Delivery Address",
  "Delivery Method",
  "Payment Method",
  "Order Review",
  "Place Order",
] as const;
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];

/**
 * Section 22: ONE ORDER PER STORE. A three-store checkout produces three of
 * these and exactly one aggregate CustomerOrder the customer can see.
 */
export interface BusinessOrder {
  id: string;
  parentOrderId: string;
  businessId: string;
  businessName: string;
  customerId: string;
  lines: OrderLine[];
  subtotal: number;
  discount: number;
  delivery: number;
  tax: number;
  total: number;
  status: OrderStatus;
  address: OrderAddress;
  deliveryOptionId: string | null;
  paymentReference: string | null;
  createdAt: string;
  updatedAt: string;
  history: { at: string; status: OrderStatus; note: string }[];
}

export interface CustomerOrder {
  id: string;
  customerId: string;
  businessOrderIds: string[];
  total: number;
  createdAt: string;
}

export type PaymentStatus = "Pending" | "Success" | "Failed" | "Refunded";

export interface PaymentRecord {
  reference: string;
  orderId: string;
  businessId: string;
  customerId: string;
  provider: string;
  amount: number;
  currency: "ETB";
  status: PaymentStatus;
  transactionId: string | null;
  createdAt: string;
  verifiedAt: string | null;
  failureReason: string | null;
}

// ---------------------------------------------------------------------------
// 23 / 24 - reviews and wishlist
// ---------------------------------------------------------------------------

export interface Review {
  id: string;
  productId: string;
  businessId: string;
  customerId: string;
  customerName: string;
  rating: number;
  body: string;
  images: string[];
  /** Section 23: only true when the order for this product was delivered. */
  verifiedPurchase: boolean;
  businessResponse: string | null;
  status: "published" | "pending" | "hidden";
  createdAt: string;
}

export interface RatingSummary {
  average: number;
  count: number;
  distribution: [number, number, number, number, number];
}

export interface WishlistItem {
  productId: string;
  customerId: string;
  addedAt: string;
  /** Section 24: what changed since it was saved. */
  notified: { price: boolean; promotion: boolean; backInStock: boolean };
}

// ---------------------------------------------------------------------------
// 18 / 19 - promotions
// ---------------------------------------------------------------------------

export const PROMOTION_TYPES = [
  "Percentage discount",
  "Fixed discount",
  "Special price",
  "Buy one get one",
  "Free item",
  "New product",
  "Seasonal promotion",
  "Event",
  "Custom offer",
  "Flash Deal",
] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export const PROMOTION_STATUSES = [
  "Draft",
  "Pending Review",
  "Approved",
  "Scheduled",
  "Active",
  "Paused",
  "Expired",
  "Rejected",
] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

/** Section 19: where a promotion may appear. Super Admin controls this. */
export const PROMOTION_PLACEMENTS = [
  "Homepage",
  "Promotions page",
  "Category page",
  "Search results",
  "Product page",
  "Store page",
  "Flash Deals",
  "Featured products",
  "Sponsored products",
  "Sponsored stores",
  "Business Spotlight",
  "Seasonal campaign",
  "Category sponsorship",
] as const;
export type PromotionPlacement = (typeof PROMOTION_PLACEMENTS)[number];

export interface Promotion {
  id: string;
  businessId: string;
  title: string;
  description: string;
  imageUrl: string | null;
  productId: string | null;
  serviceId: string | null;
  type: PromotionType;
  amount: number;
  startAt: string;
  endAt: string;
  cta: string;
  terms: string;
  status: PromotionStatus;
  placements: PromotionPlacement[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 27 - inventory
// ---------------------------------------------------------------------------

export const NODE_TYPES = [
  "warehouse",
  "room",
  "shelf",
  "branch",
  "store",
  "storage",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export interface WarehouseNode {
  id: string;
  businessId: string;
  name: string;
  type: NodeType;
  parentId: string | null;
}

export const STOCK_MOVEMENT_TYPES = [
  "Stock receipt",
  "Stock issue",
  "Stock transfer",
  "Stock adjustment",
  "Stock reconciliation",
  "Opening stock",
  "Damaged stock",
  "Lost stock",
  "Returned stock",
  "Stock reservation",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export interface StockMovement {
  id: string;
  businessId: string;
  itemId: string;
  type: StockMovementType;
  quantity: number;
  fromNodeId: string | null;
  toNodeId: string | null;
  note: string;
  reference: string | null;
  at: string;
}

export interface InventoryItem {
  id: string;
  businessId: string;
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  brand: string;
  unit: string;
  variants: ProductVariant[];
  minStock: number;
  maxStock: number;
  reorderLevel: number;
  unitCost: number;
  productId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 28 / 29 - CRM, procurement, people, expenses
// ---------------------------------------------------------------------------

export interface CustomerProfile {
  id: string;
  businessId: string;
  name: string;
  email: string;
  phone: string;
  segment: "New" | "Returning" | "VIP" | "At risk";
  orderCount: number;
  totalSpent: number;
  createdAt: string;
}

export interface Supplier {
  id: string;
  businessId: string;
  name: string;
  contact: string;
  itemsSupplied: number;
  createdAt: string;
}

export const PURCHASE_STATUSES = [
  "Draft",
  "Ordered",
  "Received",
  "Cancelled",
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export interface PurchaseOrder {
  id: string;
  businessId: string;
  supplierId: string;
  items: { itemId: string; name: string; quantity: number; unitCost: number }[];
  total: number;
  status: PurchaseStatus;
  createdAt: string;
}

export interface Employee {
  id: string;
  businessId: string;
  name: string;
  email: string;
  roleId: string;
  branchId: string | null;
  department: string | null;
  active: boolean;
}

export interface Expense {
  id: string;
  businessId: string;
  category: string;
  amount: number;
  note: string;
  at: string;
}

export interface Role {
  id: string;
  businessId: string;
  name: string;
  /** Section 38: a role is a named subset of the feature keys. */
  features: FeatureKey[];
}

// ---------------------------------------------------------------------------
// 25 - recommendations
// ---------------------------------------------------------------------------

export interface Recommendation {
  productId: string;
  score: number;
  /** Why it was recommended. Shown to the customer, never a private signal. */
  reason: string;
}

// ---------------------------------------------------------------------------
// 31-40 - subscriptions, invoices, change history
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_STATUSES = [
  "Trial",
  "Active",
  "Payment Due",
  "Suspended",
  "Expired",
  "Cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type ChangeType = "Upgrade" | "Downgrade" | "Renewal" | "Cancellation";

export interface PendingPackageChange {
  toPackageId: PackageId;
  changeType: "Upgrade" | "Downgrade";
  effectiveAt: string;
}

export interface Subscription {
  businessId: string;
  packageId: PackageId;
  status: SubscriptionStatus;
  startedAt: string;
  currentPeriodStart: string;
  /** Section 31: the renewal date shown on the billing dashboard. */
  currentPeriodEnd: string;
  autoRenew: boolean;
  pendingChange: PendingPackageChange | null;
  /**
   * Section 33/34: recorded for the history row ONLY. It is deliberately not
   * a discount field - renewal invoices use the full package price, so an
   * upgrade can never become a permanent discount.
   */
  lastUpgradeAmount: number;
}

/** Section 39: the change history row, with every field the spec lists. */
export interface PackageChangeRecord {
  id: string;
  businessId: string;
  previousPackage: PackageId;
  newPackage: PackageId;
  changeType: ChangeType;
  at: string;
  userId: string;
  userName: string;
  paymentReference: string | null;
  amount: number;
  effectiveAt: string;
  status: "Completed" | "Pending" | "Failed";
}

export const INVOICE_TYPES = ["subscription", "upgrade", "custom-quotation"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export interface Invoice {
  id: string;
  businessId: string;
  type: InvoiceType;
  packageId: PackageId;
  amount: number;
  currency: "ETB";
  periodStart: string;
  periodEnd: string;
  paymentReference: string | null;
  status: PaymentStatus;
  issuedAt: string;
  lines: { label: string; amount: number }[];
}

export interface CustomQuoteRequest {
  id: string;
  businessId: string;
  businessName: string;
  requirements: Record<string, string | number | boolean>;
  note: string;
  status: "Submitted" | "Under review" | "Quoted" | "Closed";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 48 - analytics
// ---------------------------------------------------------------------------

export interface BusinessAnalytics {
  businessId: string;
  storeVisitors: number;
  productViews: number;
  searchEvents: number;
  orders: number;
  revenue: number;
  conversionRate: number;
  returningCustomers: number;
  promotionPerformance: {
    promotionId: string;
    title: string;
    redemptions: number;
    revenue: number;
  }[];
  topProducts: { productId: string; name: string; units: number; revenue: number }[];
  lowStockProducts: {
    productId: string;
    name: string;
    stock: number;
    reorderLevel: number;
  }[];
  inventoryPerformance: { stockValue: number; deadStock: number; turnover: number };
}

export interface PlatformAnalytics {
  totalBusinesses: number;
  activeStores: number;
  packageDistribution: Record<PackageId, number>;
  subscriptionRevenue: number;
  marketplaceActivity: {
    pendingReviews: number;
    publishedListings: number;
    submissionsThisMonth: number;
  };
  orders: number;
  promotions: { active: number; pending: number };
  supportVolume: { open: number; resolvedToday: number };
}

// ---------------------------------------------------------------------------
// 49 - notifications
// ---------------------------------------------------------------------------

export type NotificationChannel = "in-app" | "email" | "telegram" | "sms";

export const BUSINESS_NOTIFICATION_TOPICS = [
  "New order",
  "Payment",
  "Delivery",
  "Customer inquiry",
  "Promotion",
  "Low stock",
  "Inventory event",
  "Subscription renewal",
  "Payment due",
  "Package change",
  "Support ticket",
] as const;
export type BusinessNotificationTopic = (typeof BUSINESS_NOTIFICATION_TOPICS)[number];

export interface Notification {
  id: string;
  businessId: string;
  channel: NotificationChannel;
  topic: BusinessNotificationTopic;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 16 - search
// ---------------------------------------------------------------------------

export const SORT_OPTIONS = [
  "Relevance",
  "Popular",
  "Newest",
  "Price low to high",
  "Price high to low",
  "Best rated",
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export interface SearchFilters {
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  location?: string;
  businessId?: string;
  brand?: string;
  minRating?: number;
  inStockOnly?: boolean;
  onPromotion?: boolean;
}

export interface SearchResultItem {
  kind: "product" | "business" | "category" | "brand" | "promotion";
  id: string;
  title: string;
  subtitle: string;
  price: number | null;
  score: number;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  suggestions: string[];
  /** True when a query was corrected for a typo. Reported, never hidden. */
  corrected: boolean;
}
