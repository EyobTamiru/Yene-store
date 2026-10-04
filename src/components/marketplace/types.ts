/**
 * ============================================================================
 *  MARKETPLACE VIEW MODELS
 * ============================================================================
 *
 *  These mirror `marketplaceCard` in api/platform/router.ts EXACTLY.
 *
 *  The server owns the projection for a reason: four endpoints return
 *  products, and if the client reshaped them it would be reshaping them four
 *  times. Declaring the shape once here, matching the server, means a card
 *  that renders correctly on the marketplace feed also renders correctly in
 *  search, on a storefront, and in recommendations.
 *
 *  NOTHING INVENTED (spec §5, §15)
 *  --------------------------------
 *  There is no fabricated rating, stock count, or sales figure anywhere in
 *  these types. `rating` is 0 when a product has no published reviews, and
 *  `imageUrl` is null when the merchant has uploaded nothing - which is the
 *  case for every seeded product today, so the card renders a designed
 *  placeholder rather than a broken image or a borrowed one.
 */

export interface MarketplaceCard {
  id: string;
  name: string;
  brand: string;
  /** null when the merchant has no image. Never a substitute URL. */
  imageUrl: string | null;
  imageCount: number;
  price: number;
  finalPrice: number;
  /** null unless there is a genuine markdown. */
  discountPercent: number | null;
  inStock: boolean;
  stock: number;
  rating: number;
  reviewCount: number;
  businessId: string;
  businessName: string;
  businessSubdomain: string | null;
  categoryId: string;
  /** Section 17: null when the merchant has not filed a subcategory. */
  subcategoryId: string | null;
  promotion: { type: string; label: string } | null;
}

export type ListingCard = MarketplaceCard & {
  submissionId: string;
  featured: boolean;
  sponsored: boolean;
};

export type RecommendationCard = MarketplaceCard & { reason: string; score: number };

/**
 * Section 41: where a store sits inside its mall, as the marketplace renders it.
 *
 * `rooms` is the FULL list, resolved server-side. A store holding two counters
 * shows both: the marketplace never asks the client to re-derive the room list
 * from the legacy single-room field.
 */
export interface MallPlacementCard {
  mallId: string | null;
  mallName: string;
  floor: string;
  /** The primary room, kept for display of a single-room store. */
  roomNumber: string;
  /** Every room the store occupies, e.g. ["GFS-024", "GFS-030"]. */
  rooms: string[];
  agreementId: string | null;
}

/** Section 41: the public identity of a mall. */
export interface MallInfo {
  id: string;
  name: string;
  slug: string;
  city: string;
  address: string;
  agreementId: string | null;
}

/** A mall with the stores registered under it. */
export interface MallCard extends MallInfo {
  description: string;
  floors: string[];
  logoUrl: string | null;
  coverImageUrl: string | null;
  storeCount: number;
  productCount: number;
  stores: {
    id: string;
    name: string;
    subdomain: string;
    floor: string;
    rooms: string[];
    /** The rooms as one readable line, e.g. "GFS-024 & GFS-030". */
    roomLabel: string;
    rating: number;
    logoUrl: string | null;
    productCount: number;
  }[];
}

/** One mall page: its own detail, its stores, and its unclaimed rooms. */
export interface MallPage {
  mall: MallInfo & {
    description: string;
    floors: string[];
    logoUrl: string | null;
    coverImageUrl: string | null;
    storeCount: number;
  };
  stores: {
    id: string;
    name: string;
    subdomain: string;
    floor: string;
    rooms: string[];
    roomLabel: string;
    rating: number;
    logoUrl: string | null;
    verified: boolean;
    description: string;
    productCount: number;
  }[];
  /** Counters with nobody registered in them, for a seller signing up. */
  availableRooms: string[];
}

export interface StoreCard {
  id: string;
  name: string;
  subdomain: string;
  location: string;
  rating: number;
  type: "standalone" | "mall";
  mall: MallPlacementCard | null;
  /** Null for a standalone store; the mall it trades from otherwise. */
  mallInfo: MallInfo | null;
  /** Section 14: only true because a Super Admin set the trusted-seller flag. */
  verified: boolean;
  logoUrl: string | null;
  coverImageUrl: string | null;
  productCount: number;
  createdAt: string;
}

export interface PromotionCard {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  type: string;
  amount: number;
  cta: string;
  terms: string;
  placements: string[];
  businessId: string;
  businessName: string | null;
  productId: string | null;
  startsAt: string;
  /** Real campaign deadline. A countdown is only ever shown against this. */
  endsAt: string;
}

/**
 * Section 17: a main category with its subcategories already nested.
 *
 * `subcategories` is always present, and empty for a main category nobody has
 * added children to yet. The header renders the second row from it, so adding a
 * subcategory through the admin needs no UI change.
 */
export interface CategoryChip {
  id: string;
  name: string;
  parentId: string | null;
  /**
   * The volume shown beside the name in the nav ("Electronics 407,791 ads").
   *
   * It arrives in the same payload as the tree, so the figure beside a category
   * and the section a shopper lands on can never come from two different reads
   * of the same row. `null` means no figure is shown and the name stands alone.
   */
  listingCount: number | null;
  subcategories: { id: string; name: string }[];
}

export interface SearchHit {
  kind: "product" | "business" | "category" | "promotion";
  id: string;
  title: string;
  subtitle: string;
  price: number | null;
  score: number;
}

/** Section 51: the two languages that ship today. */
export type LanguageCode = "en" | "am";