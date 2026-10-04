/**
 * ============================================================================
 *  AUTO-SCROLLING RAIL
 * ============================================================================
 *
 *  A horizontally scrolling row that advances itself, one card at a time.
 *
 *  Built for the Featured Businesses row, and reusable by any other rail.
 *
 *  FOUR THINGS THIS GETS RIGHT, WHICH IS WHY IT IS ITS OWN COMPONENT
 *  ----------------------------------------------------------------
 *  1. IT STOPS WHEN THERE IS NOTHING TO SCROLL. If the cards fit, no timer is
 *     created at all - a carousel that animates a row which is not scrollable
 *     is a spinner with no work to do.
 *
 *  2. THE USER ALWAYS WINS. Hover, keyboard focus, a wheel, a drag, or a tap on
 *     a card pauses it immediately, and it only resumes after the pointer has
 *     been still for a moment. Someone reaching for a card must never have the
 *     row slide out from under their finger.
 *
 *  3. IT IS PAUSABLE ON PURPOSE. WCAG 2.2.2 requires a mechanism to stop
 *     auto-updating content, and "move the mouse away" is not one. The play/
 *     pause control is that mechanism, so this is not only a nicety.
 *
 *  4. IT RESPECTS REDUCED MOTION. The stylesheet kills CSS animations for
 *     `prefers-reduced-motion`, but this row is scrolled from JavaScript, so
 *     the media query has to be honoured here too or the setting does nothing.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { TOUCH } from "./ProductCard";

/** How long a card stays put before the row advances. */
const DEFAULT_INTERVAL_MS = 4000;
/** How long the pointer must be still before auto-scrolling resumes. */
const RESUME_DELAY_MS = 6000;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface AutoScrollRailProps {
  children: ReactNode;
  /** Distinguishes several rails on one page for screen readers. */
  ariaLabel: string;
  intervalMs?: number;
}


export function AutoScrollRail({
  children,
  ariaLabel,
  intervalMs = DEFAULT_INTERVAL_MS,
}: AutoScrollRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set while the pointer is over the row, or while the user is driving it. */
  const [interacting, setInteracting] = useState(false);
  /** The explicit pause control. Separate from `interacting` on purpose. */
  const [paused, setPaused] = useState(false);
  /** Mirrored into state so the arrow buttons enable/disable correctly. */
  const [edges, setEdges] = useState({ start: true, end: false });
  /**
   * Whether the row actually overflows. Kept in state, not read off the ref
   * during render, so the controls appear on the first paint after measuring
   * rather than one frame late.
   */
  const [scrollable, setScrollable] = useState(false);

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft <= 2, end: max <= 2 || el.scrollLeft >= max - 2 });
    setScrollable(max > 2);
  }, []);

  /** Move one card to the right, or back to the start once past the last. */
  const step = useCallback((direction: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    // One card plus the rail's own gap, so it never lands half-way between two.
    const amount = (first?.offsetWidth ?? 240) + 12;
    const max = el.scrollWidth - el.clientWidth;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";

    if (direction === 1) {
      if (el.scrollLeft >= max - 2) {
        // Past the last card, return to the first. Looping is what makes a
        // showcase feel continuous rather than stalling at the end.
        el.scrollTo({ left: 0, behavior });
        return;
      }
      el.scrollTo({ left: Math.min(el.scrollLeft + amount, max), behavior });
      return;
    }

    if (el.scrollLeft <= 2) {
      el.scrollTo({ left: max, behavior });
      return;
    }
    el.scrollTo({ left: Math.max(el.scrollLeft - amount, 0), behavior });
  }, []);

  // Re-measure when the viewport changes, so the arrows stay correct after a
  // resize turns a scrolling row into a still one.
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // THE AUTO-ADVANCE ITSELF.
  //
  // No timer is created unless the row actually overflows, the user is not
  // driving it, the pause control is off, and reduced motion is not requested.
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    if (!scrollable) return;
    if (interacting || paused || prefersReducedMotion()) return;
    const id = setInterval(() => {
      // A row scrolled out of view (another tab, a background window) must not
      // keep consuming time and fighting the user on their return.
      if (document.visibilityState !== "visible") return;
      step(1);
    }, intervalMs);

    return () => clearInterval(id);
  }, [interacting, paused, intervalMs, scrollable, step]);

  /** Pause while the user is doing anything, then restart after they stop. */
  const hold = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    setInteracting(true);
    resumeTimer.current = setTimeout(() => setInteracting(false), RESUME_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <div ref={railRef} className="min-w-0 flex-1">
          <ul
            aria-label={ariaLabel}
            onScroll={measure}
            onMouseEnter={hold}
            onMouseLeave={hold}
            onFocus={hold}
            onBlur={hold}
            onWheel={hold}
            onTouchStart={hold}
            onPointerDown={hold}
            className="yene-rail"
          >
            {children}
          </ul>
        </div>

        {scrollable && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={() => {
                hold();
                step(-1);
              }}
              disabled={edges.start}
              aria-label="Scroll to the previous businesses"
              className={`${TOUCH} inline-flex w-9 items-center justify-center rounded-button border border-yene-line-soft text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent disabled:opacity-35 disabled:hover:border-yene-line-soft`}
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
            {/* WCAG 2.2.2: a real control to stop the auto-scrolling. */}
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              aria-label={paused ? "Resume auto-scrolling" : "Pause auto-scrolling"}
              aria-pressed={paused}
              className={`${TOUCH} inline-flex w-9 items-center justify-center rounded-button border border-yene-line-soft text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
            >
              {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
            </button>
            <button
              type="button"
              onClick={() => {
                hold();
                step(1);
              }}
              disabled={edges.end}
              aria-label="Scroll to the next businesses"
              className={`${TOUCH} inline-flex w-9 items-center justify-center rounded-button border border-yene-line-soft text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent disabled:opacity-35 disabled:hover:border-yene-line-soft`}
            >
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
