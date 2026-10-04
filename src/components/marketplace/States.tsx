/**
 * ============================================================================
 *  STATES (spec §9, §13)
 * ============================================================================
 *
 *  "Support empty and loading states", "proper loading and error states", and
 *  "do not fake successful payments, orders, or authentication".
 *
 *  So every section can render three honest states, and an error is ALWAYS
 *  visibly an error - never a silently empty section that reads like "no
 *  results", because those two mean very different things to a shopper.
 */

import { AlertTriangle, PackageOpen } from "lucide-react";
import { TOUCH } from "./ProductCard";

/** A shimmering card placeholder that matches the real card's dimensions. */
export function CardSkeleton() {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-card border border-yene-line-soft bg-yene-surface"
    >
      <div className="aspect-4/3 w-full animate-pulse bg-yene-raised" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-4/5 animate-pulse rounded bg-yene-raised" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-yene-raised" />
        <div className="h-7 w-full animate-pulse rounded-button bg-yene-raised" />
      </div>
    </div>
  );
}

export function SectionSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 tablet:grid-cols-3 laptop:grid-cols-4 desktop:grid-cols-5"
      role="status"
      aria-label="Loading products"
    >
      {Array.from({ length: count }).map((_, index) => (
        <CardSkeleton key={index} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-yene-line px-6 py-12 text-center">
      <PackageOpen size={26} aria-hidden className="mb-2 text-yene-faint" />
      <p className="text-[14px] font-medium text-yene-text">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-[12.5px] text-yene-muted">{hint}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={`${TOUCH} mt-4 rounded-button border border-yene-line px-4 text-[13px] font-medium text-yene-text transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-card border border-yene-danger/40 bg-yene-danger/5 px-6 py-8 text-center"
    >
      <AlertTriangle size={24} aria-hidden className="mb-2 text-yene-danger" />
      <p className="text-[13.5px] font-medium text-yene-text">Something went wrong</p>
      <p className="mt-1 max-w-md text-[12.5px] text-yene-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={`${TOUCH} mt-4 rounded-button bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** A short inline notice, used for the "corrected your search" case. */
export function InlineNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-button border border-yene-info/40 bg-yene-info/10 px-3 py-2 text-[12.5px] text-yene-info">
      {children}
    </p>
  );
}
