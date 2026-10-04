/**
 * ============================================================================
 *  MANAGEMENT SECTION PRIMITIVES
 * ============================================================================
 *
 *  The four states every section can be in, defined once so a section cannot
 *  invent a fifth:
 *
 *    Loading   a spinner and a line saying what is being fetched
 *    Error     what went wrong and a Retry that genuinely re-fetches
 *    Empty     real: "you have none yet", never a fake row
 *    Ready     the data
 *
 *  WHY EMPTY IS ITS OWN STATE
 *  --------------------------
 *  An empty list and a failed request look identical if you are not careful, and
 *  showing "No products yet" when the request actually failed is a lie that
 *  costs the user an afternoon. They are separate branches here on purpose.
 *
 *  RESPONSIVE TABLES
 *  -----------------
 *  `DataTable` is a real `<table>` on tablet and up, and a stacked list of
 *  cards on a phone. Both render from the same `columns` array, so the two
 *  layouts cannot drift apart. The table scrolls inside its own container
 *  rather than pushing the page wide - the usual cause of horizontal overflow
 *  at 320px.
 */

import { AlertTriangle, Inbox, Loader2, RotateCw } from "lucide-react";
import { TOUCH } from "../marketplace/ProductCard";

export function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-14" role="status" aria-live="polite">
      <Loader2 size={18} className="animate-spin text-yene-accent" aria-hidden />
      <span className="text-[13px] text-yene-muted">{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-card border border-yene-danger/40 bg-yene-danger/10 px-4 py-5 text-center">
      <AlertTriangle size={20} className="mx-auto text-yene-danger" aria-hidden />
      <p className="mt-2 text-[13px] text-yene-danger">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={`${TOUCH} mt-3 inline-flex items-center gap-1.5 rounded-button border border-yene-danger/40 px-3.5 text-[12.5px] font-medium text-yene-danger transition-colors hover:bg-yene-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
      >
        <RotateCw size={14} aria-hidden />
        Try again
      </button>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-card border border-dashed border-yene-line-soft bg-yene-raised px-4 py-10 text-center">
      <Inbox size={20} className="mx-auto text-yene-faint" aria-hidden />
      <p className="mt-2 text-[13px] font-medium text-yene-muted">{title}</p>
      {hint && <p className="mt-1 text-[12.5px] text-yene-faint">{hint}</p>}
    </div>
  );
}

/**
 * The honest "this is not built yet" panel.
 *
 * Used only where the registry records no backend. It names the gap instead of
 * showing a spinner that never resolves or a form that quietly discards input.
 */
export function NotBuiltNotice({ missing }: { missing: string }) {
  return (
    <div className="rounded-card border border-yene-line-soft bg-yene-raised px-4 py-6">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-yene-warn" aria-hidden />
        <div>
          <p className="text-[13px] font-medium text-yene-text">Not available yet</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-yene-muted">{missing}</p>
        </div>
      </div>
    </div>
  );
}

/** The capability note for a section that reads but cannot yet write. */
export function ReadOnlyNotice({ missing }: { missing: string }) {
  return (
    <p className="rounded-button border border-yene-info/40 bg-yene-info/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-yene-info">
      {missing}
    </p>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer. A string, or arbitrary nodes for a richer column. */
  render: (row: T) => React.ReactNode;
  numeric?: boolean;
}

/**
 * A responsive table.
 *
 * Phone: one card per row. Tablet and up: a real table. Both from the same
 * `columns`, so the two layouts cannot disagree.
 */
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  empty,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  empty: { title: string; hint?: string };
  caption?: string;
}) {
  if (rows.length === 0) return <EmptyState title={empty.title} hint={empty.hint} />;
  const primary = columns[0];
  const rest = columns.slice(1);

  return (
    <>
      <div className="yene-scroll hidden overflow-x-auto rounded-card border border-yene-line-soft tablet:block">
        <table className="w-full min-w-[640px] border-collapse text-left">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-yene-line-soft">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-yene-faint ${
                    column.numeric ? "text-right" : "text-left"
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-yene-line-soft last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2.5 text-[12.5px] text-yene-text ${
                      column.numeric ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 tablet:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-card border border-yene-line-soft bg-yene-surface px-3 py-2.5">
            <p className="text-[13px] font-medium text-yene-text">{primary.render(row)}</p>
            <dl className="mt-1.5 space-y-1">
              {rest.map((column) => (
                <div key={column.key} className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-[11.5px] text-yene-faint">{column.header}</dt>
                  <dd className="truncate text-right text-[12.5px] text-yene-muted">{column.render(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A read-only definition row, used by the detail panels. */
export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-yene-line-soft py-2 last:border-0">
      <dt className="shrink-0 text-[12.5px] text-yene-muted">{label}</dt>
      <dd className="break-words text-right text-[12.5px] font-medium text-yene-text">{value}</dd>
    </div>
  );
}

/** A small heading above a group of rows. */
export function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-6 text-[11.5px] font-semibold uppercase tracking-wide text-yene-faint">
      {children}
    </h3>
  );
}
