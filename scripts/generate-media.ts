/**
 * ============================================================================
 *  MEDIA GENERATOR
 * ============================================================================
 *
 *  Run with:  npx tsx scripts/generate-media.ts
 *
 *  WHY GENERATED FILES RATHER THAN URLs
 *  -----------------------------------
 *  Every seeded product had `imageUrl: null`, which the card renders as a
 *  designed placeholder. That is honest, but it means a shop front has no
 *  pictures at all. The obvious fix - pasting an Unsplash or placeholder.com URL
 *  into the seed - would have been worse than nothing:
 *
 *    - those images 404 or change without warning,
 *    - the project would depend on a third party at render time, and
 *    - the marketplace documentation is explicit that a card may never show a
 *      SUBSTITUTE image, because a borrowed picture reads as a real listing.
 *
 *  So the assets are real, local and deterministic: SVG written into
 *  `data/media/` and served by `GET /api/media/:file`. Re-running produces byte
 *  identical files, so a diff shows only the assets that genuinely changed.
 *
 *  WHAT IS GENERATED
 *  -----------------
 *    stores/<id>-logo.svg     the mark on a storefront and a dashboard
 *    stores/<id>-cover.svg    the wide header banner behind the store name
 *    products/<id>.svg        the square card image
 *
 *  Every image carries its own subject and its business initials, so a card is
 *  recognisable at thumbnail size instead of being an abstract gradient that
 *  says nothing about what is for sale.
 */

import fs from "node:fs";
import path from "node:path";

const mediaDir = path.resolve(process.cwd(), "data", "media");
const storeDir = path.join(mediaDir, "stores");
const productDir = path.join(mediaDir, "products");

/** The YENE-STORE palette, so a generated asset looks like the app. */
const INK = "#0d1117";
const ACCENT = "#3DDC97";

/** Escape text for inclusion in SVG. Store names are user-supplied in production. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A stable hue per business, derived from its id.
 *
 * Hashing the id rather than the name means renaming a shop does not silently
 * repaint every one of its products, and two shops never collide by accident.
 */
function hueFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

/** Up to two initials from a trading name. */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Y";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function write(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf8");
}

/** The round mark: a storefront badge showing the business initials. */
export function logoSvg(name: string, id: string): string {
  const hue = hueFor(id);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="${esc(name)}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="hsl(${hue} 55% 28%)"/>
    <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 60% 16%)"/>
  </linearGradient></defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <rect x="8" y="8" width="112" height="112" rx="22" fill="none" stroke="${ACCENT}" stroke-opacity="0.35" stroke-width="2"/>
  <text x="64" y="64" text-anchor="middle" dominant-baseline="central"
        font-family="Segoe UI, system-ui, sans-serif" font-size="44" font-weight="700"
        fill="${ACCENT}">${esc(initials(name))}</text>
</svg>
`;
}

/** The wide header banner behind a storefront's name. */
export function coverSvg(name: string, id: string, tagline: string): string {
  const hue = hueFor(id);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" width="1200" height="400" role="img" aria-label="${esc(name)} cover">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 48% 20%)"/>
      <stop offset="55%" stop-color="hsl(${(hue + 25) % 360} 42% 13%)"/>
      <stop offset="100%" stop-color="${INK}"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0V48" fill="none" stroke="${ACCENT}" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1200" height="400" fill="url(#bg)"/>
  <rect width="1200" height="400" fill="url(#grid)"/>
  <circle cx="980" cy="90" r="150" fill="${ACCENT}" fill-opacity="0.08"/>
  <circle cx="150" cy="340" r="120" fill="${ACCENT}" fill-opacity="0.05"/>
  <text x="72" y="196" font-family="Segoe UI, system-ui, sans-serif" font-size="54"
        font-weight="700" fill="#ffffff">${esc(name)}</text>
  <text x="72" y="248" font-family="Segoe UI, system-ui, sans-serif" font-size="23"
        fill="${ACCENT}" fill-opacity="0.85">${esc(tagline)}</text>
  <rect x="72" y="278" width="88" height="5" rx="2.5" fill="${ACCENT}"/>
</svg>
`;
}

/**
 * The square product card image.
 *
 * Built from the product's own words and its category, so two products never
 * render the same picture and a shopper can tell at a glance which section a
 * card belongs to.
 */
export function productSvg(name: string, categoryLabel: string, id: string): string {
  const hue = hueFor(id);
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const mark = (words[0] ?? "Y").slice(0, 2).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img" aria-label="${esc(name)}">
  <defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="hsl(${hue} 40% 22%)"/>
    <stop offset="100%" stop-color="hsl(${(hue + 45) % 360} 38% 11%)"/>
  </linearGradient></defs>
  <rect width="600" height="600" fill="url(#p)"/>
  <circle cx="300" cy="268" r="132" fill="${ACCENT}" fill-opacity="0.10"/>
  <circle cx="300" cy="268" r="132" fill="none" stroke="${ACCENT}" stroke-opacity="0.3" stroke-width="2"/>
  <text x="300" y="268" text-anchor="middle" dominant-baseline="central"
        font-family="Segoe UI, system-ui, sans-serif" font-size="96" font-weight="700"
        fill="${ACCENT}" fill-opacity="0.9">${esc(mark)}</text>
  <text x="300" y="472" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif"
        font-size="27" font-weight="600" fill="#ffffff" fill-opacity="0.92">${esc(
          words.slice(0, 3).join(" ") || name,
        )}</text>
  <text x="300" y="514" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif"
        font-size="19" fill="${ACCENT}" fill-opacity="0.7">${esc(categoryLabel)}</text>
</svg>
`;
}

export function mediaPaths() {
  return { mediaDir, storeDir, productDir };
}

if (process.argv[1] && process.argv[1].includes("generate-media")) {
  // Read the LIVE businesses and products rather than a duplicate seed list, so
  // an image can never describe a product that no longer exists.
  const dataDir = path.resolve(process.cwd(), "data");
  const businesses = JSON.parse(
    fs.readFileSync(path.join(dataDir, "platform-businesses.json"), "utf8"),
  ) as {
    id: string;
    name: string;
    customization: { logoUrl: string | null; coverImageUrl: string | null };
  }[];
  const products = JSON.parse(
    fs.readFileSync(path.join(dataDir, "platform-products.json"), "utf8"),
  ) as {
    id: string;
    name: string;
    businessId: string;
    categoryId: string;
    imageUrl: string | null;
  }[];
  const categories = JSON.parse(
    fs.readFileSync(path.join(dataDir, "platform-categories.json"), "utf8"),
  ) as { id: string; name: string }[];

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  let logos = 0;
  let covers = 0;
  let productImages = 0;

  for (const business of businesses) {
    // Only businesses that HAVE ASKED for artwork get any: a store with
    // `logoUrl: null` keeps rendering the designed placeholder, because a
    // generated mark is not the merchant's own branding.
    if (!business.customization.logoUrl) continue;
    write(path.join(storeDir, `${business.id}-logo.svg`), logoSvg(business.name, business.id));
    logos += 1;

    if (business.customization.coverImageUrl) {
      write(
        path.join(storeDir, `${business.id}-cover.svg`),
        coverSvg(business.name, business.id, "Welcome to our YENE-STORE shop"),
      );
      covers += 1;
    }
  }

  for (const product of products) {
    if (!product.imageUrl) continue;
    write(
      path.join(productDir, `${product.id}.svg`),
      productSvg(product.name, categoryName.get(product.categoryId) ?? "Marketplace", product.id),
    );
    productImages += 1;
  }

  console.log(
    `Generated ${logos} logos, ${covers} covers, ${productImages} product images into data/media/`,
  );
}