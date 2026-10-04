/**
 * ============================================================================
 *  PLATFORM API CLIENT (Sections 10-55)
 * ============================================================================
 *
 *  The browser's only door to the platform. Mirrors the support client's
 *  conventions: a bearer token from the same store, JSON in and JSON out, and
 *  a generic error that never leaks a status code or a stack trace into the
 *  DOM.
 *
 *  TENANT SCOPE IS THE SERVER'S JOB
 *  --------------------------------
 *  Notice what is NOT here: there is no function that sends a businessId for a
 *  tenant-scoped call. `/api/platform/products` takes no argument - the server
 *  reads the business from the verified token (api/platform/auth.ts). The one
 *  place businessId appears in a query string is `/api/platform/search`, where
 *  it is a public "search within one store" filter, not an access decision.
 */

const TOKEN_KEY = "yene-platform-token";

export class PlatformUnavailableError extends Error {
  /** Carries the server's own message so the UI can show a useful refusal. */
  readonly userMessage: string;

  constructor(userMessage = "We could not reach YENE-STORE. Please try again.") {
    super("platform_unavailable");
    this.name = "PlatformUnavailableError";
    this.userMessage = userMessage;
  }
}

export function readPlatformToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setPlatformToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked - treat as guest */
  }
}

function headers(): Record<string, string> {
  const base: Record<string, string> = { "Content-Type": "application/json" };
  const token = readPlatformToken();
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  } catch (error) {
    console.error("[platform] network failure:", error);
    throw new PlatformUnavailableError();
  }
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    // Log the status for developers; surface only the server's own message.
    console.error(`[platform] ${path} returned ${response.status}`);
    throw new PlatformUnavailableError(
      typeof body.error === "string" ? body.error : undefined,
    );
  }
  return body as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, payload: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(payload) });

// ---------------------------------------------------------------------------
// Shapes the UI needs. Deliberately narrow: a field that does not exist here
// cannot be rendered by accident.
// ---------------------------------------------------------------------------

export interface PlatformConfig {
  /** Section 17: the main -> subcategory tree, nested as the server sends it. */
  categories: CategoryChip[];
  packages: {
    id: string; name: string; price: number; priceLabel: string;
    customPricing: boolean; tagline: string; summary: string; features: string[];
  }[];
  paymentProviders: string[];
  support: { company: string; phone: string; email: string; location: string };
  customErp: { name: string; description: string };
}

export interface MarketplaceRow {
  submissionId: string; productId: string; businessId: string; businessName: string;
  name: string; price: number; discountPrice: number | null; rating: number;
  imageUrl: string | null; status: string; featured: boolean; sponsored: boolean;
}

export interface Storefront {
  business: {
    id: string; name: string; subdomain: string; status: string; location: string;
    rating: number; type: string;
    mall: MallPlacementCard | null;
    /** The mall itself, so the storefront can offer "other stores here". */
    mallInfo: MallInfo | null;
    customization: {
      logoUrl: string | null; coverImageUrl: string | null; businessName: string;
      description: string; businessInformation: string; theme: string;
      featuredProductIds: string[]; socialLinks: { platform: string; url: string }[];
      contact: { phone: string; email: string; address: string };
      policies: { returns: string; shipping: string; terms: string; privacy: string };
      delivery: { options: { id: string; label: string; fee: number; etaDays: number }[]; freeAbove: number | null };
      paymentOptions: string[];
    };
  };
  featured: ProductSummary[];
  products: ProductSummary[];
  promotions: { id: string; title: string; description: string; type: string; cta: string; amount: number }[];
}

export interface ProductSummary {
  id: string; name: string; description: string; images: string[];
  categoryId: string;
  /** Section 17: the subcategory, when the merchant filed one. */
  subcategoryId: string | null;
  brand: string; price: number; discountPrice: number | null;
  stock: number; businessId: string; soldCount: number; attributes: { name: string; value: string }[];
}

export interface CartGroup {
  businessId: string; businessName: string;
  lines: { product: ProductSummary; variant: { id: string; label: string } | null; quantity: number }[];
  subtotal: number; discount: number; delivery: number; tax: number; total: number;
}

export interface CartTotalsView {
  groups: CartGroup[]; itemCount: number; productSubtotal: number;
  storeSubtotalTotal: number; discounts: number; delivery: number; taxes: number; grandTotal: number;
}

export interface SubscriptionView {
  subscription: {
    packageId: string; status: string; currentPeriodEnd: string;
    pendingChange: { toPackageId: string; changeType: string; effectiveAt: string } | null;
    lastUpgradeAmount: number;
  };
  summary: {
    packageName: string; priceLabel: string; status: string; renewalDate: string;
    pendingChangeLabel: string | null; canUpgrade: string[]; canDowngrade: string[];
  };
  entitlements: Record<string, boolean>;
  modules: { key: string; label: string; feature: string | null; access: string; unlockWith: string | null }[];
  changeHistory: {
    id: string; previousPackage: string; newPackage: string; changeType: string;
    at: string; userName: string; amount: number; effectiveAt: string; status: string;
    paymentReference: string | null;
  }[];
  invoices: { id: string; type: string; amount: number; status: string; issuedAt: string; lines: { label: string; amount: number }[] }[];
  surcharges: { id: string; label: string; amount: number; at: string }[];
}

export interface ChangeQuoteView {
  fromPackage: string; toPackage: string; changeType: string;
  amountDue: number; refundAmount: number; notice: string;
  effectiveAt: string; immediate: boolean; nextRenewalAmount: number; renewalDate: string;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const fetchConfig = () => get<PlatformConfig>("/api/platform/config");

export const fetchMarketplace = () =>
  get<{ listings: MarketplaceRow[] }>("/api/platform/marketplace");

export interface SearchOptions {
  q?: string; category?: string; store?: string; sort?: string;
  minPrice?: number; maxPrice?: number; inStock?: boolean; page?: number;
}
export const searchMarketplace = (options: SearchOptions) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  }
  return get<{
    items: { kind: string; id: string; title: string; subtitle: string; price: number | null; score: number }[];
    total: number; page: number; pageSize: number; totalPages: number;
    suggestions: string[]; corrected: boolean;
  }>(`/api/platform/search?${params.toString()}`);
};

export const searchSuggestions = (q: string) =>
  get<{ suggestions: string[] }>(`/api/platform/search/suggest?q=${encodeURIComponent(q)}`);

export const fetchStore = (subdomain: string) =>
  get<Storefront>(`/api/platform/store/${encodeURIComponent(subdomain)}`);

export const fetchProduct = (id: string) =>
  get<{
    product: ProductSummary & { videoUrl: string | null; sku: string; variants: { id: string; label: string; price: number | null; stock: number }[]; deliveryInfo: string };
    seller: { id: string; name: string; subdomain: string; location: string; rating: number } | null;
    ratings: { average: number; count: number; distribution: number[] };
    reviews: { id: string; customerName: string; rating: number; body: string; verifiedPurchase: boolean; businessResponse: string | null; createdAt: string }[];
    marketplace: { status: string; featured: boolean; sponsored: boolean };
    recommendations: { productId: string; score: number; reason: string }[];
  }>(`/api/platform/product/${encodeURIComponent(id)}`);

export const priceCart = (lines: { productId: string; variantId?: string | null; quantity?: number }[]) =>
  post<{ ok: true; totals: CartTotalsView; paymentOptions: string[] }>("/api/platform/cart", { lines });

export const placeOrder = (payload: {
  lines: { productId: string; variantId?: string | null; quantity?: number }[];
  address: { name: string; phone: string; line1: string; city: string; note: string };
  paymentMethod: string;
}) =>
  post<{
    ok: true;
    order: { id: string; total: number; businessOrderIds: string[] };
    businessOrders: { id: string; businessName: string; total: number; status: string }[];
  }>("/api/platform/checkout", payload);

export const fetchSubscription = () => get<SubscriptionView>("/api/platform/subscription");

export const fetchChangeQuote = (to: string) =>
  get<{ ok: true; quote: ChangeQuoteView }>(`/api/platform/subscription/quote?to=${encodeURIComponent(to)}`);

export const applyChange = (to: string) =>
  post<{ ok: true; quote: ChangeQuoteView; summary: SubscriptionView["summary"]; notice: string }>(
    "/api/platform/subscription/change",
    { to },
  );

export const renewSubscription = () =>
  post<{ ok: true; invoice: SubscriptionView["invoices"][number] }>("/api/platform/subscription/renew", {});

export const fetchDashboard = () =>
  get<{
    business: { id: string; name: string; status: string; subdomain: string };
    packageId: string;
    modules: SubscriptionView["modules"];
    counts: { products: number; orders: number; promotions: number; reviews: number };
  }>("/api/platform/dashboard");

export const fetchMyOrders = () =>
  get<{ ok: true; orders: { id: string; businessName: string; total: number; status: string; createdAt: string }[] }>(
    "/api/platform/orders",
  );

export const fetchAdmin = () =>
  get<{
    areas: string[];
    analytics: {
      totalBusinesses: number; activeStores: number;
      packageDistribution: Record<string, number>; subscriptionRevenue: number;
      marketplaceActivity: { pendingReviews: number; publishedListings: number; submissionsThisMonth: number };
      orders: number; promotions: { active: number; pending: number };
    };
  }>("/api/platform/admin");

export const fetchModerationQueue = () =>
  get<{
    submissions: {
      submission: { id: string; productId: string; status: string; submittedAt: string | null; businessId: string };
      product: { id: string; name: string; price: number; brand: string; stock: number } | null;
      business: { id: string; name: string; packageId: string } | null;
    }[];
  }>("/api/platform/admin/submissions");

export const reviewSubmission = (id: string, decision: "Approved" | "Rejected", note: string) =>
  post<{ ok: true }>(`/api/platform/admin/submissions/${encodeURIComponent(id)}/review`, { decision, note });

export const publishSubmission = (id: string) =>
  post<{ ok: true }>(`/api/platform/admin/submissions/${encodeURIComponent(id)}/publish`, {});

// ---------------------------------------------------------------------------
// Marketplace homepage reads (spec Ãƒâ€šÃ‚Â§4, Ãƒâ€šÃ‚Â§9)
//
// The four endpoints below are the only product sources the homepage uses.
// The response types are imported from the marketplace view models rather than
// restated, so the client cannot drift from the server's projection.
// ---------------------------------------------------------------------------

import { PACKAGES, PACKAGE_ORDER, labelForFeature } from "../platform/packages";
import type {
  CategoryChip,
  ListingCard,
  MallCard,
  MallInfo,
  MallPage,
  MallPlacementCard,
  PromotionCard,
  RecommendationCard,
  StoreCard,
} from "../components/marketplace/types";

/** Categories (Section 17) plus the package ladder and support details. */
export const fetchPlatformConfig = () =>
  get<{
    categories: CategoryChip[];
    packages: PackageConfigCard[];
    paymentProviders: string[];
    support: { company: string; phone: string; email: string; location: string };
  }>("/api/platform/config");

/** Section 9 / 54: the four package cards, in ladder order. */
export const packageCards = () =>
  PACKAGE_ORDER.map((id) => {
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

export interface PackageConfigCard {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  customPricing: boolean;
  tagline: string;
  summary: string;
  features: string[];
}

/** Published marketplace listings (Sections 13, 15). */
export const fetchMarketplaceCards = () =>
  get<{ listings: ListingCard[] }>("/api/platform/marketplace");

/** Store cards for Featured Businesses (Section 10). */
export const fetchBusinesses = () =>
  get<{ businesses: StoreCard[] }>("/api/platform/businesses");

/**
 * Section 41: the mall directory.
 *
 * Public, like the rest of the marketplace feed. A separate endpoint rather
 * than a filter on `/businesses` because a mall carries its own facts - its
 * address, its floors, whether it holds a YENE-STORE agreement - that a store
 * card has no field for.
 */
export const fetchMalls = () => get<{ malls: MallCard[] }>("/api/platform/malls");

/** One mall, with every store registered under it and its unclaimed rooms. */
export const fetchMall = (idOrSlug: string) =>
  get<MallPage>(`/api/platform/malls/${encodeURIComponent(idOrSlug)}`);

/** Just the store cards registered in one mall. */
export const fetchMallStores = (idOrSlug: string) =>
  get<{ businesses: StoreCard[] }>(
    `/api/platform/businesses?mall=${encodeURIComponent(idOrSlug)}`,
  );

/** LIVE promotions only - the server filters by the real window (Section 19). */
export const fetchPromotions = () =>
  get<{ promotions: PromotionCard[] }>("/api/platform/promotions");

/** Cold-start recommendations for a signed-out visitor (Section 25). */
export const fetchRecommendations = (limit = 8) =>
  get<{ recommendations: RecommendationCard[] }>(
    `/api/platform/recommendations?limit=${limit}`,
  );

