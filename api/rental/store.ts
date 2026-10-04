/**
 * ============================================================================
 *  STORE RENTAL STORE (Sections 10 & 41)
 * ============================================================================
 *
 *  Holds the two records the rental feature needs on disk:
 *
 *    platform-rental-applications.json  who applied for which counter
 *    (units live in api/platform/store.ts, beside the malls they belong to)
 *
 *  WHY APPLICATIONS ARE SEPARATE FROM BUSINESSES
 *  ---------------------------------------------
 *  A `Business` row means "this shop trades". A rental application means "this
 *  person asked for a counter and is waiting". Those are different states with
 *  different consequences, and collapsing them would mean creating a live
 *  storefront for somebody who has not been approved yet - which is the exact
 *  hole that let anyone rent a store by signing up.
 *
 *  THE PHONE NUMBER IS THE POINT
 *  -----------------------------
 *  Every application carries a normalised phone (see `normalizeEthiopianPhone`).
 *  That is what lets an administrator clear the queue by typing the number
 *  somebody read out to them, and it is why `phone` is REQUIRED on an
 *  application - a rental that cannot be identified cannot be reviewed.
 */

import path from "node:path";
import { createJsonCollection } from "../lib/jsonCollection";
import type { RentalApplication } from "../../src/platform/types";

export const dataDir = process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data");

const applications = createJsonCollection<RentalApplication>(
  path.join(dataDir, "platform-rental-applications.json"),
  "rental-applications",
  20_000,
);

export const allRentalApplications = applications.all;
export const persistRentalApplications = applications.touch;
export const flushRentalApplications = applications.flush;

/** Insert or replace, by id. The only writer of an application row. */
export function saveRentalApplication(application: RentalApplication): void {
  const list = allRentalApplications();
  const index = list.findIndex((entry) => entry.id === application.id);
  if (index === -1) list.push(application);
  else list[index] = application;
  persistRentalApplications();
}

/** A single application by its id. */
export function rentalApplicationById(id: string): RentalApplication | null {
  return allRentalApplications().find((entry) => entry.id === id) ?? null;
}

/**
 * One open application per person, per counter set.
 *
 * Without this a person who double-clicks "Apply" would occupy two holds on the
 * same unit, and would show up twice in an administrator's queue - once of which
 * they would approve, leaving a phantom hold on the other.
 */
export function findOpenApplication(
  userId: string,
  mallId: string,
  rooms: readonly string[],
): RentalApplication | null {
  const wanted = new Set(rooms.map((room) => room.trim().toUpperCase()));
  return (
    allRentalApplications().find(
      (entry) =>
        entry.status === "pending" &&
        entry.userId === userId &&
        entry.mallId === mallId &&
        entry.rooms.some((room) => wanted.has(room.trim().toUpperCase())),
    ) ?? null
  );
}

/** Everything still waiting, oldest first - the order a queue is worked in. */
export function pendingApplications(): RentalApplication[] {
  return allRentalApplications()
    .filter((entry) => entry.status === "pending")
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}