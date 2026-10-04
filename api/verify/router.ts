/**
 * ============================================================================
 *  IDENTITY VERIFICATION ROUTER
 * ============================================================================
 *
 *  Mounted at /api/verify. Every route except the admin ones requires a signed
 *  -in session, and every one works on the CALLER'S OWN record only. There is
 *  no route that takes a userId from the request - the user is read from the
 *  session cookie, exactly as in the platform routes, so a caller can never
 *  read or alter someone else's verification.
 *
 *    GET  /me                     my verification status
 *    POST /profile                submit Fayda ID + TIN + name + phone
 *    POST /document               upload the Fayda front or back image
 *    GET  /document/:side         read back my own image
 *    GET  /queue                  super admin: everything awaiting review
 *    POST /review/:id             super admin: approve or reject
 *
 *  DOCUMENT HANDLING
 *  -----------------
 *  Images arrive base64-encoded in JSON rather than as multipart, which keeps
 *  the project dependency-free. Each is capped at 4 MB and must be JPEG, PNG or
 *  WebP. They are written under the data dir - NOT the web root - and are only
 *  ever served back through the ownership-checked route above. A Fayda card is
 *  a government identity document, so it is never exposed as a static file.
 */

import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveAuthContext } from "../auth/sessions";
import { allUsers, persistUsers } from "../auth/store";
import { SESSION_COOKIE } from "../auth/types";
import { verifyWithProvider, externalVerificationConfigured } from "./provider";
import {
  allVerifications,
  isApprovedForRental,
  isValidFaydaId,
  normalizeTin,
  persistVerifications,
  publicVerification,
  uploadsDir,
  verificationForUser,
  type FaydaDocuments,
  type VerificationRecord,
} from "./store";

export const verifyRouter = Router();

/** 4 MB decoded. Generous for a phone photo, small enough to bound memory. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Resolve the caller, or answer 401. */
function caller(req: Request, res: Response) {
  const context = resolveAuthContext(req, SESSION_COOKIE);
  if (!context) {
    res.status(401).json({ error: "Please sign in to continue." });
    return null;
  }
  return context;
}

function bad(res: Response, message: string) {
  return res.status(400).json({ error: message });
}

// ---------------------------------------------------------------------------
// 1. My status
// ---------------------------------------------------------------------------

verifyRouter.get("/me", (req: Request, res: Response) => {
  const context = caller(req, res);
  if (!context) return;
  return res.status(200).json({
    verification: publicVerification(verificationForUser(context.userId)),
    // The frontend uses these to decide what to render. Neither is a promise
    // that a check will pass.
    externalVerifierConfigured: externalVerificationConfigured(),
    canRentStore: isApprovedForRental(context.userId),
  });
});

// ---------------------------------------------------------------------------
// 2. Submit the profile
// ---------------------------------------------------------------------------

verifyRouter.post("/profile", (req: Request, res: Response) => {
  const context = caller(req, res);
  if (!context) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const faydaId = String(body.faydaId ?? "").trim();
  const tinNumber = normalizeTin(String(body.tinNumber ?? ""));
  const fullName = String(body.fullName ?? "").trim().slice(0, 120) || null;
  const phone = String(body.phone ?? "").trim().slice(0, 40) || null;

  // A TIN is required to rent a store. The Fayda IMAGES are optional, exactly
  // as specified - but a Fayda ID number itself is required, because it is the
  // document the TIN is matched against.
  if (!isValidFaydaId(faydaId)) {
    return bad(res, "Enter a valid Fayda ID (10-16 letters or digits).");
  }
  if (!tinNumber) {
    return bad(res, "Enter a valid TIN number (9-11 digits).");
  }

  const now = new Date().toISOString();
  const existing = verificationForUser(context.userId);

  // One Fayda ID and one TIN per person, across the whole platform. Without
  // this a person could rent a hundred stores under one identity.
  const duplicate = allVerifications().find(
    (record) =>
      record.userId !== context.userId &&
      ((record.faydaId && record.faydaId.toUpperCase() === faydaId.toUpperCase()) ||
        (record.tinNumber && record.tinNumber === tinNumber)),
  );
  if (duplicate) {
    return res.status(409).json({
      error: "That Fayda ID or TIN is already registered to another account.",
    });
  }

  const documents: FaydaDocuments = existing?.documents ?? { front: null, back: null };

  const record: VerificationRecord = {
    id: existing?.id ?? `ver-${randomBytes(6).toString("hex")}`,
    userId: context.userId,
    // A resubmission always returns to the queue. It can never carry forward an
    // earlier approval, because the details being changed ARE the identity.
    status: "pending-review",
    faydaId,
    documents,
    tinNumber,
    fullName,
    phone,
    provider: null,
    providerReference: null,
    reason: null,
    submittedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (existing) {
    allVerifications()[allVerifications().indexOf(existing)] = record;
  } else {
    allVerifications().push(record);
  }
  persistVerifications();

  // Ask the external verifier now, so a good submission is approved without a
  // human touching it. The result is recorded; nothing here decides by itself.
  void runExternalCheck(record);

  return res.status(200).json({
    success: true,
    message:
      "Saved. We will verify your Fayda ID and TIN before you can rent a store.",
    verification: publicVerification(verificationForUser(context.userId)),
  });
});

/** Fire the provider check and record the outcome. Never throws. */
async function runExternalCheck(record: VerificationRecord): Promise<void> {
  if (!record.faydaId || !record.tinNumber) return;
  const result = await verifyWithProvider({
    faydaId: record.faydaId,
    tinNumber: record.tinNumber,
    fullName: record.fullName,
  });

  const current = verificationForUser(record.userId);
  if (!current) return;
  // A later resubmission may have replaced this record while we were waiting.
  if (current.submittedAt !== record.submittedAt) return;

  current.provider = result.provider;
  current.providerReference = result.reference;
  current.reason = result.reason;
  current.updatedAt = new Date().toISOString();

  if (result.verdict === "verified") {
    current.status = "verified";
    current.reviewedAt = current.updatedAt;
    current.reviewedBy = "etrade";
  } else if (result.verdict === "rejected") {
    current.status = "rejected";
    current.reviewedAt = current.updatedAt;
    current.reviewedBy = "etrade";
  }
  // pending-review leaves the record in the queue for a human.

  persistVerifications();
  syncRentalApproval(current.userId);
}

// ---------------------------------------------------------------------------
// 3. Upload a Fayda image
// ---------------------------------------------------------------------------

verifyRouter.post("/document", (req: Request, res: Response) => {
  const context = caller(req, res);
  if (!context) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const side = String(body.side ?? "");
  if (side !== "front" && side !== "back") return bad(res, "Side must be 'front' or 'back'.");

  const dataUrl = String(body.dataUrl ?? "");
  const match = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) return bad(res, "Send the image as a base64 data URL.");

  const extension = IMAGE_TYPES[match[1].toLowerCase()];
  if (!extension) return bad(res, "Only JPEG, PNG or WebP images are accepted.");

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0) return bad(res, "That image is empty.");
  if (buffer.length > MAX_IMAGE_BYTES) {
    return bad(res, "That image is larger than 4 MB. Please upload a smaller photo.");
  }

  const now = new Date().toISOString();
  const record: VerificationRecord = verificationForUser(context.userId) ?? {
    id: `ver-${randomBytes(6).toString("hex")}`,
    userId: context.userId,
    status: "not-started",
    faydaId: null,
    documents: { front: null, back: null },
    tinNumber: null,
    fullName: null,
    phone: null,
    provider: null,
    providerReference: null,
    reason: null,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: now,
    updatedAt: now,
  };

  // The filename is built from the SESSION user id and a fixed side name - no
  // request value reaches the path, so there is nothing to traverse with.
  const filename = `${context.userId}-${side}.${extension}`;
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  } catch (error) {
    console.error("[verify] could not store document:", error);
    return res.status(500).json({ error: "We could not save that image. Please try again." });
  }

  record.documents = { ...record.documents, [side]: filename };
  record.updatedAt = now;

  const list = allVerifications();
  const index = list.findIndex((entry) => entry.userId === context.userId);
  if (index >= 0) list[index] = record;
  else list.push(record);
  persistVerifications();

  return res.status(200).json({
    success: true,
    verification: publicVerification(verificationForUser(context.userId)),
  });
});

/**
 * Mirror the verification outcome onto the user record.
 *
 * This is the only writer of `storeRentalApproved` in the codebase. It is set
 * true ONLY for a verified record that has a TIN, so the gate cannot be opened
 * by a sign-up, a profile submission, or a direct API call.
 */
function syncRentalApproval(userId: string): void {
  const user = allUsers().find((entry) => entry.id === userId);
  if (!user) return;
  const approved = isApprovedForRental(userId);
  if (user.storeRentalApproved !== approved) {
    user.storeRentalApproved = approved;
    persistUsers();
  }
}

const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

verifyRouter.get("/document/:side", (req: Request, res: Response) => {
  const context = caller(req, res);
  if (!context) return;

  const side = req.params.side;
  if (side !== "front" && side !== "back") return bad(res, "Unknown document side.");

  const record = verificationForUser(context.userId);
  const filename = record?.documents?.[side];
  if (!filename) return res.status(404).json({ error: "No document has been uploaded for that side." });

  // Defence in depth: the name is rebuilt rather than trusted from the record.
  const extension = filename.split(".").pop() ?? "";
  const expected = `${context.userId}-${side}.${extension}`;
  if (filename !== expected) return res.status(403).json({ error: "Not permitted." });

  const full = path.join(uploadsDir, filename);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "That document is no longer stored." });

  res.setHeader("Content-Type", CONTENT_TYPES[extension] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "private, no-store");
  return res.sendFile(full);
});

// ---------------------------------------------------------------------------
// 5. Super admin: the review queue
// ---------------------------------------------------------------------------

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

verifyRouter.get("/queue", (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const status = String(req.query.status ?? "").trim();
  const list = allVerifications()
    .filter((record) => (status ? record.status === status : true))
    .map((record) => {
      const user = allUsers().find((entry) => entry.id === record.userId);
      return {
        ...publicVerification(record),
        id: record.id,
        userId: record.userId,
        applicant: user ? { name: user.name, email: user.email } : null,
        hasFront: Boolean(record.documents.front),
        hasBack: Boolean(record.documents.back),
        providerReference: record.providerReference,
        reviewedBy: record.reviewedBy,
      };
    });
  return res.status(200).json({ verifications: list });
});

verifyRouter.post("/review/:id", (req: Request, res: Response) => {
  const admin = requireSuperAdmin(req, res);
  if (!admin) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = String(body.decision ?? "");
  if (decision !== "approve" && decision !== "reject") {
    return bad(res, "Decision must be 'approve' or 'reject'.");
  }

  const record = allVerifications().find((entry) => entry.id === req.params.id);
  if (!record) return res.status(404).json({ error: "That submission does not exist." });

  const now = new Date().toISOString();
  record.status = decision === "approve" ? "verified" : "rejected";
  record.reason =
    decision === "reject"
      ? String(body.reason ?? "").trim().slice(0, 300) || "Rejected by an administrator."
      : null;
  record.reviewedAt = now;
  record.reviewedBy = admin.email;
  record.updatedAt = now;
  persistVerifications();

  syncRentalApproval(record.userId);

  return res.status(200).json({ success: true, verification: publicVerification(record) });
});
