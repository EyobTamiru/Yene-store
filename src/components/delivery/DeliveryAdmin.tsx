/**
 * ============================================================================
 *  YENE DELIVERY DISPATCH CENTRE
 * ============================================================================
 *
 *  The administrator's screen. Laid out the way a logistics control room wants
 *  it: the LIVE MAP beside the supply, the queue below it, and the detail of
 *  whatever is selected.
 *
 *  WHAT IT DELIBERATELY DOES NOT SHOW
 *  ----------------------------------
 *  * An IDLE DRIVER'S POSITION. `/admin/live` only returns a position for a
 *    driver who is actually carrying something. A dispatch centre that tracked
 *    every driver's movements all day would be a surveillance system, and the
 *    storage design deliberately cannot answer "where was this person last
 *    Tuesday" - so there is nothing to show even if it wanted to.
 *  * A DOCUMENT NUMBER IN A LIST. Rows carry a masked value; the full number is
 *    on the driver's own page, which is behind a super-admin check.
 */

import { useCallback, useEffect, useState } from "react";
import {
  fetchDeliveryConfig,
  type DeliveryConfig,
} from "../../lib/deliveryApi";
import { DELIVERY_STATUS_LABELS, formatDuration } from "../../platform/deliveryLabels";
import { DASHBOARD_WIDTH, TOUCH_TARGET, formatEtbUi } from "../platform/primitives";
import { DeliveryMap, type MapMarker } from "./DeliveryMap";

interface Props { onBack: () => void }

interface LiveDriver {
  id: string; name: string; vehicleType: string;
  availability: string;
  position: { latitude: number; longitude: number; at: string } | null;
  activeDeliveryId: string | null;
  deliveriesCompleted: number; rating: number;
}
interface LiveDelivery {
  id: string; status: string; driverId: string | null; vehicleType: string;
  pickup: { latitude: number; longitude: number; address: string };
  destination: { latitude: number; longitude: number; address: string };
  distanceKm: number; fee: number;
}
interface LiveResponse {
  drivers: LiveDriver[];
  deliveries: LiveDelivery[];
  counts: { onlineDrivers: number; busyDrivers: number; activeDeliveries: number; searching: number };
}

interface AdminDriverRow {
  id: string; fullName: string; phoneMasked: string; status: string; availability: string;
  statusReason: string | null; vehicleType: string; vehiclePlate: string | null;
  idNumberMasked: string | null; rating: number; ratingCount: number;
  deliveriesCompleted: number; earningsTotal: number; registeredAt: string;
}
interface Analytics {
  total: number; active: number; delivered: number; cancelled: number; failed: number;
  averageDeliverySec: number; averageDistanceKm: number;
  revenue: number; driverEarnings: number; platformCommission: number;
  mostActiveDrivers: { driverId: string; name: string; deliveries: number }[];
  drivers: { total: number; approved: number; online: number; busy: number };
}

async function admin<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Request failed.");
  return body as T;
}

type Tab = "live" | "drivers" | "analytics" | "pricing";

export function DeliveryAdmin({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>("live");
  const [live, setLive] = useState<LiveResponse | null>(null);
  const [drivers, setDrivers] = useState<AdminDriverRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [config, setConfig] = useState<DeliveryConfig | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLive = useCallback(async () => {
    try { setLive(await admin<LiveResponse>("/api/delivery/admin/live")); }
    catch (e) { setError((e as Error).message); }
  }, []);
  const loadDrivers = useCallback(async () => {
    try {
      const result = await admin<{ drivers: AdminDriverRow[] }>("/api/delivery/admin/drivers");
      setDrivers(result.drivers);
    } catch (e) { setError((e as Error).message); }
  }, []);
  const loadAnalytics = useCallback(async () => {
    try { setAnalytics(await admin<Analytics>("/api/delivery/admin/analytics")); }
    catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => {
    void loadLive();
    void loadDrivers();
    void fetchDeliveryConfig().then(setConfig).catch(() => undefined);
  }, [loadLive, loadDrivers]);

  // The live view refreshes on a timer. A dispatch centre that only updates when
  // someone presses a button is not a dispatch centre.
  useEffect(() => {
    if (tab !== "live") return;
    const timer = window.setInterval(() => void loadLive(), 10_000);
    return () => window.clearInterval(timer);
  }, [tab, loadLive]);

  useEffect(() => {
    if (tab === "analytics") void loadAnalytics();
  }, [tab, loadAnalytics]);

  const review = (driverId: string, decision: string, reason: string) => {
    setBusy(true); setError(null);
    admin(`/api/delivery/admin/drivers/${encodeURIComponent(driverId)}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, reason }),
    })
      .then(() => loadDrivers())
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  const markers: MapMarker[] = (live?.deliveries ?? []).flatMap((d) => [
    { id: `${d.id}-p`, latitude: d.pickup.latitude, longitude: d.pickup.longitude, label: "Pickup", kind: "pickup" as const },
    { id: `${d.id}-d`, latitude: d.destination.latitude, longitude: d.destination.longitude, label: "Drop", kind: "destination" as const },
  ]);

  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="border-b border-yene-line-soft">
        <div className={`${DASHBOARD_WIDTH} flex items-center justify-between gap-3 py-4`}>
          <button type="button" onClick={onBack} className={`${TOUCH_TARGET} rounded-xl px-3 text-[13px] text-yene-muted`}>&larr; Back</button>
          <h1 className="text-sm font-semibold uppercase tracking-wide text-yene-text">Yene Delivery Dispatch</h1>
          {live && (
            <span className="text-[12px] text-yene-muted">
              {live.counts.onlineDrivers} online · {live.counts.activeDeliveries} active
            </span>
          )}
        </div>
      </header>

      <nav className="border-b border-yene-line-soft">
        <div className={`${DASHBOARD_WIDTH} flex gap-1`}>
          {(["live", "drivers", "analytics", "pricing"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`${TOUCH_TARGET} px-4 text-[13px] font-medium capitalize ${
                tab === key ? "text-yene-accent" : "text-yene-muted"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </nav>

      <main className={`${DASHBOARD_WIDTH} space-y-5 py-5`}>
        {error && <p className="rounded-xl bg-yene-danger/10 px-3 py-2 text-[12.5px] text-yene-danger">{error}</p>}

        {tab === "live" && (
          <>
            <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
              <DeliveryMap
                markers={markers}
                emptyMessage="No deliveries are in progress right now."
              />
              <div className="space-y-4">
                <Counts live={live} />
                <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
                  <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-yene-faint">Drivers</h2>
                  {(live?.drivers ?? []).length === 0 ? (
                    <p className="text-[13px] text-yene-muted">No approved drivers yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {(live?.drivers ?? []).map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                          <span className="truncate text-yene-text">
                            {d.name}
                            <span className="ml-1.5 text-[11px] text-yene-faint">{d.vehicleType}</span>
                          </span>
                          <span className={`shrink-0 text-[11px] font-semibold ${
                            d.availability === "BUSY" ? "text-yene-warn" : d.availability === "ONLINE" ? "text-yene-accent" : "text-yene-faint"
                          }`}>
                            {d.availability}
                            {d.position ? " · live" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>

            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-yene-faint">Active deliveries</h2>
              {(live?.deliveries ?? []).length === 0 ? (
                <p className="text-[13px] text-yene-muted">Nothing in progress.</p>
              ) : (
                <ul className="space-y-2">
                  {(live?.deliveries ?? []).map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(selected === d.id ? null : d.id)}
                        className={`w-full rounded-xl border px-3 py-2 text-left text-[12.5px] ${
                          selected === d.id ? "border-yene-accent" : "border-yene-line-soft"
                        }`}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-semibold text-yene-text">{DELIVERY_STATUS_LABELS[d.status as never] ?? d.status}</span>
                          <span className="text-yene-accent">{formatEtbUi(d.fee)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-yene-muted">
                          {d.pickup.address} &rarr; {d.destination.address}
                        </p>
                        {selected === d.id && (
                          <p className="mt-1 text-[11.5px] text-yene-faint">
                            {d.id} · {d.distanceKm} km · driver {d.driverId ?? "unassigned"}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {tab === "drivers" && (
          <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-yene-faint">Delivery people</h2>
            {drivers.length === 0 ? (
              <p className="text-[13px] text-yene-muted">Nobody has applied yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[12.5px]">
                  <thead className="text-yene-faint">
                    <tr>
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Phone</th>
                      <th className="py-2 pr-3">Vehicle</th>
                      <th className="py-2 pr-3">ID</th>
                      <th className="py-2 pr-3">Rating</th>
                      <th className="py-2 pr-3">Deliveries</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((d) => (
                      <tr key={d.id} className="border-t border-yene-line-soft">
                        <td className="py-2 pr-3 text-yene-text">{d.fullName}</td>
                        <td className="py-2 pr-3 text-yene-muted">{d.phoneMasked}</td>
                        <td className="py-2 pr-3 text-yene-muted">{d.vehicleType}</td>
                        <td className="py-2 pr-3 text-yene-faint">{d.idNumberMasked ?? "-"}</td>
                        <td className="py-2 pr-3 text-yene-muted">
                          {d.ratingCount > 0 ? `${d.rating} ★` : "-"}
                        </td>
                        <td className="py-2 pr-3 text-yene-muted">{d.deliveriesCompleted}</td>
                        <td className="py-2 pr-3">
                          <span className={d.status === "APPROVED" ? "text-yene-accent" : "text-yene-warn"}>
                            {d.status}
                          </span>
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            {d.status !== "APPROVED" && (
                              <SmallButton disabled={busy} onClick={() => review(d.id, "APPROVE", "Verified by Yene Business Group")}>
                                Approve
                              </SmallButton>
                            )}
                            {d.status === "APPROVED" && (
                              <SmallButton disabled={busy} onClick={() => review(d.id, "SUSPEND", "Suspended by an administrator")}>
                                Suspend
                              </SmallButton>
                            )}
                          </div>
                          {d.statusReason && <p className="mt-0.5 text-[11px] text-yene-faint">{d.statusReason}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "analytics" && analytics && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Deliveries" value={String(analytics.total)} />
              <Stat label="Completed" value={String(analytics.delivered)} />
              <Stat label="In progress" value={String(analytics.active)} />
              <Stat label="Cancelled / failed" value={`${analytics.cancelled} / ${analytics.failed}`} />
              <Stat label="Average time" value={formatDuration(analytics.averageDeliverySec)} />
              <Stat label="Average distance" value={`${analytics.averageDistanceKm} km`} />
              <Stat label="Revenue" value={formatEtbUi(analytics.revenue)} />
              <Stat label="Commission" value={formatEtbUi(analytics.platformCommission)} />
              <Stat label="Driver earnings" value={formatEtbUi(analytics.driverEarnings)} />
              <Stat label="Approved drivers" value={String(analytics.drivers.approved)} />
              <Stat label="Online now" value={String(analytics.drivers.online)} />
              <Stat label="Busy now" value={String(analytics.drivers.busy)} />
            </div>
            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-yene-faint">Most active drivers</h2>
              {analytics.mostActiveDrivers.length === 0 ? (
                <p className="text-[13px] text-yene-muted">No completed deliveries yet.</p>
              ) : (
                <ol className="space-y-1">
                  {analytics.mostActiveDrivers.map((d, i) => (
                    <li key={d.driverId} className="flex justify-between text-[12.5px]">
                      <span className="text-yene-text">{i + 1}. {d.name}</span>
                      <span className="text-yene-muted">{d.deliveries}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}

        {tab === "pricing" && config && (
          <section className="space-y-4">
            <p className="rounded-xl bg-yene-raised px-3 py-2 text-[12.5px] text-yene-muted">
              Map provider: <strong>{config.map.provider}</strong>. {config.map.note}
            </p>
            <div className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-yene-faint">Vehicle pricing</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[12.5px]">
                  <thead className="text-yene-faint">
                    <tr>
                      <th className="py-2 pr-3">Vehicle</th>
                      <th className="py-2 pr-3">Base fee</th>
                      <th className="py-2 pr-3">Per km</th>
                      <th className="py-2 pr-3">Minimum</th>
                      <th className="py-2">Max weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.vehicles.map((v) => (
                      <tr key={v.id} className="border-t border-yene-line-soft">
                        <td className="py-2 pr-3 text-yene-text">{v.icon} {v.name}</td>
                        <td className="py-2 pr-3 text-yene-muted">{v.baseFee}</td>
                        <td className="py-2 pr-3 text-yene-muted">{v.pricePerKm}</td>
                        <td className="py-2 pr-3 text-yene-muted">{v.minFee}</td>
                        <td className="py-2 text-yene-muted">{v.maxWeightKg} kg</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[12px] text-yene-faint">
              Change fees with PUT /api/delivery/admin/pricing, or edit a class with
              PUT /api/delivery/admin/vehicles/:id. Every change is written to the audit log.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

function Counts({ live }: { live: LiveResponse | null }) {
  if (!live) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Online" value={String(live.counts.onlineDrivers)} />
      <Stat label="Busy" value={String(live.counts.busyDrivers)} />
      <Stat label="Active" value={String(live.counts.activeDeliveries)} />
      <Stat label="Searching" value={String(live.counts.searching)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-yene-line-soft bg-yene-surface p-3">
      <p className="text-[11px] uppercase tracking-wide text-yene-faint">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-yene-text">{value}</p>
    </div>
  );
}

function SmallButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-8 rounded-lg border border-yene-line px-2.5 text-[11.5px] font-medium text-yene-accent disabled:opacity-50"
    >
      {children}
    </button>
  );
}
