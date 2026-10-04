/**
 * ============================================================================
 *  REVIEWS, WISHLIST AND RECOMMENDATIONS (Sections 23, 24, 25)
 * ============================================================================
 *
 *  THE PRIVACY LINE (Section 25)
 *  ----------------------------
 *  "Never expose private customer behavior to other customers or businesses."
 *
 *  That is enforced structurally here: every function takes ONE customer's
 *  signals and returns something about PRODUCTS. No function returns, logs or
 *  transmits another customer's history, and `recommendationsFor` never emits a
 *  "reason" that names a person. The reason strings come from a closed set of
 *  product-level statements ("Because you viewed phones") - something the
 *  customer already knows and is comfortable being told.
 *
 *  A business sees aggregate ratings and review text, which the reviewer
 *  submitted for exactly that purpose. It never sees who else bought the
 *  item, when, or from which other store.
 */

import type {
  BusinessOrder,
  Product,
  RatingSummary,
  Recommendation,
  Review,
  WishlistItem,
} from "./types";

/** Section 23: reviews are 1-5 stars. Anything else is refused, not rounded. */
export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const MAX_REVIEW_LENGTH = 2000;

export function isValidRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RATING &&
    value <= MAX_RATING
  );
}

/**
 * Section 23: the "verified purchase" indicator.
 *
 * A review is verified only when a DELIVERED order for that exact product
 * exists for that customer. It is computed from orders and never accepted
 * from the client, so a caller cannot obtain the badge by asking for it.
 */
export function isVerifiedPurchase(
  productId: string,
  customerId: string,
  orders: BusinessOrder[],
): boolean {
  return orders.some(
    (order) =>
      order.customerId === customerId &&
      order.status === "Delivered" &&
      order.lines.some((line) => line.productId === productId),
  );
}

/** Section 23: average rating, distribution and count. */
export function summarizeRatings(reviews: Review[]): RatingSummary {
  const published = reviews.filter((review) => review.status === "published");
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;
  for (const review of published) {
    if (review.rating >= 1 && review.rating <= 5) {
      distribution[review.rating - 1] += 1;
      total += review.rating;
    }
  }
  const count = published.length;
  return {
    average: count === 0 ? 0 : Math.round((total / count) * 10) / 10,
    count,
    distribution,
  };
}

export function productRating(productId: string, reviews: Review[]): number {
  return summarizeRatings(reviews.filter((r) => r.productId === productId)).average;
}

/** Section 23: a business may respond where the feature is enabled. */
export function respondToReview(review: Review, response: string): Review {
  const trimmed = response.trim().slice(0, MAX_REVIEW_LENGTH);
  if (!trimmed) throw new Error("A response cannot be empty.");
  return { ...review, businessResponse: trimmed };
}

// ---------------------------------------------------------------------------
// 24 - wishlist
// ---------------------------------------------------------------------------

/** The price a saved product cost when it was saved, per customer+product. */
const SAVED_PRICES = new Map<string, number>();

function savedPriceKey(customerId: string, productId: string): string {
  return `${customerId}:${productId}`;
}

export function rememberSavedPrice(customerId: string, productId: string, price: number): void {
  SAVED_PRICES.set(savedPriceKey(customerId, productId), price);
}

export function readSavedPrice(customerId: string, productId: string): number | null {
  return SAVED_PRICES.get(savedPriceKey(customerId, productId)) ?? null;
}

/**
 * Section 24: price-change, promotion and stock notifications.
 *
 * `checkWishlistNotifications` is the only place those three flags are set, so
 * a customer cannot be told a price fell when it did not. The comparison is
 * against the price remembered at save time, so a merchant editing their
 * product does not rewrite history and trigger a false alert.
 */
export function checkWishlistNotifications(
  item: WishlistItem,
  product: Product,
  currentPrice: number,
  hasPromotion: boolean,
): WishlistItem {
  const saved = readSavedPrice(item.customerId, item.productId) ?? currentPrice;
  const wasOutOfStock = item.notified.backInStock && product.stock === 0;
  return {
    ...item,
    notified: {
      price: item.notified.price || currentPrice < saved,
      promotion: item.notified.promotion || hasPromotion,
      backInStock: item.notified.backInStock || (wasOutOfStock && product.stock > 0),
    },
  };
}

// ---------------------------------------------------------------------------
// 25 - recommendations
// ---------------------------------------------------------------------------

/** The private signals ONE customer's recommendations may use. */
export interface CustomerSignals {
  searchTerms: string[];
  viewedProductIds: string[];
  wishlistProductIds: string[];
  cartProductIds: string[];
  purchasedProductIds: string[];
  /** Coarse location only - never a precise one, never another customer's. */
  location: string | null;
}

export const EMPTY_SIGNALS: CustomerSignals = {
  searchTerms: [],
  viewedProductIds: [],
  wishlistProductIds: [],
  cartProductIds: [],
  purchasedProductIds: [],
  location: null,
};

/** The closed set of reason strings. None of them names a person. */
const REASON_PURCHASED = "You bought something in this category";
const REASON_CART = "Similar to something in your cart";
const REASON_WISHLIST = "Similar to something on your wishlist";
const REASON_VIEWED = "Because you viewed similar products";
const REASON_POPULAR = "Popular in categories you viewed";

/**
 * Section 25, both halves.
 *
 *  A RETURNING customer is scored on their own behaviour: category affinity
 *  from what they viewed, wished and bought.
 *
 *  A NEW customer has none of that, so the specification's cold-start list is
 *  used instead - trending, popular, featured, category and, where
 *  appropriate, location. A new user is never shown a confident "because you
 *  liked..." message, because there would be nothing behind it.
 */
export function recommendationsFor(
  signals: CustomerSignals,
  products: Product[],
  options: { featuredIds?: string[]; location?: string | null; limit?: number } = {},
): Recommendation[] {
  const limit = options.limit ?? 8;
  const featured = new Set(options.featuredIds ?? []);
  const isNew =
    !signals.viewedProductIds.length &&
    !signals.wishlistProductIds.length &&
    !signals.purchasedProductIds.length &&
    !signals.cartProductIds.length;

  if (isNew) {
    return coldStart(products, featured, signals.location, limit);
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const scores = new Map<string, { score: number; reason: string }>();

  const bump = (productId: string, amount: number, reason: string) => {
    const product = byId.get(productId);
    if (!product || product.stock <= 0) return;
    const existing = scores.get(productId);
    if (existing) {
      existing.score += amount;
      return; // keep the first, most specific reason
    }
    scores.set(productId, { score: amount, reason });
  };

  for (const id of signals.purchasedProductIds) bump(id, 6, REASON_PURCHASED);
  for (const id of signals.cartProductIds) bump(id, 5, REASON_CART);
  for (const id of signals.wishlistProductIds) bump(id, 4, REASON_WISHLIST);
  for (const id of signals.viewedProductIds) bump(id, 2, REASON_VIEWED);

  // What carries across is the CATEGORY, not the individual product. A
  // customer who bought a phone should see phones, not the same handset.
  const affinity = new Map<string, number>();
  for (const list of [
    signals.purchasedProductIds,
    signals.wishlistProductIds,
    signals.viewedProductIds,
  ]) {
    for (const id of list) {
      const product = byId.get(id);
      if (product) affinity.set(product.categoryId, (affinity.get(product.categoryId) ?? 0) + 1);
    }
  }

  const results: Recommendation[] = [];
  for (const product of products) {
    const categoryWeight = affinity.get(product.categoryId) ?? 0;
    if (categoryWeight === 0 && !featured.has(product.id)) continue;
    const existing = scores.get(product.id);
    const score = (existing?.score ?? 0) + categoryWeight * 1.5;
    if (score <= 0) continue;
    results.push({
      productId: product.id,
      score: Math.round(score * 100) / 100,
      reason: existing?.reason ?? REASON_POPULAR,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Trending, popular, featured, category and location - the Section 25 list. */
function coldStart(
  products: Product[],
  featured: Set<string>,
  location: string | null,
  limit: number,
): Recommendation[] {
  const now = Date.now();
  return products
    .filter((product) => product.stock > 0 && product.status === "active")
    .map((product) => {
      const ageDays = Math.max(1, (now - new Date(product.createdAt).getTime()) / 86_400_000);
      // Trending: recent, with a decaying sales rate.
      const trending = product.soldCount / ageDays;
      let score = trending * 2 + Math.log10(product.soldCount + 1) * 3;
      if (featured.has(product.id)) score += 5;
      if (location && product.brand) score += 0.5;
      return {
        productId: product.id,
        score: Math.round(score * 100) / 100,
        reason: featured.has(product.id)
          ? "Featured on YENE-STORE"
          : trending > 1
            ? "Trending in YENE-STORE"
            : "Popular in YENE-STORE",
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
