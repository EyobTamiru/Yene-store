import {
  AlertTriangle, CheckCircle2, FileText, Lock, MessageSquare, Paperclip,
  RotateCcw, Send, User, X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  addInternalNote, assignTicket, attachFile, changePriority, changeStatus, fetchTicket,
  reopenTicket, replyToTicket, requestInfo, resolveTicket, SupportAdminError,
  type DashboardMeta, type TicketDetail,
} from "../../lib/supportAdminApi";

const input =
  "w-full rounded-lg border border-yene-line bg-yene-raised px-3 py-2 text-[13px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none focus:ring-1 focus:ring-yene-accent/40";
const sectionLabel = "mb-1.5 text-[11px] font-medium uppercase tracking-wider text-yene-faint";

interface Props {
  ticketId: string;
  meta: DashboardMeta | null;
  canDo: (capability: string) => boolean;
  onClose: () => void;
  onChanged: () => void;
}

export const TicketDetailPanel = ({ ticketId, meta, canDo, onClose, onChanged }: Props) => {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const { ticket: fresh } = await fetchTicket(ticketId);
      setTicket(fresh);
      setError("");
    } catch (e) {
      setError(e instanceof SupportAdminError ? e.message : "Could not load the ticket.");
    }
  }, [ticketId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof SupportAdminError ? e.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !ticket) {
    return (
      <div className="rounded-2xl border border-yene-danger/30 bg-yene-danger/10 p-5 text-[13px] text-yene-text">
        {error}
      </div>
    );
  }
  if (!ticket) {
    return <div className="rounded-2xl border border-yene-line-soft p-6 text-[13px] text-yene-muted">Loading ticket...</div>;
  }

  const ActionButton = ({
    onClick, children, primary,
  }: { onClick: () => void; children: ReactNode; primary?: boolean }) => (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
        primary
          ? "bg-yene-accent text-yene-on-accent hover:bg-yene-accent-strong"
          : "border border-yene-line text-yene-text hover:border-yene-accent hover:text-yene-accent"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-2xl border border-yene-line-soft bg-yene-surface">
      <div className="flex items-start justify-between gap-2 border-b border-yene-line-soft p-4">
        <div className="min-w-0">
          <p className="font-mono text-[12px] text-yene-accent">{ticket.ticketId}</p>
          <h2 className="mt-0.5 text-[15px] font-semibold text-yene-text">{ticket.subject}</h2>
          <p className="mt-1 text-[11.5px] text-yene-muted">
            {ticket.status} &middot; {ticket.priority} &middot; {ticket.assignedAgent ?? "Unassigned"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close ticket"
          className="rounded-lg p-1.5 text-yene-muted hover:bg-yene-raised hover:text-yene-text"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-5 p-4">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-yene-danger/30 bg-yene-danger/10 p-2.5 text-[12px] text-yene-text">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-yene-danger" /> {error}
          </p>
        )}

        <section>
          <p className={sectionLabel}>Customer information</p>
          <div className="space-y-1 rounded-xl border border-yene-line-soft bg-yene-raised p-3 text-[12.5px]">
            <p className="flex items-center gap-1.5 text-yene-text">
              <User size={12} className="text-yene-faint" /> {ticket.customerName}
            </p>
            <p className="text-yene-muted">Email: {ticket.customerEmail ?? "Not available"}</p>
            <p className="text-yene-muted">
              Phone:{" "}
              {ticket.customerPhoneWithheld ? (
                <span className="inline-flex items-center gap-1 text-yene-faint">
                  <Lock size={11} /> Withheld - your role cannot view phone numbers
                </span>
              ) : (
                ticket.customerPhone ?? "Not available"
              )}
            </p>
            <p className="text-yene-muted">Business: {ticket.businessName}</p>
            <p className="text-yene-muted">Package: {ticket.packageName}</p>
          </div>
        </section>
      </div>
    </div>
  );
};
