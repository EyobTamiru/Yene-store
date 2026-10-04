/**
 * ============================================================================
 *  MALL ADMINISTRATION (Sections 10 & 41)
 * ============================================================================
 *
 *  The Super Admin's control surface for the whole mall side of the business:
 *  add and remove malls, show or hide them, price every counter, control which
 *  ones appear in "Rooms still available", approve tenants, record the
 *  agreement with each landlord, and see what each mall is actually collecting.
 *
 *  THE FOUR NUMBERS, AND WHY "HELD" IS ITS OWN LINE
 *  ------------------------------------------------
 *  Leased, held, available and unlisted are shown separately because they mean
 *  different things to the person acting on them:
 *
 *    LEASED     somebody pays rent. Counts as revenue.
 *    HELD       a pending application has claimed it. Waiting on YOU.
 *    AVAILABLE  on the market now.
 *    UNLISTED   deliberately withheld by the landlord. A decision already made.
 *
 *  Collapsing the last two would hide the difference between "nobody wants it"
 *  and "we are not offering it", which are opposite commercial facts.
 *
 *  NOTHING IS OFFERED THAT THE SERVER WILL REFUSE
 *  ----------------------------------------------
 *  A mall with tenants cannot be deleted, a counter that is let cannot be
 *  deleted, and a counter that is let cannot be re-advertised or renumbered.
 *  Those controls are ABSENT rather than present-and-failing, so what the screen
 *  offers is always what the server will actually accept.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, Eye, EyeOff, FileText,
  Loader2, Plus, RefreshCw, Store as StoreIcon, Trash2, TrendingUp, X, XCircle,
} from "lucide-react";
import {
  addUnit, createMall, deleteMall, deleteUnit, fetchAdminAgreement, fetchAdminLeases,
  fetchAdminMalls, fetchAdminUnits, MallAdminError, saveAgreement, setLeaseActive,
  setMallVisible, setUnitListable, updateUnit,
  type AdminAgreement, type AdminLease, type AdminMall, type AdminUnit,
} from "../../lib/mallAdminApi";
import { CONTENT_WIDTH, TOUCH_TARGET, formatEtbUi } from "../platform/primitives";
import { EmptyState, ErrorState, SectionSkeleton } from "../marketplace/States";

const input =
  "w-full rounded-lg border border-yene-line bg-yene-raised px-3 py-2 text-[13px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none focus:ring-1 focus:ring-yene-accent/40";

const btn =
  `${TOUCH_TARGET} inline-flex items-center justify-center gap-1.5 rounded-button px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50`;

/** Which part of one mall is open. Only one at a time - they are all big. */
type Tab = "units" | "leases" | "agreement";

export function MallAdminPage() {
  const [data, setData] = useState<{ malls: AdminMall[] } | null>(null);
  const [totals, setTotals] = useState<{
    malls: number;
    visible: number;
    units: number;
    leased: number;
    contractedMonthlyEtb: number;
    potentialMonthlyEtb: number;
  } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAdminMalls();
      setData(response);
      setTotals(response.totals);
    } catch (caught) {
      setError(caught instanceof MallAdminError ? caught.userMessage : "Could not load the malls.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run a write, surface its error, then re-read so the numbers are the server's. */
  const act = async (key: string, run: () => Promise<string>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      setNotice(await run());
      await load();
    } catch (caught) {
      setError(caught instanceof MallAdminError ? caught.userMessage : "That did not go through.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-dvh bg-yene-bg pb-16">
      <header className="border-b border-yene-line-soft bg-yene-surface">
        <div className={`${CONTENT_WIDTH} py-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-yene-text">Malls</h1>
              <p className="mt-0.5 text-[12.5px] text-yene-muted">
                Add malls, control what shoppers see, price counters and track rent.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCreating((value) => !value)}
                className={`${btn} border border-yene-line text-yene-muted hover:border-yene-accent hover:text-yene-accent`}
              >
                <Plus size={14} aria-hidden /> Add a mall
              </button>
              <button
                type="button"
                onClick={() => void load()}
                className={`${btn} border border-yene-line text-yene-muted hover:border-yene-accent hover:text-yene-accent`}
              >
                <RefreshCw size={14} aria-hidden /> Refresh
              </button>
            </div>
          </div>

          {creating && (
            <CreateMallForm
              onCancel={() => setCreating(false)}
              onCreate={(details) =>
                act("create", async () => {
                  const result = await createMall(details);
                  setCreating(false);
                  return `${result.mall.name} has been added with ${result.mall.floors.length} floor(s).`;
                })
              }
            />
          )}

          {totals && (
            <div className="mt-4 grid grid-cols-2 gap-3 laptop:grid-cols-4">
              <Stat label="Malls listed" value={`${totals.visible} of ${totals.malls}`} hint="visible to shoppers" />
              <Stat label="Counters let" value={`${totals.leased} of ${totals.units}`} hint="occupied shops" />
              <Stat
                label="Rent contracted"
                value={formatEtbUi(totals.contractedMonthlyEtb)}
                hint="per month"
                tone="text-yene-accent"
              />
              <Stat label="Still on offer" value={formatEtbUi(totals.potentialMonthlyEtb)} hint="if fully let" />
            </div>
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

        {loading ? (
          <SectionSkeleton count={2} />
        ) : !data || data.malls.length === 0 ? (
          <EmptyState title="No malls yet" hint="Add your first mall to start renting counters to sellers." />
        ) : (
          <ul className="space-y-3">
            {data.malls.map((mall) => (
              <li key={mall.id}>
                <MallCard
                  mall={mall}
                  busy={busy}
                  open={open === mall.id}
                  onToggleOpen={() => setOpen(open === mall.id ? null : mall.id)}
                  onToggleVisible={() =>
                    act(`vis-${mall.id}`, async () => {
                      await setMallVisible(mall.id, !mall.visible);
                      return mall.visible
                        ? `${mall.name} is now hidden from shoppers.`
                        : `${mall.name} is now listed.`;
                    })
                  }
                  onDelete={() =>
                    act(`del-${mall.id}`, async () => {
                      const result = await deleteMall(mall.id);
                      setOpen(null);
                      return result.message;
                    })
                  }
                  onError={(message) => setError(message)}
                  onNotice={(message) => {
                    setNotice(message);
                    void load();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-3">
      <p className="text-[10.5px] uppercase tracking-wider text-yene-faint">{label}</p>
      <p className={`mt-0.5 text-[17px] font-semibold ${tone ?? "text-yene-text"}`}>{value}</p>
      <p className="text-[11px] text-yene-faint">{hint}</p>
    </div>
  );
}

/**
 * Add a mall.
 *
 * `floors` is free text because a landlord describes a building in their own
 * terms - "GFS, 1F, 2F, 3F" is the usual answer, and forcing a pick from a list
 * of floors the system invented would be asking the landlord to describe their
 * own building using our vocabulary.
 */
function CreateMallForm({
  onCreate,
  onCancel,
}: {
  onCreate: (details: { name: string; city: string; address: string; floors: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("Addis Ababa");
  const [address, setAddress] = useState("");
  const [floors, setFloors] = useState("GFS, 1F, 2F");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-4 rounded-xl border border-yene-line-soft bg-yene-bg p-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onCreate({ name, city, address, floors }).finally(() => setBusy(false));
      }}
    >
      <p className="text-[12.5px] font-medium text-yene-text">New mall</p>
      <div className="mt-2.5 grid gap-2.5 tablet:grid-cols-2">
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Mall name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            placeholder="Bole Commercial Centre"
            className={`${input} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">City</span>
          <input
            value={city}
            onChange={(event) => setCity(event.target.value)}
            placeholder="Addis Ababa"
            className={`${input} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Address</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Bole Road"
            className={`${input} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Floors (comma separated)</span>
          <input
            value={floors}
            onChange={(event) => setFloors(event.target.value)}
            required
            placeholder="GFS, 1F, 2F, 3F"
            className={`${input} mt-1`}
          />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-yene-faint">
        A unit directory is created for every floor you list, so counters can be
        priced straight away.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={busy || name.trim().length < 2 || floors.trim().length === 0}
          className={`${btn} bg-yene-accent text-yene-on-accent hover:bg-yene-accent-strong`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Plus size={14} aria-hidden />}
          Create the mall
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`${btn} border border-yene-line text-yene-muted hover:border-yene-accent`}
        >
          <X size={14} aria-hidden /> Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * One mall: its numbers, the show/hide switch, and the three panels.
 *
 * The occupancy strip is a stacked bar rather than a number, because a landlord
 * scanning a list of malls needs to see WHICH malls are half empty at a glance -
 * "8 of 88" down a column of figures is compared far more slowly than a bar.
 */
function MallCard({
  mall,
  busy,
  open,
  onToggleOpen,
  onToggleVisible,
  onDelete,
  onError,
  onNotice,
}: {
  mall: AdminMall;
  busy: string | null;
  open: boolean;
  onToggleOpen: () => void;
  onToggleVisible: () => void;
  onDelete: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("units");
  const { occupancy, rentRoll } = mall;

  // A mall with tenants or live leases cannot be deleted, and the server refuses.
  // The button is ABSENT rather than shown-and-failing, so the screen never
  // offers an action the backend will reject.
  const canDelete = mall.storeCount === 0 && rentRoll.leaseCount === 0;

  const percent = (value: number) =>
    occupancy.total === 0 ? 0 : Math.round((value / occupancy.total) * 100);

  return (
    <article
      className={`overflow-hidden rounded-xl border bg-yene-surface ${
        mall.visible ? "border-yene-line-soft" : "border-yene-warn/40"
      }`}
    >
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14.5px] font-semibold text-yene-text">{mall.name}</h2>
              {!mall.visible && (
                <span className="rounded-full bg-yene-warn/15 px-2 py-0.5 text-[10.5px] font-medium text-yene-warn">
                  Hidden from shoppers
                </span>
              )}
              {mall.agreement ? (
                <span className="rounded-full bg-yene-accent-dim px-2 py-0.5 text-[10.5px] font-medium text-yene-accent">
                  Agreement with {mall.agreement.landlordName}
                </span>
              ) : (
                <span className="rounded-full bg-yene-raised px-2 py-0.5 text-[10.5px] font-medium text-yene-faint">
                  No agreement yet
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-yene-muted">
              {mall.city}
              {mall.address ? ` · ${mall.address}` : ""} · {mall.floors.join(", ")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onToggleVisible}
              disabled={busy === `vis-${mall.id}`}
              className={`${btn} border border-yene-line text-yene-muted hover:border-yene-accent hover:text-yene-accent`}
            >
              {busy === `vis-${mall.id}` ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : mall.visible ? (
                <EyeOff size={14} aria-hidden />
              ) : (
                <Eye size={14} aria-hidden />
              )}
              {mall.visible ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              onClick={onToggleOpen}
              className={`${btn} border border-yene-line text-yene-muted hover:border-yene-accent hover:text-yene-accent`}
            >
              Manage
              <ChevronDown
                size={14}
                aria-hidden
                className={open ? "rotate-180 transition-transform" : "transition-transform"}
              />
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy === `del-${mall.id}`}
                className={`${btn} border border-yene-line text-yene-muted hover:border-yene-danger hover:text-yene-danger`}
              >
                <Trash2 size={14} aria-hidden /> Delete
              </button>
            )}
          </div>
        </div>

        {/* The occupancy strip. Four states, four meanings - see the file header. */}
        <div className="mt-3">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-yene-raised">
            <span className="bg-yene-accent" style={{ width: `${percent(occupancy.leased)}%` }} />
            <span className="bg-yene-warn" style={{ width: `${percent(occupancy.held)}%` }} />
            <span className="bg-yene-info" style={{ width: `${percent(occupancy.available)}%` }} />
            <span className="bg-yene-line" style={{ width: `${percent(occupancy.unlisted)}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
            <Legend dot="bg-yene-accent" label="Let" value={`${occupancy.leased}`} />
            <Legend dot="bg-yene-warn" label="Held" value={`${occupancy.held}`} />
            <Legend dot="bg-yene-info" label="Available" value={`${occupancy.available}`} />
            <Legend dot="bg-yene-line" label="Unlisted" value={`${occupancy.unlisted}`} />
            <span className="text-yene-faint">
              of {occupancy.total} counters
              {occupancy.occupancyPercent !== null && ` · ${occupancy.occupancyPercent}% let`}
            </span>
          </div>
        </div>

<div className="mt-3 grid grid-cols-2 gap-2.5 tablet:grid-cols-4">
          <Figure label="Rent contracted" value={formatEtbUi(rentRoll.contractedMonthlyEtb)} />
          <Figure label="Deposits held" value={formatEtbUi(rentRoll.depositsHeldEtb)} />
          <Figure label="Still on offer" value={formatEtbUi(rentRoll.potentialMonthlyEtb)} />
          <Figure
            label="Landlord payout"
            value={mall.agreement ? formatEtbUi(mall.agreement.payoutEtb) : "No agreement"}
            tone={mall.agreement ? "text-yene-accent" : "text-yene-faint"}
          />
        </div>
      </div>

      {open && (
        <div className="border-t border-yene-line-soft bg-yene-bg p-4">
          <Tabs current={tab} onChange={setTab} />
          <div className="mt-3">
            {tab === "units" && <UnitsPanel mall={mall} onError={onError} onNotice={onNotice} />}
            {tab === "leases" && <LeasesPanel mall={mall} onError={onError} onNotice={onNotice} />}
            {tab === "agreement" && (
              <AgreementPanel mall={mall} onError={onError} onNotice={onNotice} />
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function Legend({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-yene-muted">
      <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
      {label} <strong className="font-semibold text-yene-text">{value}</strong>
    </span>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-yene-line-soft bg-yene-surface p-2.5">
      <p className="text-[10.5px] uppercase tracking-wider text-yene-faint">{label}</p>
      <p className={`mt-0.5 text-[13px] font-semibold ${tone ?? "text-yene-text"}`}>{value}</p>
    </div>
  );
}

function Tabs({ current, onChange }: { current: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div className="flex gap-1.5">
      {(["units", "leases", "agreement"] as const).map((entry) => (
        <button
          key={entry}
          type="button"
          onClick={() => onChange(entry)}
          className={`${TOUCH_TARGET} rounded-button px-3 text-[12.5px] font-medium capitalize transition-colors ${
            current === entry
              ? "bg-yene-accent text-yene-on-accent"
              : "text-yene-muted hover:bg-yene-raised hover:text-yene-text"
          }`}
        >
          {entry === "units" ? "Counters" : entry}
        </button>
      ))}
    </div>
  );
}

/**
 * The counters of one mall: price, size, and whether each is advertised.
 *
 * `listable` is the switch that drives the public "Rooms still available" list,
 * so it is rendered FIRST and as a plain checkbox rather than hidden behind an
 * edit dialog - it is the action a landlord performs most, and most often by
 * accident, so it must be obvious.
 */
function UnitsPanel({
  mall,
  onError,
  onNotice,
}: {
  mall: AdminMall;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [units, setUnits] = useState<AdminUnit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "available" | "hidden" | "let">("all");
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchAdminUnits(mall.id);
      setUnits(response.units);
    } catch (caught) {
      onError(caught instanceof MallAdminError ? caught.userMessage : "Could not load the counters.");
    } finally {
      setLoading(false);
    }
  }, [mall.id, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = (units ?? []).filter((unit) => {
    if (filter === "available") return unit.status === "available" && unit.listable;
    if (filter === "hidden") return unit.listable === false;
    if (filter === "let") return unit.status === "leased";
    return true;
  });

  /** Wrap a write so a failure surfaces and the list is re-read from the server. */
  const run = async (key: string, action: () => Promise<string>) => {
    setSaving(key);
    try {
      onNotice(action ? await action() : "");
      await load();
    } catch (caught) {
      onError(caught instanceof MallAdminError ? caught.userMessage : "That did not go through.");
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <p className="text-[12.5px] text-yene-faint">Loading counters...</p>;
  if (!units) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `All ${units.length}`],
              ["available", "Advertised"],
              ["hidden", "Unlisted"],
              ["let", "Let"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                filter === key
                  ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                  : "border-yene-line-soft text-yene-muted hover:border-yene-accent/50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          className={`${btn} border border-yene-line text-yene-muted hover:border-yene-accent hover:text-yene-accent`}
        >
          <Plus size={13} aria-hidden /> Add a counter
        </button>
      </div>

      {adding && (
        <AddUnitForm
          mall={mall}
          onDone={() => {
            setAdding(false);
            void load();
          }}
          onError={onError}
        />
      )}

      <p className="mt-2 text-[11.5px] text-yene-faint">
        "Advertised" counters appear under Rooms still available in {mall.name}. Switch one
        off to hold it back from the market without letting it.
      </p>

      <ul className="mt-2.5 space-y-1.5">
        {shown.map((unit) => (
          <UnitRow
            key={unit.id}
            unit={unit}
            saving={saving === unit.id}
            onToggleListable={() =>
              run(unit.id, async () => {
                await setUnitListable(unit.id, !unit.listable);
                return unit.listable
                  ? `${unit.number} is no longer advertised.`
                  : `${unit.number} is now advertised.`;
              })
            }
            onSavePrice={(price) =>
              run(unit.id, async () => {
                await updateUnit(unit.id, { monthlyRentEtb: price });
                return `${unit.number} is now ${formatEtbUi(price)} per month.`;
              })
            }
            onDelete={() =>
              run(unit.id, async () => {
                const result = await deleteUnit(unit.id);
                return result.message;
              })
            }
          />
        ))}
        {shown.length === 0 && (
          <li className="rounded-lg border border-yene-line-soft bg-yene-surface px-3 py-4 text-center text-[12.5px] text-yene-faint">
            Nothing here.
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * One counter: its price, who holds it, and whether it is advertised.
 *
 * A LET counter's advertise switch and delete button are ABSENT rather than
 * disabled. The server refuses both - a counter that is let cannot be
 * re-advertised or deleted - so showing them would only ever produce a failure.
 */
function UnitRow({
  unit,
  saving,
  onToggleListable,
  onSavePrice,
  onDelete,
}: {
  unit: AdminUnit;
  saving: boolean;
  onToggleListable: () => void;
  onSavePrice: (price: number) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(unit.monthlyRentEtb));
  const isLet = unit.status === "leased";

  return (
    <li className="rounded-lg border border-yene-line-soft bg-yene-surface p-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={`flex min-h-6 items-center gap-2 text-[12px] ${
            isLet ? "cursor-not-allowed opacity-50" : "cursor-pointer text-yene-muted"
          }`}
          title={isLet ? "This counter is let. End the lease before advertising it again." : undefined}
        >
          <input
            type="checkbox"
            // `!== false` rather than a plain read: a row written before the
            // `listable` column existed has no flag, and `checked={undefined}`
            // renders UNCHECKED - which would show an advertised counter as
            // unlisted. The server already treats a missing flag as true.
            checked={unit.listable !== false}
            disabled={isLet || saving}
            onChange={onToggleListable}
            className="h-4 w-4 accent-yene-accent"
          />
          Advertised
        </label>

        <span className="text-[13px] font-semibold text-yene-text">{unit.number}</span>
        <span className="text-[11.5px] text-yene-faint">{unit.sizeSqm} m2</span>

        {unit.status === "leased" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-yene-accent-dim px-2 py-0.5 text-[10.5px] font-medium text-yene-accent">
            <StoreIcon size={10} aria-hidden /> {unit.tenantName ?? "Let"}
          </span>
        )}
        {unit.status === "held" && (
          <span className="rounded-full bg-yene-warn/15 px-2 py-0.5 text-[10.5px] font-medium text-yene-warn">
            Held by a request
          </span>
        )}

        <span className="ml-auto text-[12.5px] font-semibold text-yene-text">
          {formatEtbUi(unit.monthlyRentEtb)}
        </span>

        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setPrice(String(unit.monthlyRentEtb));
              setEditing(true);
            }}
            className="rounded-button px-2 py-1 text-[11.5px] text-yene-muted hover:text-yene-accent"
          >
            Price
          </button>
        ) : (
          <span className="flex items-center gap-1.5">
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="numeric"
              aria-label={`Monthly rent for ${unit.number} in ETB`}
              className="w-24 rounded-lg border border-yene-line bg-yene-raised px-2 py-1 text-[12px] text-yene-text focus:border-yene-accent focus:outline-none"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const parsed = Number(price);
                if (Number.isFinite(parsed) && parsed >= 0) {
                  onSavePrice(parsed);
                  setEditing(false);
                }
              }}
              className="rounded-button bg-yene-accent px-2 py-1 text-[11.5px] font-semibold text-yene-on-accent disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-button px-2 py-1 text-[11.5px] text-yene-muted hover:text-yene-text"
            >
              Cancel
            </button>
          </span>
        )}

        {/* Shown only when the counter is free. A held counter still belongs to a
            pending request, and a let one to a lease - neither is the landlord's
            to delete until that is settled. */}
        {!unit.businessId && !unit.applicationId && (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            aria-label={`Delete counter ${unit.number}`}
            className="rounded-button p-1.5 text-yene-faint hover:text-yene-danger"
          >
            <Trash2 size={13} aria-hidden />
          </button>
        )}
      </div>

      {/* A discount is visible without opening the lease: the counter is
          advertised at one figure and the tenant agreed another. */}
      {isLet && unit.currentLeaseRentEtb !== null && unit.currentLeaseRentEtb !== unit.monthlyRentEtb && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-yene-warn">
          <TrendingUp size={11} aria-hidden />
          Tenant pays {formatEtbUi(unit.currentLeaseRentEtb)} — below the {formatEtbUi(unit.monthlyRentEtb)} asking price.
        </p>
      )}
    </li>
  );
}

/** Add one counter to a mall. */
function AddUnitForm({
  mall,
  onDone,
  onError,
}: {
  mall: AdminMall;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [floor, setFloor] = useState(mall.floors[0] ?? "GFS");
  const [number, setNumber] = useState("");
  const [size, setSize] = useState("20");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-2.5 rounded-lg border border-yene-line-soft bg-yene-bg p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        addUnit(mall.id, {
          floor,
          number: number.trim() || `${floor}-01`,
          sizeSqm: Number(size) || 20,
          monthlyRentEtb: Number(price) || 0,
        })
          .then(onDone)
          .catch((caught: unknown) =>
            onError(
              caught instanceof MallAdminError ? caught.userMessage : "Could not add that counter.",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <div className="grid gap-2.5 tablet:grid-cols-4">
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Floor</span>
          <select value={floor} onChange={(event) => setFloor(event.target.value)} className={`${input} mt-1`}>
            {mall.floors.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Shop number</span>
          <input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder={`${floor}-01`}
            className={`${input} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Size (m2)</span>
          <input value={size} onChange={(event) => setSize(event.target.value)} inputMode="numeric" className={`${input} mt-1`} />
        </label>
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Monthly rent (ETB)</span>
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="numeric" className={`${input} mt-1`} />
        </label>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button type="submit" disabled={busy} className={`${btn} bg-yene-accent text-yene-on-accent hover:bg-yene-accent-strong`}>
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Plus size={13} aria-hidden />}
          Add counter
        </button>
        <button type="button" onClick={onDone} className={`${btn} border border-yene-line text-yene-muted`}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The leases of one mall.
 *
 * Ending a lease RELEASES the counter, which is the whole reason this is a
 * button rather than a status field: a shop that is closed must go back on the
 * market, and that has to be an explicit act.
 */
function LeasesPanel({
  mall,
  onError,
  onNotice,
}: {
  mall: AdminMall;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [leases, setLeases] = useState<AdminLease[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchAdminLeases(mall.id);
      setLeases(response.leases);
    } catch (caught) {
      onError(caught instanceof MallAdminError ? caught.userMessage : "Could not load the leases.");
    } finally {
      setLoading(false);
    }
  }, [mall.id, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const flip = async (lease: AdminLease, active: boolean) => {
    setBusy(lease.id);
    try {
      const result = await setLeaseActive(lease.id, active);
      onNotice(`${result.message} (${lease.unitNumber})`);
      await load();
    } catch (caught) {
      onError(
        caught instanceof MallAdminError ? caught.userMessage : "Could not change that lease.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="text-[12.5px] text-yene-faint">Loading leases...</p>;
  if (!leases) return null;

  return (
    <div>
      {leases.length === 0 ? (
        <p className="rounded-lg border border-yene-line-soft bg-yene-surface px-3 py-4 text-center text-[12.5px] text-yene-faint">
          No leases yet. Approving a rental request in {mall.name} creates one.
        </p>
      ) : (
        <ul className="space-y-2">
          {leases.map((lease) => (
            <li
              key={lease.id}
              className={`rounded-lg border p-3 ${
                lease.active
                  ? "border-yene-line-soft bg-yene-surface"
                  : "border-yene-line-soft bg-yene-raised opacity-70"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-yene-text">
                    {lease.tenantName}
                    <span className="ml-2 text-[11.5px] font-normal text-yene-faint">
                      {lease.unitNumber}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-yene-muted">
                    {formatEtbUi(lease.monthlyRentEtb)} per month · deposit{" "}
                    {formatEtbUi(lease.depositEtb)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-yene-faint">
                    Started {lease.startDate}
                    {lease.endDate ? ` · ended ${lease.endDate}` : " · open-ended"}
                    {lease.tenantSubdomain ? ` · ${lease.tenantSubdomain}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {lease.active ? (
                    <>
                      <span className="inline-flex items-center gap-1 rounded-full bg-yene-accent-dim px-2 py-0.5 text-[10.5px] font-medium text-yene-accent">
                        <CheckCircle2 size={10} aria-hidden /> Active
                      </span>
                      <button
                        type="button"
                        disabled={busy === lease.id}
                        onClick={() => void flip(lease, false)}
                        className={`${btn} border border-yene-line text-yene-muted hover:border-yene-danger hover:text-yene-danger`}
                      >
                        {busy === lease.id ? (
                          <Loader2 size={13} className="animate-spin" aria-hidden />
                        ) : (
                          <XCircle size={13} aria-hidden />
                        )}
                        End lease
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === lease.id}
                      onClick={() => void flip(lease, true)}
                      className={`${btn} border border-yene-line text-yene-muted hover:border-yene-accent hover:text-yene-accent`}
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The agreement between YENE-STORE and the mall's owner.
 *
 * The payout is shown LIVE as the share is typed, because an agreement is
 * negotiated on exactly that number and reading it back only after saving is how
 * a landlord agrees to the wrong percentage.
 *
 * "Save and activate" is one named action because it has a consequence the
 * landlord may not expect: an ACTIVE agreement is what grants that mall's stores
 * free subdomains (Section 41).
 */
function AgreementPanel({
  mall,
  onError,
  onNotice,
}: {
  mall: AdminMall;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [data, setData] = useState<{
    current: AdminAgreement | null;
    rentRoll: { contractedMonthlyEtb: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [landlordName, setLandlordName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fee, setFee] = useState("0");
  const [share, setShare] = useState("70");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchAdminAgreement(mall.id);
      setData(response);
      setLandlordName(response.current?.landlordName ?? "");
      setPhone(response.current?.landlordPhone ?? "");
      setEmail(response.current?.landlordEmail ?? "");
      setFee(String(response.current?.monthlyFeeEtb ?? 0));
      setShare(String(response.current?.revenueSharePercent ?? 70));
      setNotes(response.current?.notes ?? "");
    } catch (caught) {
      onError(
        caught instanceof MallAdminError ? caught.userMessage : "Could not load the agreement.",
      );
    } finally {
      setLoading(false);
    }
  }, [mall.id, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-[12.5px] text-yene-faint">Loading the agreement...</p>;

  const contracted = data?.rentRoll.contractedMonthlyEtb ?? 0;
  const sharePercent = Math.min(Math.max(Number(share) || 0, 0), 100);
  const preview = Math.round((contracted * sharePercent) / 100);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        saveAgreement(mall.id, {
          landlordName,
          landlordPhone: phone,
          landlordEmail: email,
          status: "active",
          monthlyFeeEtb: Number(fee) || 0,
          revenueSharePercent: sharePercent,
          notes,
          signedByLandlord: true,
        })
          .then((result) => {
            onNotice(result.message);
            void load();
          })
          .catch((caught: unknown) =>
            onError(
              caught instanceof MallAdminError ? caught.userMessage : "Could not save the agreement.",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <div className="flex items-start gap-2 rounded-lg border border-yene-line-soft bg-yene-surface p-3">
        <FileText size={15} aria-hidden className="mt-0.5 shrink-0 text-yene-accent" />
        <div>
          <p className="text-[12.5px] font-medium text-yene-text">
            {data?.current
              ? `Agreement in force with ${data.current.landlordName}`
              : "No agreement yet"}
          </p>
          <p className="mt-0.5 text-[11.5px] text-yene-muted">
            {mall.name} collects {formatEtbUi(contracted)} a month. At {sharePercent}% the owner
            receives <strong className="text-yene-accent">{formatEtbUi(preview)}</strong>.
          </p>
        </div>
      </div>

      <div className="grid gap-2.5 tablet:grid-cols-2">
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Landlord's name</span>
          <input
            value={landlordName}
            onChange={(event) => setLandlordName(event.target.value)}
            required
            placeholder="Dembel Property PLC"
            className={`${input} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Landlord's phone</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+251 911 000 000"
            className={`${input} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Landlord's email</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            placeholder="owner@example.com"
            className={`${input} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Monthly fee to YENE-STORE (ETB)</span>
          <input value={fee} onChange={(event) => setFee(event.target.value)} inputMode="numeric" className={`${input} mt-1`} />
        </label>
        <label className="block">
          <span className="text-[11.5px] text-yene-muted">Revenue share to the owner (%)</span>
          <input value={share} onChange={(event) => setShare(event.target.value)} inputMode="numeric" className={`${input} mt-1`} />
        </label>
      </div>

<label className="block">
        <span className="text-[11.5px] text-yene-muted">Notes</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          placeholder="Terms agreed on the phone, refurbishment dates, anything unusual."
          className={`${input} mt-1 resize-y`}
        />
      </label>

      <p className="flex items-start gap-1.5 text-[11.5px] text-yene-warn">
        <AlertTriangle size={13} aria-hidden className="mt-px shrink-0" />
        Saving as active grants this mall's stores a free YENE-STORE subdomain, so they are
        not charged for one.
      </p>

      <button
        type="submit"
        disabled={busy || landlordName.trim().length < 2}
        className={`${btn} bg-yene-accent text-yene-on-accent hover:bg-yene-accent-strong`}
      >
        {busy ? (
          <Loader2 size={13} className="animate-spin" aria-hidden />
        ) : (
          <FileText size={13} aria-hidden />
        )}
        Save and activate
      </button>
    </form>
  );
}