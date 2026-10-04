/**
 * ============================================================================
 *  THEME (dark / light)
 * ============================================================================
 *
 *  A theme switch that works by flipping `data-theme` on <html>, which swaps
 *  the CSS variables every component reads. See src/index.css for why that
 *  re-themes the whole application without touching a single component.
 *
 *  PERSISTENCE
 *  -----------
 *  The choice is written to localStorage, and index.html reads it BEFORE the
 *  first paint, so a returning user never sees a flash of the wrong theme.
 *
 *  "System" IS NOT OFFERED, DELIBERATELY
 *  -------------------------------------
 *  A three-way switch (light / dark / system) looks tidier but is worse here:
 *  the OS can change at sunset, which would re-theme the page while somebody is
 *  halfway through checkout. Two explicit states are predictable, and the
 *  system preference is still honoured as the DEFAULT on a first visit.
 */

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type ThemeName = "dark" | "light";

const STORAGE_KEY = "yene-theme";

/** Canvas colours, matching the `@theme` tokens in src/index.css. */
const THEME_COLORS: Record<ThemeName, string> = {
  dark: "#0D1117",
  light: "#F6F8FA",
};

function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing. The attribute is already set, so the theme still
    // applies for this session - it just will not be remembered.
  }
  // Repaint the browser's own chrome (the mobile address bar) to match the
  // page, so the OS UI does not contradict a light page with a dark bar.
  const swatch = document.getElementById("yene-theme-color");
  if (swatch) swatch.setAttribute("content", THEME_COLORS[theme]);
}

export function currentTheme(): ThemeName {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** Called once at app start, to reconcile React state with the bootstrap. */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(() => currentTheme());

  useEffect(() => {
    // The bootstrap script in index.html already set the attribute; this only
    // keeps React in step with it, and covers a browser back/forward that
    // restored a different document.
    applyTheme(theme);
  }, [theme]);

  const toggle = () => setTheme((value) => (value === "dark" ? "light" : "dark"));

  return { theme, toggle, setTheme };
}

/**
 * The toggle button.
 *
 * Both icons are always rendered and swapped with CSS, so the control does not
 * change width when it flips - a shifting button is a small, persistent
 * annoyance in a sticky header.
 */
export function ThemeToggle({
  theme,
  onToggle,
  className = "",
}: {
  theme: ThemeName;
  onToggle: () => void;
  className?: string;
}) {
  const nextLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={nextLabel}
      aria-label={nextLabel}
      className={`min-h-11 min-w-11 inline-flex items-center justify-center rounded-button border border-transparent px-2.5 text-yene-muted transition-colors hover:border-yene-line hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${className}`}
    >
      <Sun size={17} aria-hidden className={theme === "light" ? "hidden" : "block"} />
      <Moon size={17} aria-hidden className={theme === "light" ? "block" : "hidden"} />
      <Monitor size={14} aria-hidden className="sr-only" />
    </button>
  );
}
