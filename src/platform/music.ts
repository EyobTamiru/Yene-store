/**
 * ============================================================================
 *  STOREFRONT MUSIC - auto-selected, customer-controllable
 * ============================================================================
 *
 *  WHAT THE SYSTEM DOES, EXACTLY
 *  -----------------------------
 *  1. Yene Business Group uploads a LIBRARY of licensed tracks.
 *  2. Each track carries MOOD tags.
 *  3. Each store carries a MOOD (coffee shop, fashion, electronics...).
 *  4. `pickTrackForStore` chooses a track deterministically from (storeId, mood).
 *     Two stores with the same mood get different tracks - so the marketplace
 *     does not sound like one song on loop - but the SAME store always gets the
 *     SAME track, so the storefront sounds like itself and does not change on
 *     every page load.
 *  5. A customer may change the track, or turn music off entirely, and that
 *     choice is remembered.
 *
 *  WHY DETERMINISTIC AND NOT RANDOM
 *  ---------------------------------
 *  A random pick would give a store a different track on every visit, which reads
 *  as a bug rather than as variety. Deterministic selection gives stable
 *  identity per store AND distribution across stores, which is the actual goal.
 *
 *  WHY MUTED BY DEFAULT
 *  --------------------
 *  This is not a preference, it is a browser constraint: every major browser
 *  blocks unmuted autoplay without a prior user gesture. A player that tries to
 *  autoplay loudly simply does not start. So the player starts muted, shows a
 *  clear unmute control, and never pretends to be playing when it is not.
 *
 *  HONESTLY EMPTY UNTIL CONFIGURED
 *  ------------------------------
 *  No audio ships with this code. Fabricating "music" would mean shipping tones
 *  and calling them tracks. The library is a table an administrator fills, and
 *  every function here behaves correctly - and says so - when it is empty.
 */

export interface MusicMood {
  id: string;
  label: string;
}

/** The moods a store may declare. A store may also declare none. */
export const MUSIC_MOODS: MusicMood[] = [
  { id: "general", label: "General" },
  { id: "calm", label: "Calm and relaxed" },
  { id: "upbeat", label: "Upbeat" },
  { id: "luxury", label: "Luxury" },
  { id: "traditional", label: "Traditional" },
  { id: "family", label: "Family friendly" },
];

/** One licensed track in the library. */
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  /** Where the audio actually lives. Must be a real, reachable file. */
  url: string;
  /** Seconds. Used to show a length and to stop before a track ends. */
  durationSec: number;
  /** Moods this track suits. A track may suit several. */
  moods: string[];
  /** False for a track Yene has not licensed. NEVER served when false. */
  licensed: boolean;
  createdAt: string;
}

/**
 * A small, stable hash.
 *
 * FNV-1a: it is not a cryptographic hash and does not need to be. It needs to be
 * the SAME on every platform and in every future release, which rules out
 * anything language-specific, and cheap enough to run on a storefront render.
 */
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result >>> 0;
}

/** Tracks that are safe to serve: licensed, with a URL and a positive duration. */
export function playableTracks(library: MusicTrack[]): MusicTrack[] {
  return library.filter(
    (track) => track.licensed && Boolean(track.url) && track.durationSec > 0,
  );
}

/**
 * Choose a track for a store.
 *
 * Returns null when the library has nothing playable - which is the honest
 * answer for a fresh deployment, and is why the player renders nothing rather
 * than a broken audio element.
 */
export function pickTrackForStore(
  storeId: string,
  mood: string | null,
  library: MusicTrack[],
): MusicTrack | null {
  const playable = playableTracks(library);
  if (playable.length === 0) return null;

  // Prefer a track that suits the mood; fall back to the whole library rather
  // than to silence, because a store with the wrong mood set is a data problem
  // and silence is a worse answer than a mismatched track.
  const matching = mood ? playable.filter((track) => track.moods.includes(mood)) : [];
  const pool = matching.length > 0 ? matching : playable;

  const index = hash(`${storeId}:${mood ?? "general"}`) % pool.length;
  return pool[index];
}

/**
 * The next track for a customer who has pressed "change".
 *
 * Walks deterministically rather than randomly, so pressing next twice in a row
 * cannot land on the same track, and going back lands where it started.
 */
export function nextTrack(currentId: string | null, storeId: string, mood: string | null, library: MusicTrack[], direction = 1): MusicTrack | null {
  const playable = playableTracks(library);
  if (playable.length === 0) return null;
  const matching = mood ? playable.filter((track) => track.moods.includes(mood)) : [];
  const pool = matching.length > 0 ? matching : playable;
  if (pool.length === 1) return pool[0];

  const currentIndex = pool.findIndex((track) => track.id === currentId);
  // An unknown or absent current track starts from the store's own pick, so
  // "next" from a fresh state is consistent with "next" after the auto-pick.
  const from = currentIndex === -1 ? hash(`${storeId}:${mood ?? "general"}`) % pool.length : currentIndex;
  const nextIndex = (from + direction + pool.length) % pool.length;
  return pool[nextIndex];
}

/** A customer's saved music choice. Stored per browser, per store. */
export interface MusicPreference {
  /** null means "follow the store's automatic choice". */
  trackId: string | null;
  /** False once the customer has switched music off. */
  enabled: boolean;
  volume: number;
}

export const DEFAULT_MUSIC_PREFERENCE: MusicPreference = {
  trackId: null,
  enabled: false, // muted by default, and explicitly off until a customer opts in
  volume: 0.4,
};

/**
 * Merge a stored preference over the defaults.
 *
 * Tolerant by design: the value comes from browser storage a user can edit, so
 * a malformed or partial record must not crash the storefront. Anything
 * unusable falls back to the default rather than throwing.
 */
export function normalisePreference(value: unknown): MusicPreference {
  if (!value || typeof value !== "object") return { ...DEFAULT_MUSIC_PREFERENCE };
  const raw = value as Partial<MusicPreference>;
  return {
    trackId: typeof raw.trackId === "string" && raw.trackId.length > 0 ? raw.trackId : null,
    enabled: raw.enabled === true,
    volume:
      typeof raw.volume === "number" && Number.isFinite(raw.volume)
        ? Math.min(1, Math.max(0, raw.volume))
        : DEFAULT_MUSIC_PREFERENCE.volume,
  };
}

/**
 * The track a customer should actually hear.
 *
 * THE PRECEDENCE IS THE REQUIREMENT: an explicit choice always wins, including an
 * explicit "off". Only when the customer has expressed no preference does the
 * store's automatic pick apply - and because the default is `enabled: false`, a
 * first-time visitor hears nothing until they choose to.
 */
export function resolveTrack(
  storeId: string,
  mood: string | null,
  preference: MusicPreference,
  library: MusicTrack[],
): MusicTrack | null {
  if (!preference.enabled) return null;
  if (preference.trackId) {
    const chosen = playableTracks(library).find((track) => track.id === preference.trackId);
    // A track that has since been unlicensed must not keep playing, so the
    // customer falls back to the automatic choice rather than to silence.
    if (chosen) return chosen;
  }
  return pickTrackForStore(storeId, mood, library);
}

/** The browser storage key for one store's preference. */
export function preferenceKey(storeId: string): string {
  return `yene-music-${storeId}`;
}
