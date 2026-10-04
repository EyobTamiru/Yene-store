/**
 * Financial system verification - the Phase 1 contract.
 *
 *   npm run test:finance
 *
 * Covers the pure domain layer: money, the chart of accounts, double-entry
 * balancing, commission splitting, limits, earnings release and the feature
 * gates. No database, no network, no mail - every rule is a pure function, so
 * each can be tested against a literal boundary.
 *
 * WHAT IS PROVED, AND WHY IT MATTERS
 * ----------------------------------
 *  1. MONEY IS EXACT. Float arithmetic is what makes wallets lose money, so the
 *     classic `0.1 + 0.2` failure is asserted against our own money functions.
 *  2. SPLITS SUM EXACTLY. A commission split that does not add up silently
 *     creates or destroys a cent; this is tested across amounts that divide
 *     cleanly and amounts that emphatically do not.
 *  3. THE LEDGER BALANCES. Every posted transaction must satisfy
 *     debits === credits, and an unbalanced one must be impossible to build.
 *  4. DIRECTION IS DERIVED, NOT TYPED. A caller states economics, never
 *     "debit", so a sign error cannot be introduced.
 *  5. COMMISSION IS CONFIGURABLE AND BOUNDED.
 *  6. LIMITS REFUSE AT THE BOUNDARY, with a reason.
 *  7. PENDING EARNINGS CANNOT PAY OUT, and a dispute blocks release entirely.
 *  8. FINANCIAL OPERATIONS ARE OFF UNLESS EXPLICITLY ENABLED.
 *
 * The stores are redirected to a temp directory before anything imports them,
 * using DYNAMIC imports only: ES module imports are hoisted, so a static import
 * would evaluate the stores before this assignment ran - and the password-reset
 * suite already proved that failure mode is real, not theoretical.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yene-finance-"));
process.env.YENE_DATA_DIR = dataDir;
process.env.LOGIN_CODE_SECRET = "finance-verification-secret-32chars";

const {
  add,
  allocate,
  assertMinor,
  formatMoney,
  formatSigned,
  isMinor,
  MoneyError,
  mulByBps,
  neg,
  parseMoney,
  remainderAfterBps,
  sub,
  sum,
  toDecimalString,
} = await import("../src/finance/money");

const {
  COMMISSION_REVENUE_ACCOUNT,
  FREELANCER_PAYABLE_ACCOUNT,
  PROVIDER_SETTLEMENT_ACCOUNT,
  SYSTEM_ACCOUNTS,
  USER_WALLET_ACCOUNT,
  accountDefinition,
  chartOfAccounts,
} = await import("../src/finance/accounts");

const { LedgerError, assertBalanced, buildTransaction, entryFor, isBalanced, reversalEntries, signedEffect, totalFor } =
  await import("../src/finance/ledger");

const { DEFAULT_COMMISSION_RULES, MAX_COMMISSION_BPS, splitCommission } = await import(
  "../src/finance/commission"
);

const { DEFAULT_LIMITS, PAYOUT_PERMITTED_KINDS, checkDepositAllowed, checkWithdrawalAllowed, quoteWithdrawal } =
  await import("../src/finance/limits");

const { decideRelease } = await import("../src/finance/earnings");

const { financeGates, FinanceDisabledError, requireWithdrawalsEnabled } = await import(
  "../src/finance/config"
);

type WalletShape = import("../src/finance/types").Wallet;

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/** Assert that `fn` throws. Business refusals are values; this is for invariants. */
function throws(label: string, fn: () => unknown): void {
  try {
    fn();
    check(label, false, "did not throw");
  } catch {
    check(label, true);
  }
}

/** Run `fn` with specific environment variables set, then restore exactly. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}

function makeWallet(overrides: Partial<WalletShape> = {}): WalletShape {
  return {
    id: "wal-test",
    userId: "usr-test",
    kind: "customer",
    currency: "ETB",
    available: 0,
    pending: 0,
    reserved: 0,
    withheld: 0,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    totals: { deposits: 0, withdrawals: 0, purchases: 0, earnings: 0, fees: 0 },
    frozenReason: null,
    frozenBy: null,
    frozenAt: null,
    ...overrides,
  };
}


// ---------------------------------------------------------------------------
// 1. Money is exact
// ---------------------------------------------------------------------------

section("1. Money is exact integer arithmetic, never floating point");

// The failure this module exists to prevent.
check("0.1 + 0.2 really is wrong in plain JavaScript", 0.1 + 0.2 !== 0.3);
check("our equivalent is exact", add(parseMoney("0.10"), parseMoney("0.20")) === parseMoney("0.30"));

check("1000.50 parses to 100050", parseMoney("1000.50") === 100_050);
check("a bare integer is whole birrs", parseMoney("1000") === 100_000);
check("one decimal place works", parseMoney("1000.5") === 100_050);
check("a leading dot works", parseMoney(".50") === 50);
check("a thousands separator is forgiven", parseMoney("1,000.50") === 100_050);
check("surrounding space is forgiven", parseMoney(" 1000 ") === 100_000);

throws("a third decimal place is refused", () => parseMoney("10.005"));
throws("exponent notation is refused", () => parseMoney("1e3"));
throws("letters are refused", () => parseMoney("abc"));
throws("an empty amount is refused", () => parseMoney(""));
throws("a negative amount is refused by default", () => parseMoney("-50"));
check("a negative amount parses when explicitly allowed", parseMoney("-50", true) === -5_000);

throws("a fractional Minor is refused", () => assertMinor(1.5));
throws("NaN is refused", () => assertMinor(Number.NaN));
throws("Infinity is refused", () => assertMinor(Number.POSITIVE_INFINITY));
check("a whole number of cents is a Minor", isMinor(100_050));
check("a fraction is not a Minor", !isMinor(100.05));

check("toDecimalString round-trips", toDecimalString(parseMoney("1000.50")) === "1000.50");
check("toDecimalString handles a whole amount", toDecimalString(100_000) === "1000.00");
check("formatMoney groups thousands", formatMoney(100_050) === "1,000.50 ETB");
check("formatMoney drops a zero fraction", formatMoney(100_000) === "1,000 ETB");
check("formatSigned shows direction", formatSigned(100_050) === "+1,000.50 ETB");
check("neg(0) is 0, not -0", Object.is(neg(0), 0));
check("sub can go negative", sub(100, 250) === -150);

// ---------------------------------------------------------------------------
// 2. Splits sum exactly
// ---------------------------------------------------------------------------

section("2. An allocation always sums to exactly the total");

// The naive calculation loses a cent; that is the point of the module.
const naive = [Math.floor(10_000 / 3), Math.floor(10_000 / 3), Math.floor(10_000 / 3)];
check("naive three-way division loses a cent", sum(naive) !== 10_000, String(sum(naive)));
const allocated = allocate(10_000, [1, 1, 1]);
check("allocate preserves the total", sum(allocated) === 10_000, String(sum(allocated)));
check("every share is within a cent of exact", allocated.every((share) => Math.abs(share - 3_333.33) < 1));
check("the leftover cent went to exactly one share", allocated.filter((share) => share === 3_334).length === 1);

check("an even split is untouched", sum(allocate(10_000, [8_000, 2_000])) === 10_000);
check("the 80/20 split gives 8000/2000", allocate(10_000, [8_000, 2_000]).join("/") === "8000/2000");
check("a single share takes everything", allocate(999, [1])[0] === 999);
check("a zero total allocates zero", sum(allocate(0, [1, 2, 3])) === 0);
check("a negative total is preserved", sum(allocate(-10_000, [1, 1, 1])) === -10_000);
check("allocation is deterministic", allocate(10_001, [3, 3, 3]).join() === allocate(10_001, [3, 3, 3]).join());

throws("a zero weight is refused", () => allocate(100, [1, 0]));
throws("a negative weight is refused", () => allocate(100, [1, -1]));
throws("allocating money across nothing is refused", () => allocate(100, []));
check("allocating zero across nothing is allowed", allocate(0, []).length === 0);

check("20% of 70000 is 14000", mulByBps(70_000, 2_000) === 14_000);
check("rounding is half away from zero", mulByBps(1, 5_000) === 1);
check("negative rounding is symmetric", mulByBps(-1, 5_000) === -1);
check("the remainder is exact", remainderAfterBps(70_000, 2_000) === 56_000);
throws("a fractional rate is refused", () => mulByBps(100, 12.5));


// ---------------------------------------------------------------------------
// 3. The ledger balances
// ---------------------------------------------------------------------------

section("3. Every posted transaction balances, and an unbalanced one cannot be built");

const KNOWN_USERS = ["usr-customer", "usr-freelancer"];
const KNOWN_PROVIDERS = ["chapa"];

const providerAccount = accountDefinition(PROVIDER_SETTLEMENT_ACCOUNT("chapa"), KNOWN_USERS, KNOWN_PROVIDERS)!;
const walletAccount = accountDefinition(USER_WALLET_ACCOUNT("usr-customer"), KNOWN_USERS, KNOWN_PROVIDERS)!;
const payableAccount = accountDefinition(FREELANCER_PAYABLE_ACCOUNT("usr-freelancer"), KNOWN_USERS, KNOWN_PROVIDERS)!;
const commissionAccount = accountDefinition(COMMISSION_REVENUE_ACCOUNT, KNOWN_USERS, KNOWN_PROVIDERS)!;

check("a provider settlement account exists", providerAccount.accountClass === "asset");
check("a provider account is custodial", providerAccount.custodial === true);
check("a wallet is a LIABILITY, not revenue", walletAccount.accountClass === "liability");
check("a wallet is custodial", walletAccount.custodial === true);
check("a freelancer payable is a liability", payableAccount.accountClass === "liability");
check("commission is revenue", commissionAccount.accountClass === "revenue");
check("an unknown account id is refused", accountDefinition("nope:nothing", KNOWN_USERS, KNOWN_PROVIDERS) === null);
check("an unknown user is refused", accountDefinition(USER_WALLET_ACCOUNT("usr-ghost"), KNOWN_USERS, KNOWN_PROVIDERS) === null);
check("the chart grows with users and providers", chartOfAccounts(KNOWN_USERS, KNOWN_PROVIDERS).length === SYSTEM_ACCOUNTS.length + 1 + 3 * 2);

// Direction is DERIVED from the normal balance, never chosen by the caller.
const walletUp = entryFor({ accountId: walletAccount.id, amount: 100_000, walletId: "wal-1" }, walletAccount);
const walletDown = entryFor({ accountId: walletAccount.id, amount: 100_000, opposite: true }, walletAccount);
const providerUp = entryFor({ accountId: providerAccount.id, amount: 100_000 }, providerAccount);
check("increasing a liability is a CREDIT", walletUp.direction === "credit");
check("decreasing a liability is a DEBIT", walletDown.direction === "debit");
check("increasing an asset is a DEBIT", providerUp.direction === "debit");
check("signedEffect agrees with the direction", signedEffect(walletUp, walletAccount) === 100_000);
check("signedEffect negates for the other side", signedEffect(walletDown, walletAccount) === -100_000);

throws("a zero-amount leg is refused", () => entryFor({ accountId: walletAccount.id, amount: 0 }, walletAccount));
throws("a negative leg is refused", () => entryFor({ accountId: walletAccount.id, amount: -100 }, walletAccount));

// The specification's deposit example: 1,000 ETB in.
const depositEntries = [
  entryFor({ accountId: providerAccount.id, amount: 100_000 }, providerAccount),
  entryFor({ accountId: walletAccount.id, amount: 100_000, walletId: "wal-1" }, walletAccount),
];
check("the deposit example balances", isBalanced(depositEntries));
check("its debits total 100000", totalFor(depositEntries, "debit") === 100_000);
check("its credits total 100000", totalFor(depositEntries, "credit") === 100_000);

throws("an unbalanced transaction is refused", () =>
  assertBalanced([
    entryFor({ accountId: providerAccount.id, amount: 100_000 }, providerAccount),
    entryFor({ accountId: walletAccount.id, amount: 99_999, walletId: "wal-1" }, walletAccount),
  ]),
);
throws("a single-entry transaction is refused", () => assertBalanced([walletUp]));

// The purchase example: one debit, two credits. This is the shape that
// commission splitting must satisfy, and the one that silently unbalances if
// the split is wrong.
const purchaseSplit = splitCommission(70_000, "freelance-service", DEFAULT_COMMISSION_RULES);
check("700 splits to 560/140", purchaseSplit.payeeAmount === 56_000 && purchaseSplit.platformFee === 14_000);
const purchaseEntries = [
  entryFor({ accountId: walletAccount.id, amount: 70_000, opposite: true, walletId: "wal-1" }, walletAccount),
  entryFor({ accountId: payableAccount.id, amount: purchaseSplit.payeeAmount, walletId: "wal-2" }, payableAccount),
  entryFor({ accountId: commissionAccount.id, amount: purchaseSplit.platformFee }, commissionAccount),
];
check("the purchase example balances", isBalanced(purchaseEntries));
check("debits equal credits across three legs", totalFor(purchaseEntries, "debit") === totalFor(purchaseEntries, "credit"));


const goodPost = buildTransaction(
  "led-1",
  "TXN-2026-000001",
  {
    type: "deposit",
    entries: depositEntries,
    sourceKind: "deposit",
    sourceId: "dep-1",
    description: "Wallet top-up",
    createdBy: "deposit-service",
    userId: "usr-customer",
  },
  "2026-01-01T00:00:00.000Z",
);
check("a balanced transaction builds", goodPost.reference === "TXN-2026-000001");
check("a built transaction is posted", goodPost.status === "posted");

throws("buildTransaction refuses an unbalanced posting", () =>
  buildTransaction(
    "led-2",
    "TXN-2026-000002",
    {
      type: "deposit",
      entries: [
        entryFor({ accountId: providerAccount.id, amount: 100_000 }, providerAccount),
        entryFor({ accountId: walletAccount.id, amount: 90_000, walletId: "wal-1" }, walletAccount),
      ],
      sourceKind: "deposit",
      sourceId: "dep-2",
      description: "Broken",
      createdBy: "deposit-service",
    },
    "2026-01-01T00:00:00.000Z",
  ),
);

// A PENDING transaction may be unbalanced, because it moves no money yet. That
// is the loophole which lets a deposit sit unverified without crediting anyone.
const pendingPost = buildTransaction(
  "led-3",
  "TXN-2026-000003",
  {
    type: "deposit",
    entries: [entryFor({ accountId: walletAccount.id, amount: 100_000, walletId: "wal-1" }, walletAccount)],
    sourceKind: "deposit",
    sourceId: "dep-3",
    description: "Awaiting provider confirmation",
    createdBy: "deposit-service",
    status: "pending",
  },
  "2026-01-01T00:00:00.000Z",
);
check("a pending transaction may be unbalanced", pendingPost.status === "pending");
check("but it is NOT a balanced posting", !isBalanced(pendingPost.entries));

// A reversal flips every leg and is balanced by construction.
const reversed = reversalEntries(goodPost);
check("a reversal balances", isBalanced(reversed));
check("a reversal swaps debit and credit", reversed[0].direction === "credit" && reversed[1].direction === "debit");

// ---------------------------------------------------------------------------
// 4. Commission is configurable and bounded
// ---------------------------------------------------------------------------

section("4. Commission comes from configuration and cannot be set absurd");

check("the default freelance rate is 20%", splitCommission(70_000, "freelance-service", []).platformFee === 14_000);
check(
  "a stored rule overrides the default",
  splitCommission(70_000, "freelance-service", [
    { category: "freelance-service", bps: 1000, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" },
  ]).platformFee === 7_000,
);
check("a zero rate pays the payee everything", splitCommission(70_000, "special-agreement", []).payeeAmount === 70_000);
check("every default category has a rule", DEFAULT_COMMISSION_RULES.length === 5);
check("rates are within the permitted maximum", DEFAULT_COMMISSION_RULES.every((rule) => rule.bps <= MAX_COMMISSION_BPS));
throws("an unknown category is refused", () => splitCommission(100, "not-a-category" as never, []));
throws("an out-of-range rate is refused", () =>
  splitCommission(100, "product", [
    { category: "product", bps: 9_999, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" },
  ]),
);

// The awkward amounts, where a naive split loses a cent.
for (const gross of [1, 3, 7, 10_001, 33_333, 99_999, 1_000_001]) {
  const split = splitCommission(gross, "freelance-service", []);
  check(
    `a ${gross / 100} ETB split sums exactly`,
    split.platformFee + split.payeeAmount === gross && sum([split.platformFee, split.payeeAmount]) === gross,
    `${split.platformFee} + ${split.payeeAmount} != ${gross}`,
  );
}


// ---------------------------------------------------------------------------
// 5. Limits refuse at the boundary, with a reason
// ---------------------------------------------------------------------------

section("5. Limits refuse at the boundary and always say why");

const limits = DEFAULT_LIMITS;
const FEE = { bps: 200, flat: 0 };

// Deposit boundaries: exactly at the minimum, and one cent below it.
const atMin = checkDepositAllowed(makeWallet(), limits.deposit.min, 0, limits);
const belowMin = checkDepositAllowed(makeWallet(), limits.deposit.min - 1, 0, limits);
const atMax = checkDepositAllowed(makeWallet(), limits.deposit.max, 0, limits);
const aboveMax = checkDepositAllowed(makeWallet(), limits.deposit.max + 1, 0, limits);
check("a deposit at the minimum is allowed", atMin.allowed, atMin.reason ?? "");
check("one cent below the minimum is refused", !belowMin.allowed && belowMin.code === "below-minimum");
check("a deposit at the maximum is allowed", atMax.allowed, atMax.reason ?? "");
check("one cent above the maximum is refused", !aboveMax.allowed && aboveMax.code === "above-maximum");
check("every refusal carries a reason", Boolean(belowMin.reason && aboveMax.reason));

// The daily limit is an aggregate, so it is tested with an amount that is
// individually legal. Passing the daily figure as the amount would trip the
// per-deposit maximum first and prove nothing about the daily rule.
const overDaily = checkDepositAllowed(makeWallet(), 400_000_00, 700_000_00, limits);
check("exceeding the daily deposit limit is refused", !overDaily.allowed && overDaily.code === "daily-limit");
const underDaily = checkDepositAllowed(makeWallet(), 400_000_00, 100_00, limits);
check("a deposit inside the daily limit is allowed", underDaily.allowed, underDaily.reason ?? "");

const overCeiling = checkDepositAllowed(makeWallet({ available: limits.walletCeiling }), 100_00, 0, limits);
check("exceeding the wallet ceiling is refused", !overCeiling.allowed && overCeiling.code === "ceiling-exceeded");

const frozen = checkDepositAllowed(makeWallet({ status: "frozen", frozenReason: "AML review" }), 100_00, 0, limits);
check("a frozen wallet refuses a deposit", !frozen.allowed && frozen.code === "wallet-frozen");
check("the freeze reason is shown to the user", (frozen.reason ?? "").includes("AML review"));

// Withdrawal boundaries. The specification's 500/10/490 worked example.
const quote = quoteWithdrawal(50_000, FEE, limits);
check(
  "the 500/10/490 example reconciles",
  "requested" in quote && quote.requested === 50_000 && quote.fee === 1_000 && quote.net === 49_000,
);
check("requested minus fee equals net", "net" in quote && quote.requested - quote.fee === quote.net);
const zeroNet = quoteWithdrawal(10, { bps: 10_000, flat: 0 }, limits);
check("a net of zero is refused", !("requested" in zeroNet));
const flatFee = quoteWithdrawal(10_000, { bps: 0, flat: 500 }, limits);
check("a flat fee is applied", "net" in flatFee && flatFee.fee === 500 && flatFee.net === 9_500);

// A freelancer with plenty of PENDING but nothing available must be refused -
// this is the rule that makes Part 5 enforceable rather than advisory.
const pendingOnly = checkWithdrawalAllowed(
  makeWallet({ kind: "freelancer", available: 0, pending: 5_000_000 }),
  10_000,
  0,
  FEE,
  limits,
);
check("pending earnings cannot fund a withdrawal", !pendingOnly.allowed && pendingOnly.code === "insufficient-balance");

const exactBalance = checkWithdrawalAllowed(
  makeWallet({ kind: "freelancer", available: 10_000, pending: 5_000_000 }),
  10_000,
  0,
  FEE,
  limits,
);
check("spending the whole available balance IS allowed", exactBalance.allowed, exactBalance.reason ?? "");

const customerWallet = checkWithdrawalAllowed(
  makeWallet({ kind: "customer", available: 999_999_00 }),
  10_000,
  0,
  FEE,
  limits,
);
check("a customer wallet cannot withdraw", !customerWallet.allowed && customerWallet.code === "payout-not-permitted");
check("freelancer, seller and business may pay out", PAYOUT_PERMITTED_KINDS.length === 3);

const overDailyWithdrawal = checkWithdrawalAllowed(
  makeWallet({ kind: "freelancer", available: limits.withdrawal.daily }),
  limits.withdrawal.daily,
  1,
  FEE,
  limits,
);
check("exceeding the daily withdrawal limit is refused", !overDailyWithdrawal.allowed);


// ---------------------------------------------------------------------------
// 6. Earnings release rules
// ---------------------------------------------------------------------------

section("6. Earnings only release when every configured gate is satisfied");

const DAY = 24 * 60 * 60 * 1000;
const completedAt = "2026-01-01T00:00:00.000Z";

const notComplete = decideRelease(
  { completed: false, customerApproved: true, disputed: false, adminApproved: true, completedAt: null, gross: 10_000 },
  undefined,
  Date.parse(completedAt) + 30 * DAY,
);
check("an incomplete job does not release", !notComplete.releasable);
check("it reports the missing gate", (notComplete.reason ?? "").includes("completed"));

const notApproved = decideRelease(
  { completed: true, customerApproved: false, disputed: false, adminApproved: true, completedAt, gross: 10_000 },
  undefined,
  Date.parse(completedAt) + 30 * DAY,
);
check("an unapproved job does not release", !notApproved.releasable);
check("it reports the missing approval", (notApproved.reason ?? "").includes("approval"));

// Exactly at the boundary: the window closes AT completedAt + 7 days.
const atBoundary = decideRelease(
  { completed: true, customerApproved: true, disputed: false, adminApproved: true, completedAt, gross: 10_000 },
  undefined,
  Date.parse(completedAt) + 7 * DAY,
);
check("the window closes exactly at 7 days", atBoundary.releasable, atBoundary.reason ?? "");

const oneMsEarly = decideRelease(
  { completed: true, customerApproved: true, disputed: false, adminApproved: true, completedAt, gross: 10_000 },
  undefined,
  Date.parse(completedAt) + 7 * DAY - 1,
);
check("one millisecond early does NOT release", !oneMsEarly.releasable);
check("and it says when it will", Boolean(oneMsEarly.releasableAt));

// A dispute overrides everything, including an administrator approval.
const disputed = decideRelease(
  { completed: true, customerApproved: true, disputed: true, adminApproved: true, completedAt, gross: 10_000 },
  undefined,
  Date.parse(completedAt) + 365 * DAY,
);
check("a dispute blocks release however complete the job is", !disputed.releasable);
check("the dispute reason is explicit", (disputed.reason ?? "").includes("dispute"));

// A high-value job needs a human even though the configured gates do not.
const highValue = decideRelease(
  { completed: true, customerApproved: true, disputed: false, adminApproved: false, completedAt, gross: 5_000_000_00 },
  undefined,
  Date.parse(completedAt) + 30 * DAY,
);
check("a high-value job requires an administrator review", !highValue.releasable);
check("the review gate is reported", highValue.gates.some((gate) => gate.gate === "adminReview"));

const lowValueReviewed = decideRelease(
  { completed: true, customerApproved: true, disputed: false, adminApproved: true, completedAt, gross: 10_000 },
  undefined,
  Date.parse(completedAt) + 30 * DAY,
);
check("a low-value job releases once its window closes", lowValueReviewed.releasable);

// The window starts at COMPLETION, so a job that took a month to deliver still
// gets its full window afterwards.
const longJob = decideRelease(
  {
    completed: true,
    customerApproved: true,
    disputed: false,
    adminApproved: true,
    completedAt: "2026-03-01T00:00:00.000Z",
    gross: 10_000,
  },
  undefined,
  Date.parse("2026-03-08T00:00:00.000Z"),
);
check("a job that finished late still gets its full window", longJob.releasable, longJob.reason ?? "");


// ---------------------------------------------------------------------------
// 7. Financial operations are off unless enabled
// ---------------------------------------------------------------------------

section("7. Financial operations are OFF unless explicitly enabled");

withEnv({ FINANCE_ENABLED: undefined, NODE_ENV: "production", FINANCE_PRODUCTION_APPROVED: undefined }, () => {
  const gates = financeGates();
  check("finance is off when nothing is set", gates.enabled === false);
  check("the mode reads as off", gates.mode === "off");
  check("there is a reason to show the user", gates.disabledReason.length > 0);
});

withEnv({ FINANCE_ENABLED: "true", NODE_ENV: "production", FINANCE_PRODUCTION_APPROVED: undefined }, () => {
  const gates = financeGates();
  check("production refuses finance without the approval switch", gates.enabled === false);
  check("and says exactly what is missing", gates.disabledReason.includes("FINANCE_PRODUCTION_APPROVED"));
});

withEnv({ FINANCE_ENABLED: "true", NODE_ENV: "production", FINANCE_PRODUCTION_APPROVED: "true" }, () => {
  const gates = financeGates();
  check("an approved production deployment may enable finance", gates.enabled === true);
  check("the mode reads as production", gates.mode === "production");
});

withEnv({ FINANCE_ENABLED: "true", NODE_ENV: "development", FINANCE_PRODUCTION_APPROVED: undefined }, () => {
  const gates = financeGates();
  check("development may enable finance without the approval switch", gates.enabled === true);
  check("the mode reads as sandbox", gates.mode === "sandbox");
});

withEnv({ FINANCE_ENABLED: "true", NODE_ENV: "development", FINANCE_WITHDRAWALS_ENABLED: "false" }, () => {
  const gates = financeGates();
  check(
    "withdrawals can be held back independently of everything else",
    gates.enabled === true && gates.withdrawals === false,
  );
  let refused = false;
  try {
    requireWithdrawalsEnabled();
  } catch (error) {
    refused = error instanceof FinanceDisabledError;
  }
  check("a gated operation refuses when its own switch is off", refused);
});

withEnv({ FINANCE_ENABLED: undefined, NODE_ENV: "development" }, () => {
  let refused = false;
  try {
    requireWithdrawalsEnabled();
  } catch (error) {
    refused = error instanceof FinanceDisabledError;
  }
  check("a gated operation refuses when finance is off entirely", refused);
});

// The shipped defaults must be safe: a fresh clone cannot move money.
withEnv({ FINANCE_ENABLED: undefined, FINANCE_DEPOSITS_ENABLED: undefined, FINANCE_WITHDRAWALS_ENABLED: undefined }, () => {
  const gates = financeGates();
  check("a fresh clone has deposits off", gates.deposits === false);
  check("a fresh clone has withdrawals off", gates.withdrawals === false);
});

// ---------------------------------------------------------------------------
console.log("");
if (failures === 0) {
  console.log("ALL FINANCIAL CHECKS PASSED");
} else {
  console.log(`${failures} FINANCIAL CHECK(S) FAILED`);
  process.exit(1);
}

// Referenced so the imports are not dropped as unused.
void MoneyError;
void LedgerError;
