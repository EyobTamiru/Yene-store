/**
 * ============================================================================
 *  RENT-A-STORE ROUTER (Section 55)
 * ============================================================================
 *
 *  Mounted at /api/platform/rental-out.
 *
 *  THE TENANT IS NEVER TAKEN FROM A REQUEST
 *  ---------------------------------------
 *  `tenantBusinessId` in a request body is ignored. The tenant is the CALLER's
 *  own business, resolved from the session - which is what stops business A from
 *  occupying business B's slot by naming B's id.
 *
 *  THE OWNER IS NEVER TAKEN FROM A REQUEST EITHER
 *  ------------------------------------------------
 *  Same rule on the other side: an owner may only edit a listing whose
 *  `ownerBusinessId` is their own resolved business.
 */

import { Router, type Request, type Response } from "express";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createJsonCollection } from "../lib/jsonCollection";
import { resolveIdentity } from "./auth";
import { allBusinesses, businessById } from "./store";
import { PACKAGE_ORDER, PACKAGES, isPackageId, monthlyPrice } from "../../src/platform/packages";
import {
  canOfferRental,
  canRentSlot,
  isValidShareBps,
  listingForOwner,
  listingForRenters,
  ownerMonthlyIncome,
  shareLabel,
  type StoreRentalListing,
} from "../../src/platform/rentalOut";

export const rentalOutRouter = Router();

const dataDir = process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data");

const listings = createJsonCollection<StoreRentalListing>(
  path.join(dataDir, "store-rental-listings.json"),
  "store-rental-listings",
  5_000,
);

export const allRentalListings = listings.all;
export const persistRentalListings = listings.touch;

function newListingId(): string {
  return `rent-${randomBytes(6).toString("hex")}`;
}

/**
 * The caller's own business, or a refusal.
 *
 * Written once here so that no route in this file can accidentally trust a
 * business id from a request body.
 */
function ownBusiness(req: Request, res: Response) {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated) {
    res.status(401).json({ error: "Please sign in to continue." });
    return null;
  }
  if (!identity.businessId) {
    res.status(403).json({ error: "This account is not attached to a business." });
    return null;
  }
  const business = businessById(identity.businessId);
  if (!business) {
    res.status(404).json({ error: "Business not found." });
    return null;
  }
  return business;
}

function save(listing: StoreRentalListing): void {
  const list = allRentalListings();
  const index = list.findIndex((entry) => entry.id === listing.id);
  if (index === -1) list.push(listing);
  else list[index] = listing;
  persistRentalListings();
}

/**
 * GET /api/platform/rental-out/mine
 *
 * The caller's own slots. Never anybody else's.
 */
rentalOutRouter.get("/mine", (req: Request, res: Response) => {
  const business = ownBusiness(req, res);
  if (!business) return;

  const rows = allRentalListings()
    .filter((listing) => listing.ownerBusinessId === business.id)
    .map((listing) => {
      const tenant = listing.tenantBusinessId ? businessById(listing.tenantBusinessId) : null;
      return {
        ...listingForOwner(listing),
        // What the owner earns, from the TENANT's package price - the one figure
        // both sides agree on.
        incomePerMonth: ownerMonthlyIncome(
          listing,
          tenant?.packageId ?? null,
          monthlyPrice,
        ),
      };
    });

  return res.status(200).json({
    listings: rows,
    totals: {
      listings: rows.length,
      occupied: rows.filter((row) => row.occupied).length,
      incomePerMonth: rows.reduce((sum, row) => sum + row.incomePerMonth, 0),
    },
  });
});

/**
 * GET /api/platform/rental-out/open
 *
 * The slots on offer. Public, like the marketplace: a business looking for a slot
 * should be able to see what exists without an account.
 */
rentalOutRouter.get("/open", (_req: Request, res: Response) => {
  const rows = allRentalListings()
    .filter((listing) => listing.status === "open" && !listing.tenantBusinessId)
    .map((listing) =>
      listingForRenters(listing, businessById(listing.ownerBusinessId)?.name ?? "A Yene business"),
    );
  return res.status(200).json({ listings: rows });
});

/**
 * POST /api/platform/rental-out
 *
 * Offer a slot. Available to EVERY package - a Silver business must be able to
 * rent its storefront out, which is how a small business becomes a landlord.
 */
rentalOutRouter.post("/", (req: Request, res: Response) => {
  const business = ownBusiness(req, res);
  if (!business) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = String(body.title ?? "").trim().slice(0, 120);
  if (title.length < 3) return res.status(400).json({ error: "Give the slot a name." });

  const rent = Number(body.monthlyRentEtb ?? 0);
  if (!Number.isFinite(rent) || rent < 0 || rent > 1_000_000) {
    return res.status(400).json({ error: "The monthly rent must be between 0 and 1,000,000 ETB." });
  }

  const share = Number(body.ownerShareBps ?? 0);
  if (!isValidShareBps(share)) {
    return res.status(400).json({ error: "The revenue share must be between 0% and 90%." });
  }

  const minimumPackageId = String(body.minimumPackageId ?? business.packageId);
  if (!isPackageId(minimumPackageId)) {
    return res.status(400).json({ error: "Choose a valid minimum package." });
  }

  // A business may not demand a package ABOVE its own - that would be selling
  // something it cannot deliver.
  if (PACKAGE_ORDER.indexOf(minimumPackageId) > PACKAGE_ORDER.indexOf(business.packageId)) {
    return res.status(400).json({
      error: `Your slot cannot require a package above your own (${PACKAGES[business.packageId].name}).`,
    });
  }

  const now = new Date().toISOString();
  const listing: StoreRentalListing = {
    id: newListingId(),
    ownerBusinessId: business.id,
    title,
    description: String(body.description ?? "").trim().slice(0, 1000),
    monthlyRentEtb: Math.round(rent),
    ownerShareBps: share,
    tenantBusinessId: null,
    status: "open",
    minimumPackageId,
    createdAt: now,
    updatedAt: now,
    occupiedAt: null,
    endedAt: null,
  };

  save(listing);
  return res.status(201).json({
    listing: listingForOwner(listing),
    message: "Your slot is now on offer.",
  });
});

/**
 * POST /api/platform/rental-out/:id/rent
 *
 * Take a slot. THE TENANT IS THE CALLER.
 */
rentalOutRouter.post("/:id/rent", (req: Request, res: Response) => {
  const business = ownBusiness(req, res);
  if (!business) return;

  const listing = allRentalListings().find((entry) => entry.id === String(req.params.id));
  if (!listing || listing.status !== "open") {
    return res.status(404).json({ error: "This slot is not available." });
  }

  const decision = canRentSlot(business, listing, PACKAGE_ORDER);
  if (decision.ok === false) return res.status(409).json({ error: decision.reason });

  const now = new Date().toISOString();
  listing.tenantBusinessId = business.id;
  listing.status = "occupied";
  listing.occupiedAt = now;
  listing.updatedAt = now;
  save(listing);

  return res.status(200).json({
    listing: listingForOwner(listing),
    message: "The slot is now yours. Your store will appear in the owner's storefront group.",
    // Stated so neither party is surprised about the money.
    yourMonthlyShareOwed: ownerMonthlyIncome(listing, business.packageId, monthlyPrice),
    ownerShare: shareLabel(listing.ownerShareBps),
  });
});

/**
 * POST /api/platform/rental-out/:id/end
 *
 * End a tenancy. Either party may call it; the counterparty is released either
 * way, and neither can hold the slot hostage by refusing to leave.
 */
rentalOutRouter.post("/:id/end", (req: Request, res: Response) => {
  const business = ownBusiness(req, res);
  if (!business) return;

  const listing = allRentalListings().find((entry) => entry.id === String(req.params.id));
  if (!listing) return res.status(404).json({ error: "Slot not found." });

  const isOwner = listing.ownerBusinessId === business.id;
  const isTenant = listing.tenantBusinessId === business.id;
  if (!isOwner && !isTenant) {
    // The same refusal as "not found", so this route cannot confirm that a slot
    // exists between two other businesses.
    return res.status(404).json({ error: "Slot not found." });
  }

  const now = new Date().toISOString();
  listing.status = "open";
  listing.tenantBusinessId = null;
  listing.occupiedAt = null;
  listing.endedAt = now;
  listing.updatedAt = now;
  save(listing);

  return res.status(200).json({
    listing: listingForOwner(listing),
    message: "The tenancy has ended and the slot is on offer again.",
  });
});

/**
 * GET /api/platform/rental-out/directory
 *
 * Every open slot with its owner named - the directory a business browses before
 * deciding to take one.
 */
rentalOutRouter.get("/directory", (_req: Request, res: Response) => {
  const rows = allRentalListings()
    .filter((listing) => listing.status === "open" && !listing.tenantBusinessId)
    .map((listing) => ({
      ...listingForRenters(listing, businessById(listing.ownerBusinessId)?.name ?? "A Yene business"),
      ownerPackageId: businessById(listing.ownerBusinessId)?.packageId ?? null,
    }));
  return res.status(200).json({ listings: rows, total: allBusinesses().length });
});
