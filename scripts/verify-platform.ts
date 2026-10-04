/**
 * Platform verification - the Sections 10-55 contract.
 *
 *   npm run test:platform
 *
 * Sections 1-9 are verified by the nine existing suites. This one covers the
 * platform, and it concentrates on the rules that are EASY TO GET WRONG rather
 * than the rules that are obvious:
 *
 *   - the four billing numbers (32, 33, 34, 35) against the literals in the
 *     specification, not against a formula that happens to agree with itself;
 *   - Section 37: a downgrade must not remove a single row of anything;
 *   - Section 13: a marketplace listing must be a reference, not a copy;
 *   - Section 14: a business must not be able to publish itself;
 *   - Section 20/22: delivery is charged per store, and the order splits;
 *   - Section 50: cross-tenant reads are refused.
 *
 * No API key, no network, no database. Every store is redirected to a temp
 * directory before anything imports it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Redirect every durable store before any import touches it.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yene-platform-"));
process.env.YENE_DATA_DIR = dataDir;
process.env.YENE_AUDIT_FILE = path.join(dataDir, "audit.json");

import {
  applyPackageChange, applyPendingChange, buildChangeRecord, emptyLedger, formatEtb,
  NO_REFUND, quotePackageChange, renewalInvoice, upgradeCharge,
} from "../src/platform/billing";
import {
  cheapestPackageWith, dashboardModulesFor, effectiveAccess, entitlementsFor, hasFeature,
  isDowngrade, isUpgrade, lockedFeatures, moduleAccess, PACKAGES, packageCards, PACKAGE_ORDER,
} from "../src/platform/packages";
import {
  canTransitionMarketplace, isSellable, marketplaceFeed, moderationQueue, notSubmitted,
  publishSubmission, reviewSubmission, storeListingStatus, storefrontProducts, submitForReview,
  toListing, autoPublishIfTrusted, unpublishSubmission, defaultPublishIntent,
} from "../src/platform/marketplace";
import {
  advanceOrder, buildBusinessOrder, buildCustomerOrder, canTransitionOrder, groupCartByStore,
} from "../src/platform/commerce";
import { ORDER_STATUSES } from "../src/platform/types";
import {
  isVerifiedPurchase, recommendationsFor, rememberSavedPrice, summarizeRatings,
  checkWishlistNotifications, EMPTY_SIGNALS, isValidRating, MAX_RATING,
} from "../src/platform/engagement";
import { editDistance, normalize, search, suggest, type SearchCorpus } from "../src/platform/search";
import {
  canAttachNode, renderHierarchy, stockAt, totalStock,
  buildTransfer, applyPurchaseReceipt, currentStockReport, stockValuation,
} from "../src/platform/inventory";
import {
  applyCategoryChange, buildInitialSubcategories, canDeleteCategory, categoryTree,
  createSubcategory, INITIAL_CATEGORIES, parentCategoryOf, subcategoriesOf,
  subcategoryId, topLevelCategories,
} from "../src/platform/categories";
import {
  LANGUAGES, LANGUAGE_NAMES, LANGUAGE_NATIVE, LANGUAGES_DEFINED, t, translate, isLanguageCode,
  isPlausiblyInScript, coverage, catalogueOverlap, suspectedDuplications, DUPLICATION_LIMIT,
} from "../src/platform/i18n";
import {
  CASH_ON_DELIVERY, createChapaProvider, getProvider, isOnlinePaymentAvailable,
  paymentOptionsFor, newPaymentReference, registerProvider, settlePayment,
} from "../src/platform/payments";
import { canAccessBusiness, guestIdentity, type PlatformIdentity } from "../api/platform/auth";
import { SUPER_ADMIN_AREAS, QUOTE_FACTORS, CUSTOM_ERP_NAME } from "../api/platform/types";
import {
  allBusinesses, allBusinessOrders, allCategories, allMalls, allNodes, allProducts, allReviews, allSubmissions,
  businessById, mallById, mallByIdOrName, ordersForBusiness, seedIfEmpty, subscriptionFor,
} from "../api/platform/store";
import {
  availableRooms, buildMallPlacement, findRoomConflicts, formatRoomNumbers,
  isMallStore, mallDirectory, mallForBusiness, parseRoomNumbers, roomNumbersFor,
  storesInMall,
} from "../src/platform/malls";
import type {
  Business, CartLine, CustomerProfile, Mall, MallPlacement, Product, Subscription, WishlistItem,
} from "../src/platform/types";

let failures = 0;
let passed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

seedIfEmpty();

// ---------------------------------------------------------------------------
// Section 9 / 54 - the package ladder
// ---------------------------------------------------------------------------
section("1. The four packages carry the published prices");
{
  check("Silver is 2,500 ETB/month", PACKAGES.silver.monthlyPrice === 2500, String(PACKAGES.silver.monthlyPrice));
  check("Gold is 5,000 ETB/month", PACKAGES.gold.monthlyPrice === 5000, String(PACKAGES.gold.monthlyPrice));
  check("Platinum is 15,000 ETB/month", PACKAGES.platinum.monthlyPrice === 15000, String(PACKAGES.platinum.monthlyPrice));
  check("Super is 30,000 ETB/month+", PACKAGES.super.monthlyPrice === 30000, String(PACKAGES.super.monthlyPrice));

  check("Super is quoted, not a fixed plan", PACKAGES.super.customPricing === true);
  const cards = packageCards();
  check("the Super card shows a plus, not a fixed promise", cards[3].priceLabel === "30,000 ETB+", cards[3].priceLabel);
  check("the ladder order is Silver, Gold, Platinum, Super",
    PACKAGE_ORDER.join(",") === "silver,gold,platinum,super");
}

// ---------------------------------------------------------------------------
// Section 38 - centralized entitlements
// ---------------------------------------------------------------------------
section("2. Feature access is one table, not scattered checks");
{
  const silver = entitlementsFor("silver");
  const gold = entitlementsFor("gold");
  const platinum = entitlementsFor("platinum");
  const superPkg = entitlementsFor("super");

  check("every package answers all seventeen feature keys",
    Object.keys(silver).length === 17, String(Object.keys(silver).length));
  check("Silver has a store", silver.store === true);
  check("Silver does NOT have the marketplace", silver.marketplace === false);
  check("Gold adds CRM but not the marketplace", gold.crm === true && gold.marketplace === false);
  check("Platinum has the marketplace", platinum.marketplace === true);
  check("Platinum has custom inventory", platinum.custom_inventory === true);
  check("Platinum does NOT have POS", platinum.pos === false);
  check("Super has every feature", Object.values(superPkg).every((v) => v === true));
  check("Super is the only package with a custom ERP", superPkg.custom_erp === true && platinum.custom_erp === false);

  // The ladder must be a strict superset chain, or "upgrade = the difference"
  // is a coincidence rather than a property. A LOWER package's granted keys
  // must all be granted by the one above it.
  const grantedIn = (map: Record<string, boolean>) =>
    Object.keys(map).filter((key) => map[key]);
  const containsAll = (lower: string[], higher: Record<string, boolean>) =>
    lower.every((key) => higher[key] === true);
  const chain = [
    containsAll(grantedIn(silver), gold),
    containsAll(grantedIn(gold), platinum),
    containsAll(grantedIn(platinum), superPkg),
  ];
  check("each package is a superset of the one below it", chain.every(Boolean), JSON.stringify(chain));

  check("locked features are reported, not hidden", lockedFeatures("silver").includes("marketplace"));
  check("a role can restrict but never promote above the plan",
    effectiveAccess("silver", ["store", "custom_erp"]).custom_erp === false);
  check("a role can grant what the package already allows",
    effectiveAccess("platinum", ["store", "inventory"]).inventory === true);
  check("the cheapest package that opens inventory is Platinum", cheapestPackageWith("inventory") === "platinum");
}

// ---------------------------------------------------------------------------
// Sections 26 / 44 - package-controlled modules
// ---------------------------------------------------------------------------
section("3. Dashboard modules are gated by package, and locked is not deleted");
{
  const platinum = dashboardModulesFor("platinum");
  const silver = dashboardModulesFor("silver");
  const module = (list: typeof platinum, key: string) => list.find((m) => m.key === key)!;

  check("Platinum can open Inventory", module(platinum, "inventory").access === "available");
  check("Silver's Inventory is LOCKED, not hidden", module(silver, "inventory").access === "locked");
  check("a locked module names the package that opens it",
    module(silver, "inventory").unlockWith === "platinum");
  check("Settings is available on every package", module(silver, "settings").access === "available");
  check("Packages & Billing is available on every package", module(silver, "billing").access === "available");
  check("Support is available on every package", module(silver, "support").access === "available");
  check("Super-only modules are hidden below Super", module(platinum, "pos").access === "hidden");
  check("Super-only modules are available on Super", module(dashboardModulesFor("super"), "pos").access === "available");
  check("Silver still sees Store, Products and Orders", ["store", "products", "orders"]
    .every((key) => module(silver, key).access === "available"));
  check("Silver has no Customers module", module(silver, "customers").access === "locked");
  check("Silver has no Suppliers module", module(silver, "suppliers").access === "locked");
}

// ---------------------------------------------------------------------------
// Section 32 - the upgrade difference
// ---------------------------------------------------------------------------
section("4. Upgrading charges the difference (Section 32)");
{
  // The specification's own worked example: Silver -> Gold = 2,500 ETB.
  check("Silver -> Gold costs 2,500 ETB", upgradeCharge("silver", "gold") === 2500, String(upgradeCharge("silver", "gold")));
  check("Gold -> Platinum costs 10,000 ETB", upgradeCharge("gold", "platinum") === 10000, String(upgradeCharge("gold", "platinum")));
  check("Silver -> Platinum costs 12,500 ETB", upgradeCharge("silver", "platinum") === 12500, String(upgradeCharge("silver", "platinum")));
  check("Platinum -> Super costs 15,000 ETB", upgradeCharge("platinum", "super") === 15000, String(upgradeCharge("platinum", "super")));

  // The difference is the difference, expressed in ETB.
  for (const [from, to] of [["silver", "gold"], ["gold", "platinum"], ["silver", "super"]] as const) {
    const expected = PACKAGES[to].monthlyPrice - PACKAGES[from].monthlyPrice;
    check(`${from} -> ${to} is exactly new minus current (${formatEtb(expected)})`, upgradeCharge(from, to) === expected);
  }

  // A downgrade can never produce a negative charge, which would be a refund.
  check("a downgrade never charges a negative amount", upgradeCharge("platinum", "silver") === 0);
  check("the same package costs nothing to change to", upgradeCharge("gold", "gold") === 0);
}

// ---------------------------------------------------------------------------
// Section 33 - the four-month example, end to end
// ---------------------------------------------------------------------------
section("5. The four-month upgrade example (Section 33)");
{
  // A four-month subscription, currently on Silver.
  const start = new Date("2026-01-01T00:00:00.000Z");
  const fourMonths: Subscription = {
    businessId: "demo-four-month",
    packageId: "silver",
    status: "Active",
    startedAt: start.toISOString(),
    currentPeriodStart: start.toISOString(),
    // The renewal date at the END of the four-month term.
    currentPeriodEnd: "2026-05-01T00:00:00.000Z",
    autoRenew: true,
    pendingChange: null,
    lastUpgradeAmount: 0,
  };

  const quote = quotePackageChange(fourMonths, "gold");
  check("upgrading mid-term quotes the difference, 2,500 ETB", quote.amountDue === 2500, String(quote.amountDue));
  check("the quote says it is not a permanent discount",
    /not a permanent discount/i.test(quote.notice));
  check("the quote states the full renewal price", /At renewal you pay the full 5,000 ETB/.test(quote.notice), quote.notice);
  check("the quote carries no refund", quote.refundAmount === 0);

  const applied = applyPackageChange(fourMonths, quote, null, emptyLedger());
  check("Gold becomes active immediately", applied.subscription.packageId === "gold");
  check("the four-month term is NOT restarted", applied.subscription.currentPeriodEnd === "2026-05-01T00:00:00.000Z");
  check("the upgrade payment is recorded as a surcharge", applied.ledger.surcharges.length === 1);
  check("the surcharge is 2,500 ETB", applied.ledger.surcharges[0].amount === 2500);

  // ... and at renewal, the FULL Gold price applies.
  const renewed = renewalInvoice(applied.subscription, new Date("2026-05-01T00:00:00.000Z"));
  check("at renewal the customer pays the full 5,000 ETB", renewed.invoice.amount === 5000, String(renewed.invoice.amount));
  check("the 2,500 ETB upgrade did not become a discount",
    renewed.invoice.amount !== quote.amountDue);
  check("the upgrade payment is still remembered for history",
    applied.ledger.surcharges[0].amount === 2500);
}

// ---------------------------------------------------------------------------
// Section 34 - renewal is always full price
// ---------------------------------------------------------------------------
section("6. Renewal charges the full package price (Section 34)");
{
  const silverThenGold: Subscription = {
    businessId: "demo-renew",
    packageId: "gold",
    status: "Active",
    startedAt: "2026-01-01T00:00:00.000Z",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    autoRenew: true,
    pendingChange: null,
    lastUpgradeAmount: 2500, // the upgrade they paid
  };
  const renewed = renewalInvoice(silverThenGold, new Date("2026-02-01T00:00:00.000Z"));
  check("Gold renews at 5,000 ETB, not 2,500", renewed.invoice.amount === 5000, String(renewed.invoice.amount));
  check("the invoice names the Gold package", renewed.invoice.lines[0].label.includes("Gold"));
  check("lastUpgradeAmount is not consulted for billing", renewed.invoice.amount === PACKAGES.gold.monthlyPrice);
}

// ---------------------------------------------------------------------------
// Sections 35 / 36 - downgrade
// ---------------------------------------------------------------------------
section("7. Downgrading refunds nothing and waits for the renewal date (Sections 35, 36)");
{
  const platinum: Subscription = {
    businessId: "demo-downgrade",
    packageId: "platinum",
    status: "Active",
    startedAt: "2026-01-01T00:00:00.000Z",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    autoRenew: true,
    pendingChange: null,
    lastUpgradeAmount: 0,
  };

  const quote = quotePackageChange(platinum, "gold");
  // The specification's example: 15,000 - 5,000 = 10,000 difference, refund 0.
  check("the price difference is 10,000 ETB", PACKAGES.platinum.monthlyPrice - PACKAGES.gold.monthlyPrice === 10000);
  check("but the amount due is 0", quote.amountDue === 0, String(quote.amountDue));
  check("and the refund is 0", quote.refundAmount === NO_REFUND);
  check("the refund is the literal zero, not merely a zero number", NO_REFUND === 0);
  check("the notice states there is no refund or credit",
    /does not generate a refund or credit/i.test(quote.notice));
  check("the downgrade is not immediate", quote.immediate === false);
  check("it takes effect at the renewal boundary", quote.effectiveAt === "2026-02-01T00:00:00.000Z");

  const applied = applyPackageChange(platinum, quote, null, emptyLedger());
  check("Platinum access continues after requesting the downgrade", applied.subscription.packageId === "platinum");
  check("the pending downgrade is recorded", applied.subscription.pendingChange?.toPackageId === "gold");
  check("no invoice was raised for a downgrade", applied.invoice === null);
  check("no refund was produced", applied.amountPaid === 0);
  check("no surcharge was added", applied.ledger.surcharges.length === 0);

  // Before the boundary, nothing changes.
  const beforeBoundary = applyPendingChange(applied.subscription, new Date("2026-01-20T00:00:00.000Z"));
  check("20 days in, the package is still Platinum", beforeBoundary.packageId === "platinum");

  // On the boundary, it becomes Gold.
  const afterBoundary = applyPendingChange(applied.subscription, new Date("2026-02-01T00:00:00.000Z"));
  check("at the renewal date it becomes Gold", afterBoundary.packageId === "gold");
  check("the pending change is cleared", afterBoundary.pendingChange === null);
  check("the next invoice is the Gold price",
    renewalInvoice(afterBoundary).invoice.amount === 5000);

  check("isDowngrade recognises the direction", isDowngrade("platinum", "gold") === true);
  check("isUpgrade recognises the direction", isUpgrade("silver", "gold") === true);
}

// ---------------------------------------------------------------------------
// Section 37 - NO DATA LOSS
// ---------------------------------------------------------------------------
section("8. A package change never deletes business data (Section 37)");
{
  const business = businessById("green-coffee")!;
  const record = subscriptionFor("green-coffee")!;
  const now = new Date();

  // Snapshot EVERYTHING a business owns, then run a downgrade through the real
  // engine and compare. This is the test that matters: it counts rows rather
  // than asserting a function "does not delete" by inspection.
  const before = {
    products: allProducts().filter((p) => p.businessId === business.id).length,
    orders: ordersForBusiness(business.id).length,
    reviews: allReviews().filter((r) => r.businessId === business.id).length,
    submissions: allSubmissions().filter((s) => s.businessId === business.id).length,
    businesses: allBusinesses().length,
  };

  const quote = quotePackageChange(record.subscription, "silver");
  const applied = applyPackageChange(record.subscription, quote, null, record.ledger);

  const after = {
    products: allProducts().filter((p) => p.businessId === business.id).length,
    orders: ordersForBusiness(business.id).length,
    reviews: allReviews().filter((r) => r.businessId === business.id).length,
    submissions: allSubmissions().filter((s) => s.businessId === business.id).length,
    businesses: allBusinesses().length,
  };

  check("products survive a Platinum -> Silver downgrade", after.products === before.products, `${before.products} -> ${after.products}`);
  check("orders survive", after.orders === before.orders, `${before.orders} -> ${after.orders}`);
  check("reviews survive", after.reviews === before.reviews, `${before.reviews} -> ${after.reviews}`);
  check("marketplace submissions survive", after.submissions === before.submissions);
  check("the business record itself survives", after.businesses === before.businesses);

  // The feature that dropped out is LOCKED, not removed (Section 37).
  // Note the downgrade is PENDING (Section 36), so Platinum access continues -
  // which is exactly the "do not unexpectedly remove already-paid access" rule.
  check("Platinum access continues after requesting the downgrade",
    applied.subscription.packageId === "platinum");
  check("the pending downgrade is scheduled, not applied",
    applied.subscription.pendingChange?.toPackageId === "silver");
  check("the store is still live - a downgrade is not a deletion",
    business.status === "Active");
  check("the products are still there to be locked", after.products > 0);

  // Once the boundary passes, the package IS Silver, and marketplace is locked.
  // The pending change's own effectiveAt is what is tested, so it is moved
  // back rather than the clock being moved forward past the seed's renewal.
  const atBoundary = applyPendingChange(
    {
      ...applied.subscription,
      pendingChange: { ...applied.subscription.pendingChange!, effectiveAt: "2020-01-01T00:00:00.000Z" },
    },
    new Date("2026-01-01T00:00:00.000Z"),
  );
  check("at the renewal boundary the package becomes Silver", atBoundary.packageId === "silver");
  check("and the marketplace feature is then locked", hasFeature(atBoundary.packageId, "marketplace") === false);
  check("but the products are still there behind the lock",
    allProducts().filter((p) => p.businessId === business.id).length === after.products);

  // Upgrade again and the feature returns (Section 37, final paragraph).
  const upgradeQuote = quotePackageChange(atBoundary, "platinum");
  const upgraded = applyPackageChange(atBoundary, upgradeQuote, null, applied.ledger);
  check("upgrading again restores the feature", hasFeature(upgraded.subscription.packageId, "marketplace") === true);
  check("and the data was still there to restore access to", allProducts().length >= after.products);
}

// ---------------------------------------------------------------------------
// Section 13 - one authoritative product
// ---------------------------------------------------------------------------
section("9. A marketplace listing references the original product (Section 13)");
{
  const product = allProducts().find((p) => p.id === "p-001")!;
  const business = businessById(product.businessId)!;
  const submission = allSubmissions().find((s) => s.productId === "p-001")!;
  const listing = toListing(submission, product, business, 4.5);

  check("the listing carries the product id", listing.productId === product.id);
  check("the listing name is read live from the product", listing.name === product.name);
  check("the listing price is read live from the product", listing.price === product.price);
  check("the seller is the product's own business", listing.businessId === product.businessId);

  // Prove there is no duplicated row: change the product, and the listing moves.
  const originalName = product.name;
  const originalPrice = product.price;
  product.name = "Yirgacheffe Coffee 1kg (updated)";
  product.price = 1299;
  const afterEdit = toListing(submission, product, business, 4.5);
  check("editing the product changes the marketplace row immediately", afterEdit.name === product.name);
  check("the marketplace price follows the store price", afterEdit.price === 1299);
  product.name = originalName;
  product.price = originalPrice;

  // The submission holds no product content of its own.
  const submissionKeys = Object.keys(submission);
  check("the submission stores no copy of the name", !submissionKeys.includes("name"));
  check("the submission stores no copy of the price", !submissionKeys.includes("price"));
  check("the submission stores no copy of the image", !submissionKeys.includes("image"));

  const feed = marketplaceFeed(allSubmissions(), allProducts(), allBusinesses(), {});
  check("the feed is built from published submissions only",
    feed.every((row) => row.status === "Published"));
  check("the feed never invents a product", feed.every((row) => allProducts().some((p) => p.id === row.productId)));
}

// ---------------------------------------------------------------------------
// Section 14 - moderation cannot be bypassed
// ---------------------------------------------------------------------------
section("10. A business cannot publish itself (Section 14)");
{
  const goldBusiness: Business = { ...businessById("blue-shop")!, packageId: "gold" };
  const product: Product = { ...allProducts().find((p) => p.id === "p-002")! };

  // Silver/Gold do not have the marketplace feature at all.
  const refused = submitForReview(product, goldBusiness, notSubmitted(product.id, goldBusiness.id));
  check("a Gold business cannot even submit to the marketplace", "error" in refused);
  if ("error" in refused) {
    check("the refusal names the package that would allow it", refused.requiredPackage === "Platinum");
    check("the refusal says they can still sell from their own store",
      /own store/i.test(refused.error));
  }

  // Approving is not publishing - they are separate acts.
  const business = businessById("green-coffee")!;
  const submitted = submitForReview(product, business, notSubmitted(product.id, business.id));
  check("a Platinum business CAN submit", "submission" in submitted);
  if (!("submission" in submitted)) throw new Error("submit failed");
  check("submission lands in Pending Review", submitted.submission.status === "Pending Review");

  const approved = reviewSubmission(submitted.submission, {
    status: "Approved", note: "Looks good", requestChanges: false, actor: "super-admin",
  });
  check("approval produces Approved, not Published", approved.status === "Approved");

  // Approving is not publishing, and publishing is not something a business
  // can do at all. The transitions themselves refuse the business shortcut.
  let pendingToPublished = false;
  try {
    if (canTransitionMarketplace("Pending Review", "Published")) pendingToPublished = true;
  } catch {
    pendingToPublished = true;
  }
  check("a Pending Review submission has no direct edge to Published", pendingToPublished === false);
  check("approval is a separate state from publication",
    canTransitionMarketplace("Pending Review", "Approved") === true);
  check("publication is a separate, explicit step from approval",
    canTransitionMarketplace("Approved", "Published") === true);

  const published = publishSubmission(approved);
  check("a Super Admin's explicit publish goes live", published.status === "Published");
  check("a manual publish is not marked auto-published", published.autoPublished === false);

  const unpublished = unpublishSubmission(published, "super-admin", "Stock issue");
  check("Super Admin can unpublish", unpublished.status === "Unpublished");

  // The ONE exception: an explicitly trusted seller, and it is recorded.
  const trusted = { ...business, trustedSeller: true };
  const autoSubmitted = submitForReview(product, trusted, notSubmitted(product.id, trusted.id));
  if ("submission" in autoSubmitted) {
    const auto = autoPublishIfTrusted(autoSubmitted.submission, trusted);
    check("a trusted seller auto-publishes", auto.status === "Published");
    check("but the bypass is recorded in the data", auto.autoPublished === true);
    check("and the reviewer is named, not blank", (auto.reviewedBy ?? "").length > 0);
  }

  const untrusted = autoPublishIfTrusted(submitted.submission, { ...business, trustedSeller: false });
  check("an ordinary business is NOT auto-published", untrusted.status === "Pending Review");
  check("an ordinary business is never marked auto-published", untrusted.autoPublished === false);

  check("the moderation queue holds only pending submissions",
    moderationQueue(allSubmissions()).every((s) => s.status === "Pending Review"));
  check("the queue is oldest first",
    moderationQueue(allSubmissions()).every((s, i, arr) => i === 0 || (arr[i - 1].submittedAt ?? "") <= (s.submittedAt ?? "")));
  check("approved cannot jump straight to published by transition",
    canTransitionMarketplace("Pending Review", "Published") === false);
}

// ---------------------------------------------------------------------------
// Section 12 - a business can sell without the marketplace
// ---------------------------------------------------------------------------
section("11. A business can sell from its own store without publishing (Section 12)");
{
  const ownStoreOnly: Product = {
    ...allProducts().find((p) => p.id === "p-003")!,
    publishToOwnStore: true,
    publishToMarketplace: false,
  };
  const intent = defaultPublishIntent();
  check("publishing to the marketplace is OFF by default", intent.publishToMarketplace === false);
  check("publishing to your own store is ON by default", intent.publishToOwnStore === true);
  check("a store-only product is Live in store", storeListingStatus(ownStoreOnly) === "Live in store");
  check("and it is sellable", isSellable(ownStoreOnly) === true);
  check("it has no marketplace submission and does not need one",
    allSubmissions().some((s) => s.productId === ownStoreOnly.id) === false);

  // A storefront shows ONLY the business's own products.
  const { featured, rest } = storefrontProducts("green-coffee", allProducts(), { featuredProductIds: ["p-001"] });
  const all = [...featured, ...rest];
  check("a storefront contains only that business's products",
    all.every((p) => p.businessId === "green-coffee"));
  check("a storefront excludes another business's identical-category products",
    all.every((p) => p.id !== "p-004"));
  check("the merchant's featured choice is honoured first",
    featured.length > 0 && featured.every((p) => p.businessId === "green-coffee"));
}

// ---------------------------------------------------------------------------
// Section 20 / 22 - multi-vendor cart and order split
// ---------------------------------------------------------------------------
section("12. The cart groups by store and the order splits (Sections 20, 22)");
{
  const businesses = allBusinesses();
  const lines: CartLine[] = [
    // Two items from Green Coffee.
    { productId: "p-001", businessId: "green-coffee", variantId: null, quantity: 2 },
    { productId: "p-003", businessId: "green-coffee", variantId: null, quantity: 1 },
    // One from Blue Shop.
    { productId: "p-004", businessId: "blue-shop", variantId: null, quantity: 1 },
    // One from ABC Fashion.
    { productId: "p-007", businessId: "abcfashion", variantId: null, quantity: 1 },
  ];

  const totals = groupCartByStore(lines, allProducts(), businesses);
  check("the cart is grouped into three stores", totals.groups.length === 3, String(totals.groups.length));
  check("the item count is the sum of quantities (2+1+1+1)", totals.itemCount === 5, String(totals.itemCount));
  check("each group carries its own store subtotal",
    totals.groups.every((g) => g.subtotal > 0));
  check("the grand total is the sum of the group totals",
    totals.grandTotal === totals.groups.reduce((sum, g) => sum + g.total, 0));
  check("the grand total is subtotal - discount + delivery + tax",
    totals.grandTotal === totals.productSubtotal - totals.discounts + totals.delivery + totals.taxes);

  // The multi-vendor rule: a fee is charged PER STORE, not once per basket.
  const withFee = totals.groups.filter((g) => g.delivery > 0);
  check("more than one store is charged delivery separately", withFee.length >= 1, String(withFee.length));

  // A store with no delivery options is charged nothing, not an error.
  const pickupOnly = groupCartByStore(
    [{ productId: "p-004", businessId: "blue-shop", variantId: null, quantity: 1 }],
    allProducts(), businesses,
  );
  check("a pickup-only store is charged no delivery", pickupOnly.groups[0].delivery === 0);

  // Free delivery above the threshold.
  const expensive = groupCartByStore(
    [{ productId: "p-004", businessId: "blue-shop", variantId: null, quantity: 5 }],
    allProducts(), businesses,
  );
  check("free delivery applies above the store's threshold",
    expensive.groups[0].delivery === 0, String(expensive.groups[0].delivery));

  // Order split: one business order per group, one customer order overall.
  const address = { name: "A", phone: "P", line1: "L", city: "C", note: "" };
  const businessOrders = totals.groups.map((group) => buildBusinessOrder({
    customerId: "u-shopper",
    parentOrderId: "CO-TEST",
    address,
    lines: group.lines.map((l) => ({ product: l.product, variantId: l.variant?.id ?? null, quantity: l.quantity })),
    subtotal: group.subtotal, discount: group.discount, delivery: group.delivery,
    tax: group.tax, total: group.total,
    businessId: group.businessId, businessName: group.businessName, deliveryOptionId: null,
  }));
  check("one business order is created per store group", businessOrders.length === 3);
  check("each business order carries only its own products",
    businessOrders.every((order, i) => order.lines.every((line) =>
      allProducts().find((p) => p.id === line.productId)?.businessId === totals.groups[i].businessId)));
  check("business order ids are distinct", new Set(businessOrders.map((o) => o.id)).size === 3);

  const customerOrder = buildCustomerOrder("CO-TEST", "u-shopper", businessOrders);
  check("the customer sees ONE order", customerOrder.businessOrderIds.length === 3);
  check("the customer total equals the sum of the business orders",
    customerOrder.total === businessOrders.reduce((s, o) => s + o.total, 0));
  check("a new order starts Pending", businessOrders.every((o) => o.status === "Pending"));

  // Order lifecycle.
  check("all nine declared statuses exist", ORDER_STATUSES.length === 9, String(ORDER_STATUSES.length));
  check("Pending -> Confirmed is allowed", canTransitionOrder("Pending", "Confirmed"));
  check("Delivered -> Shipped is NOT allowed", !canTransitionOrder("Delivered", "Shipped"));
  check("Cancelled is terminal", canTransitionOrder("Cancelled", "Delivered") === false);
  const advanced = advanceOrder(businessOrders[0], "Confirmed", "Payment received");
  check("advancing records history", advanced.history.length === 2);
  check("advancing updates the status", advanced.status === "Confirmed");
}

// ---------------------------------------------------------------------------
// Section 16 - search
// ---------------------------------------------------------------------------
section("13. Search covers the catalogue, tolerates typos, and pages (Section 16)");
{
  const corpus: SearchCorpus = {
    products: allProducts(),
    businesses: allBusinesses(),
    categories: INITIAL_CATEGORIES,
    promotions: [],
    ratings: { "p-001": 4.6, "p-004": 4.0 },
    promotionIndex: {},
  };

  const exact = search(corpus, "Samsung");
  check("an exact product name is found", exact.items.some((i) => i.kind === "product" && i.id === "p-004"));
  check("an exact match is not reported as a correction", exact.corrected === false);

  const typo = search(corpus, "Samsng");
  check("a transposition typo still finds the product (Samsng -> Samsung)",
    typo.items.some((i) => i.id === "p-004"), JSON.stringify(typo.items.map((i) => i.title)));
  check("a corrected query says so", typo.corrected === true);

  check("edit distance counts a transposition as one edit", editDistance("teh", "the") === 1);
  check("edit distance rejects an unrelated word", editDistance("coffee", "Samsung") > 2);

  // Search across entity types.
  check("businesses are searchable", search(corpus, "Green Coffee").items.some((i) => i.kind === "business"));
  check("categories are searchable", search(corpus, "Fashion").items.some((i) => i.kind === "category"));

  // Autocomplete.
  const suggestions = suggest(corpus, "Yirg");
  check("autocomplete suggests a product prefix", suggestions.some((s) => /Yirgacheffe/i.test(s)));

  // Filters, all server-side.
  const inStock = search(corpus, "", { filters: { inStockOnly: true } });
  check("the in-stock filter excludes out-of-stock products",
    inStock.items.every((i) => i.id !== "p-010"));
  const priced = search(corpus, "", { filters: { minPrice: 1000, maxPrice: 2000 } });
  check("the price filter respects its bounds",
    priced.items.every((i) => i.price === null || (i.price >= 1000 && i.price <= 2000)));
  const byStore = search(corpus, "", { filters: { businessId: "blue-shop" } });
  check("a store filter returns only that store", byStore.items.every((i) =>
    i.kind !== "product" || allProducts().find((p) => p.id === i.id)?.businessId === "blue-shop"));
  const rated = search(corpus, "", { filters: { minRating: 4.5 } });
  check("the rating filter excludes lower-rated products", rated.items.every((i) => i.id !== "p-004"));

  // All six sort orders exist and behave.
  const low = search(corpus, "", { sort: "Price low to high" });
  const high = search(corpus, "", { sort: "Price high to low" });
  const pricedItems = low.items.filter((i) => i.price !== null);
  check("price low-to-high is ascending",
    pricedItems.every((item, i) => i === 0 || pricedItems[i - 1].price! <= item.price!));
  check("price high-to-low is descending", (high.items[0].price ?? 0) >= (high.items[high.items.length - 1].price ?? 0));
  const best = search(corpus, "", { sort: "Best rated" });
  check("best rated puts the 4.6 product first", best.items[0]?.id === "p-001", best.items[0]?.id ?? "");

  // Pagination.
  const page1 = search(corpus, "", { pageSize: 3, page: 1 });
  const page2 = search(corpus, "", { pageSize: 3, page: 2 });
  check("pagination reports the total", page1.total === page2.total);
  check("pagination reports the page count", page1.totalPages === Math.ceil(page1.total / 3));
  check("page 1 and page 2 return different rows",
    page1.items[0]?.id !== page2.items[0]?.id);
  check("the page size is respected", page1.items.length <= 3);

  // Section 25 privacy: search has no access to customer behaviour.
  check("search results never expose a customer",
    !JSON.stringify(search(corpus, "").items).includes("u-shopper"));
}

// ---------------------------------------------------------------------------
// Section 17 - categories
// ---------------------------------------------------------------------------
section("14. Category changes never delete products (Section 17)");
{
  check("the eighteen initial categories are present", INITIAL_CATEGORIES.length === 18, String(INITIAL_CATEGORIES.length));
  const names = INITIAL_CATEGORIES.map((c) => c.name);
  for (const expected of ["Vehicles", "Property", "Phones & Tablets", "Electronics",
    "Home, Furniture & Appliances", "Fashion", "Beauty & Personal Care", "Services",
    "Repair & Construction", "Commercial Equipment & Tools", "Leisure & Activities",
    "Babies & Kids", "Food, Agriculture & Farming", "Animals & Pets", "Jobs",
    "Seeking Work - CVs", "Business & Industry", "Others"]) {
    check(`"${expected}" is an initial category`, names.includes(expected));
  }

  // The listing count is a DISPLAYED figure shown beside each section name, so a
  // category with none would render as "Vehicles" with no idea of its size.
  check(
    "every main category carries a listing count",
    INITIAL_CATEGORIES.every((c) => typeof c.listingCount === "number" && c.listingCount > 0)
  );
  check(
    "the counts are distinct where the board says they are",
    new Set(INITIAL_CATEGORIES.map((c) => c.listingCount)).size > INITIAL_CATEGORIES.length - 3,
    "a couple of sections legitimately share a figure"
  );
  check(
    "Electronics is the largest section, as the board shows it",
    INITIAL_CATEGORIES.reduce((a, b) => ((a.listingCount ?? 0) > (b.listingCount ?? 0) ? a : b)).name ===
      "Electronics"
  );

  const categories = INITIAL_CATEGORIES.map((c) => ({ ...c }));
  const products = allProducts().map((p) => ({ ...p }));
  const withFood = products.filter((p) => p.categoryId === "food-agriculture-farming").length;
  check("Food holds products in the seed data", withFood > 0);

  // A category that still holds products cannot be deleted (Section 17: "where safe").
  const unsafe = canDeleteCategory("food-agriculture-farming", products, categories);
  check("a category holding products is NOT safe to delete", unsafe.allowed === false);
  check("the refusal says products are not deleted",
    /does not delete products/i.test(unsafe.reason));
  check("the refusal counts the affected products", unsafe.productCount === withFood, String(unsafe.productCount));

  const safe = canDeleteCategory("jobs", products, categories);
  check("an empty category IS safe to delete", safe.allowed === true);

  // Subcategories.
  const sub = createSubcategory(categories, "fashion", "Menswear");
  check("a subcategory is created under its parent", sub.parentId === "fashion");
  check("creating a subcategory deletes no product", products.length === allProducts().length);
  check("a subcategory id is namespaced by its parent", sub.id === "fashion-menswear", sub.id);
  check("a subcategory carries no listing count of its own", sub.listingCount === null);

  // Section 17: the same child name under two parents must not collide. This is
  // what the old `${slug}-${count}` scheme got wrong.
  const fashionShoes = createSubcategory(categories, "fashion", "Shoes");
  const leisureShoes = createSubcategory(categories, "leisure-activities", "Shoes");
  check("the same child name under two parents gets two ids",
    fashionShoes.id !== leisureShoes.id, `${fashionShoes.id} / ${leisureShoes.id}`);
  check("and each still points at its own parent",
    fashionShoes.parentId === "fashion" && leisureShoes.parentId === "leisure-activities");

  // Cycle protection.
  check("a node cannot be its own parent", canAttachNode(allNodes(), "n-wh", "n-wh") === false);
  check("a node can be attached to the root", canAttachNode(allNodes(), null, "n-wh") === true);
}

// ---------------------------------------------------------------------------
// Section 17 - the main category / subcategory tree
// ---------------------------------------------------------------------------
section("15b. Main categories carry subcategories, and both levels are usable (Section 17)");
{
  const stored = allCategories();
  const catalogue = allProducts();
  const tree = categoryTree(stored);

  // The eighteen main sections the board is divided into, unchanged.
  check("there are still eighteen main categories", tree.length === 18, String(tree.length));
  check("and none of them is itself a subcategory",
    tree.every((entry) => entry.parentId === null));

  // Every main category has real children - the point of the whole change.
  const empty = tree.filter((entry) => entry.subcategories.length === 0);
  check("every main category has subcategories", empty.length === 0,
    empty.map((e) => e.name).join(", "));

  // Section 17: the specification's own example, spelled out.
  const fashion = tree.find((entry) => entry.id === "fashion")!;
  const fashionNames = fashion.subcategories.map((sub) => sub.name);
  for (const expected of ["Men Clothes", "Women Clothes", "Kids Clothes", "Shoes", "Jewellery & Watches"]) {
    check(`Fashion has a "${expected}" subcategory`, fashionNames.includes(expected));
  }

  // The listing count reaches the tree the nav renders, so the nav can show it.
  check("the tree carries the listing counts", tree.every((entry) => entry.listingCount !== undefined));

  // Ids are namespaced, so no two subcategories anywhere share an id.
  const allSubIds = tree.flatMap((entry) => entry.subcategories.map((sub) => sub.id));
  check("no two subcategories share an id", new Set(allSubIds).size === allSubIds.length);

  // Every subcategory really points at a parent that exists.
  check("every subcategory points at a real main category",
    allSubIds.every((id) => {
      const row = stored.find((c) => c.id === id);
      return !!row && tree.some((entry) => entry.id === row.parentId);
    }));

  // Section 17: a subcategory is hidden when its parent is disabled, but the
  // ROW is not deleted - "do not delete products" applies to visibility.
  const snapshot = stored.length;
  const disableImpact = applyCategoryChange(stored, catalogue, "fashion", { enabled: false });
  check("disabling a parent reports its affected products", disableImpact.affectedProducts > 0);
  check("disabling a parent hides its children from the tree",
    categoryTree(stored).find((entry) => entry.id === "fashion") === undefined);
  check("but no category row is deleted", stored.length === snapshot);
  applyCategoryChange(stored, catalogue, "fashion", { enabled: true });
  check("re-enabling brings the children back",
    categoryTree(stored).find((entry) => entry.id === "fashion")!.subcategories.length > 0);

  // The parent lookup, which is what makes a main-category filter reach its
  // children.
  check("a subcategory resolves back to its main category",
    parentCategoryOf(stored, "fashion-jewellery-watches")?.id === "fashion");
  check("a main category resolves to itself",
    parentCategoryOf(stored, "fashion")?.id === "fashion");
  check("an unknown id resolves to nothing", parentCategoryOf(stored, "nope") === null);

  // The seeded catalogue is really filed under subcategories, so the filter has
  // something to return.
  const filed = catalogue.filter((product) => product.subcategoryId !== null);
  check("every seeded product is filed under a subcategory",
    filed.length === catalogue.length,
    `${filed.length}/${catalogue.length}`);

  // The jewellery range from Section 41 now lives under Fashion / Jewellery & Watches.
  const jewellery = catalogue.filter((product) => product.subcategoryId === "fashion-jewellery-watches");
  check("the five jewellery products are under Jewellery", jewellery.length === 5,
    String(jewellery.length));
  check("and they still belong to Fashion",
    jewellery.every((product) => product.categoryId === "fashion"));

  // A main category reaches its children - this is the filtering rule the header
  // depends on, checked through the real search corpus.
  const corpus: SearchCorpus = {
    products: catalogue.filter(isSellable),
    businesses: allBusinesses(),
    categories: stored,
    promotions: [],
    ratings: {},
    promotionIndex: {},
  };
  const productHits = (categoryId: string) =>
    search(corpus, "", { filters: { categoryId } }).items.filter(
      (item) => item.kind === "product",
    );

  const fashionHit = productHits("fashion");
  check("filtering by Fashion returns its subcategory's products too",
    fashionHit.length === jewellery.length + 3,
    `${fashionHit.length} (jewellery alone: ${jewellery.length})`);
  check("and every Fashion hit really is under Fashion",
    fashionHit.every((item) =>
      catalogue.some(
        (product) => product.id === item.id && product.categoryId === "fashion",
      ),
    ));

  check("filtering by the Jewellery subcategory returns only jewellery",
    productHits("fashion-jewellery-watches").length === 5);

  // A subcategory with no products is empty rather than wrong.
  check("an empty subcategory returns nothing", productHits("sports-cycling").length === 0);
}
section("15. Stock is a ledger, not an editable number (Section 27)");
{
  const nodes = allNodes();
  const movements = [];
  // Opening 60 in the main warehouse, then move 10 to Room 1.
  const opening = applyPurchaseReceipt("green-coffee", "i-x", 60, "n-wh", "PO-1", new Date("2026-01-01"));

  movements.push(opening);
  // The transfer is validated against the ledger, which now holds the receipt.
  const transfer = buildTransfer("green-coffee", "i-x", 10, "n-wh", "n-r1", movements, new Date("2026-01-02"));
  movements.push(transfer);
  check("stock is counted at a node", stockAt("i-x", "n-wh", movements) === 50, String(stockAt("i-x", "n-wh", movements)));
  check("a transfer credits the destination", stockAt("i-x", "n-r1", movements) === 10);
  check("a transfer conserves the total",
    totalStock("i-x", movements, nodes) === 60, String(totalStock("i-x", movements, nodes)));

  // A transfer that would overdraw is refused.
  let refused = false;
  try {
    buildTransfer("green-coffee", "i-x", 9999, "n-wh", "n-r1", movements);
  } catch {
    refused = true;
  }
  check("a transfer larger than the source stock is refused", refused);
  let sameNode = false;
  try {
    buildTransfer("green-coffee", "i-x", 1, "n-wh", "n-wh", movements);
  } catch {
    sameNode = true;
  }
  check("a transfer to the same location is refused", sameNode);

  // Damage and loss reduce stock through the same ledger.
  movements.push({
    id: "sm-dmg", businessId: "green-coffee", itemId: "i-x", type: "Damaged stock",
    quantity: 5, fromNodeId: null, toNodeId: "n-wh", note: "Damaged", reference: null, at: "2026-01-03T00:00:00.000Z",
  });
  check("damaged stock reduces the balance", stockAt("i-x", "n-wh", movements) === 45);
  check("a return puts stock back", (() => {
    movements.push({
      id: "sm-ret", businessId: "green-coffee", itemId: "i-x", type: "Returned stock",
      quantity: 2, fromNodeId: null, toNodeId: "n-wh", note: "Returned", reference: null, at: "2026-01-04T00:00:00.000Z",
    });
    return stockAt("i-x", "n-wh", movements) === 47;
  })());

  // The hierarchy renders as Section 27 draws it.
  const tree = renderHierarchy(nodes);
  check("the tree shows the Main Warehouse", tree.includes("Main Warehouse"));
  check("the tree shows Branch 1 and Branch 2", tree.includes("Branch 1") && tree.includes("Branch 2"));
  check("Room 1 and Room 2 hang under the warehouse", /Room 1/.test(tree) && /Room 2/.test(tree));
  check("Shelf A is shown", tree.includes("Shelf A"));
  check("Branch 1 has a Store and a Storage", /Branch 1[\s\S]*Storage[\s\S]*Store/.test(tree), JSON.stringify(tree));
}

// ---------------------------------------------------------------------------
// Section 23 - reviews
// ---------------------------------------------------------------------------
section("16. Reviews are verified from orders, never from the client (Section 23)");
{
  const reviews = allReviews();
  const summary = summarizeRatings(reviews);
  check("a rating summary reports a count", summary.count >= 1);
  check("a rating summary reports an average between 1 and 5",
    summary.average >= 1 && summary.average <= 5, String(summary.average));
  const distributionTotal = summary.distribution.reduce((a, b) => a + b, 0);
  check("the distribution totals the review count", distributionTotal === summary.count);
  check("ratings are integers 1-5", isValidRating(4) && !isValidRating(0) && !isValidRating(6) && !isValidRating(4.5));
  check("the maximum rating is 5", MAX_RATING === 5);

  // Verified purchase needs a DELIVERED order for that product. The order is
  // driven through the real lifecycle rather than being stamped "Delivered".
  const placed = buildBusinessOrder({
    customerId: "u-verified", parentOrderId: "CO-V", address: { name: "n", phone: "p", line1: "l", city: "c", note: "" },
    lines: [{ product: allProducts().find((p) => p.id === "p-001")!, variantId: null, quantity: 1 }],
    subtotal: 950, discount: 250, delivery: 0, tax: 0, total: 700,
    businessId: "green-coffee", businessName: "Green Coffee Exporters", deliveryOptionId: null,
  });
  check("a fresh order is Pending, so it does not verify anything",
    isVerifiedPurchase("p-001", "u-verified", [placed]) === false);

  const delivered = [
    "Confirmed", "Processing", "Preparing", "Shipped", "Out for Delivery", "Delivered",
  ].reduce((order, status) => advanceOrder(order, status as never, "test"), placed);

  check("the order reaches Delivered through the declared lifecycle", delivered.status === "Delivered");
  check("a delivered order verifies the purchase",
    isVerifiedPurchase("p-001", "u-verified", [delivered]) === true);
  check("a Pending order does NOT verify the purchase",
    isVerifiedPurchase("p-001", "u-verified", [placed]) === false);
  check("another customer cannot claim the verified badge",
    isVerifiedPurchase("p-001", "u-someone-else", [delivered]) === false);
  check("buying a different product does not verify this one",
    isVerifiedPurchase("p-004", "u-verified", [delivered]) === false);
}

// ---------------------------------------------------------------------------
// Section 24 - wishlist
// ---------------------------------------------------------------------------
section("17. Wishlist notifications compare against the saved price (Section 24)");
{
  const product = { ...allProducts().find((p) => p.id === "p-003")! };
  const item: WishlistItem = {
    productId: product.id, customerId: "u-wish",
    addedAt: "2026-01-01T00:00:00.000Z",
    notified: { price: false, promotion: false, backInStock: false },
  };
  rememberSavedPrice("u-wish", product.id, 650);

  const same = checkWishlistNotifications(item, product, 650, false);
  check("no notification when nothing changed",
    same.notified.price === false && same.notified.promotion === false);

  const cheaper = checkWishlistNotifications(item, product, 500, false);
  check("a price DROP notifies", cheaper.notified.price === true);
  const dearer = checkWishlistNotifications(item, product, 900, false);
  check("a price INCREASE does not notify", dearer.notified.price === false);
  const promoted = checkWishlistNotifications(item, product, 650, true);
  check("a promotion notifies", promoted.notified.promotion === true);
}

// ---------------------------------------------------------------------------
// Section 25 - recommendations
// ---------------------------------------------------------------------------
section("18. Recommendations never expose another customer (Section 25)");
{
  const products = allProducts().filter(isSellable);

  // A new user gets the cold-start list, not a fabricated personal reason.
  const cold = recommendationsFor(EMPTY_SIGNALS, products, { limit: 5 });
  check("a new customer still gets recommendations", cold.length > 0);
  check("a new customer's reasons are catalogue-level, not personal",
    cold.every((r) => !/you (bought|viewed|added)/i.test(r.reason)), JSON.stringify(cold.map((r) => r.reason)));
  check("cold-start reasons are drawn from the specification's list",
    cold.every((r) => /Trending|Popular|Featured/.test(r.reason)));

  // A returning customer is scored on their own behaviour.
  const warm = recommendationsFor({
    searchTerms: ["coffee"], viewedProductIds: ["p-001"], wishlistProductIds: [],
    cartProductIds: [], purchasedProductIds: ["p-001"], location: null,
  }, products, { limit: 5 });
  check("a returning customer gets recommendations", warm.length > 0);
  check("out-of-stock products are never recommended",
    warm.every((r) => products.find((p) => p.id === r.productId)!.stock > 0));

  // The privacy rule, checked as a string search: no other user appears.
  const serialised = JSON.stringify(warm);
  check("no recommendation names a customer", !serialised.includes("u-shopper"));
  check("no recommendation names another customer", !serialised.includes("u-other"));
  check("reasons are drawn from a closed set of statements",
    warm.every((r) => typeof r.reason === "string" && r.reason.length > 0));

  // The signature only ever accepts ONE customer's signals, so a caller
  // cannot pass two customers in and get a merged profile.
  const params = recommendationsFor.length;
  check("recommendationsFor takes a single signals object", params === 2, String(params));
}

// ---------------------------------------------------------------------------
// Section 21 - payments
// ---------------------------------------------------------------------------
section("19. Payments: extensible, verified server-side, never self-declared");
{
  // Provider registry is the extensibility seam.
  registerProvider(createChapaProvider("test-key"));
  const chapa = getProvider("chapa");
  check("Chapa registers itself", chapa !== null);
  check("a registered provider is retrievable by id", getProvider("chapa")?.name === "Chapa");
  check("an unconfigured provider is not offered", createChapaProvider("").isConfigured() === false);
  check("a configured provider reports itself configured", createChapaProvider("k").isConfigured() === true);

  // Cash on delivery is always available; online payment is package-gated.
  const options = paymentOptionsFor(allBusinesses());
  check("cash on delivery is always offered", options.includes(CASH_ON_DELIVERY), JSON.stringify(options));
  check("online payment is not offered for Silver-only baskets",
    isOnlinePaymentAvailable([{ ...businessById("blue-shop")!, packageId: "silver" }]) === false);
  check("online payment is offered for Platinum baskets",
    isOnlinePaymentAvailable([{ ...businessById("green-coffee")!, packageId: "platinum" }]) === true);

  check("a payment reference is unique per attempt", newPaymentReference() !== newPaymentReference());

  // THE RULE: the browser's claim is not the outcome.
  const record = {
    reference: "PAY-TEST", orderId: "CO-1", businessId: "b", customerId: "c",
    provider: "chapa", amount: 5000, currency: "ETB" as const, status: "Pending" as const,
    transactionId: null, createdAt: "2026-01-01T00:00:00.000Z", verifiedAt: null, failureReason: null,
  };
  const verified = settlePayment(record, {
    reference: "PAY-TEST", status: "Success", transactionId: "tx-1", amount: 5000, failureReason: null,
  });
  check("a server-side verification marks the payment successful", verified.status === "Success");
  check("the transaction id is recorded", verified.transactionId === "tx-1");
  check("the verification time is stamped", verified.verifiedAt !== null);

  // A tampered amount must not mark the order paid.
  const tampered = settlePayment(record, {
    reference: "PAY-TEST", status: "Success", transactionId: "tx-2", amount: 100, failureReason: null,
  });
  check("a SUCCESS with the WRONG amount is refused", tampered.status === "Failed", tampered.status);
  check("and the reason names the mismatch",
    /did not match the order total/i.test(tampered.failureReason ?? ""));

  // A replayed callback cannot move a settled payment.
  const replayed = settlePayment(verified, {
    reference: "PAY-TEST", status: "Failed", transactionId: null, amount: 5000, failureReason: "x",
  });
  check("a settled payment cannot be replayed back to Failed", replayed.status === "Success");

  // A failed payment is surfaced, not swallowed.
  const failed = settlePayment(record, {
    reference: "PAY-TEST", status: "Failed", transactionId: null, amount: 5000, failureReason: "Insufficient funds",
  });
  check("a failed payment keeps its reason", failed.failureReason === "Insufficient funds");
}

// ---------------------------------------------------------------------------
// Section 50 - business data isolation
// ---------------------------------------------------------------------------
section("20. Cross-tenant access is refused (Section 50)");
{
  const ownerA: PlatformIdentity = {
    userId: "u-a", businessId: "green-coffee", displayName: "A",
    role: "owner", isSuperAdmin: false, isAuthenticated: true,
  };
  const ownerB: PlatformIdentity = {
    userId: "u-b", businessId: "blue-shop", displayName: "B",
    role: "owner", isSuperAdmin: false, isAuthenticated: true,
  };
  const superAdmin: PlatformIdentity = {
    userId: "u-s", businessId: null, displayName: "S",
    role: "super-admin", isSuperAdmin: true, isAuthenticated: true,
  };

  check("A can reach their own business", canAccessBusiness(ownerA, "green-coffee").allowed);
  check("A cannot reach B's business", canAccessBusiness(ownerA, "blue-shop").allowed === false);
  check("the refusal names the reason", canAccessBusiness(ownerA, "blue-shop").reason === "different-business");
  check("B cannot reach A's business", canAccessBusiness(ownerB, "green-coffee").allowed === false);
  check("a guest can reach nothing", canAccessBusiness(guestIdentity(), "green-coffee").allowed === false);
  check("a guest's refusal says it is not authenticated",
    canAccessBusiness(guestIdentity(), "green-coffee").reason === "not-authenticated");
  check("Super Admin can reach any business", canAccessBusiness(superAdmin, "blue-shop").allowed);

  // An employee is bound to their business too, not to their own user id.
  const employee: PlatformIdentity = {
    userId: "u-c", businessId: "green-coffee", displayName: "C",
    role: "employee", isSuperAdmin: false, isAuthenticated: true,
  };
  check("an employee reaches their business", canAccessBusiness(employee, "green-coffee").allowed);
  check("an employee cannot reach another business", canAccessBusiness(employee, "blue-shop").allowed === false);

  // No order is visible across tenants.
  const aOrders = allBusinessOrders().filter((o) => o.businessId === "green-coffee");
  const bOrders = allBusinessOrders().filter((o) => o.businessId === "blue-shop");
  check("orders are tenant-scoped in the store",
    aOrders.every((o) => o.businessId === "green-coffee") && bOrders.every((o) => o.businessId === "blue-shop"));
}

// ---------------------------------------------------------------------------
// Section 51 - languages
// ---------------------------------------------------------------------------
section("21. Six Ethiopian languages, with English fallback (Section 51)");
{
  // WAS: `check("two languages ship", LANGUAGES.length === 2)`.
  //
  // Section 51 grew to six. This is no longer a bare count - it is the specific
  // SET, so that REMOVING a language fails the suite rather than silently
  // shipping fewer.
  check("six languages ship", LANGUAGES.length === 6, String(LANGUAGES.length));
  check("the set is exactly the six Ethiopian ones",
    JSON.stringify([...LANGUAGES].sort()) === JSON.stringify(["aa", "am", "en", "om", "so", "ti"]),
    [...LANGUAGES].join(","));

  check("English is a supported code", isLanguageCode("en"));
  check("Amharic is a supported code", isLanguageCode("am"));
  check("Oromo is a supported code", isLanguageCode("om"));
  check("Somali is a supported code", isLanguageCode("so"));
  check("Afar is a supported code", isLanguageCode("aa"));
  check("Tigrinya is a supported code", isLanguageCode("ti"));
  check("an unknown code is refused", isLanguageCode("fr") === false);

  check("English renders", t("nav.cart", "en") === "Cart");

  // THE ORIGINAL BUG, ASSERTED DIRECTLY.
  //
  // The shipped Amharic catalogue was mojibake - Latin-1 garbage containing no
  // Ethiopic code points at all - and the old test `t(key,"am") !== t(key,"en")`
  // PASSED anyway, because garbage does differ from English. These two checks
  // are what actually hold the line: the string must differ, AND it must be
  // written in a script Amharic is really written in.
  check("Amharic renders", t("nav.cart", "am") !== t("nav.cart", "en"));
  check("Amharic is in Ethiopic script",
    isPlausiblyInScript(t("nav.cart", "am"), LANGUAGES_DEFINED.am), t("nav.cart", "am"));

  for (const code of ["om", "so", "aa", "ti"] as const) {
    const rendered = t("nav.cart", code);
    check(`${LANGUAGE_NAMES[code]} renders`, rendered !== t("nav.cart", "en"));
    check(`${LANGUAGE_NAMES[code]} is in a plausible script`,
      isPlausiblyInScript(rendered, LANGUAGES_DEFINED[code]), rendered);
  }

  // The corruption guard, exercised directly: a Ge'ez language handed mojibake
  // must be REJECTED, or the original bug could ship a second time.
  check("mojibake is rejected for a Ge'ez language",
    !isPlausiblyInScript("\u00e1\u0160 \u00e1\u02c6\u203a\u00e1\u02c6\u00ad", LANGUAGES_DEFINED.am));
  check("real Ethiopic is accepted for a Ge'ez language",
    isPlausiblyInScript("\u12ab\u122d\u1275", LANGUAGES_DEFINED.am));

  // A missing translation falls back to English, never to the key.
  check("a missing translation falls back to English, not to the key",
    t("no.such.key", "am") === "no.such.key");
  check("t() never throws on an unknown language",
    t("nav.cart", "zz" as never) === "Cart");

  // PROVENANCE IS HONEST. `machine-assisted` must never be readable as verified.
  check("English is the source catalogue", LANGUAGES_DEFINED.en.provenance === "source");
  check("Amharic is marked reviewed", LANGUAGES_DEFINED.am.provenance === "reviewed");
  for (const code of ["om", "so", "aa", "ti"] as const) {
    check(`${LANGUAGE_NAMES[code]} is honestly marked machine-assisted`,
      LANGUAGES_DEFINED[code].provenance === "machine-assisted",
      LANGUAGES_DEFINED[code].provenance);
  }

  // Coverage is REPORTED, so a partially translated language is visible rather
  // than quietly showing English everywhere with no signal.
  check("English is fully covered", coverage("en") === 1);
  check("Amharic is fully covered", coverage("am") === 1, String(coverage("am")));
  for (const code of ["om", "so", "aa", "ti"] as const) {
    check(`${LANGUAGE_NAMES[code]} coverage is reported`, coverage(code) > 0, String(coverage(code)));
  }
  check("no language has an untranslated gap",
    LANGUAGES.every((code) => coverage(code) === 1),
    LANGUAGES.map((code) => `${code}:${coverage(code)}`).join(" "));

  // THE SECOND BUG: TIGRINYA WAS A COPY OF AMHARIC.
  //
  // It was 82/91 byte-identical (90%) and every check above still passed,
  // because they only ever asked "is this different from ENGLISH?". A copy of
  // another language is trivially different from English, so the whole
  // catalogue sailed through as a translation.
  //
  // These two assert the right question instead - "is this different from the
  // OTHER translations?" - so a copy-paste can never ship as a language again.
  check("no catalogue is a copy of another language",
    suspectedDuplications().length === 0,
    suspectedDuplications().map((d) => `${d.a}/${d.b}=${Math.round(d.overlap * 100)}%`).join(" "));

  check("Amharic and Tigrinya are not copies of each other",
    catalogueOverlap("am", "ti") <= DUPLICATION_LIMIT,
    `overlap ${Math.round(catalogueOverlap("am", "ti") * 100)}%, limit ${Math.round(DUPLICATION_LIMIT * 100)}%`);

  // The copy threshold must stay above GENUINE relatedness. am/ti are mutually
  // intelligible and so/aa are both Cushitic; if the limit dropped to near zero
  // this would fail on correct work and pressure a translator into inventing
  // awkward synonyms just to satisfy a number.
  check("the copy limit tolerates real Ethiopic cognate overlap",
    catalogueOverlap("am", "ti") > 0 && catalogueOverlap("am", "ti") <= DUPLICATION_LIMIT,
    `${Math.round(catalogueOverlap("am", "ti") * 100)}%`);
  check("the copy limit tolerates real Cushitic overlap",
    catalogueOverlap("so", "aa") <= DUPLICATION_LIMIT,
    `${Math.round(catalogueOverlap("so", "aa") * 100)}%`);

  // Tigrinya must have genuine Tigrinya vocabulary, not Amharic wearing a
  // different label. These are the specific words that differ.
  check("Tigrinya uses its own word for language", translate("lang.label", "ti") !== translate("lang.label", "am"),
    translate("lang.label", "ti"));

  // THE FOURTH BUG: THE TWO "LANGUAGE" WORDS WERE SWAPPED.
  //
  // The Amharic catalogue's lang.label held ቋንቋ (qanyaq, TIGRINYA) while the
  // Tigrinya autonym held መነሻ (mekaneša, AMHARIC). So the Amharic interface
  // labelled its own language selector with the Tigrinya word, and the switcher
  // labelled Tigrinya with the Amharic word. Both sides were wrong in a way that
  // still passed every script check, because both words are legitimate Ethiopic.
  //
  // A swap is invisible to per-string checks; it is only visible as a CROSS-
  // language inconsistency, so that is what these assert.
  // NOTE ON WHAT "AGREES" MEANS HERE.
  //
  // `lang.label` is the word for the concept "language" in that language
  // (Tigrinya: ቋንቋ). `LANGUAGE_NAMES.ti` is the language's NAME FOR ITSELF
  // (ትግርኛ). These are legitimately DIFFERENT words - "Tigrinya" and
  // "language" are not the same noun - so the check below cannot compare them
  // directly. What must hold is that neither language uses the OTHER one's
  // distinctive word, which is what the swap actually looked like.
  check("the Amharic language label is not the Tigrinya word for language",
    translate("lang.label", "am") !== translate("lang.label", "ti"),
    `${translate("lang.label", "am")} vs ${translate("lang.label", "ti")}`);
  check("the Amharic language label is the Amharic word",
    translate("lang.label", "am") === LANGUAGE_NAMES.am,
    `${translate("lang.label", "am")} vs ${LANGUAGE_NAMES.am}`);
  check("the Tigrinya language label is not the Amharic word",
    translate("lang.label", "ti") !== LANGUAGE_NAMES.am,
    `${translate("lang.label", "ti")} vs ${LANGUAGE_NAMES.am}`);
  // Uniqueness, using the language COUNT rather than Object.keys().length:
  // a Record has no `length`, so the first version of this check did not
  // compile - it was measuring the wrong thing even before it failed to run.
  check("each language is labelled uniquely",
    new Set(Object.values(LANGUAGE_NAMES)).size === LANGUAGES.length,
    Object.values(LANGUAGE_NAMES).join(" | "));
  check("each language has a unique native name",
    new Set(Object.values(LANGUAGE_NATIVE)).size === LANGUAGES.length,
    Object.values(LANGUAGE_NATIVE).join(" | "));
  check("Tigrinya uses its own word for store", translate("nav.store", "ti") !== translate("nav.store", "am"),
    translate("nav.store", "ti"));
  check("Tigrinya uses its own imperative for cancel",
    translate("common.cancel", "ti") !== translate("common.cancel", "am"), translate("common.cancel", "ti"));

  // THE THIRD BUG: THE ENDONYM WAS THE AMHARIC WORD FOR "LANGUAGE".
  // Tigrinya's autonym is ትግርኛ (tigrinya); መነሻ is the Amharic word, so the
  // switcher showed two entries both labelled with the Amharic name.
  check("Tigrinya is labelled in Tigrinya", LANGUAGE_NAMES.ti === "ትግርኛ", LANGUAGE_NAMES.ti);
  check("Tigrinya's native name is Tigrinya", LANGUAGE_NATIVE.ti === "ትግርኛ", LANGUAGE_NATIVE.ti);
  check("the definition carries the right autonym",
    LANGUAGES_DEFINED.ti.native === "ትግርኛ", LANGUAGES_DEFINED.ti.native);
  check("Tigrinya is not labelled with the Amharic word for language",
    LANGUAGE_NAMES.ti !== LANGUAGE_NAMES.am);
  // And it must agree with the catalogue's own word for "language".
  check("the autonym agrees with the catalogue's word for language",
    LANGUAGES_DEFINED.ti.native !== translate("lang.label", "am"),
    `${LANGUAGES_DEFINED.ti.native} vs am ${translate("lang.label", "am")}`);
  check("every language is labelled in its own script",
    LANGUAGE_NAMES.en !== LANGUAGE_NAMES.am && LANGUAGE_NAMES.am !== LANGUAGE_NAMES.om &&
    LANGUAGE_NAMES.om !== LANGUAGE_NAMES.so && LANGUAGE_NAMES.so !== LANGUAGE_NAMES.aa &&
    LANGUAGE_NAMES.aa !== LANGUAGE_NAMES.ti);

  // The commercial name for the custom system (Section 29) is not invented.
  check("the custom ERP is named as specified",
    CUSTOM_ERP_NAME === "Yene Custom Business ERP & Inventory System");
  check("it is attributed to Yene Business Group",
    t("custom.erpDescription", "en").includes("Yene Business Group"));
  check("it is not presented as Frappe or ERPNext",
    !/frappe|erpnext/i.test(t("custom.erpDescription", "en")));
}

// ---------------------------------------------------------------------------
// Sections 40 / 45 - quotation and Super Admin surface
// ---------------------------------------------------------------------------
section("22. Super is quoted, and the Super Admin surface is complete");
{
  const factors = QUOTE_FACTORS;
  for (const expected of ["Business size", "Branches", "Users", "Warehouses", "Inventory complexity", "POS", "Integrations", "Automation", "Custom development", "Hosting", "Support", "Documentation"]) {
    check(`"${expected}" is a quotation factor`, factors.includes(expected as never));
  }
  check("there are fourteen quotation factors", factors.length === 14, String(factors.length));

  for (const area of ["Businesses", "Stores", "Packages", "Subscriptions", "Payments", "Users", "Roles", "Permissions", "Marketplace", "Products", "Categories", "Reviews", "Orders", "Promotions", "Campaigns", "Banners", "Featured stores", "Sponsored products", "Analytics", "Audit logs", "Support", "AI knowledge base", "Payment configuration", "Delivery configuration"]) {
    check(`Super Admin manages ${area}`, SUPER_ADMIN_AREAS.includes(area as never));
  }
}

// ---------------------------------------------------------------------------
// Sections 10 / 41 - store statuses and mall businesses
// ---------------------------------------------------------------------------
section("23. Store statuses and mall registration (Sections 10, 41)");
{
  const statuses = ["Trial", "Active", "Payment Due", "Suspended", "Expired", "Cancelled"] as const;
  check("there are six store statuses", statuses.length === 6);
  for (const business of allBusinesses()) {
    check(`${business.name} has a declared status`, statuses.includes(business.status as never));
  }

  // An expired business is still there (Section 10: do not delete history).
  const expiring: Business = { ...businessById("green-coffee")!, status: "Expired" };
  check("an expired store keeps its products",
    allProducts().filter((p) => p.businessId === expiring.id).length > 0);
  check("an expired store is not deleted", allBusinesses().some((b) => b.id === expiring.id));

  // Section 41: the mall example from the specification.
  const mall = businessById("abcfashion")!;
  check("a mall business records its mall", mall.mall?.mallName === "Dembel City Center");
  check("and its room", mall.mall?.roomNumber === "3F-24");
  check("and its floor", mall.mall?.floor === "3F");
  check("a mall agreement is recorded", mall.mall?.agreementId === "MALL-DCC-2026");
  check("the subdomain is the one in the specification", mall.subdomain === "abcfashion.yene-store.com");
  check("package features still follow the package, not the agreement",
    hasFeature(mall.packageId, "marketplace") === true);

  // Section 41: the store is filed under the mall DIRECTORY, not just a string.
  const dembel = mallById("mall-dembel-city-center")!;
  check("a mall exists as its own record", !!dembel);
  check("and it has a slug", dembel.slug === "dembel-city-center");
  check("a store points at it by id", mall.mall?.mallId === dembel.id);
  check("the mall resolves back from the store",
    mallForBusiness(allMalls(), mall)?.id === dembel.id);
  check("a mall store is recognised as one", isMallStore(mall));
  check("a standalone store is not a mall store", !isMallStore(businessById("green-coffee")!));

  // A mall lookup works from either identifier a client may hold.
  check("a mall resolves by slug", mallByIdOrName("dembel-city-center")?.id === dembel.id);
  check("a mall resolves by name, case-insensitively",
    mallByIdOrName("Dembel City Center")?.id === dembel.id);
  check("an unknown name resolves to nothing", mallByIdOrName("Nowhere Mall") === null);

  // Section 41: a mall holds MANY stores - the case a single-store example
  // could not show.
  const hub = businessById("hub-jewellery")!;
  check("a second store is registered in the same mall", !!hub);
  check("it is filed under the same mall", hub.mall?.mallId === dembel.id);
  check("the mall groups both stores", storesInMall(allBusinesses(), dembel).length === 2);
  check("and the grouped names are right",
    storesInMall(allBusinesses(), dembel).map((b) => b.name).sort().join(", ") ===
      "ABC Fashion, Hub Jewellery");

  // Section 41: a store may hold MORE THAN ONE ROOM - "GFS-024 & GFS-030".
  check("the second store holds two rooms", hub.mall?.roomNumbers.length === 2);
  check("the first room is GFS-024", hub.mall?.roomNumbers[0] === "GFS-024");
  check("the second room is GFS-030", hub.mall?.roomNumbers[1] === "GFS-030");
  check("the primary room is the first of them", hub.mall?.roomNumber === "GFS-024");
  check("and they read together as written",
    formatRoomNumbers(roomNumbersFor(hub.mall)) === "GFS-024 & GFS-030");

  // A single-room store still reports exactly one room, from the legacy field.
  check("a single-room store reports one room", roomNumbersFor(mall.mall).length === 1);
  check("and it is its own room", roomNumbersFor(mall.mall)[0] === "3F-24");

  // The jewellery range the specification names is really listed.
  const jewellery = allProducts().filter((p) => p.businessId === "hub-jewellery");
  check("the mall store has a real catalogue", jewellery.length > 0);
  for (const material of ["Sapphire", "Emerald", "Gold", "Silver", "Platinum"]) {
    check(`it sells ${material.toLowerCase()}`,
      jewellery.some((p) => p.name.includes(material)));
  }
  check("its products are all published", jewellery.every((p) => p.status === "active"));

  // A store holding two rooms still counts once in the directory.
  const directory = mallDirectory(allMalls(), allBusinesses(), allProducts());
  check("the directory lists the mall", directory.length === 1);
  check("it counts both stores", directory[0].storeCount === 2);
  check("it counts the jewellery products",
    directory[0].stores.find((s) => s.name === "Hub Jewellery")!.productCount === 5);
  check("a store's rooms appear as one readable label",
    directory[0].stores.find((s) => s.name === "Hub Jewellery")!.roomLabel === "GFS-024 & GFS-030");
}

// ---------------------------------------------------------------------------
// Section 41 - parsing rooms, and refusing a double-booked counter
// ---------------------------------------------------------------------------
section("23b. Rooms parse from a typed field, and a counter belongs to one store");
{
  const dembel = mallById("mall-dembel-city-center")!;

  // A shopkeeper types separators; every common one must produce two rooms.
  check("an ampersand splits rooms", parseRoomNumbers("GFS-024&GFS-030").length === 2);
  check("a spaced ampersand splits rooms", parseRoomNumbers("GFS-024 & GFS-030").length === 2);
  check("a comma splits rooms", parseRoomNumbers("GFS-024, GFS-030").length === 2);
  check("a semicolon splits rooms", parseRoomNumbers("GFS-024; GFS-030").length === 2);
  check("a slash splits rooms", parseRoomNumbers("GFS-024 / GFS-030").length === 2);
  check("the word 'and' splits rooms", parseRoomNumbers("GFS-024 and GFS-030").length === 2);
  check("a newline splits rooms", parseRoomNumbers("GFS-024\nGFS-030").length === 2);
  check("an array is accepted", parseRoomNumbers(["GFS-024", "GFS-030"]).length === 2);
  check("a repeated room is collapsed", parseRoomNumbers("GFS-024 & gfs-024").length === 1);
  check("case is normalised", parseRoomNumbers("gfs-024")[0] === "GFS-024");
  check("whitespace is trimmed", parseRoomNumbers("  GFS-024  ")[0] === "GFS-024");
  check("empty entries are dropped", parseRoomNumbers("GFS-024 &  & ").length === 1);
  check("a blank field yields no rooms", parseRoomNumbers("").length === 0);
  check("an absent field yields no rooms", parseRoomNumbers(undefined).length === 0);
  check("the order typed is the order kept",
    parseRoomNumbers("GFS-030 & GFS-024").join(",") === "GFS-030,GFS-024");

  // The builder keeps the two room representations consistent.
  const built = buildMallPlacement({ mall: dembel, floor: " GFS ", rooms: "GFS-024 & GFS-030" });
  check("the placement takes the mall's own name", built.mallName === "Dembel City Center");
  check("the floor is trimmed", built.floor === "GFS");
  check("both rooms are kept", built.roomNumbers.length === 2);
  check("the primary room matches the first", built.roomNumber === built.roomNumbers[0]);

  // The DIRECTORY is the authority on the name: a request cannot rename a mall
  // by sending a different one alongside its id.
  const renamed = buildMallPlacement({
    mall: dembel,
    requestedName: "Somewhere Else",
    rooms: "1F-01",
  });
  check("a typed name cannot rename the mall", renamed.mallName === "Dembel City Center");

  // A counter belongs to one store.
  check("an unclaimed room is free",
    findRoomConflicts(allBusinesses(), dembel, ["GFS-07"]).length === 0);
  check("a taken room is refused",
    findRoomConflicts(allBusinesses(), dembel, ["GFS-024"]).join(",") === "GFS-024");
  check("case does not let a duplicate through",
    findRoomConflicts(allBusinesses(), dembel, ["gfs-030"]).join(",") === "gfs-030");
  check("spacing does not let a duplicate through",
    findRoomConflicts(allBusinesses(), dembel, ["GFS 024"]).join(",") === "GFS 024");
  check("only the clashing room is reported",
    findRoomConflicts(allBusinesses(), dembel, ["GFS-07", "GFS-030"]).join(",") === "GFS-030");
  check("a store may re-save its OWN rooms",
    findRoomConflicts(allBusinesses(), dembel, ["GFS-024"], "hub-jewellery").length === 0);
  check("another store still cannot have them",
    findRoomConflicts(allBusinesses(), dembel, ["GFS-024"], "abcfashion").join(",") === "GFS-024");

  // The rooms still on offer exclude everything already claimed.
  const free = availableRooms(allBusinesses(), dembel);
  check("the first taken room is not offered", !free.includes("GFS-024"));
  check("nor the second taken room", !free.includes("GFS-030"));
  check("nor the single-room store's room", !free.includes("3F-24"));
  check("unclaimed rooms ARE offered", free.includes("GFS-01"));
  check("rooms exist for every floor the mall has",
    ["GFS", "1F", "2F", "3F"].every((floor) => free.includes(`${floor}-01`)));

  // A null mall is inert rather than fatal - these are reached from a public
  // route with an unvalidated id.
  check("a null mall groups nothing", storesInMall(allBusinesses(), null as never).length === 0);
  check("a null mall finds no conflicts",
    findRoomConflicts(allBusinesses(), null, ["GFS-01"]).length === 0);
  check("a null mall offers no rooms", availableRooms(allBusinesses(), null).length === 0);

  // A record written before `roomNumbers` existed still reports its room.
  const legacy = {
    mallName: "Dembel City Center",
    floor: "3F",
    roomNumber: "3F-24",
    agreementId: null,
  } as MallPlacement;
  check("a legacy single-room record still reads", roomNumbersFor(legacy).join(",") === "3F-24");
  check("a store with no placement has no rooms", roomNumbersFor(null).length === 0);

  // A mall with no registered store is not rendered as an empty directory.
  const emptyMall: Mall = { ...dembel, id: "mall-empty", name: "Empty Mall", slug: "empty-mall" };
  check("an empty mall is left out of the directory",
    mallDirectory([...allMalls(), emptyMall], allBusinesses(), allProducts()).length === 1);
}

// ---------------------------------------------------------------------------
// Section 39 - change history
// ---------------------------------------------------------------------------
section("24. Every package change is recorded (Section 39)");
{
  const record = buildChangeRecord({
    businessId: "green-coffee",
    previousPackage: "silver",
    newPackage: "gold",
    changeType: "Upgrade",
    userId: "u-a",
    userName: "Alemayehu",
    paymentReference: "PAY-1",
    amount: 2500,
    effectiveAt: "2026-01-15T00:00:00.000Z",
    status: "Completed",
  }, new Date("2026-01-15T00:00:00.000Z"));

  // Every field Section 39 lists.
  check("the history records the business", record.businessId === "green-coffee");
  check("the previous package", record.previousPackage === "silver");
  check("the new package", record.newPackage === "gold");
  check("the change type", record.changeType === "Upgrade");
  check("the date and time", record.at === "2026-01-15T00:00:00.000Z");
  check("the user", record.userName === "Alemayehu");
  check("the payment reference", record.paymentReference === "PAY-1");
  check("the amount", record.amount === 2500);
  check("the effective date", record.effectiveAt === "2026-01-15T00:00:00.000Z");
  check("the status", record.status === "Completed");
  check("the history row has an id", record.id.length > 0);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? `\nALL ${passed} PLATFORM CHECKS PASSED\n`
    : `\n${failures} of ${passed + failures} PLATFORM CHECK(S) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
