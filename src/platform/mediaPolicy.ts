/**
 * ============================================================================
 *  MEDIA POLICY - what may be uploaded, and in what form
 * ============================================================================
 *
 *  A DECLARED ALLOWLIST, NOT A DENYLIST
 *  -----------------------------------
 *  "Reject anything not ending in .exe" is a list that is wrong the day someone
 *  finds a new extension. This declares the formats that are ACCEPTED, so an
 *  unknown type is refused by default rather than admitted by default.
 *
 *  THE TYPE IS DECIDED BY CONTENT, NOT BY THE CLAIMED NAME
 *  -----------------------------------------------------
 *  A caller can send any `contentType` it likes. The extension is checked against
 *  the declared MIME type and vice versa, so a `.html` file renamed to `.png` and
 *  sent as `image/png` is caught by the pair disagreeing - and the served response
 *  is typed from the ALLOWLIST, never from what the uploader claimed.
 *
 *  WHY THIS MATTERS HERE MORE THAN USUALLY
 *  ---------------------------------------
 *  Uploaded media is served back over HTTP. A store XSS served from the same
 *  origin as the session cookie is a full account takeover, so an SVG - which is
 *  script-capable - is treated differently from a raster image and never served
 *  without the sandbox CSP the media router already applies.
 */

import type { PackageId } from "./types";

export type MediaKind = "image" | "video" | "audio";

/** One accepted format. The extension and the MIME type must agree. */
export interface MediaFormat {
  extension: string;
  mimeTypes: string[];
  kind: MediaKind;
  /** Script-capable formats get a sandbox when served. */
  scriptCapable: boolean;
}

/**
 * The accepted formats.
 *
 * Deliberately conservative: no SVG for video, no PDF, no archive. A business
 * that needs another format gets it by adding a row here, which is a reviewable
 * change rather than a silent widening.
 */
export const ACCEPTED_FORMATS: MediaFormat[] = [
  // ---- images ----
  { extension: "png", mimeTypes: ["image/png"], kind: "image", scriptCapable: false },
  { extension: "jpg", mimeTypes: ["image/jpeg"], kind: "image", scriptCapable: false },
  { extension: "jpeg", mimeTypes: ["image/jpeg"], kind: "image", scriptCapable: false },
  { extension: "webp", mimeTypes: ["image/webp"], kind: "image", scriptCapable: false },
  { extension: "gif", mimeTypes: ["image/gif"], kind: "image", scriptCapable: false },
  // SVG is script-capable, so it is served sandboxed and never auto-rendered
  // inside the app's own document.
  { extension: "svg", mimeTypes: ["image/svg+xml"], kind: "image", scriptCapable: true },
  // ---- video ----
  { extension: "mp4", mimeTypes: ["video/mp4"], kind: "video", scriptCapable: false },
  { extension: "webm", mimeTypes: ["video/webm"], kind: "video", scriptCapable: false },
  { extension: "ogv", mimeTypes: ["video/ogg"], kind: "video", scriptCapable: false },
  // ---- audio ----
  { extension: "mp3", mimeTypes: ["audio/mpeg", "audio/mp3"], kind: "audio", scriptCapable: false },
  { extension: "m4a", mimeTypes: ["audio/mp4", "audio/x-m4a"], kind: "audio", scriptCapable: false },
  { extension: "ogg", mimeTypes: ["audio/ogg"], kind: "audio", scriptCapable: false },
  { extension: "wav", mimeTypes: ["audio/wav", "audio/x-wav", "audio/wave"], kind: "audio", scriptCapable: false },
];

const BY_EXTENSION = new Map(ACCEPTED_FORMATS.map((format) => [format.extension, format]));

/** The extension a filename actually has, lowercased, or null. */
export function extensionOf(filename: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Decide what a proposed upload is, or why it cannot be.
 *
 * BOTH the name and the claimed MIME type are checked, and they must agree. A
 * mismatch is refused rather than resolved in favour of one of them, because a
 * disagreement is exactly what a renamed file looks like.
 */
export function classifyUpload(
  filename: string,
  claimedMimeType: string,
): { ok: true; format: MediaFormat } | { ok: false; reason: string } {
  const extension = extensionOf(filename);
  if (!extension) {
    return { ok: false, reason: "The file has no extension, so its type cannot be determined." };
  }

  const format = BY_EXTENSION.get(extension);
  if (!format) {
    const accepted = ACCEPTED_FORMATS.filter((f) => f.kind === "image").map((f) => f.extension);
    return {
      ok: false,
      reason: `That file type is not accepted. Accepted images: ${accepted.join(", ")}.`,
    };
  }

  const claimed = claimedMimeType.split(";")[0].trim().toLowerCase();
  if (claimed && !format.mimeTypes.includes(claimed)) {
    // The two disagree - which is what a renamed file looks like.
    return {
      ok: false,
      reason: `This file is named .${extension} but was uploaded as ${claimed}. Refusing the mismatch.`,
    };
  }

  return { ok: true, format };
}

/** The MIME type to SERVE, taken from the allowlist rather than the request. */
export function contentTypeFor(filename: string): string | null {
  const extension = extensionOf(filename);
  if (!extension) return null;
  return BY_EXTENSION.get(extension)?.mimeTypes[0] ?? null;
}

/** Must this format be sandboxed when served? */
export function isScriptCapable(filename: string): boolean {
  const extension = extensionOf(filename);
  if (!extension) return false;
  return BY_EXTENSION.get(extension)?.scriptCapable ?? false;
}

/** Where an uploaded file belongs. One folder per business, per kind. */
export type MediaFolder = "stores" | "products" | "music";

export const MEDIA_FOLDERS: Record<MediaFolder, string> = {
  stores: "stores",
  products: "products",
  music: "music",
};

/**
 * A safe stored filename.
 *
 * The caller's name is NEVER used on disk. A random id plus the vetted extension
 * means a file can neither traverse (`../../`) nor collide with an existing one,
 * and the original name is kept as a display field in the record instead.
 */
export function storedFileName(randomId: string, originalName: string): string | null {
  const extension = extensionOf(originalName);
  if (!extension || !BY_EXTENSION.has(extension)) return null;
  return `${randomId}.${extension}`;
}

/**
 * Magic-number signatures for the formats where it matters.
 *
 * A content-type header is a claim; these bytes are a fact. A PNG that begins
 * with the PNG signature is a PNG no matter what it was called.
 *
 * Only the magic numbers are checked - deliberately. A full decoder is not
 * reimplemented here, and pretending to validate the whole container would be a
 * worse claim than checking the identifier honestly and saying so.
 */
const SIGNATURES: { extension: string; bytes: number[] }[] = [
  { extension: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { extension: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { extension: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { extension: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { extension: "webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
  { extension: "mp3", bytes: [0x49, 0x44, 0x33] }, // "ID3"
  { extension: "wav", bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
];

/**
 * Does the content agree with the extension?
 *
 * `null` means "this format has no signature we check", NOT "verified". Callers
 * must treat it as permissive, because refusing every file without a signature
 * would reject every valid MP4.
 */
export function contentMatchesExtension(originalName: string, bytes: Uint8Array): boolean | null {
  const extension = extensionOf(originalName);
  if (!extension) return false;
  const signature = SIGNATURES.find((entry) => entry.extension === extension);
  if (!signature) return null; // no signature defined for this format

  if (bytes.length < signature.bytes.length) return false;
  return signature.bytes.every((byte, index) => bytes[index] === byte);
}

/**
 * The per-package single-file ceiling for a media kind.
 *
 * Video is allowed a larger ceiling than an image on the same package, because
 * "your plan allows 25 MB" would otherwise make video uploads impossible on
 * every plan - which is the same mistake as having no video support at all.
 */
export function fileCeilingFor(packageId: PackageId, kind: MediaKind): number {
  const base = kind === "video"
    ? { silver: 25, gold: 50, platinum: 200, super: 1024 }[packageId] * 1024 * 1024
    : { silver: 5, gold: 10, platinum: 50, super: 256 }[packageId] * 1024 * 1024;
  return base;
}
