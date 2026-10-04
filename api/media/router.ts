/**
 * ============================================================================
 *  MEDIA ROUTER
 * ============================================================================
 *
 *  Mounted at /api/media.
 *
 *    GET /:kind/:file   one generated or uploaded asset
 *
 *  WHY A ROUTE RATHER THAN express.static
 *  -------------------------------------
 *  The files live under `data/`, which also holds Fayda card scans - government
 *  identity documents a person uploaded. A static mount on that directory would
 *  publish every one of them at a guessable URL. This router resolves ONE file
 *  name inside two known folders and serves nothing else, so an attacker cannot
 *  walk out of `media/` with `../auth-users.json`.
 *
 *  `res.sendFile` needs the resolved absolute path, and the name is rebuilt here
 *  rather than trusted: only a known folder and a basename survive, so no
 *  request value ever reaches the filesystem beyond the extension check.
 */

import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";

export const mediaRouter = Router();

/**
 * Where generated artwork lives, resolved from the SAME base as every other data
 * file so `YENE_DATA_DIR` keeps working on a deployment that relocates it.
 */
const mediaDir = path.join(
  process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data"),
  "media",
);

/** The only two folders that may ever be served. */
const KINDS: Record<string, string> = {
  stores: "stores",
  products: "products",
};

/**
 * The only formats this server will emit.
 *
 * Declared here rather than trusted from the request, so a file can never be
 * served with a type the uploader chose. It must mirror
 * `src/platform/mediaPolicy.ts` - the upload path refuses anything not on that
 * allowlist, so this list only ever has to serve what was already accepted.
 */
const CONTENT_TYPES: Record<string, string> = {
  // images
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  // video - a merchant can now upload a product video
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  // audio - the storefront music library
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

/** Formats that can execute script, and so are served inside a sandbox. */
const SCRIPT_CAPABLE: Record<string, boolean> = { svg: true };

/**
 * Serve one asset.
 *
 * THE PATH IS TWO SEGMENTS BELOW `kind`
 *  -----------------------------------
 *  Uploaded media lives at `media/<kind>/<businessId>/<file>`, while generated
 *  artwork lives at `media/<kind>/<file>`. Both are served, so a file name is
 *  never allowed to contain a separator and the business id is validated as a
 *  plain token - otherwise `..` in either segment would walk out of `media/` and
 *  straight into the Fayda document scans that live in the same data directory.
 */
mediaRouter.get("/:kind/:file", (req: Request, res: Response) => {
  serve(req, res, String(req.params.file));
});

mediaRouter.get("/:kind/:owner/:file", (req: Request, res: Response) => {
  // A business id is a generated token, so anything outside this shape is not
  // one and is refused before it can contain a separator.
  const owner = String(req.params.owner ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(owner)) {
    return res.status(400).json({ error: "Bad asset path." });
  }
  return serve(req, res, String(req.params.file), owner);
});

function serve(req: Request, res: Response, rawFile: string, owner?: string): Response | void {
  const folder = KINDS[String(req.params.kind)];
  if (!folder) return res.status(404).json({ error: "Not found." });

  // The basename is the WHOLE of what may be used. `path.basename` on a name
  // containing "../" throws the traversal away, and anything with a separator
  // left in it is refused outright.
  const raw = rawFile ?? "";
  if (!raw || raw.includes("/") || raw.includes("\\") || raw.includes("..")) {
    res.status(400).json({ error: "Bad asset name." });
    return;
  }

  const extension = raw.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) { res.status(404).json({ error: "Not found." }); return; }

  const full = owner
    ? path.join(mediaDir, folder, owner, raw)
    : path.join(mediaDir, folder, raw);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.status(404).json({ error: "Not found." });
    return;
  }

  res.setHeader("Content-Type", contentType);
  // Assets are content-addressed by name and never change in place, so a long
  // cache is correct. An SVG is script-capable, hence the CSP sandbox below.
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  if (SCRIPT_CAPABLE[extension]) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  }
  return res.sendFile(full);
}