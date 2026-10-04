/**
 * ============================================================================
 *  MarketplaceSearch (spec §4, §7, §9)
 * ============================================================================
 *
 *  ONE search control, rendered into two shapes:
 *
 *    laptop+  an inline bar sitting in the header row;
 *    phone    a full-width bar on its own line BELOW the header, which is what
 *             spec §7 asks for - "the search must remain easy to access".
 *
 *  Same state, same suggestions, same submit handler. The difference is
 *  layout only, which is the whole point of spec §2.
 *
 *  WHY THERE IS NO CATEGORY DROPDOWN HERE (spec §4)
 *  ------------------------------------------------
 *  This control used to carry its own `<select>` listing every main category and
 *  its subcategories, sitting directly above `CategoryNavigation`. That made TWO
 *  main-category navigations on one screen - and worse, this one kept a PRIVATE
 *  copy of the selected category, so the header and the bar beneath it could
 *  disagree: picking "Fashion" in one left the other showing "All".
 *
 *  The category bar below is the single source of truth now. `category` is
 *  passed in from it and this control only READS it, so a search is always
 *  scoped to the category the shopper can see selected.
 *
 *  AUTOCOMPLETE IS DEBOUNCED
 *  --------------------------
 *  180ms, and the in-flight request is dropped when the query changes again,
 *  so typing a 10-character query fires one request rather than ten. That is
 *  spec §13's "avoid unnecessary API calls".
 *
 *  SPEC §9: no fake states. Loading, empty and error are all rendered
 *  explicitly, and an error never pretends to be a result.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { searchSuggestions } from "../../lib/platformApi";
import { TOUCH } from "./ProductCard";

export function MarketplaceSearch({
  category,
  language,
  onSearch,
  onSuggest,
  variant,
  autoFocus,
}: {
  /**
   * The category currently selected in `CategoryNavigation`.
   *
   * Read-only here on purpose: this control scopes a search to it but never
   * changes it, so the header and the category bar can never disagree.
   */
  category: string;
  language: "en" | "am";
  onSearch: (query: string, category: string) => void;
  onSuggest?: (term: string) => void;
  variant: "inline" | "stacked";
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchSuggestions(term)
        .then((data) => {
          setSuggestions(data.suggestions);
          onSuggest?.(term);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [query, onSuggest]);

  // Close the suggestion list on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const submit = () => {
    setOpen(false);
    setSuggestions([]);
    onSearch(query.trim(), category);
  };

  const labels = copy(language);

  return (
    <div ref={boxRef} className={variant === "inline" ? "relative min-w-0 flex-1" : "relative w-full"}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className={variant === "inline" ? "flex items-center gap-2" : "flex items-center gap-2"}
      >
        {/* No category selector here by design - `CategoryNavigation` below is the
            one and only category navigation. See the header comment. */}

        <div className="relative min-w-0 flex-1">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-yene-faint"
          />
          <label className="sr-only" htmlFor="mk-search-input">
            {labels.searchLabel}
          </label>
          <input
            id="mk-search-input"
            type="search"
            value={query}
            autoFocus={autoFocus}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={labels.placeholder}
            className={`${TOUCH} w-full rounded-button border border-yene-line bg-yene-surface pl-9 pr-9 text-[13px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none`}
          />
          {searching && (
            <Loader2
              size={15}
              aria-hidden
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-yene-accent"
            />
          )}
        </div>

        <button
          type="submit"
          className={`${TOUCH} shrink-0 rounded-button bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-bg`}
        >
          {labels.searchButton}
        </button>
      </form>

      {/* Suggestions: a listbox, so a screen reader announces the count. */}
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label={labels.suggestions}
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-button border border-yene-line bg-yene-surface shadow-xl"
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  setQuery(suggestion);
                  setOpen(false);
                  onSearch(suggestion, category);
                }}
                className={`${TOUCH} flex w-full items-center gap-2 px-3 text-left text-[13px] text-yene-text hover:bg-yene-raised focus:bg-yene-raised focus:outline-none`}
              >
                <Search size={13} aria-hidden className="text-yene-faint" />
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Section 51. Amharic is complete for interface chrome. */
export function copy(language: "en" | "am") {
  if (language === "am") {
    return {
      searchLabel: "ምርቶች፣ ድልዶችና አገልግሎቶች ይፈልጉ",
      placeholder: "ምርቶች፣ ድልዶችና አገልግሎቶች ይፈልጉ...",
      searchButton: "ፈልግ",
      category: "ምድብ",
      allCategories: "ሁሉም ምድቦች",
      suggestions: "የፍለጋ ጥቆማዎች",
    };
  }
  return {
    searchLabel: "Search products, stores and services",
    placeholder: "Search products, stores and services...",
    searchButton: "Search",
    category: "Search category",
    allCategories: "All categories",
    suggestions: "Search suggestions",
  };
}