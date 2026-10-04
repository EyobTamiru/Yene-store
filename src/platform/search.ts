/**
 * ============================================================================
 *  MARKETPLACE SEARCH (Section 16)
 * ============================================================================
 *
 *  Searches products, businesses, categories, brands, services and promotions,
 *  with server-side filtering, six sort orders, pagination, autocomplete and
 *  typo tolerance.
 *
 *  TYPO TOLERANCE, HONESTLY
 *  -----------------------
 *  Section 16 asks for typo tolerance. "Samsng" should find "Samsung".
 *
 *  The implementation below is a normalised Damerau-Levenshtein distance
 *  (transpositions counted as one edit, because that is the typo people
 *  actually make) combined with a prefix bonus. It is deliberately SMALL and
 *  self-contained rather than a fuzzy-search dependency, for two reasons:
 *
 *    1. the marketplace corpus is products and businesses, not a document
 *       collection - a bounded index is genuinely enough;
 *    2. it runs in the verification suite with no dictionary to download, so
 *       the behaviour is provable rather than asserted.
 *
 *  It reports `corrected: true` when it changed the query. A search box that
 *  silently rewrites what you typed is how people buy the wrong phone.
 *
 *  WHAT THIS MODULE NEVER DOES
 *  ----------------------------
 *  Section 25: "Never expose private customer behavior to other customers or
 *  businesses." `search()` receives only catalogue data. It has no access to
 *  any customer's history, so it cannot leak any, whatever a future caller
 *  passes in. Popularity here is `soldCount` on the PRODUCT - an aggregate
 *  every shopper can already see - not "customers like you also viewed".
 */

import { SORT_OPTIONS, type SearchFilters, type SearchResponse, type SearchResultItem, type SortOption } from "./types";
import type { Business, Category, Product, Promotion } from "./types";

export interface SearchCorpus {
  products: Product[];
  businesses: Business[];
  categories: Category[];
  promotions: Promotion[];
  /** productId -> average rating, from published reviews. */
  ratings: Record<string, number>;
  /** productId -> active promotion ids. */
  promotionIndex: Record<string, string[]>;
}

export const DEFAULT_PAGE_SIZE = 24;

/** Levenshtein with transposition, capped for speed. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Two rows of history: a transposition looks BACK TWO rows, not one.
  let twoBack = Array.from({ length: b.length + 1 }, (_, i) => i);
  let previous = twoBack;
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      // Damerau: "teh" -> "the" is ONE edit, not two. The cost is taken from
      // row i-2 / column j-2, which is why twoBack exists.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > cap) return cap + 1;
    twoBack = previous;
    previous = current;
  }
  return previous[b.length];
}

/** How much a candidate may differ and still count as a typo. */
function toleranceFor(term: string): number {
  if (term.length <= 3) return 0;
  if (term.length <= 5) return 1;
  return 2;
}

export function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function terms(query: string): string[] {
  return normalize(query).split(" ").filter(Boolean);
}

/** Does `haystack` contain the term, allowing for typos? */
function matchesTerm(haystack: string, term: string): { hit: boolean; exact: boolean } {
  if (haystack.includes(term)) return { hit: true, exact: true };
  if (toleranceFor(term) === 0) return { hit: false, exact: false };

  // Only compare against words that share the term's opening characters.
  // Using a long prefix here is self-defeating: "samsng" would require
  // "samsn", which "samsung" does not start with, so the one typo this exists
  // to catch is exactly the one that would be missed. Three characters is the
  // longest prefix that still admits a mid-word transposition.
  const prefix = term.slice(0, Math.min(3, term.length - 1));
  for (const word of haystack.split(" ")) {
    if (!word.startsWith(prefix)) continue;
    if (editDistance(term, word, toleranceFor(term)) <= toleranceFor(term)) {
      return { hit: true, exact: false };
    }
  }
  return { hit: false, exact: false };
}

function scoreText(haystack: string, queryTerms: string[]): number {
  if (!queryTerms.length) return 1;
  const normalized = normalize(haystack);
  let score = 0;
  for (const term of queryTerms) {
    const result = matchesTerm(normalized, term);
    if (!result.hit) return 0;
    score += result.exact ? 3 : 1;
    if (normalized.startsWith(term)) score += 2;
  }
  return score;
}

function businessName(businesses: Business[], id: string): string {
  return businesses.find((b) => b.id === id)?.name ?? "YENE-STORE seller";
}

function effectivePrice(product: Product): number {
  return product.discountPrice ?? product.price;
}

/** Build the candidate list, filtered and scored, before sorting or paging. */
function candidates(
  corpus: SearchCorpus,
  query: string,
  filters: SearchFilters,
): SearchResultItem[] {
  const queryTerms = terms(query);
  const items: SearchResultItem[] = [];

  for (const product of corpus.products) {
    if (product.status !== "active") continue;
    if (filters.categoryId && product.categoryId !== filters.categoryId && product.subcategoryId !== filters.categoryId) continue;
    if (filters.businessId && product.businessId !== filters.businessId) continue;
    if (filters.brand && normalize(product.brand) !== normalize(filters.brand)) continue;
    if (filters.inStockOnly && product.stock <= 0) continue;

    const price = effectivePrice(product);
    if (typeof filters.minPrice === "number" && price < filters.minPrice) continue;
    if (typeof filters.maxPrice === "number" && price > filters.maxPrice) continue;

    const rating = corpus.ratings[product.id] ?? 0;
    if (typeof filters.minRating === "number" && rating < filters.minRating) continue;

    const promoted = (corpus.promotionIndex[product.id] ?? []).length > 0;
    if (filters.onPromotion && !promoted) continue;

    const business = corpus.businesses.find((b) => b.id === product.businessId);
    if (filters.location && business && normalize(business.location) !== normalize(filters.location)) continue;

    const text = `${product.name} ${product.brand} ${product.sku} ${product.description}`;
    let score = scoreText(text, queryTerms);
    if (score === 0) continue;
    score += rating;                                    // Best rated
    score += Math.min(product.soldCount / 10, 5);       // Popular
    if (promoted) score += 1;
    if (product.discountPrice) score += 0.5;

    items.push({
      kind: "product",
      id: product.id,
      title: product.name,
      subtitle: `${product.brand} - ${businessName(corpus.businesses, product.businessId)}`,
      price,
      score,
    });
  }

  for (const business of corpus.businesses) {
    if (business.status !== "Active" && business.status !== "Trial") continue;
    if (filters.location && normalize(business.location) !== normalize(filters.location)) continue;
    const score = scoreText(
      `${business.name} ${business.customization.description}`,
      queryTerms,
    );
    if (score === 0) continue;
    items.push({
      kind: "business",
      id: business.id,
      title: business.name,
      subtitle: `${business.location} - ${business.subdomain}`,
      price: null,
      score: score + business.rating,
    });
  }

  for (const category of corpus.categories) {
    if (!category.enabled) continue;
    const score = scoreText(category.name, queryTerms);
    if (score === 0) continue;
    items.push({
      kind: "category",
      id: category.id,
      title: category.name,
      subtitle: "Category",
      price: null,
      score,
    });
  }

  for (const promotion of corpus.promotions) {
    if (promotion.status !== "Active") continue;
    const score = scoreText(`${promotion.title} ${promotion.description}`, queryTerms);
    if (score === 0) continue;
    items.push({
      kind: "promotion",
      id: promotion.id,
      title: promotion.title,
      subtitle: promotion.type,
      price: null,
      score,
    });
  }

  return items;
}

function sortItems(
  items: SearchResultItem[],
  sort: SortOption,
  corpus: SearchCorpus,
): SearchResultItem[] {
  const productById = new Map(corpus.products.map((p) => [p.id, p]));
  const copy = [...items];
  switch (sort) {
    case "Popular":
      return copy.sort(
        (a, b) =>
          (productById.get(b.id)?.soldCount ?? 0) - (productById.get(a.id)?.soldCount ?? 0),
      );
    case "Newest":
      return copy.sort(
        (a, b) =>
          new Date(productById.get(b.id)?.createdAt ?? 0).getTime() -
          new Date(productById.get(a.id)?.createdAt ?? 0).getTime(),
      );
    case "Price low to high":
      return copy.sort((a, b) => priceOr(a, Infinity) - priceOr(b, Infinity));
    case "Price high to low":
      return copy.sort((a, b) => priceOr(b, -Infinity) - priceOr(a, -Infinity));
    case "Best rated":
      return copy.sort((a, b) => (corpus.ratings[b.id] ?? 0) - (corpus.ratings[a.id] ?? 0));
    case "Relevance":
    default:
      return copy.sort((a, b) => b.score - a.score);
  }
}

/** A result with no price (a business, a category) sorts to the given end. */
function priceOr(item: SearchResultItem, fallback: number): number {
  return item.price ?? fallback;
}

/** Section 16: autocomplete, from the same corpus and the same scorer. */
export function suggest(corpus: SearchCorpus, query: string, limit = 8): string[] {
  const term = normalize(query);
  if (!term) return [];
  const pool = new Set<string>();
  for (const product of corpus.products) pool.add(product.name);
  for (const business of corpus.businesses) pool.add(business.name);
  for (const category of corpus.categories) pool.add(category.name);
  for (const promotion of corpus.promotions) pool.add(promotion.title);

  return [...pool]
    .map((name) => ({ name, score: scoreText(name, [term]) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.name);
}

/** True when every query term appears literally - i.e. no typo was corrected. */
function matchedExactly(items: SearchResultItem[], query: string): boolean {
  const queryTerms = terms(query);
  if (!queryTerms.length) return true;
  return items.some((item) =>
    queryTerms.every((term) => normalize(item.title).includes(term)),
  );
}

/**
 * Section 16, end to end. Filtering, sorting and pagination all happen
 * server-side; the browser receives exactly one page.
 */
export function search(
  corpus: SearchCorpus,
  query: string,
  options: {
    filters?: SearchFilters;
    sort?: SortOption;
    page?: number;
    pageSize?: number;
  } = {},
): SearchResponse {
  const filters = options.filters ?? {};
  const sort = SORT_OPTIONS.includes(options.sort as SortOption)
    ? (options.sort as SortOption)
    : "Relevance";
  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  const sorted = sortItems(candidates(corpus, query, filters), sort, corpus);
  const total = sorted.length;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const start = (page - 1) * pageSize;

  return {
    items: sorted.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
    suggestions: suggest(corpus, query),
    corrected: total > 0 && !matchedExactly(sorted, query),
  };
}
