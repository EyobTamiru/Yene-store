import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { knowledgeAdminRouter as kbAdminRouter } from "./api/admin/knowledge";
import { liveRouter } from "./api/live/router";
import { liveStaffRouter } from "./api/live-staff/router";
import { supportAdminRouter } from "./api/support-admin/router";
import { supportRouter } from "./api/support/router";
import { platformRouter } from "./api/platform/router";
import { authRouter } from "./api/auth/router";
import { verifyRouter } from "./api/verify/router";
import { rentalRouter } from "./api/rental/router";
import { mediaRouter } from "./api/media/router";
import { mediaUploadRouter } from "./api/media/upload";
import { musicRouter } from "./api/media/music";
import { rentalOutRouter } from "./api/platform/rentalOutRouter";
import { managementRouter } from "./api/management/router";
import { walletRouter } from "./api/finance/router";
import { buildDeliveryApi } from "./api/delivery";
import { seedUsersFromBusinesses, seedBootstrapAccounts, describeSeeded } from "./api/auth/store";
import { externalVerificationConfigured } from "./api/verify/provider";
import { googleConfigured, yotiConfigured } from "./api/auth/identity";
import { mapService } from "./src/delivery/maps";
import { proofSecretIsConfigured as deliveryProofSecretConfigured } from "./src/delivery/proof";

/** True when a map provider with its credentials is actually selected. */
function deliveryMapConfigured(): boolean {
  return mapService().isConfigured();
}

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();

  // Identity verification accepts base64 document images, so it needs a larger
  // body than the 64kb default below. It is mounted FIRST, with its own parser,
  // because Express applies middleware in registration order and the first
  // match wins: if the global 64kb parser ran first it would reject every
  // document upload with a bare 413 before the verify router was ever reached.
  // The 8mb ceiling is a backstop against an unbounded payload; the real limit
  // is the 4MB-per-image check inside api/verify/router.ts.
  app.use("/api/verify", express.json({ limit: "8mb" }), verifyRouter);

  // Section 10/41: renting a counter in a mall. Mounted before the global JSON
  // parser for the same reason the verify router is - a rental application
  // carries no images, but keeping the pair together means a future upload on
  // this route cannot be silently truncated by the 64kb limit below.
  app.use("/api/rental", express.json({ limit: "16kb" }), rentalRouter);

  // Storefront artwork and product images. A dedicated route rather than a
  // static mount on `data/`, which also holds uploaded identity documents.
  app.use("/api/media", mediaRouter);

  // Media UPLOAD (Section 55). Mounted with its own body parser BEFORE the global
  // 64 KB one below, for the same reason the verify router is: Express applies
  // middleware in registration order and the first match wins, so the global
  // parser would reject every video as a bare 413 before this router was reached.
  // Base64 costs ~33% overhead and is used rather than pretending; the real limit
  // is the per-package ceiling enforced inside the router.
  app.use("/api/media", express.json({ limit: "12mb" }), mediaUploadRouter);

  //
  // Its OWN body parser, and that is not defensive tidiness: both mounts here sit
  // ABOVE the global express.json() below, and Express applies middleware in
  // registration order with the first match winning. Without one, a POST arrives
  // with req.body empty, every field reads as undefined, and the route answers
  // "Give the slot a name" to a request that plainly carried one - which is exactly
  // what happened when this was first mounted.
  // The storefront music library (Section 55). Read-only for businesses: tracks
  // are licensed and supplied by Yene Business Group, never uploaded per store.
  app.use("/api/media", express.json({ limit: "16kb" }), musicRouter);

  // Renting a storefront slot to another business (Section 55). Separate from
  // Same parser reason as the music mount above.
  app.use("/api/platform/rental-out", express.json({ limit: "16kb" }), rentalOutRouter);

  // The Management System. Mounted alongside the platform routes rather than
  // inside them, and it takes NO tenant from the request: every figure it
  // returns is scoped by the businessId inside the session cookie.
  app.use("/api/management", managementRouter);

  // Keep a modest body limit: the only payload is a short chat message.
  app.use(express.json({ limit: "64kb" }));
  // The signup form is the largest payload on the platform.
  app.use("/api/auth", express.json({ limit: "16kb" }));

  // Security headers. The support bot renders no remote content and holds no
  // cookies, so a strict policy costs nothing here.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Yene AI Support
  app.use("/api/support", supportRouter);

  // Knowledge base administration (authorized Yene administrators only)
  app.use("/api/admin", kbAdminRouter);

  // Customer Support dashboard (Yene Business Group support staff only)
  app.use("/api/support-admin", supportAdminRouter);

  // YENE-STORE platform (Sections 10-55). Mounted alongside - not inside - the
  // support routes, so Sections 1-9 are untouched.
  app.use("/api/platform", platformRouter);

  // The financial system (read path only so far). Mounted alongside the
  // platform rather than inside it, and it creates NO data until it is called:
  // the wallets and ledger stores are new files, so enabling this module cannot
  // touch an existing collection. It is also gated at runtime by
  // FINANCE_ENABLED, which defaults to OFF - see src/finance/config.ts.
  app.use("/api/wallet", walletRouter);

  // Email-token authentication (Sections 1-9 of the auth specification).
  // Seeded from the existing businesses, additively - it only appends users.
  seedUsersFromBusinesses();
  // The shipped super-admin and demo store-owner accounts, with hashed
  // passwords. Additive and idempotent, and disabled in production unless
  // BOOTSTRAP_ACCOUNTS_ENABLED is explicitly "true".

  // YENE DELIVERY. Mounted on its own prefix alongside every other module, so
  // removing it later is deleting one line - the delivery module references
  // NOTHING here, and nothing existing was modified to accommodate it. The
  // search sweeper (expired offers re-dispatched) is owned by the module itself.
  app.use("/api/delivery", buildDeliveryApi());
  const bootstrapped = seedBootstrapAccounts();
  app.use("/api/auth", authRouter);

  // Live chat: customer side, and the agent side
  app.use("/api/live", liveRouter);
  app.use("/api/live-staff", liveStaffRouter);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`YENE-STORE running on http://localhost:${PORT}`);
    console.log(`  Marketplace (Sections 10-55)  http://localhost:${PORT}/#/marketplace`);
    console.log(`  Yene AI Support (Sections 1-9) http://localhost:${PORT}/#/support`);
    if (bootstrapped.length > 0) {
      // Emails only. The passwords are known development defaults and are
      // never logged, but the warning below is what stops them being left in
      // place on a public deployment.
      console.log(`  Seeded accounts (development): ${describeSeeded(bootstrapped)}`);
      console.warn(
        "These accounts use well-known development passwords. Change them, or set " +
          'BOOTSTRAP_ACCOUNTS_ENABLED="false" with real accounts, before exposing this server.',
      );
    }
    if (!process.env.GEMINI_API_KEY) {
      console.warn(
        "GEMINI_API_KEY is not set - the assistant will reply with the 'temporarily unavailable' message.",
      );
    }
    if (!process.env.YENE_KB_ADMIN_TOKEN || process.env.YENE_KB_ADMIN_TOKEN.startsWith("CHANGE_ME")) {
      console.warn(
        "YENE_KB_ADMIN_TOKEN is not set - the knowledge base admin API is locked (this is the safe default).",
      );
    }
    // These three gate optional identity features. Reporting them at startup
    // is better than letting a user discover a disabled button at the moment
    // they try to sign in.
    if (!googleConfigured()) {
      console.warn(
        "GOOGLE_CLIENT_ID is not set - 'Continue with Google' is unavailable. The password and email-code sign-ins still work.",
      );
    }
    if (!yotiConfigured()) {
      console.warn(
        "YOTI_API_KEY is not set - Yoti ID verification is unavailable. Submissions are held for manual review instead.",
      );
    }
    // Delivery: the map provider and the proof secret are the two settings that
    // turn a working deployment into a wrong one silently, so they are reported
    // at boot rather than discovered at the customer's door.
    if (!deliveryMapConfigured()) {
      console.warn(
        "DELIVERY_MAP_PROVIDER is not set - delivery distances and times are straight-line " +
          "estimates, not road routes. Set it (see .env.example) for production.",
      );
    }
    if (!deliveryProofSecretConfigured()) {
      console.warn(
        "DELIVERY_PROOF_SECRET is not set - delivery confirmation codes will not verify across a " +
          'restart or across more than one server instance. Set it before accepting live deliveries.',
      );
    }
    if (!externalVerificationConfigured()) {
      console.warn(
        "ETRADE_VERIFY_URL / ETRADE_API_KEY are not set - Fayda ID and TIN cannot be checked automatically, so they stay 'pending-review' until a super admin approves them.",
      );
    }
  });
}

startServer();
