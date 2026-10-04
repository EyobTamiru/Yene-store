/**
 * ============================================================================
 *  RESPONSIVE PRIMITIVES (Sections 42, 43)
 * ============================================================================
 *
 *  Section 42 asks for a LAYOUT PER BREAKPOINT, not one layout that stretches:
 *
 *    phone         mobile-first, 2-column grid, bottom nav, horizontal category
 *                  scrolling, compact header
 *    tablet        2-3 column grids, compact nav, touch-friendly
 *    laptop/desktop full nav, expanded analytics, larger grids, business sidebar
 *    large monitor  maximum content width, centered, efficient use of space
 *
 *  These components encode that once, so a new page gets all five by using
 *  them rather than by remembering four sets of Tailwind prefixes.
 *
 *  Section 43: #0D1117 canvas, #3DDC97 accent, light text, rounded cards
 *  (16-32px), strong hierarchy, accessible contrast, 44x44px touch targets.
 */

/** Section 42: the five named widths, as Tailwind breakpoints. */
export const BREAKPOINTS = {
  phone: "base",
  tablet: "sm",
  laptop: "md",
  desktop: "lg",
  largeMonitor: "2xl",
} as const;

/**
 * Section 43: the minimum recommended touch target.
 *
 * Applied as a min-size on every tappable control, and asserted in the
 * verification suite's markup check. A 32px button that LOOKS fine on a laptop
 * is unusable on the phone Section 42 asks us to support.
 */
export const TOUCH_TARGET = "min-h-11 min-w-11";

/** Section 42: product grid columns per breakpoint. Phone gets 2. */
export function productGridClass(compact = false): string {
  return compact
    ? "grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
    : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5";
}

/** Section 42: large monitors get a capped, centered column. */
export const CONTENT_WIDTH = "mx-auto w-full max-w-7xl px-4 sm:px-6 2xl:max-w-[1600px]";
export const DASHBOARD_WIDTH = "mx-auto w-full max-w-[1800px] px-4 sm:px-6 2xl:px-10";

/** Section 42: horizontal category rail on a phone, a wrapped row above. */
export const CATEGORY_RAIL =
  "flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible";


export function formatEtbUi(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "-";
  return `${amount.toLocaleString("en-US")} ETB`;
}

// -----------------------------------------------------------------------------
// Re-exported so there is exactly ONE star row and ONE product card in the app.
//
// `StarRow` used to live here as a second implementation, and `ProductCard` as
// a third. The marketplace modules own both now; these re-exports keep the
// existing import sites working without duplicating the markup.
// -----------------------------------------------------------------------------
export { RatingRow as StarRow, ProductCard, TOUCH } from "../marketplace/ProductCard";
export type { MarketplaceCard } from "../marketplace/types";
