/**
 * Give every account that has no password a working demo password.
 *
 * THE PROBLEM
 * -----------
 * `api/auth/store.ts:seedUsersFromBusinesses()` creates one owner account per
 * seeded business so stores have a tenant, but it deliberately sets NO password -
 * those accounts exist for ownership and access control, not for signing in. The
 * result is that eight of the nine example stores could not be signed into at
 * all, which makes the package comparison (Silver / Gold / Platinum / Super)
 * impossible without eight separate sign-ups.
 *
 * THE CONVENTION
 * ---------------
 * The password is the account's own name plus "123" - the part of its email
 * before the `@`, lowercased:
 *
 *     hello@bolefurniture.example    ->  hello123
 *     sales@blueshop.example         ->  sales123
 *     superadmin@yenebusinessgroup.example -> superadmin123
 *     lumiere_perfume@yene-store.com ->  lumiere123    (already shipped this way)
 *
 * That is not arbitrary: the one working owner account this project has always
 * used - the bootstrap demo owner - already follows it.
 *
 * SAFETY
 * ------
 * 1. ONLY ACCOUNTS WITH NO PASSWORD ARE TOUCHED. Anything that already has a
 *    hash is skipped, so running this twice cannot overwrite a password somebody
 *    has since changed, and cannot disturb the shipped super-admin
 *    (`admin@123`) or demo-owner (`lumiere123`) credentials.
 * 2. REFUSES TO RUN IN PRODUCTION without DEMO_PASSWORDS_ENABLED="true". These
 *    are `hello123`-strength development credentials and must never appear on a
 *    public deployment.
 * 3. HASHED LIKE ANY OTHER CREDENTIAL - scrypt, no readable secret on disk.
 *
 * Run with `npm run seed:demo-passwords`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "../api/auth/crypto";

interface StoredUser {
  id: string;
  email: string;
  businessId: string | null;
  role: string;
  passwordHash?: string;
}

const FILE = join(process.cwd(), "data", "auth-users.json");

/**
 * The development password for a given account: the email's local part + "123".
 *
 * Sanitised so an address like `sales+retail@shop.example` still yields a
 * readable password rather than one containing a plus sign.
 */
export function demoPasswordFor(email: string): string {
  const local = String(email).split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${local || "demo"}123`;
}

function main(): void {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_PASSWORDS_ENABLED !== "true") {
    console.warn(
      'DEMO_PASSWORDS_ENABLED is not "true", so no example-store passwords were set. ' +
        "This is the safe default in production.",
    );
    process.exit(1);
  }

  const users = JSON.parse(readFileSync(FILE, "utf8")) as StoredUser[];
  const set: { email: string; password: string; businessId: string; role: string }[] = [];
  const skipped: string[] = [];

  for (const user of users) {
    // NEVER CLOBBER. Anything that already has a hash is left exactly as it is,
    // which is what keeps the shipped super-admin (`admin@123`) and demo-owner
    // (`lumiere123`) credentials intact across repeated runs.
    if (user.passwordHash) {
      skipped.push(user.email);
      continue;
    }
    // An account with no usable email cannot derive a name, so it is left alone
    // rather than being given a password nobody could guess or type.
    if (!user.email || !user.email.includes("@")) {
      skipped.push(user.id);
      continue;
    }

    const password = demoPasswordFor(user.email);
    user.passwordHash = hashPassword(password);
    set.push({
      email: user.email,
      password,
      businessId: user.businessId ?? "",
      role: user.role,
    });
  }

  if (set.length > 0) writeFileSync(FILE, JSON.stringify(users, null, 2), "utf8");

  console.log(`\nAccounts signed in (${set.length}):\n`);
  for (const row of set) {
    const who = row.businessId || row.role;
    console.log(`  ${row.password.padEnd(22)} ${row.email.padEnd(38)} ${who}`);
  }

  if (skipped.length > 0) {
    console.log(`\nLeft untouched, already had a password (${skipped.length}):\n`);
    for (const email of skipped) console.log(`  ${email}`);
  }

  console.log(
    "\nThese are DEVELOPMENT credentials. Remove them, or set " +
      'DEMO_PASSWORDS_ENABLED="false" with real accounts, before exposing this server.',
  );
}

main();