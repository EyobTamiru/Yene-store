/**
 * ============================================================================
 *  MANAGEMENT SECTION HOST
 * ============================================================================
 *
 *  A thin wrapper that fetches the management OVERVIEW and hands it to
 *  `ManagementSection`.
 *
 *  WHY THIS EXISTS
 *  ---------------
 *  The Overview tiles live inside `ManagementSystem`, which fetches
 *  `/api/management/overview` itself. A section needs the same figures - the
 *  Analytics section reads them directly - and passing the whole overview
 *  screen down as a prop would mean rendering it just to reach its data.
 *
 *  So this fetches the SAME endpoint and shows the same loading and error
 *  states. Two components reading one endpoint is fine; two components
 *  INVENTING the figures is not, and neither does.
 *
 *  ERROR HANDLING
 *  --------------
 *  A 401 and a 403 say different things and need different actions, which is
 *  the §15 rule the Management System already follows. It is kept here so a
 *  deep link into a section is as clear as a link into the overview.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Lock, RotateCw } from "lucide-react";
import { ManagementSection } from "./ManagementSection";
import { TOUCH } from "../marketplace/ProductCard";
import {
  fetchManagementOverview,
  ManagementError,
  type ManagementModule,
  type ManagementOverview,
} from "../../lib/managementApi";

export function ManagementSectionHost({
  moduleKey,
  modules,
  onBack,
  onOpenSupport,
}: {
  moduleKey: string;
  modules: ManagementModule[];
  onBack: () => void;
  onOpenSupport: () => void;
}) {
  const [overview, setOverview] = useState<ManagementOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ManagementError | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchManagementOverview()
      .then((result) => {
        setOverview(result);
        setError(null);
      })
      .catch((cause) => setError(cause as ManagementError))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-yene-bg">
        <Loader2 size={24} className="animate-spin text-yene-accent" aria-hidden />
        <p className="text-[13px] text-yene-muted">Loading...</p>
      </div>
    );
  }

  if (error) {
    const expired = error.status === 401;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-yene-bg px-4 text-center">
        <Lock size={24} className="text-yene-muted" aria-hidden />
        <p className="max-w-sm text-[14px] text-yene-text">{error.userMessage}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className={`${TOUCH} rounded-button border border-yene-line px-4 text-[13px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            Back to the overview
          </button>
          <button
            type="button"
            onClick={load}
            className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button border border-yene-line px-4 text-[13px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            <RotateCw size={14} aria-hidden />
            Try again
          </button>
        </div>
        {expired && (
          <p className="text-[12px] text-yene-faint">Your session has expired. Sign in again to continue.</p>
        )}
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-yene-bg px-4 text-center">
        <AlertTriangle size={22} className="text-yene-danger" aria-hidden />
        <p className="text-[13px] text-yene-muted">We could not load this section. Please try again.</p>
      </div>
    );
  }

  const module = modules.find((entry) => entry.key === moduleKey);
  if (!module) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-yene-bg px-4 text-center">
        <p className="text-[14px] text-yene-text">This section is not available to you.</p>
        <button
          type="button"
          onClick={onBack}
          className={`${TOUCH} rounded-button bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          Back to the overview
        </button>
      </div>
    );
  }

  return (
    <ManagementSection
      module={module}
      modules={modules}
      overview={overview}
      onBack={onBack}
      onOpenSupport={onOpenSupport}
    />
  );
}
