import {
  AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Filter,
  Inbox, Lock, LogIn, RefreshCw, Search, ShieldCheck, X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  fetchMetrics, fetchMeta, fetchTicket, fetchTickets, fetchWhoami, setStaffToken,
  getStaffToken, SupportAdminError,
  type DashboardMeta, type DashboardMetrics, type StaffProfile, type TicketDetail, type TicketRow,
} from "../../lib/supportAdminApi";
import { TicketDetailPanel } from "./TicketDetailPanel";

const cell = "px-3 py-2.5 text-[12.5px]";
const head = `${cell} font-medium text-yene-muted bg-yene-surface`;
const input =
  "w-full rounded-lg border border-yene-line bg-yene-raised px-3 py-2 text-[13px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none focus:ring-1 focus:ring-yene-accent/40";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-yene-danger/15 text-yene-danger",
  high: "bg-yene-warn/15 text-yene-warn",
  normal: "bg-yene-raised text-yene-muted",
  low: "bg-yene-raised text-yene-faint",
};

const Badge = ({ value, tone }: { value: string; tone: string }) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium ${tone}`}>
    {value}
  </span>
);

function MetricCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-3.5">
      <p className="text-[11px] uppercase tracking-wider text-yene-faint">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone ?? "text-yene-text"}`}>{value}</p>
    </div>
  );
}

const minutes = (value: number | null): string => {
  if (value === null) return "-";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

interface SortState { field: string; direction: "asc" | "desc" }

const SORTABLE = ["createdAt", "updatedAt", "priority", "status", "customerName", "subject"] as const;

export const SupportDashboardPage = ({ onBack }: { onBack?: () => void }) => {
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [meta, setMeta] = useState<DashboardMeta | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ field: "createdAt", direction: "desc" });
  const [open, setOpen] = useState<TicketDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const canDo = useCallback(
    (capability: string) => staff?.capabilities.includes(capability) ?? false,
    [staff],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [m, list] = await Promise.all([
        fetchMetrics().catch(() => null),
        (async () => {
          const params = new URLSearchParams();
          if (search.trim()) params.set("search", search.trim());
          if (statusFilter.length) params.set("status", statusFilter.join(","));
          if (priorityFilter.length) params.set("priority", priorityFilter.join(","));
          if (assigneeFilter) params.set("assignedTo", assigneeFilter);
          params.set("sort", sort.field);
          params.set("direction", sort.direction);
          params.set("page", String(page));
          params.set("pageSize", "20");
          return fetchTickets(params);
        })(),
      ]);
      if (m) setMetrics(m.metrics);
      setRows(list.rows);
      setTotal(list.total);
      setPageCount(list.pageCount);
    } catch (e) {
      setError(e instanceof SupportAdminError ? e.message : "Could not load tickets.");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, priorityFilter, assigneeFilter, sort, page]);

  useEffect(() => {
    if (!getStaffToken()) return;
    (async () => {
      try {
        const who = await fetchWhoami();
        setStaff(who.staff);
        setMeta(await fetchMeta());
        await load();
      } catch (e) {
        setError(e instanceof SupportAdminError ? e.message : "Could not sign in.");
        setStaffToken("");
        setStaff(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (staff) void load(); }, [load, staff]);

  const toggle = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const toggleSort = (field: string) =>
    setSort((current) =>
      current.field === field
        ? { field, direction: current.direction === "asc" ? "desc" : "asc" }
        : { field, direction: "asc" },
    );

  // ----------------------------------------------------------------- sign in
  if (!staff) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
        <div className="rounded-2xl border border-yene-line-soft bg-yene-surface p-6">
          <div className="flex items-center gap-2 text-yene-accent">
            <ShieldCheck size={18} />
            <h1 className="text-lg font-semibold text-yene-text">Customer Support</h1>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-yene-muted">
            This dashboard is for Yene Business Group support staff only. Business
            accounts and customers cannot access platform support tickets.
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
                const who = await fetchWhoami();
                setStaff(who.staff);
                setMeta(await fetchMeta());
                await load();
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
              className={input}
            />
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-yene-accent px-4 py-2.5 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong"
            >
              <LogIn size={15} /> Sign in
            </button>
          </form>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mt-4 text-[12.5px] text-yene-muted hover:text-yene-accent"
            >
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ view
  return (
    <div className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6 sm:py-6 2xl:max-w-[1700px]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-yene-text">
            <ShieldCheck size={18} className="text-yene-accent" /> Customer Support
          </h1>
          <p className="mt-0.5 text-[12.5px] text-yene-muted">
            {staff.name} &middot; {staff.roleLabel}
            {!meta?.canViewAll && " (your assigned tickets only)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      {metrics && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <MetricCard label="Open" value={metrics.openTickets} />
          <MetricCard label="Active chats" value={metrics.activeChats} />
          <MetricCard
            label="Unassigned"
            value={metrics.unassignedTickets}
            tone={metrics.unassignedTickets > 0 ? "text-yene-warn" : undefined}
          />
          <MetricCard
            label="High priority"
            value={metrics.highPriorityTickets}
            tone={metrics.highPriorityTickets > 0 ? "text-yene-danger" : undefined}
          />
          <MetricCard label="Waiting on customer" value={metrics.waitingForCustomer} />
          <MetricCard label="Resolved today" value={metrics.resolvedToday} tone="text-yene-accent" />
          <MetricCard label="Avg response" value={minutes(metrics.averageResponseMinutes)} />
          <MetricCard label="Avg resolution" value={minutes(metrics.averageResolutionMinutes)} />
        </div>
      )}

      {/* Phone / tablet: the detail opens below the list. Laptop and up: side by
          side, because an agent triaging needs the ticket and its detail at the
          same time. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        <div className="min-w-0">
          <div className="mb-3 space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-yene-faint" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search ticket ID, customer, business, subject, email"
                className={`${input} pl-9`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11.5px] text-yene-faint">
                <Filter size={12} /> Status
              </span>
              {(meta?.statuses ?? []).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => { toggle(statusFilter, status, setStatusFilter); setPage(1); }}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                    statusFilter.includes(status)
                      ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                      : "border-yene-line text-yene-muted hover:text-yene-text"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-yene-faint">Priority</span>
              {(meta?.priorities ?? []).map((priority) => (
                <button
                  key={priority}
                  type="button"
                  onClick={() => { toggle(priorityFilter, priority, setPriorityFilter); setPage(1); }}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] capitalize transition-colors ${
                    priorityFilter.includes(priority)
                      ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                      : "border-yene-line text-yene-muted hover:text-yene-text"
                  }`}
                >
                  {priority}
                </button>
              ))}
              <select
                value={assigneeFilter}
                onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }}
                className="rounded-lg border border-yene-line bg-yene-raised px-2 py-1 text-[11.5px] text-yene-text"
              >
                <option value="">Anyone</option>
                <option value="me">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
              </select>
              {(search || statusFilter.length || priorityFilter.length || assigneeFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch(""); setStatusFilter([]); setPriorityFilter([]); setAssigneeFilter(""); setPage(1);
                  }}
                  className="inline-flex items-center gap-1 text-[11.5px] text-yene-faint hover:text-yene-accent"
                >
                  <X size={11} /> Clear
                </button>
              )}
            </div>
          </div>

          {/* Phone and tablet: cards. A nine-column table cannot be made
              readable on a phone without horizontal scrolling, which hides the
              data an agent is scanning for. Below lg each ticket is a card. */}
          <ul className="grid gap-2 lg:hidden">
            {rows.map((row) => (
              <li key={row.ticketId}>
                <button
                  type="button"
                  onClick={() => setOpen({ ticketId: row.ticketId } as TicketDetail)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
                    open?.ticketId === row.ticketId
                      ? "border-yene-accent bg-yene-accent-dim"
                      : "border-yene-line-soft bg-yene-surface hover:border-yene-line"
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-yene-text">
                        {row.subject}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-yene-muted">
                        {row.customerName} &middot; {row.businessName}
                      </span>
                    </span>
                    <Badge value={row.priority} tone={PRIORITY_TONE[row.priority] ?? PRIORITY_TONE.normal} />
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-yene-faint">
                    <span className="font-mono text-yene-accent">{row.ticketId}</span>
                    <span>{row.status}</span>
                    <span>{row.category}</span>
                    <span>
                      {row.assignedAgent ?? <span className="text-yene-warn">Unassigned</span>}
                    </span>
                    <span>{formatTime(row.updatedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="rounded-xl border border-yene-line-soft bg-yene-surface px-3 py-8 text-center text-[12.5px] text-yene-muted">
                No tickets match your search or filters.
              </li>
            )}
          </ul>

          {/* Laptop and up: the full table, with the secondary columns dropped
              on narrower laptops so the important ones stay readable. */}
          <div className="hidden overflow-x-auto rounded-xl border border-yene-line-soft lg:block">
            <table className="w-full text-left">
              <thead>
                <tr>
                  {SORTABLE.map((field) => (
                    <th key={field} className={head}>
                      <button
                        type="button"
                        onClick={() => toggleSort(field)}
                        className="inline-flex items-center gap-1 capitalize hover:text-yene-text"
                      >
                        {field === "createdAt" ? "Created" : field === "updatedAt" ? "Last updated" : field}
                        {sort.field === field &&
                          (sort.direction === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                      </button>
                    </th>
                  ))}
                  <th className={head}>Assigned</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.ticketId}
                    onClick={() => setOpen({ ticketId: row.ticketId } as TicketDetail)}
                    className={`cursor-pointer border-t border-yene-line-soft transition-colors hover:bg-yene-raised ${
                      open?.ticketId === row.ticketId ? "bg-yene-raised" : ""
                    }`}
                  >
                    <td className={`${cell} font-mono text-[11.5px] text-yene-accent`}>{row.ticketId}</td>
                    <td className={cell}>
                      <span className="block text-yene-text">{row.customerName}</span>
                      <span className="text-[11px] text-yene-faint">{row.businessName}</span>
                    </td>
                    <td className={`${cell} max-w-[200px] truncate text-yene-text`}>{row.subject}</td>
                    <td className={`${cell} text-yene-muted`}>{row.category}</td>
                    <td className={cell}>
                      <Badge value={row.priority} tone={PRIORITY_TONE[row.priority] ?? PRIORITY_TONE.normal} />
                    </td>
                    <td className={`${cell} text-yene-muted`}>{row.status}</td>
                    <td className={`${cell} text-yene-muted`}>
                      {row.assignedAgent ?? <span className="text-yene-warn">Unassigned</span>}
                    </td>
                    <td className={`${cell} text-yene-muted`}>{formatTime(row.createdAt)}</td>
                    <td className={`${cell} text-yene-muted`}>{formatTime(row.updatedAt)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-yene-muted">
                      No tickets match your search or filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-[12px] text-yene-muted">
            <span>{total} ticket{total === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-yene-line px-2.5 py-1 disabled:opacity-40"
              >
                <ChevronLeft size={13} /> Prev
              </button>
              <span>Page {page} of {pageCount}</span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-yene-line px-2.5 py-1 disabled:opacity-40"
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>

        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
          {open ? (
            <TicketDetailPanel
              ticketId={open.ticketId}
              meta={meta}
              canDo={canDo}
              onClose={() => setOpen(null)}
              onChanged={() => void load()}
            />
          ) : (
            <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-yene-line-soft p-8 text-center">
              <Inbox size={28} className="text-yene-faint" />
              <p className="mt-3 text-[13px] text-yene-muted">
                Select a ticket to see the customer, the conversation, the AI summary
                and the support actions.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
