/**
 * ============================================================================
 *  STORE RENTAL ROUTER (Sections 10 & 41)
 * ============================================================================
 *
 *  Mounted at /api/rental.
 *
 *    GET  /units                     public: the counters a mall may still offer
 *    POST /apply                     apply for a specific counter
 *    GET  /mine                      my applications
 *    GET  /admin/applications        super admin: the queue, searchable by name
 *                                    or phone number
 *    POST /admin/review              super admin: approve or reject, naming the
 *                                    applicant by id, phone or name
 *
 *  THE FEATURE THIS EXISTS FOR
 *  --------------------------
 *  An administrator clears the queue with the information they were given on the
 *  phone. They type "0911 234 567" or "Abebe Bekele" into one box and land on
 *  the right applicant. All of that matching lives in src/platform/rental.ts and
 *  is pure; this file is only the transport and the state changes.
 *
 *  WHY APPROVAL IS NOT A SEARCH RESULT
 *  ----------------------------------
 *  A search that both FINDS and APPROVES would be one typo away from handing a
 *  stranger a shop, because "Abebe" matches a great many people in Ethiopia. So:
 *
 *    - A name search returns a SHORTLIST and approves nothing.
 *    - An ambiguous query is REFUSED with the candidates, rather than guessing.
 *    - Approval always requires an explicit human decision, and records WHICH
 *      field resolved the applicant so the decision is auditable later.
 *
 *  Section 10's rule still holds underneath all of this: the applicant must have
 *  a verified identity before their store goes live. Approving a rental grants
 *  that, but only through `isApprovedForRental`, never as a side effect of
 *  filling in a form.
 */

import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { resolveAuthContext } from "../auth/sessions";
import { allUsers, persistUsers } from "../auth/store";
import { SESSION_COOKIE } from "../auth/types";
import { subdomainFor } from "../auth/router";
import { isApprovedForRental, verificationForUser } from "../verify/store";
import {
  allBusinesses,
  allMallUnits,
  allMalls,
  markUnits,
  mallByIdOrName,
  persist,
  saveSubscription,
  seedMalls,
  seedMallUnits,
} from "../platform/store";
import { emptyLedger } from "../../src/platform/billing";
import { buildMallPlacement, parseRoomNumbers } from "../../src/platform/malls";
import {
  describeMatchField,
  describeUnit,
  findUnitConflicts,
  isFloorOf,
  normalizeEthiopianPhone,
  publicApplication,
  resolveApplicantForApproval,
} from "../../src/platform/rental";
import type { Business, Mall, PackageId, RentalApplication, Subscription } from "../../src/platform/types";
import {
  allRentalApplications,
  findOpenApplication,
  pendingApplications,
  saveRentalApplication,
} from "./store";

export const rentalRouter = Router();

function bad(res: Response, message: string, extra: Record<string, unknown> = {}) {
  return res.status(400).json({ error: message, ...extra });
}

/** Resolve the caller, or answer 401. */
function caller(req: Request, res: Response) {
  const context = resolveAuthContext(req, SESSION_COOKIE);
  if (!context) {
    res.status(401).json({ error: "Please sign in to continue." });
    return null;
  }
  return context;
}

/** Refuse anyone who is not a super admin. 403, not 404 - they are a real user. */
function requireSuperAdmin(req: Request, res: Response) {
  const context = resolveAuthContext(req, SESSION_COOKIE);
  if (!context) {
    res.status(401).json({ error: "Please sign in to continue." });
    return null;
  }
  if (!context.isSuperAdmin) {
    res.status(403).json({ error: "This area is restricted to Yene Business Group administrators." });
    return null;
  }
  return context;
}

/** "GFS-01" or "GFS-01 & GFS-02", the way rooms are written on a lease. */
function formatRooms(rooms: readonly string[]): string {
  return rooms.join(" & ");
}

/**
 * GET /api/rental/units - the counters a mall may still offer.
 *
 * Deliberately PUBLIC and unfiltered: a person deciding where to apply needs to
 * see what is on offer. It exposes size and rent and nothing else - no
 * applicant, no identity, no hold. Counters held by somebody else's pending
 * request are excluded, which is what stops two people chasing one shop.
 */
rentalRouter.get("/units", (req: Request, res: Response) => {
  seedMalls();
  seedMallUnits();

  const mall = mallByIdOrName(String(req.query.mall ?? ""));
  if (!mall) return res.status(404).json({ error: "Mall not found." });

  const units = allMallUnits()
    .filter((unit) => unit.mallId === mall.id && unit.status === "available" && !unit.businessId)
    .map((unit) => ({
      number: unit.number,
      floor: unit.floor,
      sizeSqm: unit.sizeSqm,
      monthlyRentEtb: unit.monthlyRentEtb,
    }));

  return res.status(200).json({
    mall: { id: mall.id, name: mall.name, floors: mall.floors },
    units,
  });
});

/**
 * POST /api/rental/apply
 *
 * A person asks for a specific mall counter. This does NOT create a store - it
 * creates a request, and the store is created when an administrator approves.
 * That separation is what closes the hole where signing up was enough to rent.
 *
 * `fullName` and `phone` are REQUIRED, and that is the whole feature: an
 * application that cannot be found by name or phone cannot be reviewed, so
 * allowing one would put a permanently invisible request in the queue.
 */
rentalRouter.post("/apply", (req: Request, res: Response) => {
  const context = caller(req, res);
  if (!context) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const businessName = String(body.businessName ?? "").trim().slice(0, 80);
  const fullName = String(body.fullName ?? "").trim().slice(0, 120);
  const rawPhone = String(body.phone ?? "").trim().slice(0, 40);
  const packageId = String(body.packageId ?? "silver") as PackageId;

  seedMalls();
  seedMallUnits();

  // --- Who are you? Matching depends on both of these. ---
  if (businessName.length < 2) return bad(res, "Enter the name of your business.");
  if (fullName.length < 2) {
    return bad(res, "Enter your full name so we can find your application later.");
  }
  const phoneNormalized = normalizeEthiopianPhone(rawPhone);
  if (!phoneNormalized) {
    return bad(res, "Enter a phone number we can reach you on, for example 0911 234 567.");
  }

  // --- Which mall, which floor, which counter? ---
  const mall = mallByIdOrName(String(body.mall ?? ""));
  if (!mall) {
    return bad(res, "Choose a mall from the list.", {
      malls: allMalls().map((entry) => ({ id: entry.id, name: entry.name, city: entry.city })),
    });
  }

  const floor = String(body.floor ?? "").trim().slice(0, 24);
  if (!isFloorOf(mall, floor)) {
    return bad(res, `Choose a floor in ${mall.name}.`, { floors: mall.floors });
  }

  const rooms = parseRoomNumbers(
    body.rooms as string | string[] | null | undefined,
  );
  if (rooms.length === 0) return bad(res, "Choose at least one counter (shop number).");

  if (!["silver", "gold", "platinum", "super"].includes(packageId)) {
    return bad(res, "Choose a valid package.");
  }

  // A counter can only be held by one person at a time. Checked against the
  // real units, so a room this mall does not have is refused rather than
  // accepted and later discovered to be imaginary.
  const conflicts = findUnitConflicts(allMallUnits(), mall, rooms);
  if (conflicts.length > 0) {
    const unknown = conflicts.filter((unit) => unit.sizeSqm === 0);
    const known = conflicts.filter((unit) => unit.sizeSqm !== 0);
    if (unknown.length > 0) {
      return bad(
        res,
        `${unknown.map((unit) => unit.number).join(", ")} ${
          unknown.length === 1 ? "is not a counter" : "are not counters"
        } in ${mall.name}. Please choose from the list.`,
      );
    }
    return res.status(409).json({
      error: `${known.map((unit) => unit.number).join(", ")} ${
        known.length === 1 ? "is" : "are"
      } no longer available in ${mall.name}. Please choose another counter.`,
    });
  }

  // One open application per person per counter. Without this a double-click
  // would place two holds and appear twice in the queue.
  const duplicate = findOpenApplication(context.userId, mall.id, rooms);
  if (duplicate) {
    return res.status(409).json({
      error: `You already have a request for ${formatRooms(duplicate.rooms)}.`,
      application: publicApplication(duplicate),
    });
  }

  const now = new Date().toISOString();
  const application: RentalApplication = {
    id: `RA-${randomBytes(5).toString("hex")}`,
    userId: context.userId,
    businessName,
    fullName,
    phone: rawPhone,
    phoneNormalized,
    email: context.email ?? "",
    mallId: mall.id,
    mallName: mall.name,
    floor,
    rooms,
    packageId,
    status: "pending",
    reason: null,
    submittedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    matchedBy: null,
    matchedQuery: null,
    createdAt: now,
    updatedAt: now,
  };

  saveRentalApplication(application);

  // Hold the counters immediately, so a second person cannot apply for the same
  // shop while this one waits. The hold is released again if it is rejected.
  markUnits(mall.id, rooms, {
    status: "held",
    businessId: null,
    applicationId: application.id,
  });

  const units = allMallUnits().filter(
    (unit) => unit.mallId === mall.id && rooms.includes(unit.number),
  );

  return res.status(201).json({
    success: true,
    message: `Your request for ${formatRooms(rooms)} has been received. We will contact you on ${rawPhone}.`,
    application: publicApplication(application),
    units: units.map(describeUnit),
    // Told plainly, so they do not sign up again and create a duplicate account.
    identityVerified: isApprovedForRental(context.userId),
  });
});

/**
 * GET /api/rental/mine - my own applications.
 *
 * Reads the caller's id from the session, never from the request, so nobody can
 * read somebody else's rental history by changing a query parameter.
 */
rentalRouter.get("/mine", (req: Request, res: Response) => {
  const context = caller(req, res);
  if (!context) return;

  const mine = allRentalApplications()
    .filter((entry) => entry.userId === context.userId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map((entry) => ({
      ...publicApplication(entry),
      units: allMallUnits()
        .filter(
          (unit) =>
            unit.mallId === entry.mallId &&
            entry.rooms.some(
              (room) => room.trim().toUpperCase() === unit.number.trim().toUpperCase(),
            ),
        )
        .map(describeUnit),
    }));

  return res.status(200).json({ applications: mine });
});

/**
 * The queue projection, shared by the unfiltered queue and by a search result.
 *
 * Deliberately shows what the applicant DECLARED beside what is actually
 * PROVEN, because the two disagreeing is the single most useful signal an
 * administrator has: a name that does not match the account, or a Fayda ID
 * that was never submitted.
 */
function queueShape(application: RentalApplication) {
  const verification = verificationForUser(application.userId);
  const user = allUsers().find((entry) => entry.id === application.userId);
  return {
    ...publicApplication(application),
    accountName: user?.name ?? null,
    identityStatus: verification?.status ?? "not-started",
    // Only the last two digits: enough to confirm against the card in front of
    // you, not enough to be a readymade identity fraud if the screen is shared.
    faydaMasked: verification?.faydaId ? `••${verification.faydaId.slice(-2)}` : null,
    identityVerified: isApprovedForRental(application.userId),
    units: allMallUnits()
      .filter(
        (unit) =>
          unit.mallId === application.mallId &&
          application.rooms.some(
            (room) => room.trim().toUpperCase() === unit.number.trim().toUpperCase(),
          ),
      )
      .map((unit) => ({
        number: unit.number,
        sizeSqm: unit.sizeSqm,
        monthlyRentEtb: unit.monthlyRentEtb,
        status: unit.status,
      })),
  };
}

/**
 * GET /api/rental/admin/applications
 *
 * `?status=` filters the queue. `?q=` is the search box: a phone number, a
 * name, a shop name, or an application id. With no `q` the whole pending queue
 * is returned, so the screen is useful the moment it opens.
 *
 * `ambiguous` is the signal the UI uses to REFUSE a one-click Approve and show
 * a list instead. It is returned rather than resolved here precisely because the
 * decision to approve must not follow automatically from a search.
 */
rentalRouter.get("/admin/applications", (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  seedMalls();
  seedMallUnits();

  const status = String(req.query.status ?? "pending").trim();
  const query = String(req.query.q ?? "").trim();

  const pool = allRentalApplications().filter((entry) =>
    status === "all" ? true : entry.status === status,
  );

  // No query: the plain queue, oldest first, because that is the order it is
  // worked in.
  if (!query) {
    return res.status(200).json({
      applications: pool
        .slice()
        .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
        .map(queueShape),
      query: null,
      ambiguous: false,
      reason: null,
      counts: {
        pending: pendingApplications().length,
        total: allRentalApplications().length,
      },
    });
  }

  // An exact application id always wins - unambiguous by construction, and the
  // administrator may have clicked through from a list.
  const byId = pool.find((entry) => entry.id.toLowerCase() === query.toLowerCase());
  if (byId) {
    return res.status(200).json({
      applications: [queueShape(byId)],
      query,
      ambiguous: false,
      reason: null,
      matchedBy: "id",
    });
  }

  const resolution = resolveApplicantForApproval(pool, query);

  return res.status(200).json({
    applications: resolution.candidates.map((candidate) => ({
      ...queueShape(candidate.record),
      match: {
        tier: candidate.tier,
        confidence: candidate.confidence,
        reason: candidate.reason,
      },
    })),
    query,
    ambiguous: resolution.ambiguous,
    reason: resolution.reason,
  });
});

/**
 * POST /api/rental/admin/review
 *
 * The applicant is named EITHER by `id` (unambiguous, from a clicked row) OR by
 * `query` - a phone number or a name - resolved through the SAME matcher the
 * search box uses. There is deliberately no laxer second rule: what the
 * administrator saw in the list is exactly what gets approved.
 *
 * On APPROVE, three things happen together, because any one alone would leave a
 * half-finished state:
 *
 *   1. the counters move from `held` to `leased` and are stamped with the new
 *      business id, so nobody else can take them;
 *   2. the store is actually created - Business, Trial subscription, owner
 *      binding - exactly as a direct sign-up would have made it;
 *   3. the applicant's identity standing is REPORTED but never invented.
 *      Approving a rental does not verify a Fayda ID; only the verification
 *      flow does that.
 *
 * On REJECT the hold is released, putting the counter back on the market, which
 * is the whole reason a rejection is recorded rather than simply ignored.
 */
rentalRouter.post("/admin/review", (req: Request, res: Response) => {
  const admin = requireSuperAdmin(req, res);
  if (!admin) return;

  seedMalls();
  seedMallUnits();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = String(body.decision ?? "");
  if (decision !== "approve" && decision !== "reject") {
    return bad(res, "Decision must be 'approve' or 'reject'.");
  }

  // --- Resolve WHICH applicant this is. ---
  const id = String(body.id ?? "").trim();
  const query = String(body.query ?? "").trim();

  let application: RentalApplication | null = null;
  let matchedBy: ReturnType<typeof describeMatchField> = "id";
  let matchedQuery: string | null = null;

  if (id) {
    application = allRentalApplications().find((entry) => entry.id === id) ?? null;
    matchedQuery = id;
    if (!application) {
      return res.status(404).json({ error: "That rental application does not exist." });
    }
  } else if (query) {
    const resolution = resolveApplicantForApproval(allRentalApplications(), query);
    if (!resolution.match) {
      // Ambiguous or no match. Refused, with the shortlist so the screen can
      // offer the right person instead of dead-ending.
      return res.status(409).json({
        error: resolution.reason ?? "That search did not identify one applicant.",
        ambiguous: resolution.ambiguous,
        candidates: resolution.candidates.map((candidate) => ({
          id: candidate.record.id,
          fullName: candidate.record.fullName,
          businessName: candidate.record.businessName,
          phone: candidate.record.phone,
          tier: candidate.tier,
          confidence: candidate.confidence,
        })),
      });
    }
    application = resolution.match.record as RentalApplication;
    matchedBy = describeMatchField(query, resolution.match.tier);
    matchedQuery = query;
  } else {
    return bad(res, "Name the applicant by application id, or by phone number or name.");
  }

  if (application.status !== "pending") {
    return res.status(409).json({
      error: `That application was already ${application.status}.`,
      application: publicApplication(application),
    });
  }

  const now = new Date().toISOString();

  // --- Reject: release the hold so the counter goes back on the market. ---
  if (decision === "reject") {
    application.status = "rejected";
    application.reason =
      String(body.reason ?? "").trim().slice(0, 300) ||
      "Not approved. Please contact Yene Business Group.";
    application.reviewedAt = now;
    application.reviewedBy = admin.email;
    application.matchedBy = matchedBy;
    application.matchedQuery = matchedQuery;
    application.updatedAt = now;
    saveRentalApplication(application);

    markUnits(application.mallId, application.rooms, {
      status: "available",
      businessId: null,
      applicationId: null,
    });

    return res.status(200).json({
      success: true,
      application: publicApplication(application),
      message: `The request for ${formatRooms(application.rooms)} was declined and the counter is available again.`,
    });
  }

// --- Approve ---
  const mall = mallByIdOrName(application.mallId);
  if (!mall) return res.status(409).json({ error: "That mall no longer exists." });

  // Someone else may have been approved for the same counter in between. Our own
  // hold is expected here and is filtered out, or approval would refuse itself.
  const clashes = findUnitConflicts(allMallUnits(), mall, application.rooms).filter(
    (unit) => unit.applicationId !== application.id,
  );
  if (clashes.length > 0) {
    return res.status(409).json({
      error: `${clashes.map((unit) => unit.number).join(", ")} ${
        clashes.length === 1 ? "has" : "have"
      } already been let to someone else.`,
    });
  }

  const business = provisionStore({
    businessName: application.businessName,
    email: application.email,
    phone: application.phone,
    location: mall.city,
    packageId: application.packageId,
    mall,
    floor: application.floor,
    rooms: application.rooms,
    userId: application.userId,
  });

  application.status = "approved";
  application.reason = null;
  application.reviewedAt = now;
  application.reviewedBy = admin.email;
  application.matchedBy = matchedBy;
  application.matchedQuery = matchedQuery;
  application.updatedAt = now;
  saveRentalApplication(application);

  markUnits(application.mallId, application.rooms, {
    status: "leased",
    businessId: business.id,
    applicationId: application.id,
  });

  const unverified = !isApprovedForRental(application.userId);

  return res.status(200).json({
    success: true,
    application: publicApplication(application),
    business: { id: business.id, name: business.name, subdomain: business.subdomain },
    identityVerified: !unverified,
    message:
      `${application.businessName} is approved for ${formatRooms(application.rooms)} in ${mall.name}. ` +
      `They sign in with ${application.email}.` +
      // Stated rather than buried: a rented shop whose owner's Fayda ID was never
      // checked is a real risk, and the administrator is the only person
      // positioned to notice it.
      (unverified
        ? " Their Fayda ID has not been verified yet, so their store cannot be published until it is."
        : ""),
  });
});

/**
 * Create the store behind an approved rental.
 *
 * Mirrors what the sign-up route does for a person who registers directly, so
 * an approved renter and a direct sign-up end up with identical records - no
 * second shape of "a store exists" for a later feature to discover.
 *
 * Returns the created business so the caller can stamp it onto the units.
 */
function provisionStore(input: {
  businessName: string;
  email: string;
  phone: string;
  location: string;
  packageId: PackageId;
  mall: Mall;
  floor: string;
  rooms: string[];
  userId: string;
}): Business {
  const now = new Date().toISOString();
  const id = `biz-${randomBytes(4).toString("hex")}`;
  const email = input.email.trim().toLowerCase();

  const business: Business = {
    id,
    name: input.businessName,
    type: "mall",
    mall: buildMallPlacement({
      // The DIRECTORY is the authority on the name, never the applicant's form.
      mall: input.mall,
      floor: input.floor,
      rooms: input.rooms,
      agreementId: input.mall.agreementId,
    }),
    subdomain: subdomainFor(input.businessName),
    status: "Trial",
    packageId: input.packageId,
    trustedSeller: false,
    location: input.location,
    rating: 0,
    createdAt: now,
    customization: {
      logoUrl: null,
      coverImageUrl: null,
      businessName: input.businessName,
      description: "",
      businessInformation: "",
      theme: "yene",
      featuredProductIds: [],
      bannerProductIds: [],
      socialLinks: [],
      contact: { phone: input.phone, email, address: input.location },
      policies: { returns: "", shipping: "", terms: "", privacy: "" },
      delivery: { options: [], freeAbove: null },
      paymentOptions: ["Cash on delivery"],
    },
  };

  const subscription: Subscription = {
    businessId: id,
    packageId: input.packageId,
    status: "Trial",
    startedAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    autoRenew: false,
    pendingChange: null,
    lastUpgradeAmount: 0,
  };

  allBusinesses().push(business);
  persist.businesses();
  saveSubscription(subscription, emptyLedger());

  // Attach the store to the person who applied. Their account keeps its own
  // password and identity; only the business binding is new. A customer who
  // becomes an owner by renting a shop is the point of the feature.
  const user = allUsers().find((entry) => entry.id === input.userId);
  if (user && user.businessId !== id) {
    user.businessId = id;
    if (user.role === "customer") user.role = "owner";
    persistUsers();
  }

  return business;
}