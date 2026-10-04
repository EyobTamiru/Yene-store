/**
 * ============================================================================
 *  CATEGORIES (Section 17)
 * ============================================================================
 *
 *  The fourteen initial categories are listed exactly as the specification
 *  gives them. They are DATA, not a switch statement, so a Super Admin can
 *  add one without a deploy.
 *
 *  Section 17's two hard rules are enforced in `applyCategoryChange` below,
 *  not left to callers:
 *
 *    "Create / Edit / Delete where safe / Reorder / Subcategories /
 *     Enable-disable"
 *    "Do not delete products simply because a category changes."
 *
 *  The second one is the interesting one. Disabling a category hides it; it
 *  does not orphan a single product. Re-parenting a subcategory does not
 *  touch products either - products carry the category id, and the category
 *  tree is an independent structure.
 */

import type { Category, Product } from "./types";

/**
 * Section 17: the initial category list, in the order given.
 *
 * These are the sections of the board a shopper in Ethiopia actually browses -
 * vehicles, property, phones, and so on - each carrying the number of listings
 * it holds so the nav can show where the market is. DATA, not a switch
 * statement, so a Super Admin can add one without a deploy.
 *
 * `listingCount` is the volume shown beside the name. It is a DISPLAYED figure
 * stored on the row rather than counted from the product table: a classifieds
 * category counts offers to sell, not units in stock, and a count that
 * recomputed on every seed would make the demo numbers move every time
 * somebody added a product.
 */
export const INITIAL_CATEGORIES: Category[] = (
  [
    ["Vehicles", 26_366],
    ["Property", 22_843],
    ["Phones & Tablets", 44_483],
    ["Electronics", 407_791],
    ["Home, Furniture & Appliances", 78_860],
    ["Fashion", 43_235],
    ["Beauty & Personal Care", 43_597],
    ["Services", 2_824],
    ["Repair & Construction", 24_127],
    ["Commercial Equipment & Tools", 79_441],
    ["Leisure & Activities", 15_397],
    ["Babies & Kids", 11_449],
    ["Food, Agriculture & Farming", 3_373],
    ["Animals & Pets", 8_565],
    ["Jobs", 55],
    ["Seeking Work - CVs", 1_634],
    ["Business & Industry", 140],
    ["Others", 4_210],
  ] as const
).map(([name, listingCount], index) => ({
  id: slug(name),
  name,
  parentId: null,
  position: index,
  enabled: true,
  listingCount,
}));

/**
 * The subcategories that sit under each main category (Section 17).
 *
 * A flat list of fourteen main categories is not browsable: "Fashion" is too
 * coarse to be useful and too broad to be honest. These give each one real
 * children, so the header can show a main category and then the things actually
 * inside it - Fashion -> Men Clothes, Women Clothes, Kids Clothes, Shoes,
 * Jewellery.
 *
 * DATA, NOT CODE. A Super Admin adds or renames one of these through the
 * Section 17 category admin, and the header re-renders with no deploy - which is
 * the same promise `INITIAL_CATEGORIES` makes.
 *
 * ONE LEVEL ONLY, ON PURPOSE
 * -------------------------
 * `parentId` is a single field, so a subcategory cannot itself have children.
 * A third level would need a tree the product row, the search filter and the
 * admin UI do not currently carry. "Jewellery" is the honest leaf: a shopper
 * looking for a sapphire ring wants Jewellery, not a second page of questions.
 */
export const INITIAL_SUBCATEGORIES: { parent: string; name: string }[] = [
  // ---- Vehicles ----
  { parent: "vehicles", name: "Cars For Sale" },
  { parent: "vehicles", name: "Motorcycles" },
  { parent: "vehicles", name: "Bikes & Scooters" },
  { parent: "vehicles", name: "Trucks & Buses" },
  { parent: "vehicles", name: "Vehicle Parts" },
  { parent: "vehicles", name: "Car Accessories" },
  // ---- Property ----
  { parent: "property", name: "Houses For Rent" },
  { parent: "property", name: "Houses For Sale" },
  { parent: "property", name: "Apartments" },
  { parent: "property", name: "Commercial Property" },
  { parent: "property", name: "Land & Plots" },
  { parent: "property", name: "Shared Accommodation" },
  // ---- Phones & Tablets ----
  { parent: "phones-tablets", name: "Smartphones" },
  { parent: "phones-tablets", name: "Feature Phones" },
  { parent: "phones-tablets", name: "Tablets" },
  { parent: "phones-tablets", name: "Phone Accessories" },
  { parent: "phones-tablets", name: "Tablets Accessories" },
  // ---- Electronics ----
  { parent: "electronics", name: "Televisions" },
  { parent: "electronics", name: "Audio & Sound" },
  { parent: "electronics", name: "Cameras & Camcorders" },
  { parent: "electronics", name: "Gaming Consoles" },
  { parent: "electronics", name: "Laptops & Desktops" },
  { parent: "electronics", name: "Computer Accessories" },
  // ---- Home, Furniture & Appliances ----
  { parent: "home-furniture-appliances", name: "Furniture" },
  { parent: "home-furniture-appliances", name: "Kitchen Appliances" },
  { parent: "home-furniture-appliances", name: "Home Decor" },
  { parent: "home-furniture-appliances", name: "Bedding & Linen" },
  { parent: "home-furniture-appliances", name: "Garden & Outdoor" },
  // ---- Fashion ----
  { parent: "fashion", name: "Men Clothes" },
  { parent: "fashion", name: "Women Clothes" },
  { parent: "fashion", name: "Kids Clothes" },
  { parent: "fashion", name: "Shoes" },
  { parent: "fashion", name: "Bags & Accessories" },
  { parent: "fashion", name: "Jewellery & Watches" },
  // ---- Beauty & Personal Care ----
  { parent: "beauty-personal-care", name: "Makeup" },
  { parent: "beauty-personal-care", name: "Skincare" },
  { parent: "beauty-personal-care", name: "Haircare" },
  { parent: "beauty-personal-care", name: "Fragrance & Attar" },
  { parent: "beauty-personal-care", name: "Salon & Spa" },
  // ---- Services ----
  { parent: "services", name: "Education & Training" },
  { parent: "services", name: "Health & Wellness" },
  { parent: "services", name: "Transport & Delivery" },
  { parent: "services", name: "Event Services" },
  { parent: "services", name: "Professional Services" },
  // ---- Repair & Construction ----
  { parent: "repair-construction", name: "Construction" },
  { parent: "repair-construction", name: "Plumbing & Electrical" },
  { parent: "repair-construction", name: "Painting & Finishing" },
  { parent: "repair-construction", name: "Carpentry & Roofing" },
  { parent: "repair-construction", name: "Cleaning & Maintenance" },
  // ---- Commercial Equipment & Tools ----
  { parent: "commercial-equipment-tools", name: "Power Tools" },
  { parent: "commercial-equipment-tools", name: "Agricultural Machinery" },
  { parent: "commercial-equipment-tools", name: "Factory Machinery" },
  { parent: "commercial-equipment-tools", name: "Office Equipment" },
  { parent: "commercial-equipment-tools", name: "Safety Equipment" },
  // ---- Leisure & Activities ----
  { parent: "leisure-activities", name: "Fitness & Gym" },
  { parent: "leisure-activities", name: "Team Sports" },
  { parent: "leisure-activities", name: "Camping & Outdoor" },
  { parent: "leisure-activities", name: "Hobbies & Crafts" },
  { parent: "leisure-activities", name: "Sportswear" },
  // ---- Babies & Kids ----
  { parent: "babies-kids", name: "Baby Clothes" },
  { parent: "babies-kids", name: "Baby Gear" },
  { parent: "babies-kids", name: "Toys & Games" },
  { parent: "babies-kids", name: "Nursery & School" },
  { parent: "babies-kids", name: "Kids Footwear" },
  // ---- Food, Agriculture & Farming ----
  { parent: "food-agriculture-farming", name: "Coffee & Tea" },
  { parent: "food-agriculture-farming", name: "Grains & Pulses" },
  { parent: "food-agriculture-farming", name: "Spices & Sauces" },
  { parent: "food-agriculture-farming", name: "Fresh Produce" },
  { parent: "food-agriculture-farming", name: "Farm Machinery" },
  // ---- Animals & Pets ----
  { parent: "animals-pets", name: "Dogs" },
  { parent: "animals-pets", name: "Cats" },
  { parent: "animals-pets", name: "Livestock" },
  { parent: "animals-pets", name: "Pet Supplies" },
  { parent: "animals-pets", name: "Veterinary" },
  // ---- Jobs ----
  { parent: "jobs", name: "Full Time Jobs" },
  { parent: "jobs", name: "Part Time Jobs" },
  { parent: "jobs", name: "Contract & Freelance" },
  { parent: "jobs", name: "Internships" },
  { parent: "jobs", name: "Remote Jobs" },
  // ---- Seeking Work - CVs ----
  { parent: "seeking-work-cvs", name: "Accounting & Finance" },
  { parent: "seeking-work-cvs", name: "Sales & Marketing" },
  { parent: "seeking-work-cvs", name: "Engineering & IT" },
  { parent: "seeking-work-cvs", name: "Healthcare" },
  { parent: "seeking-work-cvs", name: "Education & Teaching" },
  // ---- Business & Industry ----
  { parent: "business-industry", name: "Manufacturing" },
  { parent: "business-industry", name: "Wholesale & Distribution" },
  { parent: "business-industry", name: "Import & Export" },
  { parent: "business-industry", name: "Construction Materials" },
  { parent: "business-industry", name: "Franchise & Investment" },
  // ---- Others ----
  { parent: "others", name: "Clearance Sale" },
  { parent: "others", name: "Bulk Orders" },
  { parent: "others", name: "Everything Else" },
];

/**
 * A subcategory id, namespaced by its parent.
 *
 * The previous scheme was `${slug(name)}-${count}`, which collides the moment
 * two main categories share a child name: Fashion/Shoes and Sports/Shoes both
 * produced `shoes-1`, and a product pointing at one would silently appear under
 * the other. Prefixing the parent makes the id unique by construction.
 */
export function subcategoryId(parentId: string, name: string): string {
  return `${parentId}-${slug(name)}`;
}

/** The seeded subcategory rows, in the order the header should show them. */
export function buildInitialSubcategories(
  parents: Category[] = INITIAL_CATEGORIES,
): Category[] {
  return INITIAL_SUBCATEGORIES.map((entry) => ({
    id: subcategoryId(entry.parent, entry.name),
    name: entry.name,
    parentId: entry.parent,
    // Position is scoped to the parent, which is how `subcategoriesOf` orders
    // them - so every parent's list starts at zero rather than continuing the
    // global count.
    position: INITIAL_SUBCATEGORIES.filter((other) => other.parent === entry.parent).indexOf(entry),
    enabled: parents.some((parent) => parent.id === entry.parent && parent.enabled),
    // A subcategory shows no listing count of its own. The figure belongs to the
    // section the shopper is browsing, and inventing one per child would be a
    // number with no source behind it.
    listingCount: null,
  }));
}

/**
 * Every main category id, and the subcategories beneath it.
 *
 * Exported so a seeder can be checked against the taxonomy it is about to write
 * into: a product filed under a category that no longer exists is invisible in
 * the marketplace with no error anywhere, which is the failure this makes loud.
 */
export function taxonomyIndex(parents: Category[] = INITIAL_CATEGORIES): {
  mains: Set<string>;
  children: Set<string>;
} {
  return {
    mains: new Set(parents.map((category) => category.id)),
    children: new Set(
      INITIAL_SUBCATEGORIES.map((entry) => subcategoryId(entry.parent, entry.name)),
    ),
  };
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Create a subcategory under an existing parent (Section 17). */
export function createSubcategory(
  categories: Category[],
  parentId: string,
  name: string,
): Category {
  const parent = categories.find((c) => c.id === parentId);
  if (!parent) throw new Error(`Unknown parent category: ${parentId}`);
  const siblings = categories.filter((c) => c.parentId === parentId);
  const created: Category = {
    // Namespaced by parent, so "Shoes" under Fashion and "Shoes" under Sports are
    // different rows with different ids. See `subcategoryId`.
    id: subcategoryId(parentId, name),
    name,
    parentId,
    position: siblings.length,
    enabled: true,
    // A subcategory added by hand carries no volume until someone counts it.
    listingCount: null,
  };
  categories.push(created);
  return created;
}

/**
 * Section 17: enable/disable a category.
 *
 * Disabling is a VISIBILITY change. `affectedProducts` is returned so the UI
 * can say "142 products are in this category and are unaffected" - which is
 * the honest statement, and the one that stops a merchant from believing
 * their catalogue has been emptied.
 */
export function applyCategoryChange(
  categories: Category[],
  products: Product[],
  categoryId: string,
  change: { enabled?: boolean; name?: string },
): { category: Category | null; affectedProducts: number } {
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return { category: null, affectedProducts: 0 };

  if (typeof change.enabled === "boolean") category.enabled = change.enabled;
  if (typeof change.name === "string" && change.name.trim()) {
    category.name = change.name.trim();
  }

  // Counted, never touched. Section 17: products are not deleted because a
  // category changes.
  const affectedProducts = products.filter(
    (p) => p.categoryId === categoryId || p.subcategoryId === categoryId,
  ).length;

  return { category, affectedProducts };
}

/** Section 17: reorder categories. Positions are rewritten, products are not. */
export function reorderCategories(categories: Category[], orderedIds: string[]): Category[] {
  const top = orderedIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => !!c && c.parentId === null);
  top.forEach((category, index) => {
    category.position = index;
  });
  return categories;
}

/**
 * Section 17: delete a category only where it is SAFE.
 *
 * Safe means: no products reference it. Where it is not safe the caller is
 * told to move the products first. Deleting a category that still holds
 * products would either orphan them or delete them, and the specification
 * forbids both.
 */
export function canDeleteCategory(
  categoryId: string,
  products: Product[],
  categories: Category[],
): { allowed: boolean; reason: string; productCount: number } {
  const productCount = products.filter(
    (p) => p.categoryId === categoryId || p.subcategoryId === categoryId,
  ).length;
  if (productCount > 0) {
    return {
      allowed: false,
      productCount,
      reason:
        `${productCount} product(s) are in this category. Move them to another category first - YENE-STORE does not delete products when a category changes.`,
    };
  }
  const childCount = categories.filter((c) => c.parentId === categoryId).length;
  if (childCount > 0) {
    return {
      allowed: false,
      productCount,
      reason: `This category has ${childCount} subcategor${childCount === 1 ? "y" : "ies"}. Remove or move them first.`,
    };
  }
  return { allowed: true, productCount, reason: "Safe to delete." };
}

export function deleteCategory(categories: Category[], categoryId: string): boolean {
  const index = categories.findIndex((c) => c.id === categoryId);
  if (index === -1) return false;
  categories.splice(index, 1);
  return true;
}

export function enabledCategories(categories: Category[]): Category[] {
  return categories
    .filter((c) => c.enabled)
    .sort((a, b) => a.position - b.position);
}

// ---------------------------------------------------------------------------
// The two-level tree the header renders
// ---------------------------------------------------------------------------

/** One main category with its subcategories already nested inside it. */
export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  /**
   * Listings shown beside this section's name in the nav.
   *
   * Carried through the tree rather than re-fetched by the component, so the
   * number beside a category and the section a shopper lands on cannot come
   * from two different reads of the same row.
   */
  listingCount: number | null;
  subcategories: { id: string; name: string }[];
}

/** Just the main categories - the ones with no parent - in display order. */
export function topLevelCategories(categories: Category[]): Category[] {
  return enabledCategories(categories)
    .filter((c) => c.parentId === null)
    .sort((a, b) => a.position - b.position);
}

/** One main category's enabled subcategories, in their own order. */
export function subcategoriesOf(categories: Category[], parentId: string): Category[] {
  return enabledCategories(categories)
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.position - b.position);
}

/**
 * The main -> subcategory tree, for the header.
 *
 * Built HERE rather than in a React component because four callers need the
 * same shape: the header bar, the search select, the search suggestion list and
 * the verification suite. Computing it once in the domain means the header
 * cannot show a subcategory that search would then refuse to find.
 *
 * A subcategory whose parent is disabled or missing is NOT surfaced. It is not
 * deleted - Section 17's "do not delete products" rule applies to the row, and
 * this is only a visibility decision - but offering a child with no parent in a
 * two-level menu is a dead end.
 */
export function categoryTree(categories: Category[]): CategoryNode[] {
  const parents = topLevelCategories(categories);
  return parents.map((parent) => ({
    id: parent.id,
    name: parent.name,
    parentId: null,
    listingCount: parent.listingCount ?? null,
    subcategories: subcategoriesOf(categories, parent.id).map((child) => ({
      id: child.id,
      name: child.name,
    })),
  }));
}

/**
 * The main category a subcategory belongs to, or null for a main category.
 *
 * Used when a product is filed under a subcategory: the card has to be able to
 * answer "which main category is this?" so that filtering by Fashion still
 * returns a product filed as Fashion / Jewellery.
 */
export function parentCategoryOf(categories: Category[], categoryId: string): Category | null {
  const entry = categories.find((c) => c.id === categoryId);
  if (!entry) return null;
  if (entry.parentId === null) return entry;
  return categories.find((c) => c.id === entry.parentId) ?? null;
}
