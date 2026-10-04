/**
 * ============================================================================
 *  CategoryNavigation (spec §4 desktop bar, §7 phone shortcuts)
 * ============================================================================
 *
 *  Same data, two presentations:
 *
 *    laptop+  a full horizontal bar of every category, which wraps rather than
 *             truncating - a category a shopper cannot see is a category they
 *             will not click.
 *    phone    a horizontally scrollable rail of small visual cards. The rail
 *             scrolls INSIDE its own container, so the page itself never
 *             scrolls sideways (spec §8: "No horizontal overflow").
 *
 *  TWO LEVELS, BECAUSE ONE IS NOT ENOUGH (Section 17)
 *  --------------------------------------------------
 *  "Fashion" on its own tells a shopper nothing about what is inside it, so the
 *  second row lists the subcategories of whichever main category is active:
 *  Fashion -> Men Clothes, Women Clothes, Kids Clothes, Shoes, Jewellery.
 *
 *  WHICH MAIN CATEGORY IS "ACTIVE"
 *  ------------------------------
 *  The one whose id is `selected`, OR the parent of `selected` when a
 *  SUBCATEGORY is selected. That is why picking "Jewellery" keeps the Fashion
 *  bar highlighted instead of resetting to nothing - otherwise the shopper
 *  loses their place after one tap.
 *
 *  Categories come from the API and are reusable for dynamic data (spec §4),
 *  so adding a category on the backend needs no code change here.
 */

import { ChevronRight } from "lucide-react";
import { TOUCH } from "./ProductCard";
import type { CategoryChip } from "./types";

export function CategoryNavigation({
  categories,
  selected,
  onSelect,
  allLabel = "All",
}: {
  categories: CategoryChip[];
  selected: string;
  onSelect: (categoryId: string) => void;
  allLabel?: string;
}) {
  if (!categories.length) return null;

  // Which main category's children are on show. A subcategory id resolves back
  // to its parent; a main category resolves to itself; "All" resolves to none.
  const activeMain =
    categories.find((category) => category.id === selected) ??
    categories.find((category) =>
      category.subcategories.some((sub) => sub.id === selected),
    ) ??
    null;

  const subcategories = activeMain?.subcategories ?? [];
  const selectedSubId = subcategories.some((sub) => sub.id === selected) ? selected : "";

  return (
    <nav
      aria-label="Product categories"
      className="border-b border-yene-line-soft bg-yene-surface/40"
    >
      {/* ---- Phone: a scrollable rail of small visual cards (spec §7) ----

          THE VISIBILITY CLASS IS ON A WRAPPER, NOT ON THE RAIL. `yene-rail`
          sets `display:flex` and is emitted LATER in the stylesheet than
          `tablet:hidden`; both are single-class selectors, so the later rule
          wins and the rail stayed visible at every width. That is what put the
          phone rail and the desktop bar on screen together. Wrapping keeps the
          two concerns separate: the wrapper answers "which breakpoint am I at",
          the rail answers "lay my children out in a row". */}
      <div className="tablet:hidden">
        <div className="yene-rail px-4 py-3">
          <CategoryTile
            label={allLabel}
            count={null}
            active={selected === ""}
            onClick={() => onSelect("")}
          />
          {categories.map((category) => (
            <CategoryTile
              key={category.id}
              label={category.name}
              count={category.listingCount}
              active={category.id === activeMain?.id && selectedSubId === ""}
              onClick={() => onSelect(category.id)}
            />
          ))}
        </div>
      </div>

      {/* ---- Phone: the subcategories of the active main category ----
          Same wrapper rule as the tile rail above - `yene-rail` and the
          visibility class cannot share one element. */}
      {subcategories.length > 0 && (
        <div className="tablet:hidden">
          <ul
            aria-label={`${activeMain!.name} subcategories`}
            className="yene-rail gap-1.5 border-t border-yene-line-soft px-4 py-2"
          >
            <SubcategoryPill
              label={allLabel}
              active={selectedSubId === ""}
              onClick={() => onSelect(activeMain!.id)}
            />
            {subcategories.map((sub) => (
              <SubcategoryPill
                key={sub.id}
                label={sub.name}
                active={sub.id === selectedSubId}
                onClick={() => onSelect(sub.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {/* ---- Tablet and up: a wrapping bar (spec §4) ---- */}
      <div className="hidden px-4 tablet:block tablet:px-6 desktop:px-8">
        <ul className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-1.5 py-2.5">
          <CategoryPill
            label={allLabel}
            count={null}
            active={selected === ""}
            onClick={() => onSelect("")}
          />
          {categories.map((category) => (
            <CategoryPill
              key={category.id}
              label={category.name}
              count={category.listingCount}
              // A main category stays highlighted while one of its
              // subcategories is selected, so the shopper keeps their place.
              active={category.id === activeMain?.id}
              onClick={() => onSelect(category.id)}
            />
          ))}
        </ul>

        {/* Section 17: the second row, only for the active main category. */}
        {subcategories.length > 0 && (
          <ul
            aria-label={`${activeMain!.name} subcategories`}
            className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-1.5 border-t border-yene-line-soft py-2"
          >
            <SubcategoryPill
              label={`All ${activeMain!.name}`}
              active={selectedSubId === ""}
              onClick={() => onSelect(activeMain!.id)}
            />
            {subcategories.map((sub) => (
              <SubcategoryPill
                key={sub.id}
                label={sub.name}
                active={sub.id === selectedSubId}
                onClick={() => onSelect(sub.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

/**
 * One category, as a tile in the phone rail.
 *
 * The tile is the LABEL, its volume, and nothing else. It used to sit above a
 * circular badge carrying the first letter of the name ("A" for All, "F" for
 * Fashion), which repeated the label's own first character one line above it and
 * added nothing a shopper could not read faster from the word itself. Two thirds
 * of the sections started with a different letter anyway (Food, Fashion and
 * Footwear all becoming some variant of "F"), so the badge was decoration that
 * made the rail taller without making it clearer.
 *
 * The volume now sits UNDER the name instead, which is the space the badge used
 * to occupy. On a classifieds board a shopper decides where to look first by
 * reading how much of the market each section holds, so the number earns the
 * space rather than merely filling it.
 *
 * The active state moves onto the tile's own border and background, which is
 * what a shopper actually needs to see: where they are.
 */
function CategoryTile({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`${TOUCH} flex w-[86px] flex-col items-center justify-center gap-0.5 rounded-card border px-2 py-3 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
        active
          ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
          : "border-yene-line-soft bg-yene-surface text-yene-muted hover:border-yene-accent/50"
      }`}
    >
      <span className="line-clamp-2 text-[11px] font-medium leading-tight">{label}</span>
      {count !== null && (
        <span className={`text-[10px] ${active ? "opacity-80" : "text-yene-faint"}`}>
          {count.toLocaleString("en-US")} ads
        </span>
      )}
    </button>
  );
}

/**
 * A subcategory chip.
 *
 * Visually quieter than a main `CategoryPill` and always carries a chevron, so
 * the two levels are distinguishable at a glance without reading the labels.
 */
function SubcategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={`${TOUCH} inline-flex items-center gap-0.5 rounded-full px-3 text-[12.5px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
          active
            ? "bg-yene-accent text-yene-on-accent"
            : "border border-yene-line-soft text-yene-muted hover:border-yene-accent/50 hover:text-yene-text"
        }`}
      >
        {label}
        {/* The chevron is the cue that these sit UNDER a main category. It is
            decorative - the row carries its own aria-label. */}
        <ChevronRight size={12} aria-hidden className="opacity-50" />
      </button>
    </li>
  );
}

function CategoryPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={`${TOUCH} rounded-full border px-3.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
          active
            ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
            : "border-yene-line-soft bg-yene-surface text-yene-muted hover:border-yene-accent/50 hover:text-yene-text"
        }`}
      >
        {label}
        {/* The volume is what tells a shopper where the market is. `aria-hidden`
            because the button already reads as "Fashion" and the number is
            supporting detail, not part of the control's name. */}
        {count !== null && (
          <span aria-hidden className="ml-1.5 text-[11px] opacity-60">
            {count.toLocaleString("en-US")}
          </span>
        )}
      </button>
    </li>
  );
}
