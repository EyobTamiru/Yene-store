/**
 * ============================================================================
 *  MANAGEMENT SYSTEM
 * ============================================================================
 *
 *  The landing page the header's "Management System" button opens.
 *
 *  WHAT IT RENDERS
 *  ---------------
 *  Business identity, the role the visitor actually holds, the overview tiles
 *  and the module grid. Every module already carries the server's `access`
 *  verdict, so this component never asks what a package or a role can do - it
 *  renders what it was told, which is what stops a fifth rule appearing here by
 *  accident.
 *
 *  THE THREE MODULE STATES (the existing Section 37 contract)
 *  -------------------------------------------------------
 *    available  usable
 *    locked     shown, with what would open it and the note that the data is
 *               still there, because a downgrade locks a feature, never deletes
 *               it
 *    hidden     not offered at all
 *
 *  A LOCKED module says plainly that it is unavailable, rather than
 *  "Upgrade to Platinum": if the blocker is the visitor's ROLE, no upgrade would
 *  ever grant it, and offering one would be a lie.
 *
 *  §6: the header states that management mode is active and offers a
 *  Storefront button back to the public store.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  LayoutGrid,
  Loader2,
  Lock,
  LogOut,
  Store,
} from "lucide-react";
import {
  fetchManagementOverview,
  ManagementError,
  type ManagementModule,
  type ManagementOverview,
} from "../../lib/managementApi";
import { TOUCH } from "../marketplace/ProductCard";
import { ThemeToggle, useTheme } from "../marketplace/ThemeToggle";

/** ETB, grouped. The same convention as the rest of the platform. */
function etb(value: number): string {
  return `${value.toLocaleString("en-US")} ETB`;
}

/** How each role reads on screen. */
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  employee: "Employee",
  customer: "Customer",
  "super-admin": "Super Admin",
  guest: "Guest",
};

export function ManagementSystem({
  onExit,
  onOpenStorefront,
  onSignOut,
}: {
  onExit: () => void;
  onOpenStorefront: () => void;
  onSignOut: () => void;
}) {
  const { theme, toggle } = useTheme();
  const [data, setData] = useState<ManagementOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchManagementOverview()
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((cause) => {
        const e = cause as ManagementError;
        setError({ message: e.userMessage, status: e.status });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // §15: never a blank page. Each state says what to do next rather than just
  // refusing, and an expired session and a permission failure are different
  // messages because they need different actions.
  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-yene-bg">
        <Loader2 size={24} className="animate-spin text-yene-accent" aria-hidden />
        <p className="text-[13px] text-yene-muted">Loading Management System...</p>
      </div>
    );
  }

  if (error) {
    const expired = error.status === 401;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-yene-bg px-4 text-center">
        <Lock size={24} className="text-yene-muted" aria-hidden />
        <p className="max-w-sm text-[14px] text-yene-text">{error.message}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onExit}
            className={`${TOUCH} rounded-button border border-yene-line px-4 text-[13px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            Back to the marketplace
          </button>
          {expired && (
            <button
              type="button"
              onClick={onSignOut}
              className={`${TOUCH} rounded-button bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
            >
              Sign in again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { stats, business, modules } = data;
  const usable = modules.filter((module) => module.access === "available");
  const locked = modules.filter((module) => module.access === "locked");
  const roleLabel = data.roleName ?? ROLE_LABELS[data.role] ?? data.role;

  return (
    <div className="min-h-dvh bg-yene-bg">
      <ManagementHeader
        onExit={onExit}
        onOpenStorefront={onOpenStorefront}
        onSignOut={onSignOut}
        theme={theme}
        onToggleTheme={toggle}
      />

      <main className="mx-auto w-full max-w-[1600px] px-4 py-8 tablet:px-6 desktop:px-8">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-yene-accent">
          Management System
        </p>

        <section className="mt-7">
          <h2 className="text-sm font-semibold text-yene-text">Overview</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 tablet:grid-cols-3 desktop:grid-cols-6">
            <Tile label="Today's Sales" value={etb(stats.todaySales)} accent />
            <Tile label="Orders today" value={String(stats.todayOrders)} />
            <Tile label="Orders" value={String(stats.orders)} />
            <Tile label="Customers" value={String(stats.customers)} />
            <Tile label="Products" value={String(stats.products)} />
            <Tile label="Low Stock" value={String(stats.lowStock)} warn={stats.lowStock > 0} />
          </div>
        </section>

        <section className="mt-9">
          <h2 className="text-sm font-semibold text-yene-text">Management</h2>
          {usable.length === 0 ? (
            <p className="mt-2 text-[13px] text-yene-muted">
              No modules have been assigned to your role yet. Ask a manager to update it.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2.5 tablet:grid-cols-3 desktop:grid-cols-4">
              {usable.map((module) => (
                <ModuleTile key={module.key} module={module} />
              ))}
            </div>
          )}
        </section>

        {locked.length > 0 && (
          <section className="mt-9">
            <h2 className="text-sm font-semibold text-yene-text">
              Not available on your plan or role
            </h2>
            <p className="mt-1 text-[12.5px] text-yene-muted">
              Your existing data is untouched. It stays here and reappears the moment it
              is included again.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2.5 tablet:grid-cols-3 desktop:grid-cols-4">
              {locked.map((module) => (
                <ModuleTile key={module.key} module={module} />
              ))}
            </div>
          </section>
        )}

        {stats.lowStockItems.length > 0 && (
          <section className="mt-9">
            <h2 className="text-sm font-semibold text-yene-text">Needs restocking</h2>
            <ul className="mt-3 divide-y divide-yene-line-soft overflow-hidden rounded-card border border-yene-line-soft">
              {stats.lowStockItems.map((item) => (
                <li
                  key={item.itemId}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="truncate text-[13px] text-yene-text">{item.name}</span>
                  <span className="shrink-0 text-[12.5px] text-yene-warn">
                    {item.onHand} on hand
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

/**
 * The management-mode header (§6).
 *
 * A DIFFERENT header from the marketplace one, deliberately: the brand sits
 * beside an explicit "Management System" marker so it is always obvious which
 * side of the product you are on, and a Storefront button puts one tap back to
 * the public store.
 */
function ManagementHeader({
  onExit,
  onOpenStorefront,
  onSignOut,
  theme,
  onToggleTheme,
}: {
  onExit: () => void;
  onOpenStorefront: () => void;
  onSignOut: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-yene-line-soft bg-yene-bg/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 tablet:px-6 desktop:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yene-accent text-[15px] font-bold text-yene-on-accent">
            Y
          </span>
          <span className="truncate text-[15px] font-semibold tracking-tight text-yene-text">
            YENE-STORE
          </span>
          {/* The "you are in management mode" marker. */}
          <span className="hidden shrink-0 items-center gap-1.5 rounded-button border border-yene-accent/40 bg-yene-accent-dim px-2 py-1 text-[11.5px] font-semibold text-yene-accent tablet:inline-flex">
            <Briefcase size={13} aria-hidden />
            Management System
          </span>
        </div>

        <nav className="flex items-center gap-1.5">
          {/* §6: back to the public storefront. */}
          <button
            type="button"
            onClick={onOpenStorefront}
            title="Open your public storefront"
            className={`${TOUCH} hidden items-center gap-1.5 rounded-button border border-yene-line px-3 text-[12.5px] font-medium text-yene-text transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent tablet:inline-flex`}
          >
            <Store size={15} aria-hidden />
            Storefront
          </button>

          <ThemeToggle theme={theme} onToggle={onToggleTheme} />

          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className={`${TOUCH} hidden items-center justify-center rounded-button px-2.5 text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent tablet:inline-flex`}
          >
            <LogOut size={17} aria-hidden />
          </button>

          {/* §7: on a phone the header is not crowded - one menu button. */}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Open menu"
            className={`${TOUCH} inline-flex items-center justify-center rounded-button px-2.5 text-yene-text transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent tablet:hidden`}
          >
            <LayoutGrid size={18} aria-hidden />
          </button>
        </nav>
      </div>

      {menuOpen && (
        <div className="border-t border-yene-line-soft tablet:hidden">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-1 px-4 py-2">
            {[
              { label: "Storefront", icon: <Store size={16} aria-hidden />, run: onOpenStorefront },
              { label: "Dashboard", icon: <LayoutGrid size={16} aria-hidden />, run: onExit },
              { label: "Sign out", icon: <LogOut size={16} aria-hidden />, run: onSignOut },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  item.run();
                }}
                className={`${TOUCH} flex items-center gap-2.5 rounded-button px-2.5 text-left text-[13px] font-medium text-yene-text transition-colors hover:bg-yene-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

function Tile({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-card border p-3.5 ${
        warn
          ? "border-yene-warn/40 bg-yene-warn/10"
          : accent
            ? "border-yene-accent/40 bg-yene-accent-dim"
            : "border-yene-line-soft bg-yene-surface"
      }`}
    >
      <p className="text-[11.5px] text-yene-muted">{label}</p>
      <p
        className={`mt-1 truncate text-[17px] font-semibold ${
          warn ? "text-yene-warn" : accent ? "text-yene-accent" : "text-yene-text"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * One module tile.
 *
 * A LOCKED tile never says "Upgrade" on its own. The upgrade hint is only true
 * when the PACKAGE is the blocker; if the visitor's ROLE is what is missing, no
 * upgrade would ever help, and offering one would be a lie.
 *
 * IT IS A BUTTON NOW, AND THAT IS THE POINT
 * -----------------------------------------
 * This used to be a `<div>`, which meant all twenty-two modules were displayed
 * and none of them could be opened - decorative navigation, which this codebase
 * explicitly forbids. Opening one routes to `#/management/<key>`, where
 * `ManagementSection` renders the real data for it.
 */
function ModuleTile({ module }: { module: ManagementModule }) {
  const locked = module.access === "locked";
  return (
    <button
      type="button"
      onClick={() => {
        window.location.hash = `#/management/${module.key}`;
      }}
      aria-label={locked ? `${module.label} - not available` : `Open ${module.label}`}
      className={`rounded-button border p-3.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
        locked
          ? "border-dashed border-yene-line-soft bg-yene-raised hover:border-yene-warn/50"
          : "border-yene-line-soft bg-yene-surface hover:border-yene-accent"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={`text-[13px] font-semibold ${locked ? "text-yene-muted" : "text-yene-text"}`}
        >
          {module.label}
        </p>
        {locked ? (
          <Lock size={14} className="shrink-0 text-yene-faint" aria-hidden />
        ) : (
          <CheckCircle2 size={14} className="shrink-0 text-yene-accent" aria-hidden />
        )}
      </div>
      {locked && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-yene-faint">
          {module.unlockWith
            ? `Included from ${module.unlockWith}. Your data is kept.`
            : "Not included in your role."}
        </p>
      )}
    </button>
  );
}
