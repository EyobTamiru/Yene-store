/**
 * ============================================================================
 *  MUSIC ROUTER - the storefront music library
 * ============================================================================
 *
 *  Mounted under /api/media, alongside the read and upload paths.
 *
 *    GET  /music/library    the playable tracks (super admin or public reads)
 *    POST /music            add a track to the library (super admin only)
 *    GET  /music/for-store  the track a store's storefront should use
 *
 *  WHY BUSINESSES CANNOT UPLOAD THEIR OWN MUSIC
 *  ---------------------------------------------
 *  A storefront plays audio to every visitor without asking. If a merchant could
 *  upload a track, then a storefront becomes a channel for unlicensed music, and
 *  Yene Business Group carries the consequence for every business on the
 *  platform. So the library is operator-supplied and each track carries an
 *  explicit `licensed` flag; an unlicensed track is never served and never auto-
 *  selected, however it got into the table.
 *
 *  THE LIBRARY IS EMPTY UNTIL IT IS FILLED
 *  ---------------------------------------
 *  No audio ships with this code. `for-store` therefore returns `track: null`
 *  on a fresh deployment, and the player renders nothing. Returning a silent
 *  placeholder or a tone would be worse than returning nothing.
 */

import { Router, type Request, type Response } from "express";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createJsonCollection } from "../lib/jsonCollection";
import { resolveIdentity } from "../platform/auth";
import { MUSIC_MOODS, pickTrackForStore, playableTracks, type MusicTrack } from "../../src/platform/music";

export const musicRouter = Router();

const dataDir = process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data");

const library = createJsonCollection<MusicTrack>(
  path.join(dataDir, "music-library.json"),
  "music-library",
  500,
);

export const allMusicTracks = library.all;
export const persistMusicLibrary = library.touch;

/**
 * GET /api/media/music/for-store?store=<id>&mood=<mood>
 *
 * What this store's storefront should play, chosen deterministically by
 * (storeId, mood). Returns null when the library holds nothing playable, which
 * is the honest answer rather than a broken audio element.
 */
musicRouter.get("/music/for-store", (req: Request, res: Response) => {
  const storeId = String(req.query.store ?? "").trim();
  const mood = String(req.query.mood ?? "").trim() || null;

  const track = storeId
    ? pickTrackForStore(storeId, mood, allMusicTracks())
    : pickTrackForStore("yene-storefront", mood, allMusicTracks());

  return res.status(200).json({
    track: track ? publicTrack(track) : null,
    // Stated so the client can render nothing deliberately rather than by
    // accident, and an operator can see why.
    available: Boolean(track),
    note: track
      ? null
      : "No licensed track is available for this store yet. Yene Business Group has not added one to the library.",
    moods: MUSIC_MOODS,
  });
});

/**
 * GET /api/media/music/library
 *
 * The playable tracks, so the customer's "change track" control has a list to
 * offer. Only licensed, playable tracks are returned.
 */
musicRouter.get("/music/library", (_req: Request, res: Response) => {
  const tracks = playableTracks(allMusicTracks());
  return res.status(200).json({ tracks: tracks.map(publicTrack), moods: MUSIC_MOODS });
});

/**
 * POST /api/media/music
 *
 * Add a track. Super admin only, because this is a licensing decision.
 */
musicRouter.post("/music", (req: Request, res: Response) => {
  const identity = resolveIdentity(req);
  if (!identity.isAuthenticated || !identity.isSuperAdmin) {
    return res.status(403).json({ error: "Super Admin access is required." });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = String(body.title ?? "").trim().slice(0, 120);
  const artist = String(body.artist ?? "").trim().slice(0, 120);
  // A track with no URL cannot play, and a relative URL would let a caller point
  // the player at an arbitrary path on this origin.
  const url = String(body.url ?? "").trim();
  const durationSec = Number(body.durationSec);

  if (title.length < 1) return res.status(400).json({ error: "A track title is required." });
  if (!/^https:\/\//i.test(url) && !url.startsWith("/api/media/music/audio/")) {
    return res.status(400).json({ error: "The track URL must be https, or a served library file." });
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return res.status(400).json({ error: "The track duration must be a positive number of seconds." });
  }

  const moods = Array.isArray(body.moods)
    ? body.moods.map(String).filter((mood) => MUSIC_MOODS.some((entry) => entry.id === mood))
    : [];

  const track: MusicTrack = {
    id: `trk-${randomBytes(6).toString("hex")}`,
    title,
    artist,
    url,
    durationSec: Math.round(durationSec),
    moods,
    // Defaults to unlicensed, deliberately. A track is not played until somebody
    // with authority says the licence exists.
    licensed: body.licensed === true,
    createdAt: new Date().toISOString(),
  };

  allMusicTracks().push(track);
  persistMusicLibrary();

  return res.status(201).json({
    track: publicTrack(track),
    message: track.licensed
      ? "Added to the library."
      : "Added as UNLICENSED - it will not play until an administrator marks it licensed.",
  });
});

/** What a browser is told about a track. Never carries internal fields. */
function publicTrack(track: MusicTrack) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    url: track.url,
    durationSec: track.durationSec,
    moods: track.moods,
  };
}
