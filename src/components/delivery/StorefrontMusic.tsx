/**
 * ============================================================================
 *  STOREFRONT MUSIC PLAYER
 * ============================================================================
 *
 *  Muted by default, and that is not a style choice - it is a browser
 *  constraint. Every current browser blocks unmuted autoplay without a prior user
 *  gesture, so a player that tries simply does not start. This one starts muted,
 *  shows an unmistakable unmute control, and never claims to be playing when it
 *  is not.
 *
 *  THE CUSTOMER CONTROLS IT COMPLETELY
 *  -----------------------------------
 *  * nothing plays until they press play,
 *  * they can change the track,
 *  * they can turn it off,
 *  * and the choice is remembered per store, so their choice survives a reload.
 *
 *  WHAT IS NEVER DONE HERE
 *  -----------------------
 *  * no audio is faked, generated or synthesised,
 *  * no track plays that the server did not say was licensed,
 *  * nothing is inserted into localStorage that has not been validated by
 *    `normalisePreference` - the store is user-editable, so it is treated as
 *    untrusted input.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_MUSIC_PREFERENCE,
  MUSIC_MOODS,
  nextTrack,
  normalisePreference,
  preferenceKey,
  type MusicPreference,
  type MusicTrack,
} from "../../platform/music";

interface Props {
  storeId: string;
  /** The store's declared mood, used to choose a track that suits it. */
  mood?: string | null;
  /** The tracks the server says are playable. */
  tracks: MusicTrack[];
  /** The track the store's storefront would use by default. */
  suggested: MusicTrack | null;
  className?: string;
}

export function StorefrontMusic({ storeId, mood = null, tracks, suggested, className = "" }: Props) {
  const [preference, setPreference] = useState<MusicPreference>(DEFAULT_MUSIC_PREFERENCE);
  const [track, setTrack] = useState<MusicTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ---- Restore the customer's saved choice ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(preferenceKey(storeId));
      // Untrusted input: normalised rather than trusted.
      setPreference(normalisePreference(raw ? JSON.parse(raw) : null));
    } catch {
      setPreference({ ...DEFAULT_MUSIC_PREFERENCE });
    }
    setLoaded(true);
  }, [storeId]);

  // ---- Resolve which track should be playing ----
  useEffect(() => {
    if (!loaded) return;
    if (!preference.enabled) {
      setTrack(null);
      return;
    }
    if (preference.trackId) {
      const chosen = tracks.find((entry) => entry.id === preference.trackId);
      // A track that has since been removed must not keep playing.
      if (chosen) {
        setTrack(chosen);
        return;
      }
    }
    setTrack(suggested);
  }, [loaded, preference.enabled, preference.trackId, tracks, suggested]);

  // ---- Keep the element in step with the choice ----
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (audio.src !== new URL(track.url, window.location.origin).href) {
      audio.src = track.url;
      audio.volume = preference.volume;
    }
  }, [track, preference.volume]);

  const persist = useCallback(
    (next: MusicPreference) => {
      setPreference(next);
      try {
        localStorage.setItem(preferenceKey(storeId), JSON.stringify(next));
      } catch {
        // Storage blocked: the choice lasts for this visit only, which is an
        // acceptable degradation and not worth interrupting a shopper over.
      }
    },
    [storeId],
  );

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // A rejected promise here is the browser refusing autoplay. It is not an
    // error to surface - the customer simply has not interacted yet.
    void audio.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }, []);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
  }, []);

  const changeTrack = useCallback(() => {
    const following = nextTrack(track?.id ?? null, storeId, mood, tracks, 1);
    if (!following) return;
    persist({ ...preference, enabled: true, trackId: following.id });
    setTrack(following);
    // Autoplay after a gesture IS allowed, so the new track can start straight
    // away - but only muted, for the same reason as the first track.
    const audio = audioRef.current;
    if (audio) {
      audio.src = following.url;
      audio.volume = preference.volume;
      void audio.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    }
  }, [track, storeId, mood, tracks, preference, persist]);

  const stop = useCallback(() => {
    pause();
    persist({ ...preference, enabled: false });
  }, [pause, preference, persist]);

  // NOTHING TO SHOW. Either no library, or the customer has music off. Either
  // way the storefront renders no player rather than a broken one.
  if (tracks.length === 0) return null;
  if (loaded && !preference.enabled) {
    return (
      <button
        type="button"
        onClick={() => persist({ ...preference, enabled: true })}
        className={`min-h-9 rounded-full border border-yene-line bg-yene-surface/90 px-3 text-[11.5px] text-yene-muted backdrop-blur ${className}`}
        aria-label="Play store music"
      >
        ♪ Play music
      </button>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border border-yene-line bg-yene-surface/90 px-2 py-1 backdrop-blur ${className}`}
      role="group"
      aria-label="Store music"
    >
      <audio ref={audioRef} loop preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />

      {playing ? (
        <button
          type="button"
          onClick={pause}
          className="min-h-8 px-2 text-[11.5px] text-yene-muted"
          aria-label="Pause music"
        >
          ❚❚ Pause
        </button>
      ) : (
        <button
          type="button"
          onClick={play}
          className="min-h-8 px-2 text-[11.5px] text-yene-muted"
          aria-label="Play music"
        >
          ▶ Play
        </button>
      )}

      {track && (
        <span className="hidden max-w-[9rem] truncate text-[11px] text-yene-faint sm:inline" title={track.artist}>
          {track.title}
        </span>
      )}

      <button
        type="button"
        onClick={changeTrack}
        className="min-h-8 px-1.5 text-[11.5px] text-yene-muted"
        aria-label="Change track"
        title="Change track"
      >
        ⏭
      </button>

      <button
        type="button"
        onClick={stop}
        className="min-h-8 px-1.5 text-[11.5px] text-yene-muted"
        aria-label="Turn music off"
        title="Turn music off"
      >
        ✕
      </button>
    </div>
  );
}

/** The mood a merchant picks for their store, for the admin form. */
export function MusicMoodPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (mood: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-11 w-full rounded-xl border border-yene-line bg-yene-surface px-3 text-[13px] text-yene-text"
    >
      <option value="">No mood set</option>
      {MUSIC_MOODS.map((mood) => (
        <option key={mood.id} value={mood.id}>
          {mood.label}
        </option>
      ))}
    </select>
  );
}
