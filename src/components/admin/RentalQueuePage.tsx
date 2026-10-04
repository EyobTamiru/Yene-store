/**
 * ============================================================================
 *  STORE RENTAL QUEUE (Sections 10 & 41)
 * ============================================================================
 *
 *  The screen an administrator works to approve somebody renting a mall counter,
 *  searching by NAME OR PHONE NUMBER - whichever they were given on the phone.
 *
 *  WHY THE SCREEN REFUSES TO GUESS
 *  -------------------------------
 *  This page is the human half of a safety rule that lives in
 *  `src/platform/rental.ts`. Because "Abebe" matches a great many people in
 *  Ethiopia, a search that named more than one person returns `ambiguous: true`
 *  from the server, and this page responds by:
 *
 *    - refusing to render a single prominent Approve button,
 *    - showing the shortlist so the administrator picks the RIGHT Abebe, and
 *    - saying in plain words why it will not choose for them.
 *
 *  That refusal is the feature. A queue screen that silently approves the first
 *  of five matches is how somebody ends up with a shop they do not own.
 *
 *  The phone number is shown in full on this admin screen and nowhere else: the
 *  whole point is to compare it against what the applicant said on the phone.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Building2, CheckCircle2, Clock, Loader2, Phone, RefreshCw,
  Search, ShieldCheck, User, XCircle,
} from "lucide-react";
import {
  fetchQueue, reviewRental, RentalError,
  type QueueResponse, type QueueRow,
} from "../../lib/rentalApi";
import { CONTENT_WIDTH, TOUCH_TARGET, formatEtbUi } from "../platform/primitives";
import { EmptyState, ErrorState, SectionSkeleton } from "../marketplace/States";

const cell = "px-3 py-2.5 text-[12.5px]";
const input =
  "w-full rounded-lg border border-yene-line bg-yene-raised px-3 py-2 text-[13px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none focus:ring-1 focus:ring-yene-accent/40";

const TIER_TONE: Record<string, string> = {
  phone: "bg-yene-accent-dim text-yene-accent",
  name: "bg-yene-warn/15 text-yene-warn",
  fayda: "bg-yene-accent-dim text-yene-accent",
  tin: "bg-yene-accent-dim text-yene-accent",
};

const IDENTITY_COPY: Record<string, { label: string; tone: string }> = {
  verified: { label: "Fayda verified", tone: "text-yene-accent" },
  "pending-review": { label: "Fayda pending review", tone: "text-yene-warn" },
  "not-started": { label: "No Fayda submitted", tone: "text-yene-danger" },
  rejected: { label: "Fayda rejected", tone: "text-yene-danger" },
};

export function RentalQueuePage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchQueue({ status, query: search || undefined }));
    } catch (caught) {
      setError(caught instanceof RentalError ? caught.userMessage : "Could not load the queue.");
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Decide on ONE row, always by its id.
   *
   * The id - not the query - is what is sent, precisely so a row the
   * administrator has just read cannot be swapped underneath them between
   * seeing it and pressing the button.
   */
  const decide = async (row: QueueRow, decision: "approve" | "reject") => {
    setBusyId(row.id);
    setNotice(null);
    try {
      const result = await reviewRental({
        id: row.id,
        decision,
        reason: decision === "reject" ? "Not approved by Yene Business Group." : undefined,
      });
      setNotice(result.message);
      await load();
    } catch (caught) {
      // A refusal here is the safety rule working, not a bug: the row changed
      // underneath us, or somebody else moved first.
      setError(caught instanceof RentalError ? caught.userMessage : "That did not go through.");
    } finally {
      setBusyId(null);
    }
  };

  // THE REFUSAL. More than one person matched, so there is no single "the one".
  const ambiguous = data?.ambiguous === true && data.applications.length > 1;
  const single = !ambiguous && data?.applications.length === 1 ? data.applications[0] : null;

  return (
    <div className="min-h-dvh bg-yene-bg pb-16">
      <header className="border-b border-yene-line-soft bg-yene-surface">
        <div className={`${CONTENT_WIDTH} py-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-yene-text">Store rental requests</h1>
              <p className="mt-0.5 text-[12.5px] text-yene-muted">
                Approve who rents a counter in a mall. Search by phone number or name.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className={`${TOUCH_TARGET} inline-flex items-center gap-1.5 rounded-button border border-yene-line px-3 text-[12.5px] font-medium text-yene-muted hover:border-yene-accent hover:text-yene-accent`}
            >
              <RefreshCw size={14} aria-hidden /> Refresh
            </button>
          </div>

          <form
            className="mt-4 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(query.trim());
            }}
          >
            <div className="relative min-w-[260px] flex-1">
              <Search
                size={15}
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-yene-faint"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Phone number or name, e.g. 0911 234 567 or Abebe Bekele"
                aria-label="Search by phone number or name"
                className={`${input} pl-9`}
              />
            </div>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="Filter by status"
              className={`${input} w-auto`}
            >
              <option value="pending">Waiting for review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Declined</option>
              <option value="all">All requests</option>
            </select>
            <button
              type="submit"
              className={`${TOUCH_TARGET} rounded-button bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent hover:bg-yene-accent-strong`}
            >
              Search
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSearch("");
                }}
                className={`${TOUCH_TARGET} rounded-button border border-yene-line px-3 text-[13px] text-yene-muted hover:border-yene-accent hover:text-yene-accent`}
              >
                Clear
              </button>
            )}
          </form>

          {data?.counts && !search && (
            <p className="mt-2.5 text-[12px] text-yene-faint">
              {data.counts.pending} waiting for review, {data.counts.total} in total.
            </p>
          )}
        </div>
      </header>

<main className={`${CONTENT_WIDTH} mt-4 space-y-3`}>
        {notice && (
          <p className="rounded-lg border border-yene-accent/40 bg-yene-accent-dim px-3 py-2.5 text-[12.5px] text-yene-accent">
            {notice}
          </p>
        )}
        {error && <ErrorState message={error} />}

        {/* THE REFUSAL, made visible rather than silent. */}
        {ambiguous && (
          <div role="alert" className="rounded-lg border border-yene-warn/50 bg-yene-warn/10 p-3.5">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-yene-warn">
              <AlertTriangle size={15} aria-hidden />
              More than one applicant matches
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-yene-muted">
              {data?.reason ??
                "That search is not specific enough to approve safely. Open the right person below, or search again using their exact phone number."}
            </p>
          </div>
        )}

        {/* One unambiguous result: shown alone, with everything needed to confirm. */}
        {single && (
          <ApplicantCard
            row={single}
            busy={busyId === single.id}
            onApprove={() => void decide(single, "approve")}
            onReject={() => void decide(single, "reject")}
            highlight
          />
        )}

        {loading ? (
          <SectionSkeleton count={3} />
        ) : !data || data.applications.length === 0 ? (
          <EmptyState
            title={search ? "Nobody matches that" : "No requests waiting"}
            hint={
              search
                ? `We could not find an applicant matching "${search}". Check the number, or try the name they gave you.`
                : "When somebody applies for a counter in a mall, their request appears here."
            }
          />
        ) : (
          !ambiguous && (
            <ul className="space-y-3">
              {data.applications.map((row) => (
                <li key={row.id}>
                  <ApplicantCard
                    row={row}
                    busy={busyId === row.id}
                    onApprove={() => void decide(row, "approve")}
                    onReject={() => void decide(row, "reject")}
                  />
                </li>
              ))}
            </ul>
          )
        )}
      </main>
    </div>
  );
}

/**
 * One applicant, with everything needed to decide whether it is the right one.
 *
 * The order is deliberate. Who they are, how to reach them, what they have
 * asked for, and THEN whether their identity is actually proven - because the
 * last of those is the warning an administrator is most likely to scroll past.
 */
function ApplicantCard({
  row,
  busy,
  onApprove,
  onReject,
  highlight = false,
}: {
  row: QueueRow;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  highlight?: boolean;
}) {
  const identity = IDENTITY_COPY[row.identityStatus] ?? IDENTITY_COPY["not-started"];
  const decided = row.status !== "pending";

  return (
    <article
      className={`rounded-xl border bg-yene-surface p-4 ${
        highlight ? "border-yene-accent/60" : "border-yene-line-soft"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold text-yene-text">{row.fullName}</h2>
            {row.match && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                  TIER_TONE[row.match.tier] ?? "bg-yene-raised text-yene-muted"
                }`}
              >
                matched by {row.match.tier}
              </span>
            )}
            <span className="text-[11.5px] text-yene-faint">{row.id}</span>
          </div>

          <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-yene-muted">
            <Phone size={13} aria-hidden className="shrink-0 text-yene-faint" />
            {row.phone}
          </p>

          {/* A declared name that differs from the account name is worth a look. */}
          {row.accountName && row.accountName !== row.fullName && (
            <p className="mt-0.5 text-[11.5px] text-yene-warn">
              Account name is “{row.accountName}” - check this is the same person.
            </p>
          )}

          <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-yene-muted">
            <Building2 size={13} aria-hidden className="shrink-0 text-yene-faint" />
            {row.businessName} · {row.mallName} · {row.floor} · {row.rooms.join(" & ")}
          </p>

          {row.units.length > 0 && (
            <p className="mt-1 text-[11.5px] text-yene-faint">
              {row.units
                .map((u) => `${u.number}: ${u.sizeSqm} m2, ${formatEtbUi(u.monthlyRentEtb)}/month`)
                .join(" · ")}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className={`flex items-center gap-1 justify-end text-[11.5px] font-medium ${identity.tone}`}>
            <ShieldCheck size={13} aria-hidden />
            {identity.label}
          </p>
          {row.faydaMasked && (
            <p className="mt-0.5 text-[11px] text-yene-faint">Fayda {row.faydaMasked}</p>
          )}
        </div>
      </div>

      {decided ? (
        <p className="mt-3 flex items-center gap-1.5 border-t border-yene-line-soft pt-3 text-[12px] text-yene-muted">
          {row.status === "approved" ? (
            <CheckCircle2 size={14} aria-hidden className="text-yene-accent" />
          ) : (
            <XCircle size={14} aria-hidden className="text-yene-danger" />
          )}
          {row.status === "approved" ? "Approved" : "Declined"}
          {row.reviewedBy && ` by ${row.reviewedBy}`}
          {row.matchedBy && ` · matched by ${row.matchedBy}`}
          {row.reason && ` · ${row.reason}`}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-yene-line-soft pt-3">
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className={`${TOUCH_TARGET} inline-flex items-center gap-1.5 rounded-button bg-yene-accent px-3.5 text-[12.5px] font-semibold text-yene-on-accent hover:bg-yene-accent-strong disabled:opacity-60`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <CheckCircle2 size={14} aria-hidden />}
            Approve this store
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className={`${TOUCH_TARGET} inline-flex items-center gap-1.5 rounded-button border border-yene-line px-3.5 text-[12.5px] font-medium text-yene-muted hover:border-yene-danger hover:text-yene-danger disabled:opacity-60`}
          >
            <XCircle size={14} aria-hidden />
            Decline
          </button>

          {/* Approving does not verify a Fayda ID, and saying so here is the
              last thing an administrator reads before committing. */}
          {!row.identityVerified && (
            <p className="flex items-center gap-1.5 text-[11.5px] text-yene-warn">
              <AlertTriangle size={13} aria-hidden />
              No verified Fayda ID. The store will exist but cannot be published until it is.
            </p>
          )}
        </div>
      )}
    </article>
  );
}