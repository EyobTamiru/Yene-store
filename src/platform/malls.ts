/**
 * ============================================================================
 *  MALLS (Section 41)
 * ============================================================================
 *
 *  Section 41 is one line in the specification:
 *
 *      Business Type -> Mall Store -> Mall -> Floor -> Room/Shop Number
 *                                           -> Package
 *
 *  The seeded demo business already showed the CHAIN, but a chain with one link
 *  is not much use: there was no mall to browse, so "which stores are in
 *  Dembel City Center?" could not be answered without reading every business
 *  row and grouping a free-text field at render time.
 *
 *  This module is the domain behind that grouping, and it is pure - no I/O, no
 *  Express, no React - exactly like categories.ts and packages.ts, so the rules
 *  can be tested directly.
 *
 *  THE THREE RULES IT ENFORCES
 *  ---------------------------
 *  1. A MALL IS A ROW, NOT A STRING. `Mall` exists, so "stores in this mall" is
 *     a lookup rather than a guess. A store keeps the mall's name denormalised
 *     for display, and `mallId` for identity.
 *
 *  2. A STORE MAY HOLD MORE THAN ONE ROOM. Hub Jewellery trades out of GFS-024
 *     AND GFS-030. That is why `parseRoomNumbers` exists: the browser sends one
 *     field and the user types "GFS-024 & GFS-030", or "GFS-024, GFS-030", or
 *     adds them one at a time. All three have to land as two rooms, not as one
 *     room called "GFS-024 & GFS-030".
 *
 *  3. A ROOM BELONGS TO ONE STORE. `findRoomConflicts` is what stops two
 *     sellers claiming the same counter, which is the failure mode a free-text
 *     placement field would have had.
 *
 *  BACKWARD COMPATIBILITY
 *  ----------------------
 *  `MallPlacement.roomNumber` predates `roomNumbers`, and rows written by the
 *  earlier shape are still on disk. `roomNumbersFor()` is the ONLY sanctioned
 *  way to read a store's rooms: it prefers the array and falls back to the
 *  single legacy string, so an old record renders "3F-24" rather than nothing.
 */

import type { Business, Mall, MallPlacement } from "./types";

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/** `,` `&` `;` `/` `|` newline, and the word "and" between words. */
const SPLIT_ROOMS = /[,&;/|]|\s+\band\b\s+|\s*\n\s*/i;

/**
 * Split one text field into room numbers.
 *
 * A shopkeeper types separators, not arrays, so every common separator is
 * accepted: an ampersand (the way rooms are written on a lease), a comma, a
 * semicolon, a slash, a pipe, the word "and", and plain newlines. Whitespace
 * around each is trimmed, blanks are dropped, and duplicates are collapsed
 * case-insensitively while keeping the order they were typed - because
 * "024 & 030" and "030 & 024" are the same two rooms, and the first one typed
 * is the primary.
 *
 * An empty result is legitimate: a store may register with a floor and no room
 * yet, and refusing sign-up over a blank optional field would be worse than
 * letting a YENE-STORE agent confirm the number later.
 */
export function parseRoomNumbers(input: string | string[] | null | undefined): string[] {
  const parts: string[] = Array.isArray(input)
    ? input.flatMap((entry) => String(entry ?? "").split(SPLIT_ROOMS))
    : String(input ?? "").split(SPLIT_ROOMS);

  const seen = new Set<string>();
  const rooms: string[] = [];
  for (const part of parts) {
    const room = part.trim().toUpperCase();
    if (!room || seen.has(room)) continue;
    seen.add(room);
    rooms.push(room);
  }
  return rooms;
}

/**
 * Every room a store occupies, with the legacy shape handled.
 *
 * This is the read path for `MallPlacement.roomNumbers` and the reason callers
 * never touch that field directly.
 */
export function roomNumbersFor(placement: MallPlacement | null | undefined): string[] {
  if (!placement) return [];
  const stored = Array.isArray(placement.roomNumbers) ? placement.roomNumbers : [];
  const rooms = parseRoomNumbers(stored.length > 0 ? stored : placement.roomNumber);
  // A record whose primary room is set but whose array is empty (the original
  // shape) still has to report that room, so the union of both is the answer.
  return rooms.length > 0 ? rooms : parseRoomNumbers(placement.roomNumber);
}

/** "GFS-024 & GFS-030" - how a multi-room store is written in the UI. */
export function formatRoomNumbers(rooms: string[]): string {
  return rooms.join(" & ");
}

/**
 * Build the placement a store should be saved with.
 *
 * `mallName` is always taken from the DIRECTORY when a `mall` is supplied,
 * never from the request body. Otherwise a caller could file a store under
 * "Dembel City Center" by typing those words while pointing `mallId` at a
 * different mall, and the directory would end up with two conflicting names for
 * one row.
 */
export function buildMallPlacement(input: {
  mall: Mall | null;
  requestedName?: string | null;
  floor?: string | null;
  rooms?: string | string[] | null;
  /** Set by a Super Admin or an agreement, never by the sign-up form. */
  agreementId?: string | null;
}): MallPlacement {
  const rooms = parseRoomNumbers(input.rooms);
  return {
    mallId: input.mall?.id ?? null,
    mallName: input.mall
      ? input.mall.name
      : String(input.requestedName ?? "").trim().slice(0, 120),
    floor: String(input.floor ?? "").trim().slice(0, 24),
    roomNumber: rooms[0] ?? "",
    roomNumbers: rooms,
    // A self-registered mall store has no agreement yet, so Section 41 does
    // NOT grant it a free subdomain.
    agreementId: input.agreementId ?? null,
  };
}
// ---------------------------------------------------------------------------
// Grouping stores under a mall
// ---------------------------------------------------------------------------

/** Is this business registered in a mall at all? */
export function isMallStore(business: Business): boolean {
  return business.type === "mall" && Boolean(business.mall?.mallName);
}

/**
 * The stores registered under one mall.
 *
 * Matching is on `mallId` first, because that is identity. The name comparison
 * is the fallback for records written before malls had ids: dropping them would
 * silently remove ABC Fashion from Dembel City Center, and this module's whole
 * purpose is that a mall's stores can be found at all.
 */
export function storesInMall(businesses: Business[], mall: Mall): Business[] {
  // A null mall yields nothing rather than throwing. This is called from a
  // public route with an unvalidated `:id`, and a crash there would take the
  // marketplace down over a mistyped link.
  if (!mall) return [];
  return businesses.filter((business) => {
    if (!isMallStore(business)) return false;
    if (business.mall?.mallId === mall.id) return true;
    return slugify(business.mall?.mallName ?? "") === mall.slug;
  });
}

/** The mall a business belongs to, or null for a standalone store. */
export function mallForBusiness(malls: Mall[], business: Business): Mall | null {
  if (!isMallStore(business) || !business.mall) return null;
  const placement = business.mall;
  if (placement.mallId) {
    const byId = malls.find((mall) => mall.id === placement.mallId);
    if (byId) return byId;
  }
  return malls.find((mall) => mall.slug === slugify(placement.mallName)) ?? null;
}

/**
 * Rooms already taken in this mall, so a second seller cannot claim one.
 *
 * The comparison is case-insensitive and ignores separators, so "gfs-024",
 * "GFS-024" and "GFS 024" are the same counter - which they are, and which is
 * exactly the near-duplicate that would otherwise leave two shops both
 * believing they own a prime location.
 *
 * `excludeBusinessId` lets a store re-save its own profile without colliding
 * with the rooms it already holds.
 */
export function findRoomConflicts(
  businesses: Business[],
  mall: Mall | null,
  rooms: string[],
  excludeBusinessId?: string,
): string[] {
  if (!mall || rooms.length === 0) return [];
  const taken = new Set<string>();
  for (const business of storesInMall(businesses, mall)) {
    if (business.id === excludeBusinessId) continue;
    for (const room of roomNumbersFor(business.mall)) taken.add(slugify(room));
  }
  return rooms.filter((room) => taken.has(slugify(room)));
}

/** How many units a mall directory lists per floor. */
const UNITS_PER_FLOOR = 22;

/**
 * Rooms in this mall that nobody has claimed, so the sign-up screen can grey
 * out counters that are already taken rather than letting somebody fill in a
 * form and be refused after the fact.
 */
export function availableRooms(businesses: Business[], mall: Mall | null): string[] {
  if (!mall) return [];
  const taken = new Set<string>();
  for (const business of storesInMall(businesses, mall)) {
    for (const room of roomNumbersFor(business.mall)) taken.add(slugify(room));
  }
  const rooms: string[] = [];
  for (const floor of mall.floors) {
    for (let unit = 1; unit <= UNITS_PER_FLOOR; unit += 1) {
      const room = `${floor}-${String(unit).padStart(2, "0")}`;
      if (!taken.has(slugify(room))) rooms.push(room);
    }
  }
  return rooms;
}
// ---------------------------------------------------------------------------
// The public mall directory
// ---------------------------------------------------------------------------

export interface MallStoreSummary {
  id: string;
  name: string;
  subdomain: string;
  floor: string;
  /** Every room this store holds. Never empty for a registered mall store. */
  rooms: string[];
  /** The same rooms as one readable line, e.g. "GFS-024 & GFS-030". */
  roomLabel: string;
  rating: number;
  logoUrl: string | null;
  productCount: number;
}

/** One mall, as the directory renders it. Counts are counted, never guessed. */
export interface MallSummary {
  id: string;
  name: string;
  slug: string;
  city: string;
  address: string;
  description: string;
  floors: string[];
  agreementId: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  storeCount: number;
  productCount: number;
  stores: MallStoreSummary[];
}

/**
 * The mall directory, richest first: the mall with the most registered stores
 * is the one a shopper is most likely to want, and a deterministic order means
 * the page does not reshuffle between loads.
 *
 * Malls with no registered store are filtered out rather than shown empty: an
 * empty mall is a directory entry with nothing in it, and rendering it would be
 * a dead end for a shopper.
 */
export function mallDirectory(
  malls: Mall[],
  businesses: Business[],
  products: { businessId: string }[] = [],
): MallSummary[] {
  const productCounts = new Map<string, number>();
  for (const product of products) {
    productCounts.set(product.businessId, (productCounts.get(product.businessId) ?? 0) + 1);
  }

  return malls
    .map((mall) => {
      const stores = storesInMall(businesses, mall).map((business) => {
        const rooms = roomNumbersFor(business.mall);
        return {
          id: business.id,
          name: business.name,
          subdomain: business.subdomain,
          floor: business.mall?.floor ?? "",
          rooms,
          roomLabel: formatRoomNumbers(rooms),
          rating: business.rating,
          logoUrl: business.customization.logoUrl,
          productCount: productCounts.get(business.id) ?? 0,
        };
      });
      return {
        id: mall.id,
        name: mall.name,
        slug: mall.slug,
        city: mall.city,
        address: mall.address,
        description: mall.description,
        floors: mall.floors,
        agreementId: mall.agreementId,
        logoUrl: mall.logoUrl,
        coverImageUrl: mall.coverImageUrl,
        storeCount: stores.length,
        productCount: stores.reduce((total, store) => total + store.productCount, 0),
        stores,
      };
    })
    .filter((mall) => mall.storeCount > 0)
    .sort((a, b) => b.storeCount - a.storeCount || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Slugs and lookups
// ---------------------------------------------------------------------------

/**
 * The lookup key for a mall name - and for a room number.
 *
 * Exported because room comparisons depend on it too: `gfs-024` and `GFS-024`
 * are the same counter, and a naive string compare would let two shops claim one.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The mall a sign-up form should offer, by name - case-insensitive. */
export function mallByName(malls: Mall[], name: string): Mall | null {
  const wanted = slugify(name);
  return malls.find((mall) => mall.slug === wanted) ?? null;
}

/**
 * Resolve the mall a sign-up request named, from whichever identifier it sent.
 *
 * A client may send the id (what the picker sends) or the typed name (what a
 * form field sends), so both are accepted and both are resolved against the
 * DIRECTORY. A name that matches nothing yields null rather than a new mall:
 * creating a mall is a Super Admin action, not something a stranger can do by
 * typing a word into a sign-up box.
 */
export function resolveMall(malls: Mall[], idOrName: string | null | undefined): Mall | null {
  const wanted = String(idOrName ?? "").trim();
  if (!wanted) return null;
  return (
    malls.find((mall) => mall.id === wanted) ??
    malls.find((mall) => mall.slug === slugify(wanted)) ??
    null
  );
}