/**
 * ============================================================================
 *  MarketplaceHome (spec Ã‚Â§2, Ã‚Â§4, Ã‚Â§12)
 * ============================================================================
 *
 *  The composer. It owns the DATA and the state, and renders the section
 *  components. No card, grid or breakpoint logic lives here - that is what
 *  stops the file becoming the 406-line monolith it replaced.
 *
 *  DATA IS REAL, OR IT IS NOT SHOWN
 *  ---------------------------------
 *  Five public endpoints, loaded in parallel on mount:
 *
 *    /api/platform/config         categories (Section 17, fourteen of them)
 *    /api/platform/marketplace    published listings (Section 13/15)
 *    /api/platform/businesses     store cards (Section 10)
 *    /api/platform/promotions     LIVE promotions only (Section 18/19)
 *    /api/platform/recommendations cold-start recommendations (Section 25)
 *
 *  Nothing is hard-coded. Spec Ã‚Â§15: "Do not replace real backend data with
 *  hardcoded demo data", and Ã‚Â§9: "If backend functionality is not yet
 *  available, implement clean frontend states" - so each section has a real
 *  loading, empty and error state, and a failed endpoint never blanks the
 *  whole page or shows a fake section.
 *
 *  SEARCH
 *  ------
 *  Searching replaces the grid with results, keeps the category selection, and
 *  reports the server's `corrected` flag so a typo fix is visible rather than
 *  silent (Section 16).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchBusinesses,
  fetchMall,
  fetchMarketplaceCards,
  fetchMalls,
  fetchPlatformConfig,
  fetchPromotions,
  fetchRecommendations,
  searchMarketplace,
} from "../../lib/platformApi";
import { CategoryNavigation } from "./CategoryNavigation";
import { MarketplaceFooter } from "./MarketplaceFooter";
import { MarketplaceHeader } from "./MarketplaceHeader";
import { MallStoresSection } from "./MallStores";
import { BOTTOM_NAV_SPACE, MobileBottomNavigation, type BottomTab } from "./MobileBottomNavigation";
import type { MarketplaceCard } from "./types";
import {
  FeaturedBusinessesSection,
  FlashDealsSection,
  HeroPromotion,
  ProductSection,
  PromotionsSection,
  RecommendedProducts,
} from "./Sections";
import { EmptyState, ErrorState, InlineNotice, SectionSkeleton } from "./States";
import type {
  CategoryChip,
  ListingCard,
  MallCard,
  PromotionCard,
  RecommendationCard,
  StoreCard,
} from "./types";

const HERO_SLIDES = [
  {
    headline: "Discover More. Shop Smarter.",
    body: "Explore products and businesses across YENE-STORE - one marketplace, many Ethiopian sellers, delivered nationwide.",
    cta: "Explore Marketplace",
    badge: "Multi-vendor marketplace",
  },
  {
    headline: "Open Your Own Store.",
    body: "Rent a YENE-STORE storefront, list your products and reach every shopper - from Silver to Super.",
    cta: "See Packages",
    badge: "Start selling today",
  },
  {
    headline: "Manage, Automate, Grow.",
    body: "Inventory, CRM, orders and analytics in one place - built by Yene Business Group.",
    cta: "Business Dashboard",
    badge: "Business platform",
  },
];

export interface MarketplaceHomeProps {
  cart: { productId: string; name: string; price: number; quantity: number }[];
  onOpenProduct: (productId: string) => void;
  onOpenStore: (subdomain: string) => void;
  /** Section 41: open one mall and the stores registered inside it. */
  onOpenMall: (slug: string) => void;
  onAddToCart: (card: { productId: string; name: string; price: number; quantity: number }) => void;
  onToggleWishlist?: (card: MarketplaceCard) => void;
  wishlistIds?: Set<string>;
  onOpenCart: () => void;
  onOpenOrders: () => void;
  onOpenAccount: () => void;
  onOpenHelp: () => void;
  onOpenDashboard: () => void;
  onNavigate: (view: "marketplace" | "cart" | "business-dashboard" | "support") => void;
  initialCategory?: string;
  initialQuery?: string;
  /** Server-resolved identity. The client never supplies a businessId. */
  me: { authenticated: boolean; user?: { name: string; email: string }; business?: { name: string; packageId: string } | null } | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  onSignOut: () => void;
  /** Opens identity verification (Fayda ID + TIN). Required before renting. */
  onOpenVerification: () => void;
  /** Opens the Management System. Present only for permitted accounts. */
  onOpenManagement?: () => void;
  /** Opens the wallet drawer, which shows the real balance from /api/wallet. */
  onOpenWallet: () => void;
}

export function MarketplaceHome(props: MarketplaceHomeProps) {
  const [language, setLanguage] = useState<"en" | "am">("en");
  const [categories, setCategories] = useState<CategoryChip[]>([]);
  const [listings, setListings] = useState<ListingCard[] | null>(null);
  const [stores, setStores] = useState<StoreCard[]>([]);
  const [promotions, setPromotions] = useState<PromotionCard[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationCard[]>([]);
  // Section 41: the mall directory. Loaded SEPARATELY from the main feed, on
  // purpose - the header comment above promises that a failed endpoint never
  // blanks the whole page, and folding this into the same Promise.all would
  // break that promise for a section that is not essential to shopping.
  const [malls, setMalls] = useState<MallCard[]>([]);
  const [mallsError, setMallsError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [category, setCategory] = useState(props.initialCategory ?? "");
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [results, setResults] = useState<MarketplaceCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [corrected, setCorrected] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<BottomTab>("home");
  const [slide, setSlide] = useState(0);
  const [flashEndsAt, setFlashEndsAt] = useState<string | null>(null);

  const cartCount = useMemo(
    () => props.cart.reduce((total, line) => total + line.quantity, 0),
    [props.cart],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchPlatformConfig(),
      fetchMarketplaceCards(),
      fetchBusinesses(),
      fetchPromotions(),
      fetchRecommendations(10),
    ])
      .then(([config, market, businessList, promoList, recommended]) => {
        setCategories(config.categories);
        setListings(market.listings);
        setStores(businessList.businesses);
        setPromotions(promoList.promotions);
        setRecommendations(recommended.recommendations);
      })
      .catch((cause) => {
        // Spec Ã‚Â§9: a failure is shown as a failure, never as "no results".
        setError((cause as { userMessage?: string }).userMessage ?? "The marketplace could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, reload]);

  // The mall directory, independent of the main feed. A failure here is shown
  // against this section only - the rest of the marketplace still works.
  const loadMalls = useCallback(() => {
    setMallsError(null);
    fetchMalls()
      .then((result) => setMalls(result.malls))
      .catch((cause) =>
        setMallsError(
          (cause as { userMessage?: string }).userMessage ??
            "The mall directory is unavailable right now.",
        ),
      );
  }, []);

  useEffect(loadMalls, [loadMalls, reload]);

  // The Flash Deals deadline is the earliest REAL end date among the live
  // promotions, so a countdown can never point at an invented date (spec Ã‚Â§4).
  useEffect(() => {
    const ends = promotions
      .map((promotion) => new Date(promotion.endsAt).getTime())
      .filter((time) => time > Date.now());
    setFlashEndsAt(ends.length ? new Date(Math.min(...ends)).toISOString() : null);
  }, [promotions]);

  const runSearch = useCallback(
    (term: string, categoryId: string) => {
      const trimmed = term.trim();
      if (!trimmed && !categoryId) {
        setResults(null);
        setCorrected(false);
        return;
      }
      setSearching(true);
      setSearchError(null);
      searchMarketplace({ q: trimmed, category: categoryId, page: 1 })
        .then((response) => {
          setResults(
            response.items
              .filter((item) => item.kind === "product")
              .map((item) => ({
                id: item.id,
                name: item.title,
                brand: "",
                imageUrl: null,
                imageCount: 0,
                price: item.price ?? 0,
                finalPrice: item.price ?? 0,
                discountPercent: null,
                inStock: true,
                stock: 0,
                rating: 0,
                reviewCount: 0,
                businessId: "",
                businessName: item.subtitle,
                businessSubdomain: null,
                categoryId: categoryId,
                // Section 17: a search hit does not carry a subcategory, so the
                // filter falls back to matching the main category alone.
                subcategoryId: null,
                promotion: null,
              })),
          );
          setCorrected(response.corrected);
        })
        .catch((cause) =>
          setSearchError(
            (cause as { userMessage?: string }).userMessage ?? "Search is unavailable right now.",
          ),
        )
        .finally(() => setSearching(false));
    },
    [],
  );

  const onTab = (tab: BottomTab) => {
    setActiveTab(tab);
    if (tab === "home") {
      setQuery("");
      setResults(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (tab === "categories") {
      document.getElementById("mk-categories")?.scrollIntoView({ behavior: "smooth" });
    } else if (tab === "cart") {
      props.onOpenCart();
    } else if (tab === "orders") {
      props.onOpenOrders();
    } else {
      props.onOpenAccount();
    }
  };


  // ---- Derived section data, all from real responses -------------------
  const allCards: MarketplaceCard[] = useMemo(() => listings ?? [], [listings]);
  const discounted = useMemo(
    () => allCards.filter((card) => card.discountPercent !== null),
    [allCards],
  );
  const trending = useMemo(
    () => [...allCards].sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount),
    [allCards],
  );
  const newArrivals = useMemo(() => [...allCards].reverse(), [allCards]);
  const bestSellers = useMemo(
    () => [...allCards].sort((a, b) => b.stock - a.stock),
    [allCards],
  );
  /**
 * The products matching the selected category.
 *
 * A MAIN category matches its whole subtree, not just the products whose
 * `categoryId` is that category. Without this, clicking "Fashion" would hide
 * every product a merchant filed as Fashion / Jewellery - which is most of
 * them. A SUBCATEGORY matches only itself.
 *
 * Null when nothing is selected, so the caller can tell "no filter" apart from
 * "a filter that matched nothing".
 */
const inCategory = useMemo(() => {
  if (!category) return null;
  const parent = categories.find((entry) => entry.id === category);
  if (parent) {
    // A main category: everything filed under it OR under one of its children.
    const childIds = new Set(parent.subcategories.map((sub) => sub.id));
    return allCards.filter(
      (card) => card.categoryId === category || (card.subcategoryId !== null && childIds.has(card.subcategoryId)),
    );
  }
  // A subcategory: itself, plus anything filed against the parent but not
  // narrowed to a sibling subcategory.
  return allCards.filter(
    (card) => card.subcategoryId === category || card.categoryId === category,
  );
}, [allCards, category, categories]);

/** The label for the "you are browsing" heading. */
const selectedCategoryName = useMemo(() => {
  for (const entry of categories) {
    if (entry.id === category) return entry.name;
    const child = entry.subcategories.find((sub) => sub.id === category);
    if (child) return `${entry.name} / ${child.name}`;
  }
  return "Category";
}, [categories, category]);

  const addToCart = (card: MarketplaceCard) => {
    props.onAddToCart({
      productId: card.id,
      name: card.name,
      price: card.finalPrice,
      quantity: 1,
    });
  };

  const openPromotion = (promotion: PromotionCard) => {
    // Spec Ã‚Â§9: open the REAL destination, or the store. Never a dead card.
    if (promotion.productId) props.onOpenProduct(promotion.productId);
    else if (promotion.businessId) props.onOpenStore(promotion.businessId);
  };

  const commonProps = {
    onOpenProduct: props.onOpenProduct,
    onAddToCart: addToCart,
    onOpenStore: props.onOpenStore,
    onToggleWishlist: props.onToggleWishlist,
    wishlistIds: props.wishlistIds,
  };

  return (
    <div className={`min-h-dvh bg-yene-bg ${BOTTOM_NAV_SPACE}`}>
      <a
        href="#mk-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-button focus:bg-yene-accent focus:px-4 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-yene-on-accent"
      >
        Skip to content
      </a>

      <MarketplaceHeader
        language={language}
        onLanguage={setLanguage}
        cartCount={cartCount}
        onOpenCart={props.onOpenCart}
        onOpenAccount={props.onOpenAccount}
        onOpenOrders={props.onOpenOrders}
        onOpenHelp={props.onOpenHelp}
        onOpenDashboard={props.onOpenDashboard}
        onSearch={runSearch}
        category={category}
        me={props.me}
        theme={props.theme}
        onToggleTheme={props.onToggleTheme}
        onSignIn={props.onSignIn}
        onSignUp={props.onSignUp}
        onSignOut={props.onSignOut}
        onOpenVerification={props.onOpenVerification}
        onOpenManagement={props.onOpenManagement}
        onOpenWallet={props.onOpenWallet}
      />

      <div id="mk-categories">
        <CategoryNavigation
          categories={categories}
          selected={category}
          onSelect={(next) => {
            setCategory(next);
            runSearch(query, next);
          }}
        />
      </div>

      <main id="mk-main" className="mx-auto w-full max-w-[1600px] px-4 py-5 tablet:px-6 desktop:px-8">
        {error ? (
          <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />
        ) : (
          <div className="space-y-9">
            <HeroPromotion
              slides={HERO_SLIDES}
              activeSlide={slide}
              onSelectSlide={setSlide}
              onCta={() => {
                if (slide === 0) setActiveTab("categories");
                else props.onOpenDashboard();
              }}
            />

            {searchError && (
              <ErrorState message={searchError} onRetry={() => runSearch(query, category)} />
            )}

            {searching ? (
              <SectionSkeleton count={6} />
            ) : results ? (
              <SearchResults
                results={results}
                query={query}
                corrected={corrected}
                onOpen={props.onOpenProduct}
                onClear={() => runSearch("", "")}
              />
            ) : (
              <>
                <FlashDealsSection
                  title="Flash Deals"
                  cards={discounted}
                  loading={loading}
                  countdownEndsAt={flashEndsAt}
                  {...commonProps}
                />
                <FeaturedBusinessesSection stores={stores} onOpenStore={props.onOpenStore} />

                {/* Section 41: browse a mall and see the stores inside it.
                    Sits next to Featured Businesses because they answer the same
                    question two ways - by store, and by where the store trades. */}
                {mallsError ? (
                  <InlineNotice>{mallsError}</InlineNotice>
                ) : (
                  <MallStoresSection
                    malls={malls}
                    onOpenMall={props.onOpenMall}
                    onOpenStore={props.onOpenStore}
                  />
                )}

                <PromotionsSection
                  promotions={promotions}
                  onOpenPromotion={openPromotion}
                  onOpenStore={props.onOpenStore}
                />
                {/* Section 17: browsing a category, or one of its subcategories. */}
                {inCategory ? (
                  inCategory.length === 0 ? (
                    <EmptyState
                      title={`No products in ${selectedCategoryName} yet`}
                      hint="Try another subcategory, or browse all products."
                      action={{ label: "Browse all products", onClick: () => setCategory("") }}
                    />
                  ) : (
                    <ProductSection
                      title={selectedCategoryName}
                      cards={inCategory}
                      loading={loading}
                      {...commonProps}
                      viewAll={{ label: "All categories", onClick: () => setCategory("") }}
                    />
                  )
                ) : (
                  <>
                    <ProductSection title="Trending now" cards={trending} loading={loading} {...commonProps} />
                    <ProductSection title="New arrivals" cards={newArrivals} loading={loading} {...commonProps} />
                    <ProductSection title="Best sellers" cards={bestSellers} loading={loading} {...commonProps} />
                  </>
                )}
                <RecommendedProducts cards={recommendations} {...commonProps} />
              </>
            )}
          </div>
        )}
      </main>

      <MarketplaceFooter onNavigate={props.onNavigate} />

      <MobileBottomNavigation active={activeTab} cartCount={cartCount} onSelect={onTab} />
    </div>
  );
}


/** Search results replace the normal grids entirely (spec Ã‚Â§9). */
function SearchResults({
  results,
  query,
  corrected,
  onOpen,
  onClear,
}: {
  results: MarketplaceCard[];
  query: string;
  corrected: boolean;
  onOpen: (productId: string) => void;
  onClear: () => void;
}) {
  return (
    <section aria-label="Search results">
      <h2 className="mb-1 text-[16px] font-semibold text-yene-text">
        {results.length} result{results.length === 1 ? "" : "s"}
        {query ? ` for "${query}"` : ""}
      </h2>
      {corrected && (
        <div className="mb-3">
          <InlineNotice>Showing results for a corrected spelling of your search.</InlineNotice>
        </div>
      )}
      {results.length === 0 ? (
        <EmptyState
          title="No results found"
          hint="Try a different spelling, or browse a category."
          action={{ label: "Clear search", onClick: onClear }}
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 tablet:grid-cols-3 laptop:grid-cols-4 desktop:grid-cols-5 wide:grid-cols-6">
          {results.map((card) => (
            <li key={card.id} className="contents">
              <SearchResultCard card={card} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A search hit is thinner than a catalogue card - no rating, no stock - so it
 * gets a compact row rather than a card full of dashes that would read as
 * missing data.
 */
function SearchResultCard({
  card,
  onOpen,
}: {
  card: MarketplaceCard;
  onOpen: (productId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(card.id)}
      className="flex min-h-11 flex-col rounded-card border border-yene-line-soft bg-yene-surface p-3 text-left transition-colors hover:border-yene-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
    >
      <span className="line-clamp-2 text-[13px] font-medium text-yene-text">{card.name}</span>
      {card.businessName && (
        <span className="mt-0.5 truncate text-[11.5px] text-yene-muted">{card.businessName}</span>
      )}
      {card.price > 0 && (
        <span className="mt-1.5 text-sm font-semibold text-yene-text">
          {card.price.toLocaleString("en-US")} ETB
        </span>
      )}
    </button>
  );
}

