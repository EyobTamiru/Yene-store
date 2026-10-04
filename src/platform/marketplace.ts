/**
 * ============================================================================
 *  PRODUCTS AND MARKETPLACE PUBLISHING (Sections 12, 13, 14, 15)
 * ============================================================================
 *
 *  THE TWO RULES THIS FILE ENFORCES
 *  --------------------------------
 *
 *  1. ONE PRODUCT, TWO PLACES (Section 13).
 *     "Do not unnecessarily duplicate the product in the database. The
 *     original business product should remain authoritative. Marketplace
 *     listing should reference the original product."
 *
 *     This is structural, not a convention. `MarketplaceSubmission` holds a
 *     `productId` and nothing else about the product - no name, no price, no
 *     image. A marketplace listing is a VIEW (`toListing`) computed from the
 *     live product, so a price edit in the store is a price edit on the
 *     marketplace. There is no second row that could disagree.
 *
 *  2. NOTHING PUBLISHES ITSELF (Section 14).
 *     "A business must not be able to bypass marketplace moderation unless an
 *     explicit trusted-business automatic publishing rule is configured."
 *
 *     `submitForReview` is the only way a submission reaches "Pending Review",
 *     and only a Super Admin can move it to "Published" - with one exception:
 *     a business a Super Admin has marked `trustedSeller`, and even then the
 *     submission is recorded with `autoPublished: true` so the bypass is
 *     visible in the audit trail rather than silent.
 */

import { hasFeature } from "./packages";
import type {
  Business,
  MarketplaceListing,
  MarketplaceStatus,
  MarketplaceSubmission,
  Product,
} from "./types";

/** Section 12: the three checkboxes, in the order the form shows them. */
export interface PublishIntent {
  publishToOwnStore: boolean;
  publishToMarketplace: boolean;
  addToPromotion: boolean;
}

/** Section 12: publishing to the main marketplace is optional, not default. */
export function defaultPublishIntent(): PublishIntent {
  return { publishToOwnStore: true, publishToMarketplace: false, addToPromotion: false };
}

// ---------------------------------------------------------------------------
// 13 - the workflow
// ---------------------------------------------------------------------------

/** The declared marketplace states, and the legal moves between them. */
export const MARKETPLACE_TRANSITIONS: Record<MarketplaceStatus, MarketplaceStatus[]> = {
  "Not Submitted": ["Pending Review"],
  "Pending Review": ["Approved", "Rejected", "Unpublished"],
  Approved: ["Published", "Unpublished"],
  Published: ["Unpublished"],
  Rejected: ["Pending Review"],
  Unpublished: ["Pending Review", "Published"],
};

export function canTransitionMarketplace(
  from: MarketplaceStatus,
  to: MarketplaceStatus,
): boolean {
  return (MARKETPLACE_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * A product that has never been submitted.
 *
 * "Not Submitted" is a real state rather than the absence of a submission, so
 * a dashboard can list every product and show which are missing from the
 * marketplace.
 */
export function notSubmitted(productId: string, businessId: string): MarketplaceSubmission {
  return {
    id: `MS-${productId}`,
    productId,
    businessId,
    status: "Not Submitted",
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    changesRequested: false,
    featured: false,
    sponsored: false,
    autoPublished: false,
  };
}

/**
 * Section 12 -> 13: a business ticks "Publish to Main YENE Marketplace".
 *
 * Requires the `marketplace` feature (Platinum and above, Section 38). A
 * Silver or Gold business gets a refusal, not a silent success - and the
 * refusal names the package, so the upsell is honest rather than a dead end.
 * Their own store is unaffected either way.
 */
export function submitForReview(
  product: Product,
  business: Business,
  existing: MarketplaceSubmission,
  now: Date = new Date(),
): { submission: MarketplaceSubmission } | { error: string; requiredPackage: string } {
  if (!hasFeature(business.packageId, "marketplace")) {
    return {
      error:
        "Publishing to the main YENE Marketplace is available on the Platinum package and above. " +
        "You can still sell this product from your own store.",
      requiredPackage: "Platinum",
    };
  }
  if (!canTransitionMarketplace(existing.status, "Pending Review")) {
    return {
      error: `A product that is "${existing.status}" cannot be submitted again.`,
      requiredPackage: "",
    };
  }
  return {
    submission: {
      ...existing,
      status: "Pending Review",
      submittedAt: now.toISOString(),
      changesRequested: false,
      reviewNote: null,
    },
  };
}

export interface ReviewDecision {
  status: Extract<MarketplaceStatus, "Approved" | "Rejected" | "Unpublished">;
  note: string;
  requestChanges: boolean;
  actor: string;
}

/**
 * Section 14: the Super Admin's decision.
 *
 * Approving does NOT publish. It produces "Approved", and publication is a
 * separate, explicit act. That gap is deliberate: an approver and a publisher
 * can be different people, and nothing is live on the marketplace because
 * somebody clicked twice.
 */
export function reviewSubmission(
  submission: MarketplaceSubmission,
  decision: ReviewDecision,
  now: Date = new Date(),
): MarketplaceSubmission {
  if (!canTransitionMarketplace(submission.status, decision.status)) {
    throw new Error(
      `Cannot move a submission from "${submission.status}" to "${decision.status}".`,
    );
  }
  return {
    ...submission,
    status: decision.status,
    reviewedAt: now.toISOString(),
    reviewedBy: decision.actor,
    reviewNote: decision.note || null,
    changesRequested: decision.requestChanges,
  };
}

/** Section 14: the explicit publish act, by a Super Admin. */
export function publishSubmission(submission: MarketplaceSubmission): MarketplaceSubmission {
  if (!canTransitionMarketplace(submission.status, "Published")) {
    throw new Error(`Cannot publish a submission that is "${submission.status}".`);
  }
  return { ...submission, status: "Published", autoPublished: false };
}

export function unpublishSubmission(
  submission: MarketplaceSubmission,
  actor: string,
  note: string,
  now: Date = new Date(),
): MarketplaceSubmission {
  if (!canTransitionMarketplace(submission.status, "Unpublished")) {
    throw new Error(`Cannot unpublish a submission that is "${submission.status}".`);
  }
  return {
    ...submission,
    status: "Unpublished",
    reviewedAt: now.toISOString(),
    reviewedBy: actor,
    reviewNote: note || null,
  };
}

/**
 * Section 14: the ONE exception, and the only place `autoPublished` is set.
 *
 * A business flagged `trustedSeller` by a Super Admin publishes on submit. The
 * submission is still recorded, still reviewable, and still carries
 * `autoPublished: true` - so "why was this live without a review?" has an
 * answer in the data.
 */
export function autoPublishIfTrusted(
  submission: MarketplaceSubmission,
  business: Business,
  now: Date = new Date(),
): MarketplaceSubmission {
  if (!business.trustedSeller) return submission;
  return {
    ...submission,
    status: "Published",
    reviewedAt: now.toISOString(),
    reviewedBy: "automatic publishing rule",
    reviewNote: "Published automatically under the trusted-business rule.",
    autoPublished: true,
  };
}

// ---------------------------------------------------------------------------
// 13 - the view
// ---------------------------------------------------------------------------

/**
 * The marketplace row, computed from the LIVE product.
 *
 * This function is the whole of Section 13's "reference the original product":
 * the listing has no state of its own beyond publication and placement, and
 * reads name, price, discount and image straight from the product row.
 */
export function toListing(
  submission: MarketplaceSubmission,
  product: Product,
  business: Business,
  rating: number,
): MarketplaceListing {
  return {
    submissionId: submission.id,
    productId: product.id,
    businessId: business.id,
    businessName: business.name,
    name: product.name,
    price: product.price,
    discountPrice: product.discountPrice,
    rating,
    imageUrl: product.images[0] ?? null,
    status: submission.status,
    featured: submission.featured,
    sponsored: submission.sponsored,
  };
}

/** The marketplace feed: published listings only. */
export function marketplaceFeed(
  submissions: MarketplaceSubmission[],
  products: Product[],
  businesses: Business[],
  ratings: Record<string, number>,
): MarketplaceListing[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const businessById = new Map(businesses.map((b) => [b.id, b]));
  return submissions
    .filter((s) => s.status === "Published")
    .map((submission) => {
      const product = productById.get(submission.productId);
      const business = businessById.get(submission.businessId);
      if (!product || !business) return null;
      return toListing(submission, product, business, ratings[product.id] ?? 0);
    })
    .filter((listing): listing is MarketplaceListing => listing !== null);
}

/** Section 14: the moderation queue, oldest first so nothing waits unseen. */
export function moderationQueue(submissions: MarketplaceSubmission[]): MarketplaceSubmission[] {
  return submissions
    .filter((s) => s.status === "Pending Review")
    .sort((a, b) => (a.submittedAt ?? "9999").localeCompare(b.submittedAt ?? "9999"));
}

/** Section 12: what a business sees on its own product list. */
export function storeListingStatus(product: Product): "Live in store" | "Draft" | "Archived" {
  if (product.status === "archived") return "Archived";
  if (product.status === "draft") return "Draft";
  return product.publishToOwnStore ? "Live in store" : "Draft";
}

export function isSellable(product: Product): boolean {
  return (
    product.status === "active" &&
    product.publishToOwnStore &&
    (product.stock > 0 || product.variants.some((variant) => variant.stock > 0))
  );
}

/**
 * A business's own storefront: its active products, in the order the merchant
 * chose. Never any other business's products, however similar the names.
 */
export function storefrontProducts(
  businessId: string,
  products: Product[],
  customization: { featuredProductIds: string[] },
): { featured: Product[]; rest: Product[] } {
  const own = products.filter(
    (product) => product.businessId === businessId && isSellable(product),
  );
  const featuredIds = new Set(customization.featuredProductIds);
  return {
    featured: own.filter((product) => featuredIds.has(product.id)),
    rest: own.filter((product) => !featuredIds.has(product.id)),
  };
}
