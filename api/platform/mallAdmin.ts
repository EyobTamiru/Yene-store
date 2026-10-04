/**
 * ============================================================================
 *  MALL ADMINISTRATION ROUTES (Sections 10 & 41)
 * ============================================================================
 *
 *  Mounted on the platform router under /admin. Every route requires a super
 *  administrator - the tenant check used by business routes is the wrong one
 *  here, because a mall belongs to YENE-STORE's agreement with a landlord, not
 *  to any business signed into it.
 *
 *    GET    /admin/malls              every mall, with occupancy and rent roll
 *    POST   /admin/malls              create a mall
 *    PATCH  /admin/malls/:id          edit a mall, or show/hide it
 *    DELETE /admin/malls/:id          delete, refused while it has tenants
 *    GET    /admin/malls/:id/units    the full unit list, listable or not
 *    POST   /admin/malls/:id/units    add a unit
 *    PATCH  /admin/units/:id          price, size, listable, status
 *    DELETE /admin/units/:id          delete a unit
 *    GET    /admin/malls/:id/agreement   the agreement with the landlord
 *    PUT    /admin/malls/:id/agreement   create or replace it
 *    GET    /admin/malls/:id/leases      every lease, active or ended
 *    PATCH  /admin/leases/:id            end or reactivate a lease
 *
 *  TWO SWITCHES, BECAUSE THEY ANSWER DIFFERENT QUESTIONS
 *  ---------------------------------------------------
 *    Mall.visible = false    the WHOLE mall leaves the public directory. Its
 *                             stores stop appearing as mall stores and its
 *                             unclaimed rooms stop being advertised.
 *    Unit.listable = false   ONE counter stops being offered, while the rest of
 *                             the building carries on trading normally.
 *
 *  Neither deletes a row, and both are reversible - a landlord closing a mall for
 *  two weeks of renovation should not have to rebuild it afterwards.
 *
 *  MONEY IS NEVER INVENTED
 *  -----------------------
 *  The rent roll sums `StoreLease.monthlyRentEtb`, not a unit's advertised
 *  price, so the figure shown is rent that was actually agreed. A unit's price
 *  is what a NEW tenant would be asked; a lease is what the current one pays.
 */

import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { requireSuperAdmin, resolveIdentity } from "./auth";
import {
  activeAgreementFor,
  allBusinesses,
  allMallAgreements,
  allMallUnits,
  allMalls,
  allStoreLeases,
  deleteMallRow,
  deleteUnit,
  mallById,
  persistMallUnits,
  saveLease,
  saveMall,
  saveMallAgreement,
  seedMallUnits,
} from "./store";
import {
  canDeleteMall,
  landlordPayout,
  normaliseUnitEdit,
  occupancy,
  rentRoll,
} from "../../src/platform/mallAdmin";
import { slugify } from "../../src/platform/malls";
import { unitId } from "../../src/platform/rental";
import type { Mall, MallAgreementStatus, MallUnit } from "../../src/platform/types";

export const mallAdminRouter = Router();

function bad(res: Response, message: string, extra: Record<string, unknown> = {}) {
  return res.status(400).json({ error: message, ...extra });
}

/**
 * The super-admin gate, in ONE place inside this router.
 *
 * Written here rather than imported from the main platform router, because
 * `mallAdminRouter` is mounted onto it - importing the guard back out would make
 * the two modules circular. It resolves the identity and answers 403 on failure,
 * exactly as the marketplace admin routes do.
 */
function admin(res: Response, req: Request): boolean {
  if (requireSuperAdmin(resolveIdentity(req))) return true;
  res.status(403).json({ error: "Super Admin access is required." });
  return false;
}

/** Every mall with the numbers a landlord actually asks for. */
mallAdminRouter.get("/admin/malls", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  seedMallUnits();

  const malls = allMalls().map((mall) => {
    const units = allMallUnits().filter((unit) => unit.mallId === mall.id);
    const leases = allStoreLeases().filter((lease) => lease.mallId === mall.id);
    const roll = rentRoll(units, leases, mall);
    const agreement = activeAgreementFor(mall.id);

    return {
      ...mall,
      occupancy: occupancy(units, mall),
      rentRoll: roll,
      storeCount: allBusinesses().filter((business) => business.mall?.mallId === mall.id).length,
      agreement: agreement
        ? {
            id: agreement.id,
            landlordName: agreement.landlordName,
            status: agreement.status,
            revenueSharePercent: agreement.revenueSharePercent,
            monthlyFeeEtb: agreement.monthlyFeeEtb,
            endDate: agreement.endDate,
            // What the owner is owed THIS month, at the agreed share.
            payoutEtb: landlordPayout(roll, agreement.revenueSharePercent),
          }
        : null,
    };
  });

  // Malls collecting rent first: the order an administrator working a list of
  // landlords wants, rather than alphabetical.
  malls.sort((a, b) => b.rentRoll.contractedMonthlyEtb - a.rentRoll.contractedMonthlyEtb);

  return res.status(200).json({
    malls,
    totals: {
      malls: malls.length,
      visible: malls.filter((mall) => mall.visible).length,
      units: malls.reduce((sum, mall) => sum + mall.occupancy.total, 0),
      leased: malls.reduce((sum, mall) => sum + mall.occupancy.leased, 0),
      contractedMonthlyEtb: malls.reduce((sum, mall) => sum + mall.rentRoll.contractedMonthlyEtb, 0),
      potentialMonthlyEtb: malls.reduce((sum, mall) => sum + mall.rentRoll.potentialMonthlyEtb, 0),
    },
  });
});

mallAdminRouter.post("/admin/malls", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const name = String(body.name ?? "").trim().slice(0, 80);
  if (name.length < 2) return bad(res, "Enter the mall's name.");

  const slug = slugify(name);
  if (allMalls().some((mall) => mall.slug === slug)) {
    return bad(res, `A mall called "${name}" already exists.`);
  }

  const floors = String(body.floors ?? "")
    .split(/[,;\n]/)
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 24);
  if (floors.length === 0) {
    return bad(res, "Give the mall at least one floor, for example GFS or 1F.");
  }

  const mall: Mall = {
    id: `mall-${randomBytes(4).toString("hex")}`,
    name,
    slug,
    city: String(body.city ?? "Addis Ababa").trim().slice(0, 60),
    address: String(body.address ?? "").trim().slice(0, 160),
    description: String(body.description ?? "").trim().slice(0, 600),
    floors,
    agreementId: null,
    visible: body.visible !== false,
    logoUrl: null,
    coverImageUrl: null,
    createdAt: new Date().toISOString(),
  };

  saveMall(mall);
  // Build the unit directory immediately, so the new mall is usable rather than
  // an empty shell somebody has to remember to populate.
  seedMallUnits();

  return res.status(201).json({ success: true, mall });
});

mallAdminRouter.patch("/admin/malls/:id", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const mall = mallById(req.params.id);
  if (!mall) return res.status(404).json({ error: "That mall does not exist." });

  const body = (req.body ?? {}) as Record<string, unknown>;

  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 80);
    if (name.length < 2) return bad(res, "Enter the mall's name.");
    mall.name = name;
    // The slug follows the name, but only if nobody else already holds it -
    // two malls sharing a slug would merge in the directory lookup.
    const wanted = slugify(name);
    if (!allMalls().some((other) => other.id !== mall.id && other.slug === wanted)) {
      mall.slug = wanted;
    }
  }
  if (body.city !== undefined) mall.city = String(body.city).trim().slice(0, 60);
  if (body.address !== undefined) mall.address = String(body.address).trim().slice(0, 160);
  if (body.description !== undefined) {
    mall.description = String(body.description).trim().slice(0, 600);
  }
  if (body.agreementId !== undefined) {
    mall.agreementId = String(body.agreementId ?? "").trim() || null;
  }

  // The show/hide switch, recorded as a fact rather than inferred, so an
  // administrator can tell "hidden on purpose" from "not set up yet".
  if (body.visible !== undefined) {
    mall.visible = body.visible !== false && body.visible !== "false";
  }

  if (body.floors !== undefined) {
    const floors = String(body.floors)
      .split(/[,;\n]/)
      .map((entry) => entry.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 24);
    if (floors.length === 0) return bad(res, "A mall needs at least one floor.");
    mall.floors = floors;
  }

  saveMall(mall);
  return res.status(200).json({ success: true, mall });
});

mallAdminRouter.delete("/admin/malls/:id", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const mall = mallById(req.params.id);
  if (!mall) return res.status(404).json({ error: "That mall does not exist." });

  const safety = canDeleteMall(mall, allBusinesses(), allStoreLeases());
  if (!safety.allowed) {
    return res.status(409).json({ error: safety.reason, ...safety });
  }

  deleteMallRow(mall.id);
  return res.status(200).json({ success: true, message: `${mall.name} has been removed.` });
});

// ---------------------------------------------------------------------------
// Units: the "Rooms still available" list, under the landlord's control
// ---------------------------------------------------------------------------

mallAdminRouter.get("/admin/malls/:id/units", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const mall = mallById(req.params.id);
  if (!mall) return res.status(404).json({ error: "That mall does not exist." });
  seedMallUnits();

  const units = allMallUnits()
    .filter((unit) => unit.mallId === mall.id)
    .sort(
      (a, b) =>
        a.floor.localeCompare(b.floor) ||
        a.number.localeCompare(b.number, undefined, { numeric: true }),
    )
    .map((unit) => {
      const lease = allStoreLeases().find((entry) => entry.unitId === unit.id && entry.active);
      const business = lease ? allBusinesses().find((b) => b.id === lease.businessId) : null;
      return {
        ...unit,
        tenantName: business?.name ?? null,
        // The price a NEW tenant would be asked, beside what the current one
        // actually pays, so a discount is visible without opening the lease.
        currentLeaseRentEtb: lease?.monthlyRentEtb ?? null,
      };
    });

  return res.status(200).json({
    mall: { id: mall.id, name: mall.name, floors: mall.floors },
    units,
  });
});

mallAdminRouter.post("/admin/malls/:id/units", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const mall = mallById(req.params.id);
  if (!mall) return res.status(404).json({ error: "That mall does not exist." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const { patch, error } = normaliseUnitEdit(body);
  if (error) return bad(res, error);

  const floor = String(patch.floor ?? "").toUpperCase();
  if (!floor) return bad(res, "A unit needs a floor.");
  if (!mall.floors.includes(floor)) {
    return bad(res, `${floor} is not a floor in ${mall.name}.`, { floors: mall.floors });
  }

  const number = patch.number ?? `${floor}-01`;
  const id = unitId(mall.id, number);
  if (allMallUnits().some((unit) => unit.id === id)) {
    return res.status(409).json({ error: `${number} already exists in ${mall.name}.` });
  }

  const unit: MallUnit = {
    id,
    mallId: mall.id,
    floor,
    number,
    sizeSqm: patch.sizeSqm ?? 20,
    monthlyRentEtb: patch.monthlyRentEtb ?? 0,
    status: "available",
    listable: patch.listable !== false,
    businessId: null,
    applicationId: null,
    createdAt: new Date().toISOString(),
  };

  allMallUnits().push(unit);
  persistMallUnits();

  return res.status(201).json({ success: true, unit });
});

mallAdminRouter.patch("/admin/units/:id", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const unit = allMallUnits().find((entry) => entry.id === req.params.id);
  if (!unit) return res.status(404).json({ error: "That counter does not exist." });

  const { patch, error } = normaliseUnitEdit(body);
  if (error) return bad(res, error);

  // A price or size can always be changed. Renumbering a counter that is already
  // let would silently re-address somebody's lease.
  if (patch.number && patch.number !== unit.number && (unit.businessId || unit.applicationId)) {
    return res.status(409).json({
      error: `${unit.number} is already ${unit.businessId ? "let" : "held"}. End the lease before renumbering it.`,
    });
  }

  // Turning a counter back on when it is still let would put an occupied shop
  // back in the public list of rooms still available.
  if (patch.listable === true && unit.businessId) {
    return res.status(409).json({
      error: `${unit.number} is already let. End its lease before advertising it again.`,
    });
  }

  Object.assign(unit, patch);
  persistMallUnits();

  return res.status(200).json({ success: true, unit });
});

mallAdminRouter.delete("/admin/units/:id", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const unit = allMallUnits().find((entry) => entry.id === req.params.id);
  if (!unit) return res.status(404).json({ error: "That counter does not exist." });

  // Deleting a counter somebody has applied for or signed for would erase the
  // thing the hold or the lease points at.
  if (unit.businessId) {
    return res.status(409).json({ error: `${unit.number} is let to a store. End the lease first.` });
  }
  if (unit.applicationId) {
    return res.status(409).json({
      error: `${unit.number} is held by a pending rental request. Decline that request first.`,
    });
  }

  deleteUnit(unit.id);
  return res.status(200).json({ success: true, message: `${unit.number} has been removed.` });
});

// ---------------------------------------------------------------------------
// The agreement with the mall's owner
// ---------------------------------------------------------------------------

mallAdminRouter.get("/admin/malls/:id/agreement", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const mall = mallById(req.params.id);
  if (!mall) return res.status(404).json({ error: "That mall does not exist." });

  const roll = rentRoll(
    allMallUnits().filter((unit) => unit.mallId === mall.id),
    allStoreLeases(),
    mall,
  );
  const current = activeAgreementFor(mall.id);

  return res.status(200).json({
    mall: { id: mall.id, name: mall.name, agreementId: mall.agreementId },
    // Every agreement, so a terminated one is visible rather than lost.
    agreements: allMallAgreements().filter((agreement) => agreement.mallId === mall.id),
    current,
    rentRoll: roll,
    // The headline: what this mall brings in, and what it could bring in.
    payoutPreview: current
      ? {
          revenueSharePercent: current.revenueSharePercent,
          payoutEtb: landlordPayout(roll, current.revenueSharePercent),
        }
      : null,
  });
});

/**
 * Create or replace the agreement for a mall.
 *
 * REPLACES rather than appends, because there is only ever one agreement in
 * force. A landlord negotiating new terms should edit the live row, not leave
 * old terms sitting beside the new ones where a payout would be computed from
 * whichever `activeAgreementFor` happened to find first.
 *
 * Activating an agreement writes its id back onto the mall, which is what grants
 * that mall's stores a free subdomain (Section 41).
 */
mallAdminRouter.put("/admin/malls/:id/agreement", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const mall = mallById(req.params.id);
  if (!mall) return res.status(404).json({ error: "That mall does not exist." });

  const body = (req.body ?? {}) as Record<string, unknown>;

  const landlordName = String(body.landlordName ?? "").trim().slice(0, 120);
  if (landlordName.length < 2) return bad(res, "Enter the landlord's name.");

  const monthlyFeeEtb = Number(body.monthlyFeeEtb ?? 0);
  if (!Number.isFinite(monthlyFeeEtb) || monthlyFeeEtb < 0) {
    return bad(res, "The monthly fee must be zero or more.");
  }

  const revenueSharePercent = Number(body.revenueSharePercent ?? 0);
  if (!Number.isFinite(revenueSharePercent) || revenueSharePercent < 0 || revenueSharePercent > 100) {
    return bad(res, "The revenue share must be between 0 and 100.");
  }

  const status = String(body.status ?? "draft") as MallAgreementStatus;
  if (!["draft", "active", "expired", "terminated"].includes(status)) {
    return bad(res, "Unknown agreement status.");
  }

  const now = new Date().toISOString();
  const existing = activeAgreementFor(mall.id);
  const id = existing?.id ?? `MA-${randomBytes(4).toString("hex")}`;

  saveMallAgreement({
    id,
    mallId: mall.id,
    landlordName,
    landlordPhone: String(body.landlordPhone ?? "").trim().slice(0, 40),
    landlordEmail: String(body.landlordEmail ?? "").trim().slice(0, 160),
    status,
    monthlyFeeEtb: Math.round(monthlyFeeEtb),
    revenueSharePercent: Math.round(revenueSharePercent),
    startDate: String(body.startDate ?? now.slice(0, 10)),
    endDate: body.endDate ? String(body.endDate).slice(0, 10) : null,
    signedByLandlord: body.signedByLandlord === true,
    notes: String(body.notes ?? "").trim().slice(0, 1000),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  // The agreement id travels on the mall: Section 41 uses its presence to grant
  // that mall's stores a free subdomain.
  mall.agreementId = status === "active" ? id : null;
  saveMall(mall);

  const roll = rentRoll(
    allMallUnits().filter((unit) => unit.mallId === mall.id),
    allStoreLeases(),
    mall,
  );

  return res.status(200).json({
    success: true,
    agreementId: id,
    active: status === "active",
    payoutEtb: landlordPayout(roll, Math.round(revenueSharePercent)),
    message:
      status === "active"
        ? `Agreement active. ${mall.name} now grants its stores a YENE-STORE subdomain.`
        : `Agreement saved as ${status}. It does not grant free subdomains until it is active.`,
  });
});

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

mallAdminRouter.get("/admin/malls/:id/leases", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const mall = mallById(req.params.id);
  if (!mall) return res.status(404).json({ error: "That mall does not exist." });

  const leases = allStoreLeases()
    .filter((lease) => lease.mallId === mall.id)
    .map((lease) => {
      const unit = allMallUnits().find((entry) => entry.id === lease.unitId);
      const business = allBusinesses().find((entry) => entry.id === lease.businessId);
      return {
        ...lease,
        unitNumber: unit?.number ?? "(counter removed)",
        unitSizeSqm: unit?.sizeSqm ?? null,
        tenantName: business?.name ?? "(store removed)",
        tenantSubdomain: business?.subdomain ?? null,
        // What the unit is advertised at now, for comparison with what this
        // tenant agreed.
        listedRentEtb: unit?.monthlyRentEtb ?? null,
      };
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  return res.status(200).json({
    leases,
    rentRoll: rentRoll(
      allMallUnits().filter((unit) => unit.mallId === mall.id),
      allStoreLeases(),
      mall,
    ),
  });
});

/**
 * End or reactivate a lease.
 *
 * Ending one RELEASES the counter: the unit goes back to `available` and stops
 * carrying the old business id, so it can be advertised again. That release is
 * the whole point - a lease that ended without freeing the shop would leave a
 * counter permanently unlettable.
 */
mallAdminRouter.patch("/admin/leases/:id", (req: Request, res: Response) => {
  if (!admin(res, req)) return;
  const lease = allStoreLeases().find((entry) => entry.id === req.params.id);
  if (!lease) return res.status(404).json({ error: "That lease does not exist." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();

  if (body.monthlyRentEtb !== undefined) {
    const rent = Number(body.monthlyRentEtb);
    if (!Number.isFinite(rent) || rent < 0) return bad(res, "Monthly rent must be zero or more.");
    lease.monthlyRentEtb = Math.round(rent);
    lease.updatedAt = now;
  }

  if (body.depositEtb !== undefined) {
    const deposit = Number(body.depositEtb);
    if (!Number.isFinite(deposit) || deposit < 0) return bad(res, "Deposit must be zero or more.");
    lease.depositEtb = Math.round(deposit);
    lease.updatedAt = now;
  }

  if (body.active !== undefined) {
    lease.active = body.active === true || body.active === "true";
    lease.updatedAt = now;
    // Reactivating clears the end date: a live lease carrying a past end date
    // reads as expired in every report built from these rows.
    lease.endDate = lease.active
      ? null
      : String(body.endDate ?? now.slice(0, 10)).slice(0, 10);
  }

  saveLease(lease);

  // Release the counter when the lease ends, and re-take it when it restarts.
  const unit = allMallUnits().find((entry) => entry.id === lease.unitId);
  if (unit && body.active !== undefined) {
    if (lease.active) {
      unit.status = "leased";
      unit.businessId = lease.businessId;
      unit.listable = false;
    } else {
      unit.status = "available";
      unit.businessId = null;
    }
    persistMallUnits();
  }

  return res.status(200).json({
    success: true,
    lease,
    message: lease.active
      ? "Lease reactivated."
      : "Lease ended. The counter is available again.",
  });
});