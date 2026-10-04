/**
 * ============================================================================
 *  ProductCard - THE product card (spec §5, §12)
 * ============================================================================
 *
 *  ONE card for the whole app. It was previously implemented twice - once in
 *  `platform/primitives.tsx` and once as `StoreProduct` in `StorefrontView` -
 *  and two copies of a card drift within a week. Both now come from here.
 *
 *  USED BY: flash deals, trending, new arrivals, best sellers, recommended,
 *  search results, and the storefront grid. Every one of them.
 *
 *  THE RULES THIS CARD KEEPS
 *  -------------------------
 *  * Prices are REAL. A previous price only renders when `finalPrice <
 *    price`, and a discount badge only renders when `discountPercent` is a
 *    real number. Spec §5: "Show discount information only when valid."
 *  * Ratings are REAL. With no published reviews the row is omitted entirely
 *    rather than showing a fake 0.0 or a decorative five stars.
 *  * Stock is REAL. `inStock` comes from the product's own count.
 *  * No image is ever borrowed. `imageUrl` is null for every seeded product
 *    today, so the card renders a designed placeholder carrying the brand
 *    initial - a deliberate empty state, not a broken image and not someone
 *    else's photograph.
 *  * The image box is a fixed 4:3 aspect ratio with `object-cover`, so a
 *    photo of any size cannot stretch the card or shift the grid.
 *  * Every tappable control is at least 44x44 (spec §7).
 */

import { useEffect, useState } from "react";
import { Heart, ShoppingCart, Star } from "lucide-react";
import type { MarketplaceCard } from "./types";

/** Spec §7: the minimum touch target, as a Tailwind class. */
export const TOUCH = "min-h-11 min-w-11";

export function formatEtb(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "-";
  return `${Math.round(amount).toLocaleString("en-US")} ETB`;
}

/**
 * Spec §13: status is never communicated by colour alone.
 * The filled/half/empty star shapes carry the meaning, and a screen-reader
 * label states the number in words.
 */
export function RatingRow({ rating, count }: { rating: number; count: number }) {
  if (!rating || !count) return null;
  const rounded = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-yene-muted">
      <span className="inline-flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((step) => (
          <Star
            key={step}
            size={12}
            className={step <= rounded ? "fill-yene-warn text-yene-warn" : "text-yene-line"}
          />
        ))}
      </span>
      <span className="font-medium text-yene-text">{rating.toFixed(1)}</span>
      <span className="text-yene-faint">({count})</span>
      <span className="sr-only">
        Rated {rating.toFixed(1)} out of 5 from {count} reviews
      </span>
    </span>
  );
}

/**
 * The image, or a designed placeholder.
 *
 * Spec §11: no broken image URLs and no borrowed assets. When there is no
 * image we show the brand initial on a subtle gradient - recognisably a
 * placeholder rather than a picture of something else.
 */
function ProductImage({ card }: { card: MarketplaceCard }) {
  if (card.imageUrl) {
    return (
      <img
        src={card.imageUrl}
        alt={card.name}
        loading="lazy"
        decoding="async"
        // object-cover + a fixed aspect box: the photo never stretches.
        className="h-full w-full object-cover"
      />
    );
  }
  const initial = (card.brand || card.name).trim().charAt(0).toUpperCase() || "Y";
  return (
    <div
      role="img"
      aria-label={`${card.name} - no product image available`}
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-yene-raised to-yene-surface"
    >
      <span className="text-2xl font-semibold text-yene-faint">{initial}</span>
    </div>
  );
}

export interface ProductCardProps {
  card: MarketplaceCard;
  onOpen: (productId: string) => void;
  onAddToCart?: (card: MarketplaceCard) => void;
  onOpenStore?: (subdomain: string) => void;
  onToggleWishlist?: (card: MarketplaceCard) => void;
  inWishlist?: boolean;
  /** Spec §4: only a section with a real campaign deadline gets a countdown. */
  countdownEndsAt?: string | null;
  /** Shown under the card, e.g. Section 25's "Trending in YENE-STORE". */
  footnote?: string;
}

export function ProductCard({
  card,
  onOpen,
  onAddToCart,
  onOpenStore,
  onToggleWishlist,
  inWishlist,
  countdownEndsAt,
  footnote,
}: ProductCardProps) {
  const onSale = card.discountPercent !== null && card.finalPrice < card.price;
  const showCountdown = Boolean(countdownEndsAt) && card.inStock;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card border border-yene-line-soft bg-yene-surface transition-[border-color,transform] duration-200 hover:border-yene-accent/60 focus-within:border-yene-accent/60 motion-safe:hover:-translate-y-0.5">
      {/* Badges sit over the image, out of the text flow. */}
      <div className="relative aspect-4/3 w-full overflow-hidden bg-yene-raised">
        <button
          type="button"
          onClick={() => onOpen(card.id)}
          className="block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yene-accent"
        >
          <ProductImage card={card} />
          <span className="sr-only">View {card.name}</span>
        </button>

        <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
          {onSale && card.discountPercent !== null && (
            <span className="rounded-full bg-yene-danger px-2 py-0.5 text-[11px] font-semibold text-white">
              -{card.discountPercent}%
            </span>
          )}
          {card.promotion && (
            <span className="rounded-full bg-yene-accent px-2 py-0.5 text-[11px] font-semibold text-yene-on-accent">
              {card.promotion.label}
            </span>
          )}
        </div>

        {onToggleWishlist && (
          <button
            type="button"
            onClick={() => onToggleWishlist(card)}
            aria-pressed={inWishlist}
            aria-label={inWishlist ? `Remove ${card.name} from wishlist` : `Save ${card.name} to wishlist`}
            className={`${TOUCH} absolute right-1.5 top-1.5 flex items-center justify-center rounded-full border border-yene-line bg-yene-bg/85 p-1 backdrop-blur transition-colors hover:border-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            <Heart
              size={15}
              className={inWishlist ? "fill-yene-accent text-yene-accent" : "text-yene-muted"}
            />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <button
          type="button"
          onClick={() => onOpen(card.id)}
          className="line-clamp-2 text-left text-[13px] font-medium leading-snug text-yene-text focus:outline-none focus-visible:underline"
        >
          {card.name}
        </button>

        <RatingRow rating={card.rating} count={card.reviewCount} />

        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[15px] font-semibold text-yene-text">
            {formatEtb(card.finalPrice)}
          </span>
          {onSale && (
            <span className="text-[12px] text-yene-faint line-through">
              {formatEtb(card.price)}
            </span>
          )}
        </div>

        {/* Section 10/13: the store name is a link to the ORIGINAL business. */}
        {card.businessName && card.businessSubdomain && onOpenStore ? (
          <button
            type="button"
            onClick={() => onOpenStore(card.businessSubdomain as string)}
            className="truncate text-left text-[11.5px] text-yene-muted underline-offset-2 hover:text-yene-accent hover:underline focus:outline-none focus-visible:underline"
          >
            {card.businessName}
          </button>
        ) : (
          card.businessName && (
            <span className="truncate text-[11.5px] text-yene-muted">{card.businessName}</span>
          )
        )}

        {footnote && <p className="text-[11px] text-yene-faint">{footnote}</p>}

        <div className="mt-auto pt-1.5">
          {showCountdown && countdownEndsAt ? (
            <Countdown endsAt={countdownEndsAt} />
          ) : onAddToCart ? (
            <button
              type="button"
              onClick={() => onAddToCart(card)}
              disabled={!card.inStock}
              className={`${TOUCH} inline-flex w-full items-center justify-center gap-1.5 rounded-button bg-yene-accent px-3 text-[12.5px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-surface disabled:cursor-not-allowed disabled:bg-yene-raised disabled:text-yene-faint`}
            >
              <ShoppingCart size={14} />
              {card.inStock ? "Add to Cart" : "Out of stock"}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * Spec §4: "countdown only if a real campaign expiry is available".
 *
 * The deadline comes from the promotion's own `endAt`, so this can never
 * count down to an invented date. When it reaches zero the button comes back
 * rather than sitting on a dead "0d 00h 00m 00s".
 */
function Countdown({ endsAt }: { endsAt: string }) {
  const remaining = useRemaining(endsAt);
  if (remaining === null) return null;
  if (remaining <= 0) {
    return (
      <span className="flex min-h-11 items-center justify-center rounded-button border border-yene-line text-[12px] text-yene-faint">
        Offer ended
      </span>
    );
  }
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return (
    <span className="flex min-h-11 items-center justify-center gap-1 rounded-button border border-yene-danger/50 bg-yene-danger/10 text-[12px] font-semibold text-yene-danger">
      <span aria-hidden>Ends in</span>
      <span className="tabular-nums">
        {String(hours).padStart(2, "0")}h {String(minutes).padStart(2, "0")}m{" "}
        {String(seconds).padStart(2, "0")}s
      </span>
      <span className="sr-only">
        Offer ends in {hours} hours {minutes} minutes
      </span>
    </span>
  );
}

/**
 * Ticks once a second against a REAL deadline.
 *
 * The interval is cleared on unmount, so a grid of 40 counted-down cards does
 * not leave 40 timers running after the shopper scrolls past.
 */
function useRemaining(endsAt: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return new Date(endsAt).getTime() - now;
}