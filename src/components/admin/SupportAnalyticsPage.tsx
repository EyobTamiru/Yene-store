import {
  BarChart3, BookOpen, LogIn, RefreshCw, ScrollText, ShieldCheck, TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CATEGORY_LABELS, type KnowledgeCategory } from "../../knowledge/types";
import {
  fetchWhoami, getStaffToken, setStaffToken, SupportAdminError,
  type StaffProfile,
} from "../../lib/supportAdminApi";
import {
  AnalyticsError, decideKnowledgeGap, fetchAnalytics,
  fetchAudit, fetchAuditIntegrity,
  type AnalyticsReport, type AuditEntry, type AuditIntegrity, type GapStatus, type NamedCount,
} from "../../lib/supportAnalyticsApi";

const cell = "px-3 py-2.5 text-[12.5px]";
const head = `${cell} font-medium text-yene-muted bg-yene-surface`;

/** Mirrors AUDIT_ACTIONS / AUDIT_ACTION_LABELS in api/support/auditLog.ts. */
const AUDIT_ACTIONS = [
  "ticket.created", "ticket.assigned", "ticket.updated", "agent.response",
  "ticket.resolved", "ticket.reopened", "knowledge.changed", "permission.changed",
] as const;

const AUDIT_ACTION_LABELS: Record<(typeof AUDIT_ACTIONS)[number], string> = {
  "ticket.created": "Ticket created",
  "ticket.assigned": "Ticket assigned",
  "ticket.updated": "Ticket updated",
  "agent.response": "Agent response",
  "ticket.resolved": "Ticket resolved",
  "ticket.reopened": "Ticket reopened",
  "knowledge.changed": "Knowledge article changed",
  "permission.changed": "Permission changed",
};

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 0, label: "All time" },
];

const GAP_TONE: Record<GapStatus, string> = {
  open: "bg-yene-warn/15 text-yene-warn",
  planned: "bg-yene-info/15 text-yene-info",
  published: "bg-yene-accent-dim text-yene-accent",
  dismissed: "bg-yene-raised text-yene-faint",
};

/**
 * A rate with no denominator is shown as "-", never as 0%.
 *
 * This is the same rule the server applies by returning null, repeated in the
 * UI because "0%" is the one value a reader cannot tell apart from a real
 * measurement.
 */
const rate = (value: number | null): string => (value === null ? "-" : `${value}%`);

const minutes = (value: number | null): string => {
  if (value === null) return "-";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

const Metric = ({
  label, value, tone, hint,
}: {
  label: string;
  value: string | number;
  tone?: string;
  hint?: string;
}) => (
  <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-3.5">
    <p className="text-[11px] uppercase tracking-wider text-yene-faint">{label}</p>
    <p className={`mt-1 text-xl font-semibold ${tone ?? "text-yene-text"}`}>{value}</p>
    {hint && <p className="mt-0.5 text-[11px] text-yene-faint">{hint}</p>}
  </div>
);

const Breakdown = ({ title, rows }: { title: string; rows: NamedCount[] }) => {
  const max = rows[0]?.count ?? 0;
  return (
    <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-4">
      <h3 className="text-[12.5px] font-semibold text-yene-text">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12px] text-yene-faint">No data in this period.</p>
      ) : (
        <ul className="mt-2.5 space-y-1.5">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2.5">
              <span className="w-36 shrink-0 truncate text-[12px] text-yene-muted" title={row.label}>
                {row.label}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-yene-raised">
                <span
                  className="block h-full rounded-full bg-yene-accent"
                  style={{ width: `${max ? (row.count / max) * 100 : 0}%` }}
                />
              </span>
              <span className="w-7 shrink-0 text-right text-[12px] font-medium text-yene-text">
                {row.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * Section 8: the audit log.
 *
 * Shown only to roles with `audit.view`. The API enforces that independently -
 * this component simply avoids rendering what the caller could not fetch.
 */
const AuditLogPanel = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [integrity, setIntegrity] = useState<AuditIntegrity | null>(null);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (action) params.set("action", action);
      if (actor.trim()) params.set("actor", actor.trim());
      params.set("limit", "50");
      setEntries((await fetchAudit(params)).entries);
      setIntegrity((await fetchAuditIntegrity()).integrity);
    } catch (e) {
      setError(e instanceof AnalyticsError ? e.message : "Could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [action, actor]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <h2 className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wider text-yene-faint">
        <ScrollText size={13} /> Audit log
      </h2>

      {integrity && (
        <p
          className={`mb-2.5 rounded-lg border px-3 py-2 text-[12px] ${
            integrity.ok
              ? "border-yene-accent/30 bg-yene-accent-dim text-yene-accent"
              : "border-yene-danger/40 bg-yene-danger/10 text-yene-danger"
          }`}
        >
          {integrity.ok
            ? `Integrity verified across ${integrity.entries} entries.`
            : `Integrity FAILED at entry ${integrity.brokenAt}: ${integrity.reason}`}
        </p>
      )}

      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <select
          value={action}
          onChange={(event) => setAction(event.target.value)}
          className="rounded-lg border border-yene-line bg-yene-raised px-2.5 py-1.5 text-[12px] text-yene-text focus:border-yene-accent focus:outline-none"
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((value) => (
            <option key={value} value={value}>
              {AUDIT_ACTION_LABELS[value]}
            </option>
          ))}
        </select>
        <input
          value={actor}
          onChange={(event) => setActor(event.target.value)}
          placeholder="Filter by actor"
          className="rounded-lg border border-yene-line bg-yene-raised px-2.5 py-1.5 text-[12px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-yene-line px-2.5 py-1.5 text-[12px] text-yene-text hover:border-yene-accent hover:text-yene-accent"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && (
        <p className="mb-2 rounded-lg border border-yene-danger/30 bg-yene-danger/10 p-2.5 text-[12.5px] text-yene-text">
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="rounded-xl border border-yene-line-soft bg-yene-surface p-4 text-center text-[12.5px] text-yene-muted">
          No audit entries match.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-yene-line-soft">
          <table className="w-full">
            <thead>
              <tr>
                <th className={head}>When</th>
                <th className={head}>Action</th>
                <th className={head}>Actor</th>
                <th className={head}>Target</th>
                <th className={head}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-yene-line-soft">
                  <td className={`${cell} whitespace-nowrap text-yene-faint`}>
                    {new Date(entry.at).toLocaleString(undefined, {
                      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                  <td className={cell}>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                        entry.outcome === "denied"
                          ? "bg-yene-danger/15 text-yene-danger"
                          : "bg-yene-raised text-yene-muted"
                      }`}
                    >
                      {AUDIT_ACTION_LABELS[entry.action as keyof typeof AUDIT_ACTION_LABELS]
                        ?? entry.action}
                      {entry.outcome === "denied" ? " (denied)" : ""}
                    </span>
                  </td>
                  <td className={cell}>
                    <span className="text-yene-text">{entry.actor}</span>
                    {entry.actorRole && (
                      <span className="block text-[11px] text-yene-faint">{entry.actorRole}</span>
                    )}
                  </td>
                  <td className={`${cell} font-mono text-[11.5px] text-yene-muted`}>
                    {entry.target}
                  </td>
                  <td className={`${cell} max-w-[280px] truncate text-yene-muted`}>
                    {entry.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export const SupportAnalyticsPage = ({ onBack }: { onBack?: () => void }) => {
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});

  const canAudit = staff?.capabilities.includes("audit.view") ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchAnalytics(days);
      setReport(result.report);
    } catch (e) {
      setError(e instanceof AnalyticsError ? e.message : "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (!getStaffToken()) return;
    (async () => {
      try {
        setStaff((await fetchWhoami()).staff);
      } catch {
        setStaffToken("");
      }
    })();
  }, []);

  useEffect(() => {
    if (canAudit) void load();
  }, [canAudit, load]);

  const decide = async (fingerprint: string, action: GapStatus extends never ? never : "planned" | "dismissed" | "published", message: string) => {
    setNote((current) => ({ ...current, [fingerprint]: message }));
    try {
      await decideKnowledgeGap(fingerprint, action, message);
      await load();
    } catch (e) {
      setError(e instanceof AnalyticsError ? e.message : "Could not save that decision.");
    }
  };

  // ----------------------------------------------------------------- sign in
  if (!staff) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
        <div className="rounded-2xl border border-yene-line-soft bg-yene-surface p-6">
          <div className="flex items-center gap-2 text-yene-accent">
            <BarChart3 size={18} />
            <h1 className="text-lg font-semibold text-yene-text">Support Analytics</h1>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-yene-muted">
            Platform-wide support analytics are restricted to Yene Business Group
            support managers and administrators.
          </p>
          {error && (
            <p className="mt-3 rounded-lg border border-yene-danger/30 bg-yene-danger/10 p-2.5 text-[12.5px] text-yene-text">
              {error}
            </p>
          )}
          <form
            className="mt-4 space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get("token");
              setStaffToken(String(value ?? ""));
              setError("");
              try {
                setStaff((await fetchWhoami()).staff);
              } catch (e) {
                setStaffToken("");
                setError(e instanceof SupportAdminError ? e.message : "Sign in failed.");
              }
            }}
          >
            <input
              name="token"
              type="password"
              placeholder="Support staff token"
              autoComplete="off"
              className="w-full rounded-lg border border-yene-line bg-yene-raised px-3 py-2 text-[13px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none focus:ring-1 focus:ring-yene-accent/40"
            />
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-yene-accent px-4 py-2.5 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong"
            >
              <LogIn size={15} /> Sign in
            </button>
          </form>
          {onBack && (
            <button type="button" onClick={onBack} className="mt-4 text-[12.5px] text-yene-muted hover:text-yene-accent">
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------- signed in but not allowed
  if (!canAudit) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
        <div className="rounded-2xl border border-yene-line-soft bg-yene-surface p-6">
          <div className="flex items-center gap-2 text-yene-warn">
            <ShieldCheck size={18} />
            <h1 className="text-lg font-semibold text-yene-text">Not permitted</h1>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-yene-muted">
            Your role ({staff.roleLabel}) cannot view platform-wide support
            analytics. This report covers every business and conversation on the
            platform, so it is limited to support managers and administrators.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => { setStaffToken(""); setStaff(null); }}
              className="rounded-lg border border-yene-line px-3 py-1.5 text-[12.5px] text-yene-muted hover:text-yene-text"
            >
              Sign out
            </button>
            {onBack && (
              <button type="button" onClick={onBack} className="text-[12.5px] text-yene-muted hover:text-yene-accent">
                Back
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }


  // ------------------------------------------------------------------- view
  const ai = report?.ai;
  const human = report?.human;
  const sat = report?.satisfaction;

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6 sm:py-6 2xl:max-w-[1700px]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-yene-text">
            <BarChart3 size={18} className="text-yene-accent" /> Support Analytics
          </h1>
          <p className="mt-0.5 text-[12.5px] text-yene-muted">
            {staff.name} &middot; {staff.roleLabel} &middot; platform-wide, aggregate only
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => setDays(range.days)}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
                days === range.days
                  ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                  : "border-yene-line text-yene-muted hover:text-yene-text"
              }`}
            >
              {range.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-yene-line px-3 py-1.5 text-[12.5px] text-yene-text hover:border-yene-accent hover:text-yene-accent"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => { setStaffToken(""); setStaff(null); }}
            className="rounded-lg border border-yene-line px-3 py-1.5 text-[12.5px] text-yene-muted hover:text-yene-text"
          >
            Sign out
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-yene-danger/30 bg-yene-danger/10 p-2.5 text-[12.5px] text-yene-text">
          {error}
        </p>
      )}

      {!report ? (
        <p className="py-12 text-center text-[13px] text-yene-muted">Loading analytics...</p>
      ) : (
        <div className="space-y-6">
          {/* ------------------------------------------------ AI performance */}
          <section>
            <h2 className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wider text-yene-faint">
              <TrendingUp size={13} /> AI support
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Metric label="Conversations" value={ai!.totalConversations} />
              <Metric label="AI resolved" value={ai!.aiResolvedConversations} tone="text-yene-accent" />
              <Metric label="Human escalations" value={ai!.humanEscalations} />
              <Metric label="Unresolved" value={ai!.unresolvedConversations} tone={ai!.unresolvedConversations > 0 ? "text-yene-warn" : undefined} />
              <Metric label="Escalation rate" value={rate(ai!.escalationRatePercent)} hint={`${ai!.humanOffered} offered a human`} />
              <Metric label="Avg length" value={ai!.averageConversationLength === null ? "-" : `${ai!.averageConversationLength} turns`} />
            </div>
          </section>

          {/* ------------------------------------------- human performance */}
          <section>
            <h2 className="mb-2.5 text-[12.5px] font-semibold uppercase tracking-wider text-yene-faint">
              Human support
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <Metric label="Tickets created" value={human!.ticketsCreated} />
              <Metric label="Resolved" value={human!.ticketsResolved} tone="text-yene-accent" />
              <Metric label="Open" value={human!.openTickets} tone={human!.openTickets > 0 ? "text-yene-warn" : undefined} />
              <Metric label="Reopened" value={human!.reopenedTickets} />
              <Metric label="Avg first response" value={minutes(human!.averageFirstResponseMinutes)} />
              <Metric label="Avg resolution" value={minutes(human!.averageResolutionMinutes)} />
              <Metric label="Reopen rate" value={rate(human!.reopenRatePercent)} />
            </div>
          </section>

          {/* --------------------------------------------- customer satisfaction */}
          <section>
            <h2 className="mb-2.5 text-[12.5px] font-semibold uppercase tracking-wider text-yene-faint">
              Customer satisfaction
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Metric label="Responses" value={sat!.responses} />
              <Metric label="Yes" value={sat!.yes} tone="text-yene-accent" />
              <Metric label="Partially" value={sat!.partially} />
              <Metric label="No" value={sat!.no} tone={sat!.no > 0 ? "text-yene-danger" : undefined} />
              <Metric
                label="Average rating"
                value={sat!.averageRating === null ? "-" : `${sat!.averageRating} / 5`}
                hint={`${sat!.ratingsGiven} rated`}
              />
            </div>
          </section>


          {/* --------------------------------------------- knowledge gaps */}
          <section>
            <h2 className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wider text-yene-faint">
              <BookOpen size={13} /> Knowledge gaps
            </h2>
            <p className="mb-2.5 text-[12px] text-yene-muted">
              Questions the assistant could not answer from an approved article.
              Refusing for account security or a payment dispute is not counted
              here &mdash; {report.privacy.deliberateRefusals} such refusals in this
              period are working as designed.
            </p>

            {report.knowledgeGaps.length === 0 ? (
              <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-6 text-center text-[12.5px] text-yene-muted">
                No knowledge gaps in this period. The assistant answered everything
                it was asked, or the questions were escalated deliberately.
              </div>
            ) : (
              <div className="space-y-2.5">
                {report.knowledgeGaps.map((gap) => (
                  <div key={gap.fingerprint} className="rounded-xl border border-yene-line-soft bg-yene-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="max-w-2xl text-[13px] text-yene-text">{gap.question}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${GAP_TONE[gap.status]}`}>
                        {gap.status}
                      </span>
                    </div>

                    <p className="mt-1.5 text-[11.5px] text-yene-faint">
                      Asked {gap.occurrences} time{gap.occurrences === 1 ? "" : "s"} across{" "}
                      {gap.conversations} conversation{gap.conversations === 1 ? "" : "s"} &middot;{" "}
                      last asked {new Date(gap.lastAskedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                    </p>

                    <p className="mt-2 text-[12px] text-yene-muted">
                      Suggested article:{" "}
                      <code className="text-yene-accent">{gap.suggestedArticleId}.md</code> in{" "}
                      {CATEGORY_LABELS[gap.suggestedCategory as KnowledgeCategory] ?? gap.suggestedCategory}
                    </p>

                    {gap.relatedArticles.length > 0 && (
                      <p className="mt-1.5 text-[11.5px] text-yene-faint">
                        Related: {gap.relatedArticles.map((a) => `${a.title} (${a.status})`).join("; ")}
                      </p>
                    )}

                    {gap.decidedBy && (
                      <p className="mt-1.5 text-[11.5px] text-yene-faint">
                        {gap.status} by {gap.decidedBy}
                        {gap.note ? ` — ${gap.note}` : ""}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        defaultValue={gap.note}
                        onBlur={(event) => setNote((current) => ({ ...current, [gap.fingerprint]: event.target.value }))}
                        placeholder="Note (optional)"
                        className="min-w-[180px] flex-1 rounded-lg border border-yene-line bg-yene-raised px-2.5 py-1.5 text-[12px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void decide(gap.fingerprint, "planned", note[gap.fingerprint] ?? gap.note)}
                        className="rounded-lg border border-yene-info/50 bg-yene-info/10 px-2.5 py-1.5 text-[11.5px] font-medium text-yene-info transition-colors hover:bg-yene-info/20"
                      >
                        Plan article
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(gap.fingerprint, "published", note[gap.fingerprint] ?? gap.note)}
                        className="rounded-lg border border-yene-accent/50 bg-yene-accent-dim px-2.5 py-1.5 text-[11.5px] font-medium text-yene-accent transition-colors hover:bg-yene-accent/15"
                      >
                        Mark published
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(gap.fingerprint, "dismissed", note[gap.fingerprint] ?? gap.note)}
                        className="rounded-lg border border-yene-line px-2.5 py-1.5 text-[11.5px] text-yene-muted transition-colors hover:text-yene-text"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>


          {/* ------------------------------------ frequently asked questions */}
          <section className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-4">
              <h3 className="text-[12.5px] font-semibold text-yene-text">Frequently asked questions</h3>
              {ai!.frequentQuestions.length === 0 ? (
                <p className="mt-2 text-[12px] text-yene-faint">No questions recorded.</p>
              ) : (
                <ul className="mt-2.5 space-y-2">
                  {ai!.frequentQuestions.map((q) => (
                    <li key={q.fingerprint} className="flex items-start justify-between gap-3">
                      <span className="text-[12.5px] text-yene-muted">{q.question}</span>
                      <span className="shrink-0 text-[12px] font-medium text-yene-text">{q.occurrences}&times;</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-4">
              <h3 className="text-[12.5px] font-semibold text-yene-text">Knowledge articles used</h3>
              {ai!.articleUsage.length === 0 ? (
                <p className="mt-2 text-[12px] text-yene-faint">No articles cited yet.</p>
              ) : (
                <ul className="mt-2.5 space-y-2">
                  {ai!.articleUsage.map((article) => (
                    <li key={article.id} className="flex items-start justify-between gap-3">
                      <span className="text-[12.5px] text-yene-muted">
                        {article.title}
                        {!article.known && <span className="ml-1.5 text-[11px] text-yene-warn">(removed)</span>}
                      </span>
                      <span className="shrink-0 text-[12px] font-medium text-yene-text">{article.timesUsed}&times;</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ------------------------------------------------- breakdowns */}
          <section className="grid gap-3 lg:grid-cols-3">
            <Breakdown title="Most common problems" rows={ai!.commonProblems} />
            <Breakdown title="Topics by category" rows={ai!.byCategory} />
            <Breakdown title="Why people were escalated" rows={ai!.escalationReasons} />
            <Breakdown title="Tickets by category" rows={human!.byCategory} />
            <Breakdown title="Tickets by package" rows={human!.byPackage} />
            <Breakdown title="Tickets by business" rows={human!.byBusiness} />
          </section>

          {/* -------------------------------------------------- feedback */}
          <section>
            <h2 className="mb-2.5 text-[12.5px] font-semibold uppercase tracking-wider text-yene-faint">
              Customer comments
            </h2>
            {sat!.comments.length === 0 ? (
              <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-6 text-center text-[12.5px] text-yene-muted">
                No written feedback in this period. Customers answered the
                resolution question without leaving a comment, which is allowed.
              </div>
            ) : (
              <div className="space-y-2">
                {sat!.comments.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-yene-line-soft bg-yene-surface p-3.5">
                    <p className="text-[12.5px] text-yene-text">{entry.comment}</p>
                    <p className="mt-1.5 text-[11.5px] text-yene-faint">
                      Answered {entry.resolved}
                      {entry.rating !== null && ` · rated ${entry.rating}/5`}
                      {entry.ticketId && ` · ${entry.ticketId}`}
                      {" · "}
                      {new Date(entry.at).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {canAudit && <AuditLogPanel />}

          <p className="flex items-start gap-1.5 border-t border-yene-line-soft pt-4 text-[11.5px] text-yene-faint">
            <ShieldCheck size={12} className="mt-0.5 shrink-0" />
            <span>{report.privacy.note}</span>
          </p>
        </div>
      )}
    </div>
  );
};

