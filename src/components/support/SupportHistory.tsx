import {
  CheckCircle2, ChevronRight, Clock, MessageSquare, Ticket as TicketIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchMyTickets, type CustomerTicket } from "../../lib/supportApi";

/**
 * Section 9, component 8: Customer Support History.
 *
 * The journey the specification describes ends with the customer seeing the
 * resolution and being able to give feedback. Before this existed a customer
 * could open a request and read it back only if they had written down its id.
 *
 * RESPONSIVE, NOT STRETCHED
 * ------------------------
 * Each breakpoint gets a different layout rather than one layout that grows:
 *   - phone   a single column; each request is a tappable card
 *   - tablet  the same cards, two across
 *   - laptop  a list column beside the detail pane
 *   - desktop the list column widens and the detail pane gains padding
 *
 * A table would have been the obvious choice on a laptop and the wrong one on a
 * phone, so the list is cards that become a two-pane layout only when there is
 * room for it.
 */

const STATUS_TONE: Record<string, string> = {
  Open: "bg-yene-info/15 text-yene-info",
  "In Progress": "bg-yene-warn/15 text-yene-warn",
  "Waiting for Customer": "bg-yene-warn/15 text-yene-warn",
  "Waiting for Internal Team": "bg-yene-raised text-yene-muted",
  Resolved: "bg-yene-accent-dim text-yene-accent",
  Closed: "bg-yene-raised text-yene-faint",
};

const isResolved = (ticket: CustomerTicket) =>
  ticket.status === "Resolved" || ticket.status === "Closed";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

/**
 * Turn an internal event type into something a customer can read.
 *
 * The customer never sees the internal vocabulary, so the mapping is explicit
 * rather than showing the raw type. Anything unrecognised is described plainly
 * instead of leaking an internal name.
 */
function humanEvent(type: string, body?: string): string {
  switch (type) {
    case "created":
      return "opened this request";
    case "agent-reply":
      return body ? `replied: ${body}` : "replied to you";
    case "customer-message":
      return "sent a message";
    case "info-request":
      return body ? `asked: ${body}` : "asked you a question";
    case "status-change":
      return "changed the status";
    case "resolved":
      return "resolved this request";
    case "reopened":
      return "reopened this request";
    default:
      return "updated this request";
  }
}

export const SupportHistory = () => {
  const [tickets, setTickets] = useState<CustomerTicket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchMyTickets();
      setTickets(result.tickets);
      setFailed(false);
    } catch (error) {
      console.error("[support] could not load request history:", error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="rounded-xl border border-yene-line-soft bg-yene-surface p-4 text-center text-[12.5px] text-yene-muted">
        Loading your support requests...
      </p>
    );
  }

  if (failed) {
    return (
      <p className="rounded-xl border border-yene-danger/30 bg-yene-danger/10 p-4 text-center text-[12.5px] text-yene-text">
        We could not load your support requests just now. Please try again shortly.
      </p>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-5 text-center">
        <TicketIcon size={20} className="mx-auto text-yene-faint" />
        <p className="mt-2.5 text-[13px] font-medium text-yene-text">No support requests yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-yene-muted">
          When you ask for a Yene Business Group support agent, your request and
          our conversation appear here so you can follow its progress.
        </p>
      </div>
    );
  }

  const selected = tickets.find((ticket) => ticket.ticketId === selectedId) ?? null;
  const openCount = tickets.filter((ticket) => !isResolved(ticket)).length;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[12.5px] font-semibold uppercase tracking-wider text-yene-faint">
          Your support requests
        </h2>
        {openCount > 0 && <span className="text-[11.5px] text-yene-muted">{openCount} in progress</span>}
      </div>

      {/* Phone / tablet: cards stacked, one column on a phone, two on a tablet.
          Laptop and up: a two-pane list + detail layout. */}
      <div className="grid gap-2.5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {tickets.map((ticket) => {
            const active = ticket.ticketId === selectedId;
            return (
              <li key={ticket.ticketId}>
                <button
                  type="button"
                  onClick={() => setSelectedId(active ? null : ticket.ticketId)}
                  aria-expanded={active}
                  className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
                    active
                      ? "border-yene-accent bg-yene-accent-dim"
                      : "border-yene-line-soft bg-yene-surface hover:border-yene-line"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-medium text-yene-text">
                        {ticket.subject}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          STATUS_TONE[ticket.status] ?? STATUS_TONE.Closed
                        }`}
                      >
                        {ticket.status}
                      </span>
                    </span>
                    <span className="mt-1 block truncate font-mono text-[11px] text-yene-faint">
                      {ticket.ticketId}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[11px] text-yene-faint">
                      <Clock size={10} />
                      {formatDate(ticket.updatedAt)}
                    </span>
                  </span>
                  <ChevronRight size={14} className="mt-1 shrink-0 text-yene-faint" />
                </button>
              </li>
            );
          })}
        </ul>


        {/* Detail pane. On a phone it appears below the selected card. */}
        {selected && (
          <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-4 lg:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-yene-text">{selected.subject}</p>
                <p className="mt-0.5 font-mono text-[11.5px] text-yene-faint">{selected.ticketId}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  STATUS_TONE[selected.status] ?? STATUS_TONE.Closed
                }`}
              >
                {selected.status}
              </span>
            </div>

            {isResolved(selected) ? (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-yene-accent/30 bg-yene-accent-dim px-3 py-2 text-[12.5px] text-yene-accent">
                <CheckCircle2 size={14} />
                This request has been resolved.
              </p>
            ) : (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-yene-info/30 bg-yene-info/10 px-3 py-2 text-[12.5px] text-yene-info">
                <MessageSquare size={14} />
                A Yene Business Group support agent is working on this.
              </p>
            )}

            {selected.description && (
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wider text-yene-faint">
                  What you told us
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-yene-muted">
                  {selected.description}
                </p>
              </div>
            )}

            {selected.events.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wider text-yene-faint">Progress</p>
                <ol className="mt-2 space-y-2">
                  {selected.events.map((event) => (
                    <li key={event.id} className="flex items-start gap-2 text-[12.5px]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-yene-accent" />
                      <span className="min-w-0 flex-1 text-yene-muted">
                        <span className="text-yene-text">{event.actor}</span>{" "}
                        {humanEvent(event.type, event.body)}
                        <span className="ml-1.5 text-[11px] text-yene-faint">
                          {formatDate(event.at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

