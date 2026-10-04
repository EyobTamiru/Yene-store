/**
 * ============================================================================
 *  MEDIA UPLOAD ROUTER
 * ============================================================================
 *
 *  A WRITE path, added alongside the existing read-only media router. That
 *  router only ever served a known folder; this one creates files, so it has to
 *  answer questions the read path never did: who is this from, how big is it,
 *  what is it, and is there room.
 *
 *  THE FOUR GATES, IN ORDER
 *  ------------------------
 *  1. WHO      the caller's business, resolved from the session. A business id in
 *              the body is ignored, because that is how one merchant uploads
 *              into another's gallery.
 *  2. TYPE     name and claimed MIME type must agree, and the extension must be on
 *              the allowlist (see mediaPolicy.ts).
 *  3. SIZE     the per-file ceiling for this package and media kind.
 *  4. QUOTA    the package's total storage, measured from the filesystem.
 *
 *  WHY QUOTA IS MEASURED FROM DISK AND NOT COUNTED IN A TABLE
 *  -------------------------------------------------------
 *  A counter that says "this business has 400 MB" can disagree with the disk, and
 *  then a customer is refused an upload they have room for - or worse, allowed
 *  one that fills the volume. Walking the business's own folder is the only
 *  number that cannot be wrong, and it is a few `stat` calls over a directory
 *  that holds that business's uploads.
 *
 *  BASE64 IN, NOT MULTIPART
 *  ------------------------
 *  The project's JSON body parser has a 64 KB ceiling and no multipart
 *  dependency is installed. Base64 costs 33% overhead and is accepted rather
 *  than pretending; the route is mounted with its own larger limit so the global
 *  parser cannot truncate a payload before it arrives.
 */

import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { resolveIdentity } from "../platform/auth";
import { businessById } from "../platform/store";
import { PACKAGES } from "../../src/platform/packages";
import { evaluateUpload, formatBytes, shouldWarn, storageSummary, uploadRefusalMessage, usageFraction } from "../../src/platform/storage";
import { classifyUpload, contentMatchesExtension, fileCeilingFor, storedFileName, type MediaFolder, type MediaKind } from "../../src/platform/mediaPolicy";

export const mediaUploadRouter = Router();

/** Where uploads land, resolved from the same base as every other data file. */
const mediaRoot = path.join(
  process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data"),
  "media",
);

/** Folders a business may upload into. `music` is operator-only (see musicRouter). */
const UPLOAD_FOLDERS: Record<string, MediaFolder> = {
  store: "stores",
  product: "products",
};

function folderFor(businessId: string, folder: MediaFolder): string {
  return path.join(mediaRoot, folder, businessId);
}

/**
 * Total bytes a business currently occupies.
 *
 * Scoped to the business's OWN subfolder. Two businesses' uploads are siblings,
 * so neither can see or be charged for the other's files.
 */
export function bytesUsedBy(businessId: string): number {
  let total = 0;
  for (const folder of Object.values(UPLOAD_FOLDERS)) {
    const directory = folderFor(businessId, folder);
    if (!fs.existsSync(directory)) continue;
    for (const entry of safeReaddir(directory)) {
      // A subdirectory is not counted: following one would let an unrelated
      // tree inflate a business's measured usage.
      const stats = fs.statSync(path.join(directory, entry));
      if (stats.isFile()) total += stats.size;
    }
  }
  return total;
}

/** `readdirSync` that returns [] rather than throwing on a missing folder. */
function safeReaddir(directory: string): string[] {
  try {
    return fs.readdirSync(directory);
  } catch {
    return [];
  }
}

/**
 * Decode a base64 payload.
 *
 * The declared `dataLength` is what the QUOTA is charged, and it is compared
 * against the bytes actually decoded - a caller that under-declares gets refused
 * rather than getting a free upload. When the length is not declared, the
 * decoded size is used, which is the correct default.
 */
function decodePayload(body: string): { bytes: Buffer; bytesBig: Uint8Array } | null {
  // Tolerate a data URL prefix; browsers add it and it is not part of the data.
  const comma = body.indexOf(",");
  const base64 = body.startsWith("data:") && comma !== -1 ? body.slice(comma + 1) : body;
  if (!base64 || base64.length === 0) return null;
  try {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0) return null;
    return { bytes, bytesBig: new Uint8Array(bytes) };
  } catch {
    return null;
  }
}

interface UploadBody {
  folder?: string;
  filename?: string;
  contentType?: string;
  data?: string;
  /** The size the CALLER claims, in bytes. Checked against the decoded size. */
  dataLength?: number;
  altText?: string;
}

/**
 * POST /api/media/upload
 *
 * Upload one image or video into the caller's own store or product gallery.
 */
mediaUploadRouter.post("/upload", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated) {
    return res.status(401).json({ error: "Please sign in to upload media." });
  }
  const businessId = identity.businessId;
  if (!businessId) {
    return res.status(403).json({ error: "This account is not attached to a business." });
  }
  const business = businessById(businessId);
  if (!business) return res.status(404).json({ error: "Business not found." });

  const folder = UPLOAD_FOLDERS[String((req.body ?? {}).folder ?? "")];
  if (!folder) {
    return res.status(400).json({ error: "Choose whether this is a store or a product upload." });
  }

  const body = (req.body ?? {}) as UploadBody;
  const filename = String(body.filename ?? "").trim();
  if (!filename) return res.status(400).json({ error: "A filename is required." });

  // ---- GATE 2: type ----
  // The `ok` discriminant is checked HERE rather than stored, because TypeScript
  // only narrows a union at the point the discriminant is tested.
  const classification = classifyUpload(filename, String(body.contentType ?? ""));
  if (classification.ok === false) {
    return res.status(400).json({ error: classification.reason });
  }
  const format = classification.format;
  const kind: MediaKind = format.kind;
  if (kind === "audio") {
    // Music is supplied by Yene Business Group, not uploaded per business.
    return res.status(400).json({ error: "Audio is not uploaded per business. Contact Yene Business Group to add a track to the library." });
  }

  const decoded = decodePayload(String(body.data ?? ""));
  if (!decoded) return res.status(400).json({ error: "The file data was empty or not valid base64." });

  // The bytes must agree with the name. `null` means "no signature defined for
  // this format", which is permissive by design - refusing every MP4 would be
  // worse than not checking it.
  const matches = contentMatchesExtension(filename, decoded.bytesBig);
  if (matches === false) {
    return res.status(400).json({
      error: "The file contents do not match its extension. Refusing the mismatch.",
    });
  }

  // A declared length must not UNDER-declare, or the quota would be charged
  // less than the file actually costs.
  const declared = Number(body.dataLength);
  if (Number.isFinite(declared) && declared > decoded.bytes.length * 1.02) {
    return res.status(400).json({ error: "The declared file size does not match the uploaded data." });
  }

  // ---- GATES 3 and 4: size, then quota ----
  const packageId = business.packageId;
  const limitBytes = PACKAGES[packageId].limits.storageBytes;
  const maxFileBytes = fileCeilingFor(packageId, kind);
  const usedBytes = bytesUsedBy(businessId);

  const decision = evaluateUpload({
    usedBytes,
    limitBytes,
    maxFileBytes,
    incomingBytes: decoded.bytes.length,
  });

  if (decision.allowed === false) {
    return res
      .status(413).json({
      error: uploadRefusalMessage(decision),
      storage: {
        usedBytes,
        limitBytes,
        used: formatBytes(usedBytes),
        limit: formatBytes(limitBytes),
        summary: storageSummary(usedBytes, limitBytes),
        fraction: usageFraction(usedBytes, limitBytes),
      },
    });
  }

  // ---- Write ----
  const id = randomBytes(8).toString("hex");
  const stored = storedFileName(id, filename);
  if (!stored) return res.status(400).json({ error: "That file type is not accepted." });

  const directory = folderFor(businessId, folder);
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, stored), decoded.bytes);
  } catch (error) {
    console.error("[media] could not write the upload:", error);
    return res.status(500).json({ error: "The file could not be saved. Please try again." });
  }

  const usedAfter = decision.allowed ? decision.usedAfter : usedBytes + decoded.bytes.length;
  const warn = shouldWarn(usedAfter, limitBytes);

  return res.status(201).json({
    ok: true,
    id,
    filename: stored,
    /** The ORIGINAL name, kept as a display field. It is never used on disk. */
    originalFilename: filename,
    kind,
    bytes: decoded.bytes.length,
    // The URL the media router will serve it from.
    url: `/api/media/${folder}/${businessId}/${stored}`,
    altText: String(body.altText ?? "").slice(0, 200),
    storage: {
      usedBytes: usedAfter,
      limitBytes,
      used: formatBytes(usedAfter),
      limit: formatBytes(limitBytes),
      summary: storageSummary(usedAfter, limitBytes),
      fraction: usageFraction(usedAfter, limitBytes),
      // Proactive, not a refusal: told at 90% so a merchant is never surprised.
      warning: warn
        ? `You are close to your ${formatBytes(limitBytes)} storage allowance. Delete old files or upgrade your package.`
        : null,
    },
  });
});

/**
 * GET /api/media/usage
 *
 * What this business is using, so the dashboard can show it without the client
 * measuring anything itself.
 */
mediaUploadRouter.get("/usage", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated) return res.status(401).json({ error: "Please sign in." });
  const businessId = identity.businessId;
  if (!businessId) return res.status(403).json({ error: "This account is not attached to a business." });

  const business = businessById(businessId);
  if (!business) return res.status(404).json({ error: "Business not found." });

  const limitBytes = PACKAGES[business.packageId].limits.storageBytes;
  const usedBytes = bytesUsedBy(businessId);
  return res.status(200).json({
    packageId: business.packageId,
    packageName: PACKAGES[business.packageId].name,
    usedBytes,
    limitBytes,
    used: formatBytes(usedBytes),
    limit: formatBytes(limitBytes),
    summary: storageSummary(usedBytes, limitBytes),
    fraction: usageFraction(usedBytes, limitBytes),
    overQuota: usedBytes > limitBytes,
  });
});
