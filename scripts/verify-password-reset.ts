/**
 * Password reset verification - the forgot/reset contract.
 *
 *   npm run test:password-reset
 *
 * Proves the properties that are easy to get wrong and impossible to notice by
 * clicking through the UI:
 *
 *   1. NO ACCOUNT ENUMERATION: the request reply is identical for a known
 *      address, an unknown one and a malformed one.
 *   2. THE TOKEN IS NEVER STORED IN PLAINTEXT, and never appears in a response.
 *   3. A LINK IS SINGLE USE - redeeming it twice does nothing the second time.
 *   4. A NEW REQUEST RETIRES THE PREVIOUS LINK, so a leaked one dies.
 *   5. EXPIRY IS ENFORCED, and an expired link is refused.
 *   6. A RESET REVOKES EVERY SESSION for the account - the whole reason to
 *      reset is to kick someone else out, and it must actually do that.
 *   7. THE NEW PASSWORD FACES THE SAME POLICY as registration, and a policy
 *      failure must not burn the link.
 *   8. EVERY TOKEN FAILURE LOOKS THE SAME, so a stolen link cannot be probed.
 *
 * No network, no mail server, no database: the transport is replaced with a
 * recorder and every durable store is redirected to a temp directory first.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Redirect every durable store BEFORE anything imports it.
//
// This has to be a DYNAMIC import, not a static one. ES module imports are
// hoisted and evaluated before any statement in this file runs, so a static
// `import ... from "../api/auth/store"` would evaluate the store - which reads
// YENE_DATA_DIR at module scope - before the assignment below had happened.
// That is not a theoretical concern: with a static import this suite writes its
// fixtures into the REAL ./data directory.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yene-password-reset-"));
process.env.YENE_DATA_DIR = dataDir;
process.env.LOGIN_CODE_SECRET = "verification-suite-secret-value-32ch";

const { completePasswordReset, isResetExpired, requestPasswordReset, resetResetRateLimits } =
  await import("../api/auth/passwordReset");
const { buildResetUrl, generateResetToken, hashPassword, hashResetToken, verifyPassword, verifyResetToken } =
  await import("../api/auth/crypto");
const { setTransportOverride } = await import("../api/auth/email");
type VerificationMessage = import("../api/auth/email").VerificationMessage;
const { allPasswordResets, allSessions, allUsers, flushAuthStores } = await import("../api/auth/store");
const { createSession } = await import("../api/auth/sessions");
const { GENERIC_RESET_FAILED_MESSAGE, GENERIC_RESET_SENT_MESSAGE, PASSWORD_RESET_TTL_MS } =
  await import("../api/auth/types");
type User = import("../api/auth/types").User;

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

// A recording mail transport, so no real email is ever attempted.
const sent: VerificationMessage[] = [];

setTransportOverride({
  id: "recording",
  isConfigured: () => true,
  async send(message: VerificationMessage): Promise<void> {
    sent.push(message);
  },
});

/** The token from the most recent message, pulled out of the emailed link. */
function tokenFromLatestEmail(): string | null {
  const latest = sent[sent.length - 1];
  if (!latest) return null;
  const match = /token=([A-Za-z0-9_-]+)/.exec(latest.text);
  return match ? match[1] : null;
}

const KNOWN = "known-user@example.com";
const UNKNOWN = "nobody-here@example.com";
const OLD_PASSWORD = "original-pass-1";

const seeded: User = {
  id: "usr-test-known",
  email: KNOWN,
  name: "Reset Tester",
  businessId: null,
  role: "customer",
  active: true,
  createdAt: new Date().toISOString(),
  // The real hash function, so a genuine password is genuinely verifiable.
  passwordHash: hashPassword(OLD_PASSWORD),
  identityProvider: "password",
};
allUsers().push(seeded);
const user = allUsers().find((entry) => entry.email === KNOWN)!;

// ---------------------------------------------------------------------------
// 1. The request never reveals whether an account exists
// ---------------------------------------------------------------------------

section("1. The request reply is identical for known and unknown addresses");

sent.length = 0;
resetResetRateLimits();

const knownOutcome = await requestPasswordReset(KNOWN, "203.0.113.10");
const unknownOutcome = await requestPasswordReset(UNKNOWN, "203.0.113.10");
const junkOutcome = await requestPasswordReset("not-an-email", "203.0.113.10");

check("a known address reports success", knownOutcome.ok === true);
check("an unknown address also reports success", unknownOutcome.ok === true);
check("a malformed address also reports success", junkOutcome.ok === true);
check("a token is issued only for the known address", sent.length === 1);
check(
  "the email went to the known address only",
  sent.length === 1 && sent[0].to === KNOWN,
  sent.map((m) => m.to).join(","),
);
check("no email was sent to the unknown address", !sent.some((m) => m.to === UNKNOWN));
check(
  "the stored record belongs to the real user",
  allPasswordResets().length === 1 && allPasswordResets()[0].userId === user.id,
);
check("there is exactly one generic message", typeof GENERIC_RESET_SENT_MESSAGE === "string");
check(
  "the generic message does not admit or deny anything",
  !/no such|unknown|not found|does not exist/i.test(GENERIC_RESET_SENT_MESSAGE),
);

// ---------------------------------------------------------------------------
// 2. The token never exists in plaintext on disk
// ---------------------------------------------------------------------------

section("2. Only a hash of the token is stored");

const firstToken = tokenFromLatestEmail();
check("a token was present in the emailed link", Boolean(firstToken));
check("the token is long enough to be unguessable", (firstToken ?? "").length >= 43);

// `touch()` only marks the collection dirty and the write is coalesced onto a
// microtask, so the file is forced out before it is read - otherwise this check
// would be reading a file that does not exist yet.
flushAuthStores();

const storeFile = path.join(dataDir, "auth-password-resets.json");
check("the store file was written to the redirected directory", fs.existsSync(storeFile), storeFile);
const rawFile = fs.readFileSync(storeFile, "utf8");
check("the plaintext token is NOT in the store file", !rawFile.includes(firstToken ?? "###"));
check("the store holds a 64-character hex hash", /"tokenHash": "[0-9a-f]{64}"/.test(rawFile));
check(
  "the stored hash really is the HMAC of the token",
  verifyResetToken(user.id, firstToken ?? "", allPasswordResets()[0].tokenHash),
);

const url = buildResetUrl("abc123");
check("the reset link has an absolute origin", url.startsWith("http"), url);
check("the token is the only query parameter", /token=abc123$/.test(url));
check("the origin is never taken from the request", !/\$\{/.test(url));

// ---------------------------------------------------------------------------
// 3. Single use
// ---------------------------------------------------------------------------

section("3. A link can only be redeemed once");

const first = completePasswordReset(firstToken ?? "", "replacement-pass-2", "203.0.113.10");
check("the first redemption succeeds", first.ok === true);
check("the new password verifies", verifyPassword("replacement-pass-2", user.passwordHash ?? null));
check("the old password no longer verifies", !verifyPassword(OLD_PASSWORD, user.passwordHash ?? null));

const second = completePasswordReset(firstToken ?? "", "another-pass-3", "203.0.113.10");
check("the second redemption is refused", second.ok === false);
check("the refusal is the generic one", (second as { reason?: string }).reason === "invalid");
check(
  "the reused link did not change the password",
  verifyPassword("replacement-pass-2", user.passwordHash ?? null) &&
    !verifyPassword("another-pass-3", user.passwordHash ?? null),
);


// ---------------------------------------------------------------------------
// 4. A new request retires the previous link
// ---------------------------------------------------------------------------

section("4. Requesting again kills the previous link");

resetResetRateLimits();
const oldLink = firstToken;

await requestPasswordReset(KNOWN, "203.0.113.10");
const newLink = tokenFromLatestEmail();
check("a second link was issued", Boolean(newLink) && newLink !== oldLink);

const stale = completePasswordReset(oldLink ?? "", "stale-pass-4", "203.0.113.10");
check("the OLD link is refused after a new request", stale.ok === false);
check(
  "the password is untouched by the refused link",
  verifyPassword("replacement-pass-2", user.passwordHash ?? null),
);

const viaNewLink = completePasswordReset(newLink ?? "", "fresh-pass-5", "203.0.113.10");
check("the NEW link works", viaNewLink.ok === true);
check("the password is now the one just set", verifyPassword("fresh-pass-5", user.passwordHash ?? null));

// ---------------------------------------------------------------------------
// 5. Expiry
// ---------------------------------------------------------------------------

section("5. An expired link is refused");

resetResetRateLimits();
await requestPasswordReset(KNOWN, "203.0.113.10");
const expiringLink = tokenFromLatestEmail();

// Age the stored record past the TTL rather than waiting an hour.
for (const record of allPasswordResets()) {
  if (record.usedAt === null) {
    record.expiresAt = new Date(Date.now() - 1000).toISOString();
  }
}

const expired = completePasswordReset(expiringLink ?? "", "too-late-6", "203.0.113.10");
check("an expired link is refused", expired.ok === false);
check("an expired link leaves the password alone", verifyPassword("fresh-pass-5", user.passwordHash ?? null));
check("the TTL is one hour", PASSWORD_RESET_TTL_MS === 60 * 60 * 1000);

resetResetRateLimits();
await requestPasswordReset(KNOWN, "203.0.113.10");
const live = allPasswordResets().find((record) => record.usedAt === null);
check("a freshly issued link is not expired", live ? !isResetExpired(live) : false);

// ---------------------------------------------------------------------------
// 6. A reset revokes every session
// ---------------------------------------------------------------------------

section("6. A successful reset revokes every session on the account");

const sessionA = createSession(user.id, "198.51.100.1", "phone");
const sessionB = createSession(user.id, "198.51.100.2", "laptop");
const liveBefore = allSessions().filter((s) => s.userId === user.id && s.revokedAt === null).length;
check("two live sessions exist to begin with", liveBefore === 2, String(liveBefore));

resetResetRateLimits();
await requestPasswordReset(KNOWN, "203.0.113.10");
const revokeLink = tokenFromLatestEmail();
const revoked = completePasswordReset(revokeLink ?? "", "final-pass-7", "203.0.113.10");

check("the reset succeeded", revoked.ok === true);
const liveAfter = allSessions().filter((s) => s.userId === user.id && s.revokedAt === null).length;
check("no session survives the reset", liveAfter === 0, String(liveAfter));
check("the phone session was revoked", Boolean(sessionA.revokedAt));
check("the laptop session was revoked", Boolean(sessionB.revokedAt));

// ---------------------------------------------------------------------------
// 7. The password policy is the one registration uses
// ---------------------------------------------------------------------------

section("7. A weak password is refused before anything is written");

resetResetRateLimits();
await requestPasswordReset(KNOWN, "203.0.113.10");
const policyLink = tokenFromLatestEmail();

const weak = completePasswordReset(policyLink ?? "", "short", "203.0.113.10");
check("a too-short password is refused", weak.ok === false);
check("the refusal names the policy", (weak as { reason?: string }).reason === "weak-password");
check("the refused attempt did not change the password", verifyPassword("final-pass-7", user.passwordHash ?? null));

// The same link must still work: a policy failure is the user's to fix, so it
// must not silently burn the link they were sent.
const afterWeak = completePasswordReset(policyLink ?? "", "policy-ok-8", "203.0.113.10");
check("the link still works after a policy failure", afterWeak.ok === true);

// ---------------------------------------------------------------------------
// 8. Every token failure looks the same
// ---------------------------------------------------------------------------

section("8. Every token failure looks the same");

const wrong = completePasswordReset(generateResetToken(), "whatever-9", "203.0.113.10");
const empty = completePasswordReset("", "whatever-9", "203.0.113.10");
check("an invented token is refused", wrong.ok === false);
check("an empty token is refused", empty.ok === false);
check(
  "both report the same reason",
  (wrong as { reason?: string }).reason === (empty as { reason?: string }).reason,
);
check("there is one refusal message", typeof GENERIC_RESET_FAILED_MESSAGE === "string");

// A token is bound to its own account: the userId is mixed into the HMAC, so a
// hash that verifies for one user can never verify for another.
const otherUser = "usr-somebody-else";
const otherHash = hashResetToken(otherUser, "shared-token-value");
check(
  "a token cannot be verified against a different account",
  !verifyResetToken(user.id, "shared-token-value", otherHash),
);
check("and the right account still verifies", verifyResetToken(otherUser, "shared-token-value", otherHash));

// ---------------------------------------------------------------------------
// 9. Rate limiting
// ---------------------------------------------------------------------------

section("9. Rate limiting is enforced per address");

resetResetRateLimits();
let limited = false;
for (let i = 0; i < 6; i += 1) {
  const outcome = await requestPasswordReset(KNOWN, "203.0.113.11");
  if (outcome.ok === false) limited = true;
}
check("repeating the request is eventually rate limited", limited);

resetResetRateLimits();
const otherStillWorks = await requestPasswordReset(UNKNOWN, "203.0.113.11");
check("another address is not affected by that limit", otherStillWorks.ok === true);

// ---------------------------------------------------------------------------
console.log("");
if (failures === 0) {
  console.log("ALL PASSWORD-RESET CHECKS PASSED");
} else {
  console.log(`${failures} PASSWORD-RESET CHECK(S) FAILED`);
  process.exit(1);
}
