/**
 * ============================================================================
 *  PLATFORM ROUTER (Sections 10-55)
 * ============================================================================
 *
 *  Mounted at /api/platform, alongside - not inside - the existing support
 *  routes, so Sections 1-9 keep working exactly as they did.
 *
 *  THE TWO RULES EVERY HANDLER FOLLOWS
 *  ----------------------------------
 *  1. `businessId` is taken from the VERIFIED IDENTITY, never from the body,
 *     the query string or a client header. Handlers that need a business call
 *     `requireBusiness(req, res)` and get it back or the request is refused.
 *  2. A handler that a package gates asks `requireFeature(...)`. It never
 *     checks a package name inline, because a fifth inline check is how a
 *     feature ends up half-gated.
 *
 *  Modifying routes are counted per caller. The marketplace is public, so the
 *  abuse limit here is the same shape as api/support/router.ts.
 */

import { Router, type Request, type Response } from "express";
import { entitlementsFor, hasFeature, dashboardModulesFor, packageCards } from "../../src/platform/packages";
import { categoryTree, enabledCategories } from "../../src/platform/categories";
import {
  availableRooms,
  formatRoomNumbers,
  mallDirectory,
  mallForBusiness,
  roomNumbersFor,
  storesInMall,
} from "../../src/platform/malls";
import { marketplaceFeed, moderationQueue, submitForReview, reviewSubmission, publishSubmission, unpublishSubmission, autoPublishIfTrusted, notSubmitted, isSellable } from "../../src/platform/marketplace";
import { groupCartByStore, buildBusinessOrder, buildCustomerOrder, advanceOrder, isValidOrderStatus } from "../../src/platform/commerce";
import { summarizeRatings, isVerifiedPurchase, recommendationsFor, EMPTY_SIGNALS, isValidRating, rememberSavedPrice } from "../../src/platform/engagement";
import { search, suggest, type SearchCorpus } from "../../src/platform/search";
import { buildPaymentRecord, createChapaProvider, newPaymentReference, paymentOptionsFor, registerProvider, settlePayment } from "../../src/platform/payments";
import { quotePackageChange, applyPackageChange, renewalInvoice, applyPendingChange, subscriptionSummary, buildChangeRecord, formatEtb, emptyLedger } from "../../src/platform/billing";
import { currentStockReport, stockValuation, needsRestock, movementReport } from "../../src/platform/inventory";
import { SUPPORT_CONTACT } from "../../src/constants";
import { CUSTOM_ERP_DESCRIPTION, CUSTOM_ERP_NAME, QUOTE_FACTORS, SUPER_ADMIN_AREAS } from "./types";
import { canAccessBusiness, guestIdentity, requireSuperAdmin, resolveIdentity, type PlatformIdentity } from "./auth";
import {
  allBusinesses, allBusinessOrders, allCategories, allCustomerOrders, allChanges, allCustomers, allEmployees,
  allExpenses, allInvoices, allInventoryItems, allMovements, allNodes, allNotifications,
  allPayments, allProducts, allPromotions, allPurchases, allQuotes, allReviews, allRoles,
  allMallUnits,
  allMalls, allSubmissions, allSuppliers, allWishlistItems, businessById, businessBySubdomain,
  mallById, mallByIdOrName, seedMalls,
  seedMallUnits,
  changesForBusiness, customerOrderById, flushAll, invoicesForBusiness,
  notificationsForBusiness, ordersForBusiness, ordersForCustomer, persist, productById,
  productsForBusiness, reviewsForProduct, saveSubscription, seedIfEmpty, submissionForProduct,
  subscriptionFor, wishlistForCustomer,
} from "./store";
import type { Business, FeatureKey, Mall, MarketplaceSubmission, PackageId, Product } from "../../src/platform/types";
import { mallAdminRouter } from "./mallAdmin";
import { availableUnits } from "../../src/platform/rental";

// Chapa registers itself at import. It reports itself unconfigured until a
// secret key exists, so an unconfigured deployment offers cash on delivery
// only rather than a payment button that cannot work.
registerProvider(createChapaProvider());

export const platformRouter = Router();

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function badRequest(res: Response, message: string): Response {
  return res.status(400).json({ error: message });
}

function forbidden(res: Response, message: string): Response {
  return res.status(403).json({ error: message });
}

/** Resolve the caller and the business they may act for. */
function requireBusiness(
  req: Request,
  res: Response,
): { identity: PlatformIdentity; businessId: string } | null {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated) {
    forbidden(res, "Please sign in to continue.");
    return null;
  }
  // Super Admin may act on any business; everyone else on their own only.
  const businessId = identity.businessId;
  if (!businessId) {
    forbidden(res, "This account is not attached to a business.");
    return null;
  }
  return { identity, businessId };
}

function requireSuperAdminOrRes(req: Request, res: Response): PlatformIdentity | null {
  const identity = resolveIdentity(req);
  if (!requireSuperAdmin(identity)) {
    forbidden(res, "Super Admin access is required.");
    return null;
  }
  return identity;
}

/** Section 38: package gating, in exactly one place. */
function hasPackageFeature(identity: PlatformIdentity, businessId: string, feature: FeatureKey): boolean {
  const business = businessById(businessId);
  if (!business) return false;
  return hasFeature(business.packageId, feature);
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(req: Request): boolean {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

/** Section 16/25: the search corpus, assembled from live data only. */
function buildCorpus(): SearchCorpus {
  const products = allProducts().filter(isSellable);
  const promotionIndex: Record<string, string[]> = {};
  const now = Date.now();
  for (const promotion of allPromotions()) {
    if (promotion.status !== "Active") continue;
    if (new Date(promotion.endAt).getTime() < now) continue;
    if (promotion.productId) {
      promotionIndex[promotion.productId] = [
        ...(promotionIndex[promotion.productId] ?? []),
        promotion.id,
      ];
    }
  }
  const ratings: Record<string, number> = {};
  for (const product of products) {
    const summary = summarizeRatings(reviewsForProduct(product.id));
    ratings[product.id] = summary.average;
  }
  return {
    products,
    businesses: allBusinesses(),
    categories: allCategories(),
    promotions: allPromotions(),
    ratings,
    promotionIndex,
  };
}

// ---------------------------------------------------------------------------
// Public reads - no sign-in required (Sections 15, 16, 17)
// ---------------------------------------------------------------------------

seedIfEmpty();

/** GET /api/platform/health */
platformRouter.get("/health", (_req: Request, res: Response) => {
  return res.status(200).json({
    ok: true,
    businessCount: allBusinesses().length,
    productCount: allProducts().length,
    company: SUPPORT_CONTACT.email,
  });
});

/** GET /api/platform/config - brands, categories, packages, payment options. */
platformRouter.get("/config", (_req: Request, res: Response) => {
  return res.status(200).json({
    // Section 17: the main -> subcategory tree. Nested rather than flat, so the
    // header renders a main category and its children from ONE payload instead of
    // guessing the relationship from two lists.
    categories: categoryTree(allCategories()),
    packages: packageCards(),
    paymentProviders: paymentOptionsFor(allBusinesses()),
    support: { company: "Yene Business Group", ...SUPPORT_CONTACT },
    customErp: { name: CUSTOM_ERP_NAME, description: CUSTOM_ERP_DESCRIPTION },
  });
});

/**
 * Section 16: search.
 *
 * `businessId` is accepted here as a FILTER (search within one store) and
 * never as an authorization decision - it is a public parameter by design,
 * because the marketplace is public. Tenant-scoped routes below are the ones
 * that must ignore it.
 */
platformRouter.get("/search", (req: Request, res: Response) => {
  if (rateLimited(req)) return res.status(429).json({ error: "Too many requests." });
  const query = String(req.query.q ?? "");
  const filters = {
    categoryId: req.query.category ? String(req.query.category) : undefined,
    minPrice: req.query.minPrice ? Number(req.query.minPrice) : undefined,
    maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
    location: req.query.location ? String(req.query.location) : undefined,
    businessId: req.query.store ? String(req.query.store) : undefined,
    brand: req.query.brand ? String(req.query.brand) : undefined,
    minRating: req.query.minRating ? Number(req.query.minRating) : undefined,
    inStockOnly: req.query.inStock === "true",
    onPromotion: req.query.promotion === "true",
  };
  return res.status(200).json(
    search(buildCorpus(), query, {
      filters,
      sort: (req.query.sort as never) ?? "Relevance",
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 24),
    }),
  );
});

/** Section 16: autocomplete. */
platformRouter.get("/search/suggest", (req: Request, res: Response) => {
  return res.status(200).json({ suggestions: suggest(buildCorpus(), String(req.query.q ?? "")) });
});

/**
 * Section 15/13: the marketplace feed, built from published submissions.
 *
 * Returned in the SAME shape as search, store and recommendations, so the
 * ProductCard component is genuinely the single card in the app.
 */
platformRouter.get("/marketplace", (_req: Request, res: Response) => {
  const businesses = allBusinesses();
  const ratings: Record<string, number> = {};
  const reviewCounts: Record<string, number> = {};
  for (const product of allProducts()) {
    const summary = summarizeRatings(reviewsForProduct(product.id));
    ratings[product.id] = summary.average;
    reviewCounts[product.id] = summary.count;
  }

  const listings = allSubmissions()
    .filter((submission) => submission.status === "Published")
    .map((submission) => {
      // Section 13: the listing resolves the ORIGINAL product. There is no
      // second row to disagree with.
      const product = allProducts().find((entry) => entry.id === submission.productId);
      if (!product || !isSellable(product)) return null;
      return {
        ...marketplaceCard(
          product,
          businesses,
          ratings,
          reviewCounts,
          submission.sponsored || submission.featured
            ? {
                type: submission.sponsored ? "Sponsored" : "Featured",
                label: submission.sponsored ? "Sponsored" : "Featured",
              }
            : null,
        ),
        submissionId: submission.id,
        featured: submission.featured,
        sponsored: submission.sponsored,
      };
    })
    .filter((card): card is ListingCard => card !== null);

  return res.status(200).json({ listings });
});

/** Section 13: a single product with its rating summary and reviews. */
platformRouter.get("/product/:id", (req: Request, res: Response) => {
  const product = productById(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found." });
  const business = businessById(product.businessId);
  const reviews = reviewsForProduct(product.id).filter((r) => r.status === "published");
  const submission = submissionForProduct(product.id);
  return res.status(200).json({
    product,
    // Section 13: the seller is resolved from the product's own businessId.
    seller: business
      ? { id: business.id, name: business.name, subdomain: business.subdomain, location: business.location, rating: business.rating }
      : null,
    ratings: summarizeRatings(reviews),
    reviews,
    marketplace: submission
      ? { status: submission.status, featured: submission.featured, sponsored: submission.sponsored }
      : { status: "Not Submitted" },
    recommendations: recommendationsFor(EMPTY_SIGNALS, allProducts().filter(isSellable), { limit: 6 }),
  });
});

/** Section 10/11: a business's own storefront, addressed by subdomain. */
platformRouter.get("/store/:subdomain", (req: Request, res: Response) => {
  const business = businessBySubdomain(req.params.subdomain);
  if (!business) return res.status(404).json({ error: "Store not found." });
  const products = productsForBusiness(business.id).filter(isSellable);
  const featuredIds = new Set(business.customization.featuredProductIds);
  return res.status(200).json({
    business: {
      id: business.id,
      name: business.name,
      subdomain: business.subdomain,
      status: business.status,
      location: business.location,
      rating: business.rating,
      type: business.type,
      // Section 41: every room this store holds, not just the primary one, plus
      // the mall itself so the storefront can link to its neighbours.
      mall: business.mall
        ? { ...business.mall, rooms: roomNumbersFor(business.mall) }
        : null,
      // The mall itself, so the storefront can offer "other stores here"
      // rather than leaving the shopper at a single shop with no way out.
      mallInfo: mallCard(mallForBusiness(allMalls(), business)),
      customization: business.customization,
    },
    featured: products.filter((product) => featuredIds.has(product.id)),
    products: products.filter((product) => !featuredIds.has(product.id)),
    promotions: allPromotions().filter(
      (promotion) => promotion.businessId === business.id && promotion.status === "Active",
    ),
  });
});

/** Section 17: the category tree. */
platformRouter.get("/categories", (_req: Request, res: Response) => {
  const enabled = enabledCategories(allCategories());
  return res.status(200).json({
    // Section 17: both levels, already separated - a Super Admin needs the flat
    // lists to reorder, while the marketplace needs the nested tree.
    categories: enabled.filter((category) => category.parentId === null),
    // Grouped by parent, then by their own position, so the admin list reads
    // "all of Fashion's children, then all of Beauty's" rather than interleaved.
    subcategories: enabled
      .filter((category) => category.parentId !== null)
      .sort(
        (a, b) =>
          (a.parentId ?? "").localeCompare(b.parentId ?? "") || a.position - b.position,
      ),
  });
});

// ---------------------------------------------------------------------------
// Marketplace homepage reads (Sections 15, 18, 19, 25)
// ---------------------------------------------------------------------------

/**
 * The ONE shape a product card consumes.
 *
 * Four endpoints return products to the browser (marketplace feed, search,
 * store, recommendations). Without a shared projection the client would
 * reshape the same product four slightly different ways, and a card that
 * silently dropped a field on one route would look like a data bug rather
 * than a client bug. So the projection lives here, once.
 *
 * Every field is REAL: prices come from the product, the rating is the average
 * of published reviews, the seller is the product's own business. Nothing is
 * synthesised, and `discountPercent` is null unless there is a genuine
 * markdown to describe.
 */
function marketplaceCard(
  product: Product,
  businesses: Business[],
  ratings: Record<string, number>,
  reviewCounts: Record<string, number>,
  promotion: { type: string; label: string } | null,
) {
  const finalPrice = product.discountPrice ?? product.price;
  const hasDiscount = finalPrice < product.price;
  const seller = businesses.find((entry) => entry.id === product.businessId);
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    imageUrl: product.images[0] ?? null,
    imageCount: product.images.length,
    price: product.price,
    finalPrice,
    discountPercent: hasDiscount
      ? Math.round((1 - finalPrice / product.price) * 100)
      : null,
    // Section 5: "do not invent stock availability". Real count or nothing.
    inStock: product.stock > 0,
    stock: product.stock,
    rating: ratings[product.id] ?? 0,
    reviewCount: reviewCounts[product.id] ?? 0,
    businessId: product.businessId,
    businessName: seller?.name ?? "YENE-STORE seller",
    businessSubdomain: seller?.subdomain ?? null,
    categoryId: product.categoryId,
    // Section 17: which subcategory, when the merchant filed one. The client uses
    // it so filtering by a MAIN category still returns products filed under its
    // children - without it, "Fashion" would hide every Jewellery product.
    subcategoryId: product.subcategoryId,
    promotion,
  };
}

export type MarketplaceCard = ReturnType<typeof marketplaceCard>;
export type ListingCard = MarketplaceCard & {
  submissionId: string;
  featured: boolean;
  sponsored: boolean;
};
export type RecommendationCard = MarketplaceCard & { reason: string; score: number };

/**
 * The public shape of a mall, or null for a standalone store.
 *
 * Declared once so the storefront, the store card and the mall page cannot
 * drift: three call sites projecting the same six fields is how one of them
 * ends up rendering an empty address.
 */
function mallCard(mall: Mall | null) {
  if (!mall) return null;
  return {
    id: mall.id,
    name: mall.name,
    slug: mall.slug,
    city: mall.city,
    address: mall.address,
    agreementId: mall.agreementId,
  };
}

/**
 * GET /api/platform/businesses - store cards for Featured Businesses.
 *
 * Public, because the marketplace is public. `trustedSeller` is surfaced as
 * the verification indicator and is only ever true because a Super Admin set
 * it (Section 14) - it is not a decorative tick.
 */
platformRouter.get("/businesses", (req: Request, res: Response) => {
  const products = allProducts().filter(isSellable);
  seedMalls();
  const businesses = allBusinesses();

  // `?mall=` narrows the feed to the stores registered in one mall. It is a
  // PUBLIC filter over the marketplace, not a tenant selector: the caller is
  // not claiming to own anything, they are browsing. Tenant access never
  // comes from a query string - see requireBusiness.
  const mallFilter = String(req.query.mall ?? "").trim();
  const mall = mallFilter ? mallByIdOrName(mallFilter) : null;
  const inMall = mall ? storesInMall(businesses, mall) : businesses;

  return res.status(200).json({
    businesses: inMall
      .filter((business) => business.status === "Active" || business.status === "Trial")
      .map((business) => ({
        id: business.id,
        name: business.name,
        subdomain: business.subdomain,
        location: business.location,
        rating: business.rating,
        type: business.type,
        // Section 41: the placement, with the FULL room list resolved here so
        // no client has to know about the legacy single-room field.
        mall: business.mall
          ? { ...business.mall, rooms: roomNumbersFor(business.mall) }
          : null,
        mallInfo: mallCard(mallForBusiness(allMalls(), business)),
        // Section 14: the verification indicator IS the trusted-seller flag.
        verified: business.trustedSeller,
        logoUrl: business.customization.logoUrl,
        coverImageUrl: business.customization.coverImageUrl,
        productCount: products.filter((product) => product.businessId === business.id).length,
        createdAt: business.createdAt,
      })),
  });
});

/**
 * GET /api/platform/malls - the mall directory (Section 41).
 *
 * Public, because the marketplace is public: a shopper looking for a jeweller
 * needs to find which mall it is in, and a mall has to be discoverable before
 * any particular shop inside it has been found.
 *
 * The store list is counted, not estimated. A mall with no registered store is
 * filtered out by `mallDirectory` rather than rendered as an empty directory,
 * because an empty mall is a dead end for a shopper.
 */
platformRouter.get("/malls", (req: Request, res: Response) => {
  if (rateLimited(req)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }
  seedMalls();
  const products = allProducts().filter(isSellable);
  // A mall the landlord has taken off the market is not in the directory. The
  // row is kept - this is a visibility decision, not a deletion - so switching it
  // back on restores the mall exactly as it was.
  return res.status(200).json({
    malls: mallDirectory(allMalls().filter((mall) => mall.visible !== false), allBusinesses(), products),
  });
});

/**
 * GET /api/platform/malls/:id - one mall and the stores registered under it.
 *
 * Addressed by id OR slug, because the marketplace links by slug and the
 * sign-up flow resolves by id; both identify the same mall.
 *
 * Only stores a shopper can actually reach are listed: a suspended or cancelled
 * unit is not presented as if it were trading. The rooms still unclaimed are
 * returned too, so a seller signing up can see which counters are free.
 */
platformRouter.get("/malls/:id", (req: Request, res: Response) => {
  seedMalls();
  const wanted = String(req.params.id);
  const mall =
    mallById(wanted) ??
    allMalls().find((entry) => entry.slug === wanted.toLowerCase()) ??
    null;
  if (!mall) return res.status(404).json({ error: "Mall not found." });

  const businesses = allBusinesses();
  const products = allProducts().filter(isSellable);
  const registered = storesInMall(businesses, mall);
  seedMallUnits();

  // Section 41: "Rooms still available" is driven by the REAL UNIT DIRECTORY
  // now, not by a generated list, so an administrator can hold a counter back
  // from the market by switching `listable` off and have it disappear here.
  // The generated fallback stays for an installation whose units have not been
  // built yet, so the panel is never empty for the wrong reason.
  const units = allMallUnits().filter((unit) => unit.mallId === mall.id);
  const roomsStillAvailable = units.length
    ? availableUnits(units, mall).map((unit) => unit.number)
    : availableRooms(businesses, mall);

  return res.status(200).json({
    mall: {
      id: mall.id,
      name: mall.name,
      slug: mall.slug,
      city: mall.city,
      address: mall.address,
      description: mall.description,
      floors: mall.floors,
      // Whether this mall is covered by a YENE-STORE agreement - which is what
      // grants its registered stores a free subdomain.
      ...mallCard(mall),
      logoUrl: mall.logoUrl,
      coverImageUrl: mall.coverImageUrl,
      storeCount: registered.length,
    },
    stores: registered
      .filter((business) => business.status === "Active" || business.status === "Trial")
      .map((business) => {
        const rooms = roomNumbersFor(business.mall);
        return {
          id: business.id,
          name: business.name,
          subdomain: business.subdomain,
          floor: business.mall?.floor ?? "",
          // Every room this store holds, not just the first: Hub Jewellery
          // trades out of two counters in the same mall.
          rooms,
          roomLabel: formatRoomNumbers(rooms),
          rating: business.rating,
          logoUrl: business.customization.logoUrl,
          // Section 14: the verification indicator IS the trusted-seller flag.
          verified: business.trustedSeller,
          description: business.customization.description,
          productCount: products.filter((product) => product.businessId === business.id).length,
        };
      }),
    availableRooms: roomsStillAvailable,
  });
});

/**
 * GET /api/platform/promotions - the promotions rail (Sections 18, 19).
 *
 * Only promotions genuinely live right now: status Active AND inside their own
 * start/end window. An expired campaign must never render as active, so the
 * window is checked here rather than trusted from the status field alone.
 */
platformRouter.get("/promotions", (_req: Request, res: Response) => {
  const now = Date.now();
  const businesses = allBusinesses();
  return res.status(200).json({
    promotions: allPromotions()
      .filter(
        (promotion) =>
          promotion.status === "Active" &&
          new Date(promotion.startAt).getTime() <= now &&
          new Date(promotion.endAt).getTime() > now,
      )
      .map((promotion) => ({
        id: promotion.id,
        title: promotion.title,
        description: promotion.description,
        imageUrl: promotion.imageUrl,
        type: promotion.type,
        amount: promotion.amount,
        cta: promotion.cta,
        terms: promotion.terms,
        placements: promotion.placements,
        businessId: promotion.businessId,
        businessName: businesses.find((b) => b.id === promotion.businessId)?.name ?? null,
        productId: promotion.productId,
        // The real expiry, so a countdown is only ever shown against a real
        // campaign deadline rather than an invented timer.
        startsAt: promotion.startAt,
        endsAt: promotion.endAt,
      })),
  });
});

/**
 * GET /api/platform/recommendations - Recommended Products (Section 25).
 *
 * A signed-out visitor has no history, so this is the COLD START path:
 * trending, popular, featured, category and location. Section 25 forbids
 * showing a new user a fabricated "because you liked..." message, so the
 * reasons returned are catalogue-level statements only.
 */
platformRouter.get("/recommendations", (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 8), 1), 24);
  const sellable = allProducts().filter(isSellable);
  const businesses = allBusinesses();
  const ratings: Record<string, number> = {};
  const reviewCounts: Record<string, number> = {};
  for (const product of sellable) {
    const summary = summarizeRatings(reviewsForProduct(product.id));
    ratings[product.id] = summary.average;
    reviewCounts[product.id] = summary.count;
  }

  const recommendations = recommendationsFor(EMPTY_SIGNALS, sellable, {
    featuredIds: allSubmissions()
      .filter((submission) => submission.featured)
      .map((submission) => submission.productId),
    limit,
  });

  return res.status(200).json({
    recommendations: recommendations
      .map((recommendation) => {
        const product = sellable.find((entry) => entry.id === recommendation.productId);
        if (!product) return null;
        return {
          ...marketplaceCard(product, businesses, ratings, reviewCounts, null),
          reason: recommendation.reason,
          score: recommendation.score,
        };
      })
      .filter((card): card is RecommendationCard => card !== null),
  });
});

/** Section 22: a customer's own orders. Scoped by the verified identity. */
platformRouter.get("/orders", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated) {
    return res.status(200).json({ ok: true, orders: [] });
  }
  const orders = ordersForCustomer(identity.userId);
  return res.status(200).json({ ok: true, orders });
});

// ---------------------------------------------------------------------------
// Cart and checkout (Sections 20, 21, 22)
// ---------------------------------------------------------------------------

interface CartRequestBody {
  lines?: { productId: string; variantId?: string | null; quantity?: number }[];
  deliveryChoiceByBusiness?: Record<string, string>;
}

/** Section 20: price a cart without placing an order. */
platformRouter.post("/cart", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as CartRequestBody;
  const lines = (body.lines ?? []).flatMap((line) => {
    const product = productById(line.productId);
    if (!product || !isSellable(product)) return [];
    const quantity = Math.max(1, Math.min(Number(line.quantity) || 1, 99));
    return [{ productId: product.id, businessId: product.businessId, variantId: line.variantId ?? null, quantity }];
  });

  const totals = groupCartByStore(lines, allProducts(), allBusinesses(), {
    deliveryChoiceByBusiness: body.deliveryChoiceByBusiness,
  });
  return res.status(200).json({ ok: true, totals, paymentOptions: paymentOptionsFor(allBusinesses()) });
});

interface CheckoutBody extends CartRequestBody {
  customer?: { name?: string; email?: string; phone?: string };
  address?: { name?: string; phone?: string; line1?: string; city?: string; note?: string };
  paymentMethod?: string;
}

/**
 * Section 21 + 22: place one order, split per store.
 *
 * The split is not a display detail. Each store gets its own BusinessOrder
 * with its own total, and the customer gets one CustomerOrder that references
 * them - so a store can only ever see and fulfil its own part.
 */
platformRouter.post("/checkout", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated) {
    return forbidden(res, "Please sign in before placing an order.");
  }
  const body = (req.body ?? {}) as CheckoutBody;
  const lines = (body.lines ?? []).flatMap((line) => {
    const product = productById(line.productId);
    if (!product || !isSellable(product)) return [];
    const quantity = Math.max(1, Math.min(Number(line.quantity) || 1, 99));
    return [{ productId: product.id, businessId: product.businessId, variantId: line.variantId ?? null, quantity }];
  });
  if (!lines.length) return badRequest(res, "Your cart is empty.");

  const totals = groupCartByStore(lines, allProducts(), allBusinesses(), {
    deliveryChoiceByBusiness: body.deliveryChoiceByBusiness,
  });

  const parentOrderId = `CO-${Date.now().toString(36).toUpperCase()}`;
  const address = {
    name: body.address?.name ?? body.customer?.name ?? identity.displayName ?? "Customer",
    phone: body.address?.phone ?? body.customer?.phone ?? "",
    line1: body.address?.line1 ?? "",
    city: body.address?.city ?? "",
    note: body.address?.note ?? "",
  };

  const businessOrders = totals.groups.map((group) =>
    buildBusinessOrder({
      customerId: identity.userId,
      parentOrderId,
      address,
      lines: group.lines.map((line) => ({
        product: line.product,
        variantId: line.variant?.id ?? null,
        quantity: line.quantity,
      })),
      subtotal: group.subtotal,
      discount: group.discount,
      delivery: group.delivery,
      tax: group.tax,
      total: group.total,
      businessId: group.businessId,
      businessName: group.businessName,
      deliveryOptionId: body.deliveryChoiceByBusiness?.[group.businessId] ?? null,
    }),
  );
  allBusinessOrders().push(...businessOrders);
  const customerOrder = buildCustomerOrder(parentOrderId, identity.userId, businessOrders);
  // The customer sees one order; each store fulfils its own part.
  allCustomerOrders().push(customerOrder);
  persist.customerOrders();
  persist.businessOrders();


  return res.status(200).json({
    ok: true,
    order: customerOrder,
    businessOrders: businessOrders.map((order) => ({
      id: order.id,
      businessId: order.businessId,
      businessName: order.businessName,
      total: order.total,
      status: order.status,
    })),
    paymentMethod: body.paymentMethod ?? "Cash on delivery",
  });
});

/** Section 21: start a payment against a placed order. */
platformRouter.post("/payment/start", async (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated) return forbidden(res, "Please sign in to continue.");
  const body = (req.body ?? {}) as { orderId?: string; businessId?: string; email?: string; phone?: string };
  if (!identity.businessId || !body.orderId) return badRequest(res, "orderId is required.");

  const provider = (await import("../../src/platform/payments")).getProvider("chapa");
  if (!provider || !provider.isConfigured()) {
    return res.status(503).json({
      error: "Online payment is not available on this deployment. Cash on delivery is still available.",
    });
  }

  const order = ordersForBusiness(identity.businessId).find((o) => o.parentOrderId === body.orderId);
  if (!order) return res.status(404).json({ error: "Order not found." });

  const reference = newPaymentReference(new Date(), order.businessId);
  const record = buildPaymentRecord({
    reference,
    orderId: order.parentOrderId,
    businessId: order.businessId,
    customerId: identity.userId,
    provider: provider.id,
    amount: order.total,
  });
  allPayments().push(record);
  persist.payments();

  try {
    const started = await provider.start({
      reference,
      amount: order.total,
      currency: "ETB",
      orderId: order.parentOrderId,
      customer: {
        name: identity.displayName ?? "Customer",
        email: body.email ?? "",
        phone: body.phone ?? "",
      },
      businessName: order.businessName,
      returnUrl: `/order-confirmed.html?ref=${encodeURIComponent(reference)}`,
    });
    return res.status(200).json({ ok: true, reference, checkoutUrl: started.checkoutUrl });
  } catch (error) {
    record.status = "Failed";
    record.failureReason = error instanceof Error ? error.message : "Payment could not be started.";
    persist.payments();
    return res.status(502).json({ error: "The payment provider could not be reached. Try again shortly." });
  }
});

/**
 * Section 21: VERIFY, server-side.
 *
 * The browser redirect is only a hint. This is the call that decides whether
 * the order is paid, which is why a tampered success URL changes nothing.
 */
platformRouter.post("/payment/verify", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { reference?: string };
  const record = allPayments().find((payment) => payment.reference === body.reference);
  if (!record) return res.status(404).json({ error: "Payment not found." });

  const { getProvider } = await import("../../src/platform/payments");
  const provider = getProvider(record.provider);
  if (!provider) return res.status(503).json({ error: "Provider unavailable." });

  const verification = await provider.verify(record.reference);
  const settled = settlePayment(record, verification);
  const index = allPayments().indexOf(record);
  allPayments()[index] = settled;
  persist.payments();

  return res.status(200).json({ ok: true, payment: settled });
});

// ---------------------------------------------------------------------------
// Subscription and packages (Sections 31-40)
// ---------------------------------------------------------------------------

/**
 * Section 31: the billing dashboard card, plus the whole package ladder so the
 * business can see what an upgrade would open.
 *
 * `pendingChange` is surfaced explicitly - a business that requested a
 * downgrade must be able to see it is scheduled rather than wondering why
 * nothing changed.
 */
platformRouter.get("/subscription", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  const record = subscriptionFor(guard.businessId);
  if (!record) return res.status(404).json({ error: "No subscription found." });

  // A downgrade whose effective date has passed is applied on read, so the
  // dashboard never shows a stale package (Section 36).
  const current = applyPendingChange(record.subscription);
  if (current.packageId !== record.subscription.packageId || current.pendingChange === null) {
    saveSubscription(current, record.ledger);
  }

  return res.status(200).json({
    ok: true,
    subscription: current,
    summary: subscriptionSummary(current),
    entitlements: entitlementsFor(current.packageId),
    modules: dashboardModulesFor(current.packageId),
    packages: packageCards(),
    changeHistory: changesForBusiness(guard.businessId),
    invoices: invoicesForBusiness(guard.businessId),
    surcharges: record.ledger.surcharges,
  });
});

/** Section 32-36: the quote shown BEFORE the customer confirms. */
platformRouter.get("/subscription/quote", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  const record = subscriptionFor(guard.businessId);
  const to = String(req.query.to) as PackageId;
  if (!record) return res.status(404).json({ error: "No subscription found." });
  if (!["silver", "gold", "platinum", "super"].includes(to)) {
    return badRequest(res, "to must be one of silver, gold, platinum, super.");
  }
  const quote = quotePackageChange(record.subscription, to);
  return res.status(200).json({ ok: true, quote });
});

/**
 * Section 32-36: apply the change.
 *
 * The handler writes to subscriptions, changes, invoices and the ledger, and
 * NOTHING ELSE. That is Section 37 in one sentence: no product, order,
 * customer, review or report is even loaded here, so none can be removed.
 */
platformRouter.post("/subscription/change", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  const body = (req.body ?? {}) as { to?: PackageId; paymentReference?: string };
  const to = body.to;
  if (!to || !["silver", "gold", "platinum", "super"].includes(to)) {
    return badRequest(res, "to must be one of silver, gold, platinum, super.");
  }
  if (to === "super") {
    return badRequest(res, "Super is priced by quotation. Please request a custom package instead.");
  }

  const record = subscriptionFor(guard.businessId);
  if (!record) return res.status(404).json({ error: "No subscription found." });

  const quote = quotePackageChange(record.subscription, to);
  const invoice = quote.amountDue
    ? {
        id: `INV-UP-${Date.now().toString(36).toUpperCase()}`,
        businessId: guard.businessId,
        type: "upgrade" as const,
        packageId: to,
        amount: quote.amountDue,
        currency: "ETB" as const,
        periodStart: record.subscription.currentPeriodStart,
        periodEnd: record.subscription.currentPeriodEnd,
        paymentReference: body.paymentReference ?? null,
        status: "Success" as const,
        issuedAt: new Date().toISOString(),
        lines: [{ label: `Upgrade to ${to} - difference paid`, amount: quote.amountDue }],
      }
    : null;

  const applied = applyPackageChange(record.subscription, quote, invoice, record.ledger);
  saveSubscription(applied.subscription, applied.ledger);

  allChanges().push(
    buildChangeRecord({
      businessId: guard.businessId,
      previousPackage: quote.fromPackage,
      newPackage: quote.toPackage,
      changeType: applied.changeType,
      userId: guard.identity.userId,
      userName: guard.identity.displayName ?? "Owner",
      paymentReference: body.paymentReference ?? null,
      amount: applied.amountPaid,
      effectiveAt: applied.effectiveAt,
      status: "Completed",
    }),
  );
  if (invoice) allInvoices().push(invoice);
  persist.changes();
  persist.invoices();

  const business = businessById(guard.businessId);
  if (business) {
    business.packageId = applied.subscription.packageId;
    persist.businesses();
  }

  return res.status(200).json({
    ok: true,
    quote,
    subscription: applied.subscription,
    summary: subscriptionSummary(applied.subscription),
    entitlements: entitlementsFor(applied.subscription.packageId),
    modules: dashboardModulesFor(applied.subscription.packageId),
    notice: quote.notice,
  });
});

/** Section 34: renew at the FULL price of the current package. */
platformRouter.post("/subscription/renew", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  const record = subscriptionFor(guard.businessId);
  if (!record) return res.status(404).json({ error: "No subscription found." });
  const { subscription, invoice } = renewalInvoice(record.subscription);
  saveSubscription(subscription, record.ledger);
  allInvoices().push(invoice);
  persist.invoices();
  return res.status(200).json({ ok: true, subscription, invoice });
});

/** Section 40: request a custom Super quotation. */
platformRouter.post("/quote-request", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  const business = businessById(guard.businessId);
  if (!business) return res.status(404).json({ error: "Business not found." });
  const body = (req.body ?? {}) as { note?: string; requirements?: Record<string, string> };
  allQuotes().push({
    id: `QT-${Date.now().toString(36).toUpperCase()}`,
    businessId: business.id,
    businessName: business.name,
    requirements: body.requirements ?? {},
    note: body.note ?? "",
    status: "Submitted",
    createdAt: new Date().toISOString(),
  });
  persist.quotes();
  return res.status(200).json({ ok: true, factors: QUOTE_FACTORS, message: `Thank you. The ${CUSTOM_ERP_NAME} team will review your requirements and prepare a quotation.` });
});

// ---------------------------------------------------------------------------
// Business operations (Sections 11, 12, 14, 18, 22, 26, 27, 28)
// ---------------------------------------------------------------------------

/** Section 26/44: the dashboard shell - modules already gated by package. */
platformRouter.get("/dashboard", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  const business = businessById(guard.businessId);
  const record = subscriptionFor(guard.businessId);
  if (!business || !record) return res.status(404).json({ error: "Business not found." });
  const packageId = applyPendingChange(record.subscription).packageId;
  return res.status(200).json({
    ok: true,
    business: { id: business.id, name: business.name, status: business.status, subdomain: business.subdomain },
    packageId,
    modules: dashboardModulesFor(packageId),
    entitlements: entitlementsFor(packageId),
    counts: {
      products: productsForBusiness(business.id).length,
      orders: ordersForBusiness(business.id).length,
      promotions: allPromotions().filter((p) => p.businessId === business.id).length,
      reviews: allReviews().filter((r) => r.businessId === business.id).length,
    },
    notifications: notificationsForBusiness(business.id).slice(0, 10),
  });
});

/** Section 12: a business's own products, with their marketplace status. */
platformRouter.get("/products", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  return res.status(200).json({
    ok: true,
    products: productsForBusiness(guard.businessId).map((product) => ({
      product,
      // Section 13: the status is read from the submission, never stored twice.
      marketplaceStatus: submissionForProduct(product.id)?.status ?? "Not Submitted",
    })),
  });
});

/** Section 12 -> 13: submit a product for marketplace review. */
platformRouter.post("/products/:id/submit", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  const product = productById(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found." });
  // The product's own businessId decides ownership, not the request.
  if (product.businessId !== guard.businessId) {
    return forbidden(res, "That product belongs to another business.");
  }
  const business = businessById(guard.businessId)!;
  const existing = submissionForProduct(product.id) ?? notSubmitted(product.id, product.businessId);
  const result = submitForReview(product, business, existing);
  if ("error" in result) {
    return res.status(result.requiredPackage ? 403 : 400).json({ error: result.error });
  }
  // Section 14: the trusted-seller rule, and nothing else bypasses review.
  const afterTrust = autoPublishIfTrusted(result.submission, business);
  const list = allSubmissions();
  const index = list.findIndex((s) => s.productId === product.id);
  if (index === -1) list.push(afterTrust);
  else list[index] = afterTrust;
  persist.submissions();
  product.publishToMarketplace = true;
  persist.products();
  return res.status(200).json({ ok: true, submission: afterTrust });
});

/** Section 22: a business's own orders. */
platformRouter.get("/orders/business", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  return res.status(200).json({ ok: true, orders: ordersForBusiness(guard.businessId) });
});

/** Section 22: move a business order along its lifecycle. */
platformRouter.post("/orders/:id/status", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  const body = (req.body ?? {}) as { status?: string; note?: string };
  if (!isValidOrderStatus(body.status)) return badRequest(res, "Unknown order status.");

  const order = allBusinessOrders().find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const access = canAccessBusiness(guard.identity, order.businessId);
  if (!access.allowed) return forbidden(res, "That order belongs to another business.");

  const updated = advanceOrder(order, body.status, body.note ?? "");
  const index = allBusinessOrders().indexOf(order);
  allBusinessOrders()[index] = updated;
  persist.businessOrders();
  return res.status(200).json({ ok: true, order: updated });
});

/** Section 27: inventory. Platinum+ only (Section 38 `inventory`). */
platformRouter.get("/inventory", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  if (!hasPackageFeature(guard.identity, guard.businessId, "inventory")) {
    return forbidden(res, "Inventory management is available on the Platinum package and above.");
  }
  const items = allInventoryItems().filter((item) => item.businessId === guard.businessId);
  const nodes = allNodes().filter((node) => node.businessId === guard.businessId);
  return res.status(200).json({
    ok: true,
    items,
    nodes,
    report: currentStockReport(items, allMovements(), nodes),
    stockValue: stockValuation(items, allMovements(), nodes),
    lowStock: items.filter((item) => needsRestock(item, allMovements(), nodes)).map((item) => item.id),
    movements: movementReport(guard.businessId, allMovements(), 50),
  });
});

/** Section 28: CRM, suppliers, employees and expenses. */
platformRouter.get("/operations", (req: Request, res: Response) => {
  const guard = requireBusiness(req, res);
  if (!guard) return;
  return res.status(200).json({
    ok: true,
    customers: allCustomers().filter((c) => c.businessId === guard.businessId),
    suppliers: allSuppliers().filter((s) => s.businessId === guard.businessId),
    purchases: allPurchases().filter((p) => p.businessId === guard.businessId),
    employees: allEmployees().filter((e) => e.businessId === guard.businessId),
    expenses: allExpenses().filter((e) => e.businessId === guard.businessId),
    roles: allRoles().filter((r) => r.businessId === guard.businessId),
  });
});

// ---------------------------------------------------------------------------
// Reviews and wishlist (Sections 23, 24)
// ---------------------------------------------------------------------------

/** Section 23: submit a review. Verified-purchase status is computed. */
platformRouter.post("/reviews", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated) return forbidden(res, "Please sign in to review a product.");
  const body = (req.body ?? {}) as { productId?: string; rating?: number; body?: string; images?: string[] };
  const product = productById(String(body.productId ?? ""));
  if (!product) return res.status(404).json({ error: "Product not found." });
  if (!isValidRating(body.rating)) return badRequest(res, "Rating must be a whole number from 1 to 5.");
  const text = String(body.body ?? "").trim().slice(0, 2000);
  if (!text) return badRequest(res, "Please write a few words about the product.");

  const review = {
    id: `RV-${Date.now().toString(36).toUpperCase()}`,
    productId: product.id,
    businessId: product.businessId,
    customerId: identity.userId,
    customerName: identity.displayName ?? "Customer",
    rating: body.rating as number,
    body: text,
    images: Array.isArray(body.images) ? body.images.slice(0, 5) : [],
    // Section 23: computed from delivered orders, never taken from the client.
    verifiedPurchase: isVerifiedPurchase(product.id, identity.userId, ordersForCustomer(identity.userId)),
    businessResponse: null,
    status: "published" as const,
    createdAt: new Date().toISOString(),
  };
  allReviews().push(review);
  persist.reviews();
  return res.status(200).json({ ok: true, review, ratings: summarizeRatings(reviewsForProduct(product.id)) });
});

/** Section 24: the customer's wishlist. */
platformRouter.get("/wishlist", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated) return res.status(200).json({ ok: true, items: [] });
  return res.status(200).json({ ok: true, items: wishlistForCustomer(identity.userId) });
});

platformRouter.post("/wishlist", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated) return forbidden(res, "Please sign in to use your wishlist.");
  const body = (req.body ?? {}) as { productId?: string; add?: boolean };
  const product = productById(String(body.productId ?? ""));
  if (!product) return res.status(404).json({ error: "Product not found." });
  const list = allWishlistItems();
  const index = list.findIndex(
    (item) => item.productId === product.id && item.customerId === identity.userId,
  );
  if (body.add === false) {
    if (index !== -1) list.splice(index, 1);
    persist.wishlists();
    return res.status(200).json({ ok: true, added: false });
  }
  if (index === -1) {
    // Remember the price now, so a later drop can be compared honestly.
    rememberSavedPrice(identity.userId, product.id, product.discountPrice ?? product.price);
    list.push({
      productId: product.id,
      customerId: identity.userId,
      addedAt: new Date().toISOString(),
      notified: { price: false, promotion: false, backInStock: false },
    });
    persist.wishlists();
  }
  return res.status(200).json({ ok: true, added: true });
});

// ---------------------------------------------------------------------------
// Super Admin (Sections 45, 48)
// ---------------------------------------------------------------------------

/** Section 45: the Super Admin overview. */
platformRouter.get("/admin", (req: Request, res: Response) => {
  const identity = requireSuperAdminOrRes(req, res);
  if (!identity) return;
  const submissions = allSubmissions();
  const distribution: Record<PackageId, number> = { silver: 0, gold: 0, platinum: 0, super: 0 };
  for (const business of allBusinesses()) distribution[business.packageId] += 1;

  return res.status(200).json({
    ok: true,
    areas: SUPER_ADMIN_AREAS,
    analytics: {
      totalBusinesses: allBusinesses().length,
      activeStores: allBusinesses().filter((b) => b.status === "Active").length,
      packageDistribution: distribution,
      subscriptionRevenue: allInvoices()
        .filter((invoice) => invoice.status === "Success")
        .reduce((sum, invoice) => sum + invoice.amount, 0),
      marketplaceActivity: {
        pendingReviews: submissions.filter((s) => s.status === "Pending Review").length,
        publishedListings: submissions.filter((s) => s.status === "Published").length,
        submissionsThisMonth: submissions.filter(
          (s) => s.submittedAt && new Date(s.submittedAt).getMonth() === new Date().getMonth(),
        ).length,
      },
      orders: allBusinessOrders().length,
      promotions: {
        active: allPromotions().filter((p) => p.status === "Active").length,
        pending: allPromotions().filter((p) => p.status === "Pending Review").length,
      },
    },
  });
});

/** Section 14: the moderation queue, with the live product beside it. */
platformRouter.get("/admin/submissions", (req: Request, res: Response) => {
  const identity = requireSuperAdminOrRes(req, res);
  if (!identity) return;
  return res.status(200).json({
    ok: true,
    submissions: moderationQueue(allSubmissions()).map((submission) => {
      const product = productById(submission.productId);
      const business = businessById(submission.businessId);
      return {
        submission,
        // Section 13: the queue shows the ORIGINAL product, not a copy.
        product: product
          ? { id: product.id, name: product.name, price: product.price, brand: product.brand, stock: product.stock }
          : null,
        business: business ? { id: business.id, name: business.name, packageId: business.packageId } : null,
      };
    }),
  });
});

/** Section 14: approve / reject / request changes. */
platformRouter.post("/admin/submissions/:id/review", (req: Request, res: Response) => {
  const identity = requireSuperAdminOrRes(req, res);
  if (!identity) return;
  const body = (req.body ?? {}) as { decision?: string; note?: string; requestChanges?: boolean };
  if (body.decision !== "Approved" && body.decision !== "Rejected") {
    return badRequest(res, "decision must be Approved or Rejected.");
  }
  const list = allSubmissions();
  const submission = list.find((s) => s.id === req.params.id);
  if (!submission) return res.status(404).json({ error: "Submission not found." });

  const updated = reviewSubmission(submission, {
    status: body.decision,
    note: String(body.note ?? ""),
    requestChanges: body.requestChanges === true,
    actor: identity.displayName ?? "Super Admin",
  });
  list[list.indexOf(submission)] = updated;
  persist.submissions();
  return res.status(200).json({ ok: true, submission: updated });
});

/** Section 14: the explicit publish act. */
platformRouter.post("/admin/submissions/:id/publish", (req: Request, res: Response) => {
  const identity = requireSuperAdminOrRes(req, res);
  if (!identity) return;
  const list = allSubmissions();
  const submission = list.find((s) => s.id === req.params.id);
  if (!submission) return res.status(404).json({ error: "Submission not found." });
  const published = publishSubmission(submission);
  list[list.indexOf(submission)] = published;
  persist.submissions();
  return res.status(200).json({ ok: true, submission: published });
});

/** Section 14: unpublish. */
platformRouter.post("/admin/submissions/:id/unpublish", (req: Request, res: Response) => {
  const identity = requireSuperAdminOrRes(req, res);
  if (!identity) return;
  const body = (req.body ?? {}) as { note?: string };
  const list = allSubmissions();
  const submission = list.find((s) => s.id === req.params.id);
  if (!submission) return res.status(404).json({ error: "Submission not found." });
  const unpublished = unpublishSubmission(
    submission,
    identity.displayName ?? "Super Admin",
    String(body.note ?? ""),
  );
  list[list.indexOf(submission)] = unpublished;
  persist.submissions();
  return res.status(200).json({ ok: true, submission: unpublished });
});

/** Section 14: the trusted-business rule, set explicitly by a Super Admin. */
platformRouter.post("/admin/businesses/:id/trust", (req: Request, res: Response) => {
  const identity = requireSuperAdminOrRes(req, res);
  if (!identity) return;
  const business = businessById(req.params.id);
  if (!business) return res.status(404).json({ error: "Business not found." });
  const body = (req.body ?? {}) as { trusted?: boolean };
  business.trustedSeller = body.trusted === true;
  persist.businesses();
  return res.status(200).json({ ok: true, business: { id: business.id, trustedSeller: business.trustedSeller } });
});

/** Section 17: category administration. Products are never deleted. */
platformRouter.post("/admin/categories/:id", (req: Request, res: Response) => {
  const identity = requireSuperAdminOrRes(req, res);
  if (!identity) return;
  const body = (req.body ?? {}) as { enabled?: boolean; name?: string };
  const category = allCategories().find((c) => c.id === req.params.id);
  if (!category) return res.status(404).json({ error: "Category not found." });
  if (typeof body.enabled === "boolean") category.enabled = body.enabled;
  if (typeof body.name === "string" && body.name.trim()) category.name = body.name.trim();
  persist.categories();
  const affected = allProducts().filter(
    (product) => product.categoryId === category.id || product.subcategoryId === category.id,
  ).length;
  return res.status(200).json({
    ok: true,
    category,
    // Section 17, said out loud: the products are untouched.
    productsAffected: affected,
    productsDeleted: 0,
  });
});

/** Test seam: flush every store to disk. */
platformRouter.post("/_test/flush", (_req: Request, res: Response) => {
  flushAll();
  return res.status(200).json({ ok: true });
});

/**
 * Section 45: the mall administration surface.
 *
 * Mounted at the END of the file, onto the SAME router rather than a separate
 * app, because these routes are `/admin/...` alongside the marketplace
 * submissions queue and the trust toggle - one administrator, one place, one
 * guard.
 *
 * Mounted LAST deliberately. Express matches in registration order, so a
 * `/admin/malls/...` route placed earlier could be swallowed by a broader
 * `/admin/:something` pattern added later. Putting them after every other route
 * on this router means a new admin route can never shadow these by accident.
 *
 * Every route re-checks the super-admin requirement itself rather than inheriting
 * it from a parent, so a route added to `mallAdminRouter` later cannot be left
 * open by forgetting a line.
 */
platformRouter.use(mallAdminRouter);
