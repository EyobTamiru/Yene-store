/**
 * ============================================================================
 *  STORE RENTAL - APPROVAL BY NAME OR PHONE NUMBER (Sections 10 & 41)
 * ============================================================================
 *
 *  THE FEATURE
 *  -----------
 *  A person applies to rent a counter. Later, a YENE-STORE administrator sits
 *  down to clear the queue and knows only what they were told on the phone -
 *  "Abebe Bekele", or "0911 234 567". They must be able to type either one and
 *  land on the right applicant.
 *
 *  THIS MODULE IS THE MATCHING, AND IT IS PURE
 *  -------------------------------------------
 *  No I/O, no Express, no React - exactly like `malls.ts`, `marketplace.ts` and
 *  `commerce.ts` - so every rule below is testable without a server.
 *
 *  RULE 1: ONE PHONE NUMBER HAS MANY WRITINGS
 *  -------------------------------------------
 *  In Ethiopia the same handset is written "+251 911 234 567", "251911234567",
 *  "0911234567", "911234567" and "0911-234-567", and people copy it whichever
 *  way the form in front of them happens to be formatted. Matching on the
 *  literal string would find nobody, so `normalizeEthiopianPhone` reduces every
 *  one of those to the same nine-digit national number. Ethiopian mobile
 *  numbers are nine digits beginning 9 (Safaricom 091, Ethio Telecom 092,
 *  Airtel 097, Equicom 098); landlines begin 1 (Addis Ababa 011).
 *
 *  RULE 2: A NAME IS NOT A KEY, IT IS A SUGGESTION
 *  -------------------------------------------------
 *  "Abebe" is one of the most common given names in Ethiopia. Matching by name
 *  therefore NEVER decides anything by itself - it produces a shortlist a human
 *  picks from, and if the shortlist is ambiguous the request is REFUSED rather
 *  than guessed. `resolveApplicantForApproval` encodes exactly that, and it is
 *  the single most important function in this file.
 *
 *  RULE 3: AMHARIC NAMES ARE NOT LATIN
 *  -----------------------------------
 *  An Ethiopian name may be written in Ge'ez script, in Latin transliteration,
 *  or both. Normalisation case-folds and collapses whitespace but never strips
 *  characters it does not recognise - a diacritic-stripping "normaliser"
 *  applied to Ge'ez would quietly destroy the name and match it to nobody.
 *
 *  THE SAFETY PROPERTY
 *  -------------------
 *  A wrong approval is not a cosmetic error: it hands a stranger a shop. So the
 *  ranking below is ordered strongest-evidence-first, and the approval path
 *  refuses to act on anything weaker than an exact phone, Fayda ID or TIN
 *  unless exactly ONE candidate matched and a human still pressed the button.
 */

import type { Mall, MallUnit, RentalApplication, RentalMatchField } from "./types";

// ===========================================================================
//  1. PHONE NUMBERS
// ===========================================================================

/** Ethiopia's country code. */
const ETHIOPIA_CODE = "251";

/**
 * Ethiopian mobile operators, by the two digits after the leading zero.
 * Kept as data so the UI can name them and so a bad prefix produces a useful
 * message rather than a silent accept.
 */
export const ETHIOPIAN_MOBILE_PREFIXES: Record<string, string> = {
  "90": "Safaricom",
  "91": "Safaricom",
  "92": "Ethio Telecom",
  "93": "Ethio Telecom",
  "94": "Safaricom",
  "95": "Ethio Telecom",
  "96": "Airtel",
  "97": "Airtel",
  "98": "Equicom",
  "99": "Safaricom",
};

/**
 * Reduce any reasonable writing of an Ethiopian number to its canonical form.
 *
 * The canonical form is the nine-digit NATIONAL number with no trunk prefix:
 * "911234567" for the handset written 0911234567, +251911234567 or
 * 251911234567. Landlines keep their area code: "112345678".
 *
 * Returns null for anything that is not a plausible Ethiopian number, rather
 * than a best guess - a null is what stops "0911" matching "0911 000 001"
 * through a shared prefix.
 */
export function normalizeEthiopianPhone(input: string | null | undefined): string | null {
  // Everything that is not a digit goes first. That kills spaces, dashes,
  // dots, parentheses AND the "+" in one pass, which is the whole trick.
  let digits = String(input ?? "").replace(/\D+/g, "");

  // Drop the country code, however it was written.
  if (digits.startsWith(ETHIOPIA_CODE)) {
    digits = digits.slice(ETHIOPIA_CODE.length);
  }

  // Drop the national trunk prefix: 0911234567 -> 911234567.
  if (digits.length === 10 && digits.startsWith("0")) digits = digits.slice(1);

  // Ethiopia uses nine-digit national numbers, no exceptions here.
  if (!/^\d{9}$/.test(digits)) return null;

  const isMobile = digits.startsWith("9");
  const isLandline = ETHIOPIAN_LANDLINE_CODES.has(digits.slice(0, 2));
  if (!isMobile && !isLandline) return null;

  return digits;
}

/** Is this a usable Ethiopian phone number? Used to validate a form. */
export function isValidEthiopianPhone(input: string | null | undefined): boolean {
  return normalizeEthiopianPhone(input) !== null;
}

/** The operator name, for confirmation copy: "Safaricom", or null. */
export function ethiopianCarrier(input: string | null | undefined): string | null {
  const digits = normalizeEthiopianPhone(input);
  if (!digits || !digits.startsWith("9")) return null;
  return ETHIOPIAN_MOBILE_PREFIXES[digits.slice(0, 2)] ?? null;
}

/**
 * How a phone number is shown to an administrator confirming a match.
 *
 * "911 23• 4567" - enough to recognise the number on the lease without printing
 * a full handset number across a review screen, and enough that two similar
 * numbers stay distinguishable from each other.
 */
export function maskEthiopianPhone(input: string | null | undefined): string {
  const digits = normalizeEthiopianPhone(input);
  if (!digits) return "";
  return `${digits.slice(0, 3)} ${digits.slice(3, 5)}• ${digits.slice(5)}`;
}

/**
 * The last two digits of an identity document, for the same reason.
 *
 * Confirming an approval usually turns on "is this the same Fayda ID I was
 * shown on the phone?", and the last two digits are what a person remembers.
 */
export function maskDocumentId(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (text.length <= 2) return text ? `••${text}` : "";
  return `••${text.slice(-2)}`;
}

// ===========================================================================
//  2. NAMES
// ===========================================================================

/**
 * Characters that are separators rather than name parts.
 *
 * Deliberately a fixed list rather than `\W`: `\W` means "not [A-Za-z0-9_]",
 * so it would classify every Ge'ez syllable as punctuation and delete the name
 * entirely.
 */
const NAME_SEPARATORS = /[\s.,;:'"`\-_/|\\()[\]{}<>+*&#$%!?,~^=]+/g;

/**
 * Normalise a personal name for comparison. Case-folded, separators collapsed.
 *
 * PRESERVES non-Latin script. A Ge'ez name survives as itself; only its
 * spacing and case are tidied. See RULE 3 in the header.
 */
export function normalizePersonName(input: string | null | undefined): string {
  return String(input ?? "")
    .normalize("NFC")
    .replace(NAME_SEPARATORS, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** The normalised name split into parts, order-independent. */
export function nameTokens(input: string | null | undefined): string[] {
  const normalized = normalizePersonName(input);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

/**
 * How alike two names are, as a percentage.
 *
 * Token-based rather than string-based, because Ethiopian naming puts the
 * family name first as often as not: "Bekele Abebe" and "Abebe Bekele" are the
 * same person and must compare as equal, which a character-level similarity
 * would rate as barely related.
 *
 * 100 means "the same set of name parts". A single shared part out of two is a
 * 50 - which is why a name match is never allowed to decide on its own.
 */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.length === 0 || right.length === 0) return 0;

  const rightSet = new Set(right);
  const shared = left.filter((token) => rightSet.has(token)).length;
  const denominator = new Set([...left, ...right]).size;
  if (denominator === 0) return 0;

  // Dice is generous with a shared surname, Jaccard is strict about extras.
  // Taking the smaller of the two means a long name that merely CONTAINS the
  // query cannot score as high as an exact match on a short one.
  const dice = (2 * shared) / (left.length + right.length);
  const jaccard = shared / denominator;
  return Math.round(Math.min(dice, jaccard) * 100);
}

// ===========================================================================
//  3. MATCHING AN APPLICANT BY NAME OR PHONE
// ===========================================================================

/**
 * How an applicant was found, strongest evidence first.
 *
 * `fayda` and `tin` outrank `phone` because a government identifier cannot be
 * retyped onto the wrong form by accident, and `name` is last because it is the
 * only one that can plausibly belong to two people.
 */
export type MatchTier = "fayda" | "tin" | "phone" | "name" | "none";

/** Sort weight per tier. Higher wins. */
const TIER_WEIGHT: Record<MatchTier, number> = {
  fayda: 400,
  tin: 300,
  phone: 200,
  name: 100,
  none: 0,
};

/** The minimum name similarity to be shown at all. */
export const NAME_MATCH_FLOOR = 40;

/**
 * The identity fields matching may read.
 *
 * Structural rather than `RentalApplication` itself, so the same matcher serves
 * a rental application, a verification record, or an account - they all carry
 * the same few fields, and coupling the matcher to one shape would make it
 * unusable for the other two.
 */
export interface MatchableApplicant {
  id: string;
  fullName: string | null | undefined;
  phone: string | null | undefined;
  faydaId?: string | null;
  tinNumber?: string | null;
}

export interface MatchCandidate<T extends MatchableApplicant> {
  record: T;
  tier: MatchTier;
  /** 0-100 for a name match; 100 for the exact tiers. */
  confidence: number;
  /** One line an administrator can read to understand why this came back. */
  reason: string;
}

/**
 * Rank applicants against a single search box.
 *
 * The query is classified rather than guessed at: a string that normalises to a
 * phone number is tried AS A PHONE, and everything else is tried as a name. A
 * box that accepted "0911234567" and treated it as a name would find nothing.
 *
 * A candidate may appear once, at its STRONGEST tier - so someone whose phone
 * matches exactly is not also listed as a weak name guess, which would pad the
 * shortlist with themselves.
 */
export function matchApplicants<T extends MatchableApplicant>(
  applicants: readonly T[],
  query: string | null | undefined,
): Array<MatchCandidate<T>> {
  const raw = String(query ?? "").trim();
  if (!raw) return [];

  const phone = normalizeEthiopianPhone(raw);
  const name = normalizePersonName(raw);

  // Something that is neither (a bare "0", say) can never match.
  if (!phone && !name) return [];

  const found = new Map<string, MatchCandidate<T>>();

  for (const record of applicants) {
    let tier: MatchTier = "none";
    let confidence = 0;
    let reason = "";

    // Exact identifiers first. Case-insensitive, because a Fayda ID is typed
    // from a card and may come back in any case.
    const fayda = String(record.faydaId ?? "").trim();
    if (fayda && raw.replace(/\s+/g, "").toUpperCase() === fayda.toUpperCase()) {
      tier = "fayda";
      confidence = 100;
      reason = "Fayda ID matches exactly";
    }

    const tin = String(record.tinNumber ?? "").trim();
    if (tier === "none" && tin && raw.replace(/[\s-]/g, "") === tin) {
      tier = "tin";
      confidence = 100;
      reason = "TIN matches exactly";
    }

    if (tier === "none" && phone) {
      const theirs = normalizeEthiopianPhone(record.phone);
      if (theirs && theirs === phone) {
        tier = "phone";
        confidence = 100;
        reason = "Phone number matches";
      }
    }

    // The name is tried last, and only when nothing exact already matched.
    if (tier === "none" && name) {
      const similarity = Math.max(
        nameSimilarity(name, record.fullName),
        // Also try the trading name, because an administrator is as likely to
        // be given the shop's name as the person's.
        nameSimilarity(name, (record as { businessName?: string | null }).businessName),
      );
      if (similarity >= NAME_MATCH_FLOOR) {
        tier = "name";
        confidence = similarity;
        reason = `Name is ${similarity}% similar`;
      }
    }

    if (tier === "none") continue;

    const existing = found.get(record.id);
    if (existing && TIER_WEIGHT[existing.tier] >= TIER_WEIGHT[tier]) continue;

    found.set(record.id, { record, tier, confidence, reason });
  }

  return [...found.values()].sort(
    (a, b) =>
      TIER_WEIGHT[b.tier] - TIER_WEIGHT[a.tier] ||
      b.confidence - a.confidence ||
      a.record.id.localeCompare(b.record.id),
  );
}

export interface ApprovalResolution<T extends MatchableApplicant> {
  /** The one applicant this query unambiguously identifies, or null. */
  match: MatchCandidate<T> | null;
  /**
   * Everyone it could plausibly be, best first.
   *
   * Non-empty whenever `match` is null, so the caller can show a shortlist
   * instead of a dead end.
   */
  candidates: Array<MatchCandidate<T>>;
  /** True when the query named more than one person. */
  ambiguous: boolean;
  /** Why nothing was resolved, for a message the administrator can read. */
  reason: string | null;
}

/**
 * Resolve a search box to the ONE applicant it identifies, or refuse.
 *
 * This is the function an approval path calls, and the refusal is the point.
 *
 *  - No candidates -> refuse. Nothing to approve.
 *  - More than one at the strongest tier -> refuse, and return them as a
 *    shortlist. "Abebe" matches half the queue; approving the first one would
 *    be a coin toss presented as a decision.
 *  - Exactly one -> resolved. The caller still shows the applicant for
 *    confirmation before committing.
 *
 * Note what is NOT here: nothing in this function approves anyone. It resolves
 * an identity. The human decision lives one layer up, in the router.
 */
export function resolveApplicantForApproval<T extends MatchableApplicant>(
  applicants: readonly T[],
  query: string | null | undefined,
): ApprovalResolution<T> {
  const candidates = matchApplicants(applicants, query);

  if (candidates.length === 0) {
    return {
      match: null,
      candidates: [],
      ambiguous: false,
      reason: `No applicant matches "${String(query ?? "").trim()}".`,
    };
  }

  const [best] = candidates;
  const tied = candidates.filter(
    (entry) => entry.tier === best.tier && entry.confidence === best.confidence,
  );

  if (tied.length > 1) {
    return {
      match: null,
      candidates,
      ambiguous: true,
      reason:
        `"${String(query ?? "").trim()}" matches ${tied.length} applicants. ` +
        "Open one of them by its exact phone number or Fayda ID to approve the right person.",
    };
  }

  return { match: best, candidates, ambiguous: false, reason: null };
}

/**
 * Which field a query was understood as, for the audit trail.
 *
 * Recorded on the application so that "who approved this, and how did they
 * identify the applicant?" is answerable months later from the record alone.
 */
export function describeMatchField(
  query: string | null | undefined,
  tier: MatchTier,
): RentalMatchField {
  if (normalizeEthiopianPhone(query)) return "phone";
  switch (tier) {
    case "fayda":
      return "fayda";
    case "tin":
      return "tin";
    case "name":
      return "name";
    default:
      return "id";
  }
}

/**
 * Is this tier strong enough to approve on without a second identifier?
 *
 * A name alone is not, which is why the resolver refuses an ambiguous name in
 * the first place. Kept as its own predicate so the rule is stated once and
 * the router cannot drift from the module that documents it.
 */
export function tierIsDecisive(tier: MatchTier): boolean {
  return tier === "fayda" || tier === "tin" || tier === "phone";
}

// ===========================================================================
//  4. MALL UNITS
// ===========================================================================

/**
 * The stable id of one unit.
 *
 * Derived from the mall and the number rather than random, so re-seeding is
 * idempotent and a unit referenced from two places cannot drift apart.
 */
export function unitId(mallId: string, number: string): string {
  const key = `${mallId}:${number}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `unit-${key}`;
}

/**
 * Build the units of a mall from its floors.
 *
 * A landlord's directory is deterministic for a given building, so this is a
 * FACTORY, not a seeder that invents rows once and then drifts from
 * `mall.floors`. Re-running it produces the same building.
 *
 * Rent rises with the floor purely so the demo rent roll looks like a real one
 * rather than a single flat price. A landlord replaces the figures through
 * `MallUnit.monthlyRentEtb`; nothing here is presented as a real quotation.
 */
export function buildMallUnits(
  mall: Mall,
  unitsPerFloor = 22,
  now = new Date().toISOString(),
): MallUnit[] {
  const units: MallUnit[] = [];

  mall.floors.forEach((floor, floorIndex) => {
    for (let index = 1; index <= unitsPerFloor; index += 1) {
      const number = `${floor}-${String(index).padStart(2, "0")}`;
      // Ground-floor frontage is worth more; each floor adds a little.
      const monthlyRentEtb = (floorIndex === 0 ? 12000 : 8000 + floorIndex * 2500) + index * 250;

      units.push({
        id: unitId(mall.id, number),
        mallId: mall.id,
        floor,
        number,
        // Real shops are not all one size; the pattern repeats per floor.
        sizeSqm: 18 + ((index * 7) % 45),
        monthlyRentEtb,
        status: "available",
        // Advertised by default. A landlord switches this off to hold a counter
        // back from the market; see MallUnit.listable.
        listable: true,
        businessId: null,
        applicationId: null,
        createdAt: now,
      });
    }
  });

  return units;
}

/**
 * Every unit belonging to one mall, in the order a building is actually walked.
 *
 * Ordered by the LANDLORD'S OWN `mall.floors`, not alphabetically: a basement
 * sorts before "GFS" and "1F" sorts before "GFS" as plain strings, which would
 * present the third floor before the ground floor and make the list read as
 * nonsense. A floor the mall has since removed is pushed to the end rather than
 * dropped, so its units stay visible for whoever has to reconcile them.
 */
export function unitsForMall(units: readonly MallUnit[], mall: Mall | null): MallUnit[] {
  if (!mall) return [];
  const order = new Map(
    mall.floors.map((floor, index) => [floor.trim().toUpperCase(), index]),
  );
  const rank = (floor: string): number =>
    order.get(floor.trim().toUpperCase()) ?? Number.MAX_SAFE_INTEGER;

  return units
    .filter((unit) => unit.mallId === mall.id)
    .sort(
      (a, b) =>
        rank(a.floor) - rank(b.floor) ||
        a.number.localeCompare(b.number, undefined, { numeric: true }),
    );
}

/**
 * The counters a new applicant may actually ask for.
 *
 * A unit is offered when it is `available`, unclaimed, AND `listable`. The
 * `listable` test is what makes the "Rooms still available" panel controllable:
 * a landlord who switches it off on a unit removes that counter from the
 * public list without deleting it or pretending it is taken.
 *
 * Units `held` by a pending application are excluded for the same reason they
 * are held at all - that hold is what stops two applicants chasing one shop.
 */
export function availableUnits(units: readonly MallUnit[], mall: Mall | null): MallUnit[] {
  return unitsForMall(units, mall).filter(
    (unit) =>
      unit.status === "available" &&
      !unit.businessId &&
      !unit.applicationId &&
      unit.listable !== false,
  );
}

/**
 * Requested rooms that are not offerable, for an honest error message.
 *
 * Compares case-insensitively on the unit number, so "gfs-01" and "GFS-01" are
 * one counter and cannot both be taken. A room the mall does not have at all is
 * reported too, rather than silently accepted.
 */
export function findUnitConflicts(
  units: readonly MallUnit[],
  mall: Mall | null,
  rooms: readonly string[],
): MallUnit[] {
  // With no mall there is no catalogue to check against, so every room would
  // look "unknown" and every request would be refused. Returning nothing keeps
  // this inert rather than fatal, exactly like `storesInMall` and
  // `availableRooms` - and the caller always has a resolved mall.
  if (!mall) return [];

  const catalogue = new Map(
    unitsForMall(units, mall).map((unit) => [unit.number.trim().toUpperCase(), unit]),
  );
  const conflicts: MallUnit[] = [];

  for (const room of rooms) {
    const wanted = String(room).trim().toUpperCase();
    const unit = catalogue.get(wanted);
    if (!unit) {
      // Not a real counter in this building. Reported as a conflict so the
      // applicant is told the truth instead of being quietly accepted.
      conflicts.push({
        id: unitId(mall?.id ?? "mall", wanted),
        mallId: mall?.id ?? "",
        floor: wanted.split("-")[0] ?? "",
        number: wanted,
        sizeSqm: 0,
        monthlyRentEtb: 0,
        status: "leased",
        // A room that is not even a real counter has nothing to advertise.
        listable: false,
        businessId: null,
        applicationId: null,
        createdAt: "",
      });
      continue;
    }
    if (!(unit.status === "available" && !unit.businessId)) conflicts.push(unit);
  }

  return conflicts;
}

/** True when the floor is one this mall actually has. */
export function isFloorOf(mall: Mall | null, floor: string | null | undefined): boolean {
  if (!mall) return false;
  const wanted = String(floor ?? "").trim().toUpperCase();
  return wanted !== "" && mall.floors.some((entry) => entry.toUpperCase() === wanted);
}

/** A one-line description of a unit, for a review screen. */
export function describeUnit(unit: MallUnit): string {
  if (unit.sizeSqm === 0) return `${unit.number} - not a unit in this mall`;
  return (
    `${unit.number} - ${unit.sizeSqm} m2 - ` +
    `${unit.monthlyRentEtb.toLocaleString("en-US")} ETB/month`
  );
}

/**
 * The applicant-facing projection of a rental application.
 *
 * `phoneNormalized` is included so the browser can pre-fill its confirmation
 * step without the server normalising a second time on the round trip. It is
 * the same value the matcher uses, so exposing it reveals nothing extra.
 */
export function publicApplication(application: RentalApplication) {
  return {
    id: application.id,
    businessName: application.businessName,
    fullName: application.fullName,
    phone: application.phone,
    phoneMasked: maskEthiopianPhone(application.phone),
    mallId: application.mallId,
    mallName: application.mallName,
    floor: application.floor,
    rooms: application.rooms,
    packageId: application.packageId,
    status: application.status,
    reason: application.reason,
    submittedAt: application.submittedAt,
    reviewedAt: application.reviewedAt,
    reviewedBy: application.reviewedBy,
    matchedBy: application.matchedBy,
    matchedQuery: application.matchedQuery,
  };
}
/** Area codes that are landlines rather than handsets. */
const ETHIOPIAN_LANDLINE_CODES = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "22", "25",
  "26", "33", "34", "36", "37", "46", "47", "55", "57", "62", "68",
]);

// __RENTAL_PART_2__