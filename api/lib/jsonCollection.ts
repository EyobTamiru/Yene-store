import fs from "node:fs";
import path from "node:path";

/**
 * A tiny durable JSON collection on disk.
 *
 * Exists so the ticket store and the live chat store share one write strategy
 * rather than each reimplementing it:
 *
 *  - writes are ATOMIC (temp file + rename), so a crash mid-write can never
 *    truncate the data
 *  - writes are COALESCED, so a burst of updates costs one disk write
 *  - a corrupt file is reported and the store starts empty rather than
 *    taking the whole application down
 *
 * It is a SINGLE-WRITER store. Do not run more than one instance against the
 * same file; swap this for a real database before scaling out.
 *
 * TODO(production): replace with a database. Callers only use load(), save()
 * and the two mutators, so the seam is small.
 */
export interface JsonCollection<T> {
  /** Every record, in insertion order. Mutate the returned array in place. */
  all(): T[];
  /** Mark the collection dirty; the write is coalesced onto the next tick. */
  touch(): void;
  /** Force an immediate synchronous write. Used by tests. */
  flush(): void;
  readonly file: string;
}

export function createJsonCollection<T>(
  file: string,
  label: string,
  limit = 5000,
): JsonCollection<T> {
  let cache: T[] | null = null;
  let dirty = false;

  const load = (): T[] => {
    if (cache) return cache;
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        cache = Array.isArray(parsed) ? (parsed as T[]) : [];
      } else {
        cache = [];
      }
    } catch (error) {
      console.error(`[${label}] could not read store, starting empty:`, error);
      cache = [];
    }
    return cache;
  };

  const write = () => {
    if (!cache) return;
    if (cache.length > limit) {
      cache = cache.slice(cache.length - limit);
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(cache, null, 2), "utf8");
      fs.renameSync(temp, file);
    } catch (error) {
      console.error(`[${label}] could not write store:`, error);
    }
  };

  const schedule = () => {
    if (dirty) return;
    dirty = true;
    queueMicrotask(() => {
      dirty = false;
      write();
    });
  };

  return {
    file,
    all: load,
    touch: schedule,
    flush: write,
  };
}
