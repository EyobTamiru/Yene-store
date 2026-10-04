/**
 * ============================================================================
 *  SECTIONS (spec Â§4, Â§12)
 * ============================================================================
 *
 *  The spec's tree lists these as separate components. They live in one module
 *  because they are small and share the same heading, the same grid and the
 *  same card, so splitting them across nine files would make the shared logic
 *  awkward rather than cleaner. Each is still independently exported and
 *  independently reusable:
 *
 *      HeroPromotion             spec Â§4  Hero Promotion
 *      ProductSection            spec Â§12 ProductSection (reused 4x)
 *      FlashDealsSection         spec Â§4  Flash Deals
 *      FeaturedBusinessesSection spec Â§4  Featured Businesses
 *      PromotionsSection         spec Â§4  Promotions
 *      RecommendedProducts       spec Â§4  Recommended Products
 *
 *  There is EXACTLY ONE ProductCard and one grid definition, which is what
 *  spec Â§5's "keep product cards consistent across all sections" needs.
 *
 *  BREAKPOINT GRID (spec Â§7, Â§8)
 *  -----------------------------
 *    phone    2 columns - never more, never fewer
 *    tablet   3 | laptop 4 | desktop 5 | wide 6
 */

import { ArrowRight, BadgeCheck, Building2, DoorOpen, MapPin, Store as StoreIcon } from "lucide-react";
import { BRAND } from "../../constants";
import { ProductCard, TOUCH, formatEtb } from "./ProductCard";
import { AutoScrollRail } from "./AutoScrollRail";
import type { MarketplaceCard, PromotionCard, RecommendationCard, StoreCard } from "./types";

/** The single grid definition every product section uses. */
export const PRODUCT_GRID =
  "grid grid-cols-2 gap-3 tablet:grid-cols-3 laptop:grid-cols-4 desktop:grid-cols-5 wide:grid-cols-6";

/** The one section heading, so spacing and type scale cannot drift. */
export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight text-yene-text laptop:text-[18px]">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-yene-muted">{subtitle}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={`${TOUCH} inline-flex shrink-0 items-center gap-1 rounded-button px-2.5 text-[12.5px] font-medium text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          {action.label}
          <ArrowRight size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero Promotion (spec Â§4)
// ---------------------------------------------------------------------------

/**
 * Spec Â§4: large promotional banner with a headline, supporting text, a call
 * to action, a badge, and slide indicators.
 *
 * Original YENE-STORE copy (spec Â§4, Â§15). The background is drawn with CSS
 * gradients rather than a stock photograph, because a borrowed image is
 * exactly what spec Â§15 rules out. The indicators are wired to real rotating
 * messages and expose their position to a screen reader.
 */
export function HeroPromotion({
  slides,
  activeSlide,
  onSelectSlide,
  onCta,
}: {
  slides: { headline: string; body: string; cta: string; badge: string }[];
  activeSlide: number;
  onSelectSlide: (index: number) => void;
  onCta: () => void;
}) {
  const slide = slides[activeSlide] ?? slides[0];
  if (!slide) return null;

  return (
    <section
      aria-label="Featured promotions"
      aria-roledescription="carousel"
      className="relative overflow-hidden rounded-card border border-yene-line-soft bg-gradient-to-br from-yene-surface via-yene-surface to-yene-raised"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-yene-accent/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-yene-info/5 blur-3xl"
      />

      <div className="relative px-5 py-8 tablet:px-8 tablet:py-12 laptop:px-12 laptop:py-16">
        <span className="inline-flex items-center rounded-full border border-yene-accent/40 bg-yene-accent-dim px-3 py-1 text-[11px] font-semibold text-yene-accent">
          {slide.badge}
        </span>
        <h2 className="mt-3 max-w-2xl text-[22px] font-semibold leading-tight tracking-tight text-yene-text tablet:text-[30px] laptop:text-[36px]">
          {slide.headline}
        </h2>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-yene-muted tablet:text-[15px]">
          {slide.body}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onCta}
            className={`${TOUCH} rounded-button bg-yene-accent px-5 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-surface`}
          >
            {slide.cta}
          </button>
          <p className="text-[12px] text-yene-faint">
            {BRAND.company} &middot; Build. Sell. Manage. Automate. Grow.
          </p>
        </div>

        {slides.length > 1 && (
          <div className="mt-6 flex items-center gap-2" role="tablist" aria-label="Hero slides">
            {slides.map((entry, index) => (
              <button
                key={entry.headline}
                type="button"
                role="tab"
                aria-selected={index === activeSlide}
                aria-label={`Slide ${index + 1} of ${slides.length}: ${entry.headline}`}
                onClick={() => onSelectSlide(index)}
                className={`h-2 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
                  index === activeSlide ? "w-7 bg-yene-accent" : "w-2 bg-yene-line hover:bg-yene-muted"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}


// ---------------------------------------------------------------------------
// ProductSection (spec Â§12) - reused for trending, new, best, recommended
// ---------------------------------------------------------------------------

export interface ProductSectionProps {
  title: string;
  subtitle?: string;
  cards: MarketplaceCard[];
  loading?: boolean;
  /** A real campaign deadline. Only then does the card show a countdown. */
  countdownEndsAt?: string | null;
  footnotes?: Record<string, string>;
  onOpenProduct: (productId: string) => void;
  onAddToCart?: (card: MarketplaceCard) => void;
  onOpenStore?: (subdomain: string) => void;
  onToggleWishlist?: (card: MarketplaceCard) => void;
  wishlistIds?: Set<string>;
  viewAll?: { label: string; onClick: () => void };
  /** Wraps the whole section, so a variant can tint it without forking the grid. */
  sectionClassName?: string;
}

/**
 * The one product section. Trending, New Arrivals, Best Sellers and
 * Recommended all render through this, which is what stops them drifting
 * apart - four near-identical grids is how a marketplace ends up with three
 * different card paddings.
 *
 * An empty result renders nothing at all rather than an empty box: a
 * "Trending" section with no trending products is just noise.
 */
export function ProductSection(props: ProductSectionProps) {
  const { cards, loading } = props;
  if (!loading && cards.length === 0) return null;

  return (
    <section aria-label={props.title} className={props.sectionClassName}>
      <SectionHeading title={props.title} subtitle={props.subtitle} action={props.viewAll} />
      {loading ? (
        <div className={PRODUCT_GRID} role="status" aria-label={`Loading ${props.title}`}>
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      ) : (
        <ul className={PRODUCT_GRID}>
          {cards.map((card) => (
            <li key={card.id} className="contents">
              <ProductCard
                card={card}
                onOpen={props.onOpenProduct}
                onAddToCart={props.onAddToCart}
                onOpenStore={props.onOpenStore}
                onToggleWishlist={props.onToggleWishlist}
                inWishlist={props.wishlistIds?.has(card.id)}
                countdownEndsAt={props.countdownEndsAt}
                footnote={props.footnotes?.[card.id]}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SkeletonCard() {
  return (
    <div aria-hidden className="overflow-hidden rounded-card border border-yene-line-soft bg-yene-surface">
      <div className="aspect-4/3 w-full animate-pulse bg-yene-raised" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-4/5 animate-pulse rounded bg-yene-raised" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-yene-raised" />
        <div className="h-9 w-full animate-pulse rounded-button bg-yene-raised" />
      </div>
    </div>
  );
}

/** Flash Deals (spec Â§4) - a ProductSection with a real campaign deadline. */
export function FlashDealsSection(props: ProductSectionProps) {
  if (!props.loading && props.cards.length === 0) return null;
  return (
    <ProductSection
      {...props}
      title={props.title}
      // A distinctive treatment so Flash Deals reads differently from the
      // ordinary product sections, as spec Â§4 asks.
      sectionClassName="rounded-card border border-yene-danger/25 bg-yene-danger/[0.04] p-4 tablet:p-5"
    />
  );
}


// ---------------------------------------------------------------------------
// Featured Businesses (spec Â§4)
// ---------------------------------------------------------------------------

/**
 * Store cards: logo, name, location, verification indicator, rating, and a
 * View Store action that opens the real storefront.
 *
 * SPEC Â§9: the verification tick is NOT decoration. It renders only when the
 * backend reports `verified: true`, which is only ever true because a Super
 * Admin set the trusted-seller flag (spec Â§14). A decorative tick that appears
 * on every store would be a lie.
 *
 * SPEC Â§4 asks for "horizontally scrollable sections where appropriate". This
 * row is now a SCROLLING RAIL AT EVERY WIDTH, not a grid from laptop up, because
 * a grid has nowhere to scroll to and the showcase would stop moving entirely
 * on the largest screens - which are the screens it is most worth showing on.
 * The cards keep a fixed width so a scroll step is always a whole card.
 */
export function FeaturedBusinessesSection({
  stores,
  onOpenStore,
  viewAll,
}: {
  stores: StoreCard[];
  onOpenStore: (subdomain: string) => void;
  viewAll?: { label: string; onClick: () => void };
}) {
  if (stores.length === 0) return null;

  return (
    <section aria-label="Featured businesses">
      <SectionHeading title="Featured Businesses" action={viewAll} />

      <AutoScrollRail ariaLabel="Featured businesses">
        {stores.map((store) => (
          <li key={store.id}>
            <StoreCard store={store} onOpenStore={onOpenStore} />
          </li>
        ))}
      </AutoScrollRail>
    </section>
  );
}

function StoreCard({ store, onOpenStore }: { store: StoreCard; onOpenStore: (subdomain: string) => void }) {
  const initial = store.name.trim().charAt(0).toUpperCase();
  return (
    <article className="flex w-[248px] flex-col overflow-hidden rounded-card border border-yene-line-soft bg-yene-surface transition-colors hover:border-yene-accent/60 tablet:w-[280px] desktop:w-[300px]">
      {/* Cover strip, or a designed gradient when the store has no image. */}
      <div className="relative h-16 w-full shrink-0 overflow-hidden bg-yene-raised">
        {store.coverImageUrl ? (
          <img
            src={store.coverImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="h-full w-full bg-gradient-to-br from-yene-raised via-yene-surface to-yene-accent/10"
          />
        )}
        <span className="absolute -bottom-5 left-3 flex h-10 w-10 items-center justify-center rounded-xl border border-yene-line bg-yene-surface text-sm font-bold text-yene-accent">
          {initial}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3 pt-8">
        <div className="flex items-start gap-1.5">
          <h3 className="line-clamp-1 flex-1 text-[13.5px] font-semibold text-yene-text">
            {store.name}
          </h3>
          {store.verified && (
            <span className="inline-flex shrink-0 items-center" title="Verified YENE-STORE seller">
              <BadgeCheck size={15} className="text-yene-accent" aria-hidden />
              <span className="sr-only">Verified seller</span>
            </span>
          )}
        </div>

        <p className="flex items-center gap-1 text-[11.5px] text-yene-muted">
          <MapPin size={12} aria-hidden className="shrink-0 text-yene-faint" />
          <span className="truncate">
            {store.location}
            {store.mallInfo ? ` - ${store.mallInfo.name}` : ""}
          </span>
        </p>

        {/* Section 41: the rooms, when there is more than one. A store holding
            GFS-024 and GFS-030 must not be reduced to its first counter. */}
        {store.mall && store.mall.rooms.length > 1 && (
          <p className="flex items-center gap-1 text-[11.5px] text-yene-faint">
            <DoorOpen size={12} aria-hidden className="shrink-0" />
            <span className="truncate">Rooms {store.mall.rooms.join(" & ")}</span>
          </p>
        )}

        <p className="flex items-center gap-1 text-[11.5px] text-yene-faint">
          <StoreIcon size={12} aria-hidden className="shrink-0" />
          {store.productCount} {store.productCount === 1 ? "product" : "products"}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {store.rating > 0 ? (
            <span className="text-[12px] text-yene-muted">
              <span className="font-semibold text-yene-text">{store.rating.toFixed(1)}</span>
              <span className="text-yene-warn"> â˜…</span>
              <span className="sr-only"> out of 5</span>
            </span>
          ) : (
            <span className="text-[11.5px] text-yene-faint">New store</span>
          )}
          <button
            type="button"
            onClick={() => onOpenStore(store.subdomain)}
            className={`${TOUCH} shrink-0 rounded-button border border-yene-line px-3 text-[12px] font-medium text-yene-text transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            View Store
          </button>
        </div>
      </div>
    </article>
  );
}


// ---------------------------------------------------------------------------
// Promotions (spec Â§4, Â§9)
// ---------------------------------------------------------------------------

/**
 * Special offers, seasonal campaigns, new arrivals, discounts and featured
 * businesses in one horizontal rail.
 *
 * SPEC Â§9: "Promotion cards open their actual promotion or product
 * destination." A promotion with a `productId` opens that product; one
 * without opens its store. There is no dead card and no invented destination.
 *
 * SPEC Â§9 also: "Do not display expired promotions as active." The endpoint
 * already filters by the real start/end window, and `endsAt` here is the
 * genuine campaign deadline.
 */
export function PromotionsSection({
  promotions,
  onOpenPromotion,
  onOpenStore,
}: {
  promotions: PromotionCard[];
  onOpenPromotion: (promotion: PromotionCard) => void;
  onOpenStore: (subdomain: string) => void;
}) {
  if (promotions.length === 0) return null;

  return (
    <section aria-label="Promotions and offers">
      <SectionHeading title="Promotions" subtitle="Special offers and seasonal campaigns" />
      <ul className="yene-rail">
        {promotions.map((promotion) => (
          <li key={promotion.id} className="w-[280px] tablet:w-[320px]">
            <article className="flex h-full flex-col overflow-hidden rounded-card border border-yene-line-soft bg-gradient-to-br from-yene-surface to-yene-raised transition-colors hover:border-yene-accent/60">
              <div className="relative h-24 w-full shrink-0 overflow-hidden bg-yene-raised">
                {promotion.imageUrl ? (
                  <img
                    src={promotion.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="h-full w-full bg-gradient-to-br from-yene-accent/15 via-yene-raised to-yene-surface"
                  />
                )}
                <span className="absolute left-2.5 top-2.5 rounded-full bg-yene-accent px-2 py-0.5 text-[10.5px] font-semibold text-yene-on-accent">
                  {promotion.type}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-1.5 p-3.5">
                <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-yene-text">
                  {promotion.title}
                </h3>
                <p className="line-clamp-2 text-[12px] leading-relaxed text-yene-muted">
                  {promotion.description}
                </p>
                {promotion.businessName && (
                  <p className="truncate text-[11.5px] text-yene-faint">{promotion.businessName}</p>
                )}

                <div className="mt-auto flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => onOpenPromotion(promotion)}
                    className={`${TOUCH} flex-1 rounded-button bg-yene-accent px-3 text-[12px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                  >
                    {promotion.cta || "View offer"}
                  </button>
                  {promotion.businessId && onOpenStore && (
                    <button
                      type="button"
                      onClick={() => onOpenStore(promotion.businessId)}
                      className={`${TOUCH} rounded-button border border-yene-line px-3 text-[12px] text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                    >
                      Store
                    </button>
                  )}
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recommended Products (spec Â§4, Â§25)
// ---------------------------------------------------------------------------

/**
 * A ProductSection whose cards carry the server's own reason.
 *
 * The reasons come from `recommendationsFor` with an empty signal set, so they
 * are catalogue-level ("Trending in YENE-STORE") and never a fabricated
 * personal claim (spec Â§25).
 */
export function RecommendedProducts({
  cards,
  onOpenProduct,
  onAddToCart,
  onOpenStore,
  onToggleWishlist,
  wishlistIds,
}: {
  cards: RecommendationCard[];
  onOpenProduct: (productId: string) => void;
  onAddToCart?: (card: MarketplaceCard) => void;
  onOpenStore?: (subdomain: string) => void;
  onToggleWishlist?: (card: MarketplaceCard) => void;
  wishlistIds?: Set<string>;
}) {
  if (cards.length === 0) return null;
  const footnotes: Record<string, string> = {};
  for (const card of cards) footnotes[card.id] = card.reason;

  return (
    <ProductSection
      title="Recommended for you"
      subtitle="Based on what is trending on YENE-STORE"
      cards={cards}
      footnotes={footnotes}
      onOpenProduct={onOpenProduct}
      onAddToCart={onAddToCart}
      onOpenStore={onOpenStore}
      onToggleWishlist={onToggleWishlist}
      wishlistIds={wishlistIds}
    />
  );
}

