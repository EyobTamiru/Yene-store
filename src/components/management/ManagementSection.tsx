/**
 * ============================================================================
 *  MANAGEMENT SECTION - the shell that opens one module
 * ============================================================================
 *
 *  This is what a module tile opens. It supplies the sidebar (a collapsible
 *  drawer on a phone, a permanent column from tablet up) and hands the content
 *  area to `SectionBody`.
 *
 *  RESPONSIVE
 *  ----------
 *  Phone (320-767): the section list is a full-height overlay drawer opened
 *  from a button in the sub-header. One tap target per row, no horizontal
 *  scroll, and the drawer closes on Escape or on resize to tablet.
 *  Tablet (768-1199) and up: a fixed-width sidebar beside the content.
 *
 *  The content never stretches to an unreadable measure on a very wide screen -
 *  the table scrolls inside its own container rather than the page scrolling.
 *
 *  NOTHING HERE DECIDES ACCESS
 *  ---------------------------
 *  The caller passes the modules the SERVER already filtered. A locked module
 *  is shown, never hidden, because hiding it would let a role that lacks it
 *  infer that it exists. The server re-checks on every request regardless - this
 *  is presentation, never the control.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Lock, X } from "lucide-react";
import { SectionBody } from "./SectionBody";
import { MANAGEMENT_SECTIONS, type SectionDefinition } from "./sectionRegistry";
import { TOUCH } from "../marketplace/ProductCard";
import type { ManagementModule, ManagementOverview } from "../../lib/managementApi";

export function ManagementSection({
  module,
  modules,
  overview,
  onBack,
  onOpenSupport,
}: {
  module: ManagementModule;
  /** The full server-filtered module list, for the sidebar. */
  modules: ManagementModule[];
  overview: ManagementOverview;
  onBack: () => void;
  onOpenSupport: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const definition: SectionDefinition | null =
    MANAGEMENT_SECTIONS.find((entry) => entry.key === module.key) ?? null;

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setDrawerOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  if (!definition) {
    return (
      <div className="min-h-dvh bg-yene-bg px-4 py-10">
        <p className="text-[13px] text-yene-muted">This module is not recognised.</p>
      </div>
    );
  }

  const nav = (
    <nav aria-label="Management sections" className="space-y-0.5">
      {modules.map((entry) => (
        <NavRow
          key={entry.key}
          module={entry}
          current={entry.key === module.key}
          onNavigate={setDrawerOpen}
        />
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="sticky top-0 z-40 border-b border-yene-line-soft bg-yene-bg/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1800px] items-center gap-3 px-4 py-3 tablet:px-6">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to overview"
            className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button px-2.5 text-[13px] font-medium text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            <ArrowLeft size={16} aria-hidden />
            <span className="hidden tablet:inline">Overview</span>
          </button>
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-yene-text">
            {definition.label}
          </h1>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-label="All sections"
            className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button border border-yene-line px-2.5 text-[12.5px] font-medium text-yene-text transition-colors hover:border-yene-accent hover:text-yene-accent tablet:hidden`}
          >
            Sections
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>
      </header>
      <Content
        definition={definition}
        module={module}
        overview={overview}
        nav={nav}
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
        onOpenSupport={onOpenSupport}
      />
    </div>
  );
}

/**
 * The layout below the header, split out purely to keep this file readable.
 *
 * `definition` is non-null here because the parent has already returned if the
 * key was unknown.
 */
function Content({
  definition,
  module,
  overview,
  nav,
  drawerOpen,
  setDrawerOpen,
  onOpenSupport,
}: {
  definition: SectionDefinition;
  module: ManagementModule;
  overview: ManagementOverview;
  nav: React.ReactNode;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  onOpenSupport: () => void;
}) {
  return (
    <>
      <div className="mx-auto flex w-full max-w-[1800px] gap-6 px-4 py-5 tablet:px-6">
        <aside className="hidden w-56 shrink-0 tablet:block">
          <div className="sticky top-[72px]">{nav}</div>
        </aside>
        <main className="min-w-0 flex-1">
          <p className="text-[12.5px] leading-relaxed text-yene-muted">{definition.summary}</p>
          {module.access === "locked" ? (
            <LockedPanel module={module} />
          ) : (
            <div className="mt-4">
              <SectionBody
                section={definition}
                overview={overview}
                subdomain={overview.business?.subdomain ?? ""}
                onNavigateSupport={onOpenSupport}
              />
            </div>
          )}
        </main>
      </div>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 tablet:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Sections"
        >
          <button
            type="button"
            aria-label="Close sections"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/50"
            tabIndex={-1}
          />
          <div className="yene-scroll absolute inset-y-0 left-0 w-[82%] max-w-[300px] overflow-y-auto border-r border-yene-line-soft bg-yene-surface">
            <div className="flex items-center justify-between border-b border-yene-line-soft px-4 py-3">
              <span className="text-[13px] font-semibold text-yene-text">Sections</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close"
                className={`${TOUCH} rounded-button px-2 text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="p-2">{nav}</div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * One row in the section list.
 *
 * A LOCKED row says plainly what blocks it. "Upgrade to Platinum" is only ever
 * shown when the PACKAGE is the blocker; if the visitor's ROLE is what is
 * missing, no upgrade would help, and offering one would be a lie. That is the
 * existing `ModuleTile` contract, kept identical here.
 */
function NavRow({
  module,
  current,
  onNavigate,
}: {
  module: ManagementModule;
  current: boolean;
  onNavigate: (open: boolean) => void;
}) {
  const locked = module.access === "locked";

  return (
    <button
      type="button"
      onClick={() => {
        window.location.hash = `#/management/${module.key}`;
        onNavigate(false);
      }}
      aria-current={current ? "page" : undefined}
      title={
        locked
          ? module.unlockWith
            ? `Available on ${module.unlockWith}`
            : "Not available to your role"
          : module.label
      }
      className={`${TOUCH} flex w-full items-center gap-2 rounded-button px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
        current
          ? "bg-yene-accent-dim text-yene-accent"
          : locked
            ? "text-yene-faint hover:bg-yene-raised hover:text-yene-muted"
            : "text-yene-muted hover:bg-yene-raised hover:text-yene-text"
      }`}
    >
      {locked ? <Lock size={13} className="shrink-0" aria-hidden /> : null}
      {current ? <Check size={13} className="shrink-0" aria-hidden /> : null}
      <span className="min-w-0 flex-1 truncate">{module.label}</span>
    </button>
  );
}

/** The panel shown when the server says this module is locked. */
function LockedPanel({ module }: { module: ManagementModule }) {
  return (
    <div className="mt-4 rounded-card border border-yene-line-soft bg-yene-raised px-4 py-6">
      <div className="flex items-start gap-2.5">
        <Lock size={17} className="mt-0.5 shrink-0 text-yene-warn" aria-hidden />
        <div>
          <p className="text-[13px] font-medium text-yene-text">
            {module.unlockWith ? `Available on ${module.unlockWith}` : "Not available to your role"}
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-yene-muted">
            {module.unlockWith
              ? "Your existing data is untouched and reappears the moment your package includes this feature."
              : "This is blocked by your role rather than your package, so an upgrade would not change it. Ask a manager to review your permissions."}
          </p>
        </div>
      </div>
    </div>
  );
}
