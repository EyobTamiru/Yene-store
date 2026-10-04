/**
 * ============================================================================
 *  AUTH STORE - users, login codes, sessions
 * ============================================================================
 *
 *  Three NEW durable collections, using the same `createJsonCollection` write
 *  strategy as every other store in this project.
 *
 *  NO MIGRATION, NO DESTRUCTIVE STEP (Section 26)
 *  -----------------------------------------------
 *  This project has no Prisma and no SQL - "the database" is a set of JSON
 *  files under `YENE_DATA_DIR`, each written atomically (temp file + rename).
 *  Adding three new collections is purely additive: it creates three new files
 *  and touches none of the existing ones. There is no schema to migrate, no
 *  table to lock, and no `prisma migrate reset` equivalent to run.
 *
 *  The seeded users are read FROM the existing businesses rather than replacing
 *  anything: `seedUsersFromBusinesses` only ever appends, and only for
 *  businesses it has not seen before. Deleting a user row would break nothing
 *  and is never done.
 *
 *  WHY A SEPARATE USER DIRECTORY
 *  -----------------------------
 *  Sections 1-55 identified tenants by `businessId` but had no notion of a
 *  person: identity came from a hard-coded `dev:*` map. This directory is the
 *  missing half, and it is keyed by EMAIL because that is what the login flow
 *  presents. `businessId` travels with the user record, so Section 10's
 *  "resolve the business from the account" is a property of the data rather
 *  than of a request.
 */

import path from "node:path";
import { randomBytes } from "node:crypto";
import { createJsonCollection } from "../lib/jsonCollection";
import { allBusinesses, persist, saveSubscription } from "../platform/store";
import { emptyLedger } from "../../src/platform/billing";
import type { Business, PackageId, Subscription } from "../../src/platform/types";
import { hashPassword, isValidUsername, normalizeUsername } from "./crypto";
import type { LoginToken, PasswordResetToken, Session, User, UserRole } from "./types";

const dataDir = process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data");

const users = createJsonCollection<User>(
  path.join(dataDir, "auth-users.json"),
  "auth-users",
  20_000,
);
const loginTokens = createJsonCollection<LoginToken>(
  path.join(dataDir, "auth-login-tokens.json"),
  "auth-login-tokens",
  50_000,
);
const sessions = createJsonCollection<Session>(
  path.join(dataDir, "auth-sessions.json"),
  "auth-sessions",
  20_000,
);
// Password reset links. A FOURTH collection, created only when the first reset
// is requested - which is the same additive property the other three have.
const passwordResets = createJsonCollection<PasswordResetToken>(
  path.join(dataDir, "auth-password-resets.json"),
  "auth-password-resets",
  5_000,
);

export const allUsers = users.all;
export const allLoginTokens = loginTokens.all;
export const allSessions = sessions.all;
export const allPasswordResets = passwordResets.all;

export const persistUsers = users.touch;
export const persistLoginTokens = loginTokens.touch;
export const persistSessions = sessions.touch;
export const persistPasswordResets = passwordResets.touch;

export function flushAuthStores(): void {
  users.flush();
  loginTokens.flush();
  sessions.flush();
  passwordResets.flush();
}

// ---------------------------------------------------------------------------
// Email normalisation (Sections 7, 9 - both endpoints)
// ---------------------------------------------------------------------------

/**
 * Lower-case, trimmed. The only normalisation is the one the spec asks for:
 * inventing a rule that strips dots from Gmail-style addresses would reject
 * real users in some countries.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Accepts a plain address, and rejects the shapes that are not addresses. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function userByEmail(email: string): User | null {
  const wanted = normalizeEmail(email);
  return allUsers().find((user) => user.email === wanted) ?? null;
}

export function userById(id: string): User | null {
  return allUsers().find((user) => user.id === id) ?? null;
}

/**
 * Sign-in lookup by username.
 *
 * Separate from `userByEmail` because a username is NOT an email - it has no
 * '@' - so the two namespaces are searched independently. The sign-in route
 * tries the username form first, then the email form.
 */
export function userByUsername(username: string): User | null {
  const wanted = normalizeUsername(username);
  if (!wanted) return null;
  return allUsers().find((user) => user.username && user.username === wanted) ?? null;
}

export function usernameTaken(username: string): boolean {
  return userByUsername(username) !== null;
}

/**
 * Find the account a federated identity belongs to.
 *
 * `googleSub` is the stable Google user id and is the ONLY thing trusted to
 * link an account. Email is deliberately NOT used as the key: Google
 * guarantees `email_verified`, but a federated email that later changes must
 * not orphan the account, and matching on email would let anyone who registers
 * an address at Google claim an existing local account.
 */
export function userByGoogleSub(sub: string): User | null {
  if (!sub) return null;
  return allUsers().find((user) => user.googleSub && user.googleSub === sub) ?? null;
}

// ---------------------------------------------------------------------------
// Additive seeding from the existing businesses
// ---------------------------------------------------------------------------

let seeded = false;

/**
 * Give every seeded business an owner, keyed by that business's own published
 * contact email.
 *
 * Additive by construction: a business whose owner email is already present is
 * skipped, so re-running never duplicates a user and never overwrites one.
 * The business records themselves are only READ here.
 */
export function seedUsersFromBusinesses(): void {
  if (seeded) return;
  seeded = true;

  const list = allUsers();
  let added = 0;

  for (const business of allBusinesses()) {
    const email = business.customization.contact.email;
    if (!email || !isValidEmail(email)) continue;
    const normalized = normalizeEmail(email);
    if (list.some((user) => user.email === normalized)) continue;

    const name =
      business.name
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ") || business.name;

    list.push({
      id: `usr-${business.id}`,
      email: normalized,
      name,
      // The tenant travels with the user. This is the whole of Section 10.
      businessId: business.id,
      role: "owner",
      active: true,
      createdAt: new Date().toISOString(),
    });
    added += 1;
  }

  // A platform administrator, with no business of their own. Section 23:
  // admin authority comes from a role, never from owning a tenant.
  const adminEmail = normalizeEmail(
    process.env.SUPER_ADMIN_EMAIL ?? "superadmin@yenebusinessgroup.example",
  );
  if (!list.some((user) => user.email === adminEmail)) {
    list.push({
      id: "usr-super-admin",
      email: adminEmail,
      name: "Yene Business Group Administrator",
      businessId: null,
      role: "super-admin",
      active: true,
      createdAt: new Date().toISOString(),
    });
    added += 1;
  }

  if (added > 0) persistUsers();
}

/** Test seam: allow a suite to re-seed after clearing its own fixtures. */
export function resetAuthSeedFlag(): void {
  seeded = false;
}

// ---------------------------------------------------------------------------
// Bootstrap accounts
// ---------------------------------------------------------------------------

/**
 * ============================================================================
 *  BOOTSTRAP ACCOUNTS (super admin + demo store owner)
 * ============================================================================
 *
 *  Two named accounts so a fresh clone can be signed into immediately, without
 *  first going through sign-up and email verification:
 *
 *    role         email                          password     env override
 *    -----------  -----------------------------  -----------  ---------------
 *    super-admin  super_admin@yene-store.com     admin@123    SUPER_ADMIN_EMAIL
 *                                                            /_PASSWORD
 *    owner        lumiere_perfume@yene-store.com  lumiere123   DEMO_OWNER_EMAIL
 *                                                            /_PASSWORD
 *
 *  THREE SAFETY PROPERTIES
 *  -----------------------
 *  1. ADDITIVE AND IDEMPOTENT. Created only when the email is absent. Re-running
 *     never duplicates a user and NEVER overwrites a changed password.
 *
 *  2. THE PASSWORD IS STORED AS A scrypt HASH, like any other credential. There
 *     is deliberately no "temporary password" branch that writes a readable
 *     secret to disk.
 *
 *  3. IT REFUSES TO RUN IN PRODUCTION unless BOOTSTRAP_ACCOUNTS_ENABLED is
 *     explicitly "true". These are DEVELOPMENT credentials - `admin@123` is
 *     nine characters and trivially guessable - so a public deployment must not
 *     gain a super admin from a README by default.
 */

export interface SeededAccount {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  businessName?: string;
  packageId?: PackageId;
}

/** The shipped accounts, from the environment with development defaults. */
export function defaultBootstrapAccounts(): SeededAccount[] {
  const accounts: SeededAccount[] = [];

  const adminEmail = normalizeEmail(
    process.env.SUPER_ADMIN_EMAIL ?? "super_admin@yene-store.com",
  );
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD ?? "admin@123";
  if (isValidEmail(adminEmail) && adminPassword) {
    accounts.push({
      email: adminEmail,
      password: adminPassword,
      name: "Yene Business Group Super Administrator",
      role: "super-admin",
    });
  }

  const ownerEmail = normalizeEmail(
    process.env.DEMO_OWNER_EMAIL ?? "lumiere_perfume@yene-store.com",
  );
  const ownerPassword = process.env.DEMO_OWNER_PASSWORD ?? "lumiere123";
  if (isValidEmail(ownerEmail) && ownerPassword) {
    accounts.push({
      email: ownerEmail,
      password: ownerPassword,
      name: process.env.DEMO_OWNER_NAME ?? "Lumiere Perfume",
      role: "owner",
      businessName: process.env.DEMO_OWNER_BUSINESS ?? "Lumiere Perfume",
      packageId: (process.env.DEMO_OWNER_PACKAGE as PackageId) || "platinum",
    });
  }

  return accounts;
}

/** Development and test may seed freely; production must opt in explicitly. */
function assertSafeToSeed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.BOOTSTRAP_ACCOUNTS_ENABLED === "true") return true;
  console.warn(
    'BOOTSTRAP_ACCOUNTS_ENABLED is not "true", so the shipped super-admin and ' +
      "demo owner accounts were NOT created. This is the safe default in production.",
  );
  return false;
}

/**
 * Create the business behind a store-owner account, mirroring the sign-up
 * route: a Trial business plus a matching Trial subscription.
 */
function createBusiness(name: string, email: string, packageId: PackageId): Business {
  const id = `biz-${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  const business: Business = {
    id,
    name,
    type: "standalone",
    mall: null,
    subdomain: subdomainFor(name),
    status: "Trial",
    packageId,
    trustedSeller: false,
    location: "Addis Ababa",
    rating: 0,
    createdAt: now,
    customization: {
      logoUrl: null,
      coverImageUrl: null,
      businessName: name,
      description: "",
      businessInformation: "",
      theme: "yene",
      featuredProductIds: [],
      bannerProductIds: [],
      socialLinks: [],
      contact: { phone: "", email, address: "Addis Ababa" },
      policies: { returns: "", shipping: "", terms: "", privacy: "" },
      delivery: { options: [], freeAbove: null },
      paymentOptions: ["Cash on delivery"],
    },
  };

  const subscription: Subscription = {
    businessId: id,
    packageId,
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

  return business;
}

let bootstrapped = false;

/**
 * Create the shipped accounts. Safe to call on every boot.
 *
 * Returns only the accounts actually created, so the caller can print a summary
 * without this module ever logging a credential.
 */
export function seedBootstrapAccounts(accounts: SeededAccount[] = defaultBootstrapAccounts()): SeededAccount[] {
  if (bootstrapped) return [];
  bootstrapped = true;
  if (!assertSafeToSeed()) return [];

  const list = allUsers();
  const created: SeededAccount[] = [];

  for (const account of accounts) {
    const email = normalizeEmail(account.email);
    if (!isValidEmail(email)) {
      console.warn(`[bootstrap] skipping invalid email: ${account.email}`);
      continue;
    }
    // Idempotent: an existing account is left exactly as it is, including any
    // password its owner has since changed.
    if (list.some((user) => user.email === email)) continue;

    const now = new Date().toISOString();
    let businessId: string | null = null;

    if (account.role !== "super-admin") {
      const wantedName = account.businessName ?? account.name;
      // Reuse a business that already carries this name, so re-seeding after a
      // manual edit does not leave a duplicate storefront behind.
      const existingBusiness = allBusinesses().find(
        (business) => business.name.toLowerCase() === wantedName.toLowerCase(),
      );
      const business =
        existingBusiness ?? createBusiness(wantedName, email, account.packageId ?? "platinum");
      businessId = business.id;
    }

    const user: User = {
      id: `usr-${randomBytes(5).toString("hex")}`,
      email,
      name: account.name,
      businessId,
      role: account.role,
      active: true,
      createdAt: now,
      // Hashed like any other credential; the plaintext is never stored.
      passwordHash: hashPassword(account.password),
      identityProvider: "password",
      // A super admin does not trade. A seeded store owner is treated exactly
      // like one created through sign-up, so it must clear the same identity
      // gate before it can operate.
      storeRentalApproved: account.role === "super-admin",
    };

    list.push(user);
    created.push(account);
  }

  if (created.length > 0) persistUsers();
  return created;
}

/** Test seam: allow a suite to re-seed. */
export function resetBootstrapFlag(): void {
  bootstrapped = false;
}

/** A unique subdomain, matching the shape the sign-up route produces. */
function subdomainFor(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) || "store";
  const taken = new Set(allBusinesses().map((business) => business.subdomain));
  if (!taken.has(`${base}.yene-store.com`)) return `${base}.yene-store.com`;
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const candidate = `${base}${attempt}.yene-store.com`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}${randomBytes(3).toString("hex")}.yene-store.com`;
}

/** A credential-free summary for the startup log. */
export function describeSeeded(accounts: SeededAccount[]): string {
  return accounts.map((account) => `${account.role}:${account.email}`).join(", ");
}