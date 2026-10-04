/**
 * ============================================================================
 *  DELIVERY TRACKING - the customer's screen
 * ============================================================================
 *
 *  Answers the only four questions a customer actually has:
 *  WHERE IS IT, WHO HAS IT, HOW LONG, AND WHAT DID IT COST.
 *
 *  WHAT IS DELIBERATELY NOT SHOWN
 *  ------------------------------
 *  * The courier's phone, before a driver is assigned. Nobody to call yet.
 *  * A courier position once the parcel has arrived. A map marker showing where
 *    somebody's house is, after they have gone home, is a privacy problem the
 *    server already prevents and this screen must not undo.
 *  * The delivery code at any moment other than the doorstep.
 *  * The platform's commission. That is not the customer's money and showing it
 *    invites a support conversation that is not about them.
 */

import { useCallback, useEffect, useState } from "react";
import {
  cancelDelivery,
  confirmDelivery,
  fetchDelivery,
  fetchMapEnv,
  rateDelivery,
  reportProblem,
  watchDelivery,
  type CustomerDelivery,
  type PublicMapEnv,
} from "../../lib/deliveryApi";
import { CUSTOMER_PROGRESS_STEPS, DELIVERY_STATUS_LABELS } from "../../platform/deliveryLabels";
import { CONTENT_WIDTH, TOUCH_TARGET, formatEtbUi } from "../platform/primitives";
import { DeliveryMap, type MapMarker } from "./DeliveryMap";

interface Props {
  deliveryId: string;
  onBack: () => void;
}

export function DeliveryTracking({ deliveryId, onBack }: Props) {
  const [delivery, setDelivery] = useState<CustomerDelivery | null>(null);
  const [mapEnv, setMapEnv] = useState<PublicMapEnv | null>(null);
  const [transport, setTransport] = useState<"sse" | "polling" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(0);

  useEffect(() => {
    void fetchMapEnv().then(setMapEnv).catch(() => undefined);
    void fetchDelivery(deliveryId).then((r) => setDelivery(r.delivery)).catch((e) => setError(e.userMessage));
  }, [deliveryId]);

  // SSE with a polling fallback, so tracking survives a proxy that buffers it.
  useEffect(() => {
    return watchDelivery(deliveryId, {
      onTransport: setTransport,
      onSnapshot: setDelivery,
    });
  }, [deliveryId]);

  const act = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError((e as { userMessage?: string }).userMessage ?? null);
    } finally {
      setBusy(false);
    }
  }, []);

  if (error && !delivery) {
    return (
      <Shell onBack={onBack} title="Track delivery">
        <p className="text-[13px] text-yene-muted">{error}</p>
      </Shell>
    );
  }
  if (!delivery) {
    return (
      <Shell onBack={onBack} title="Track delivery">
        <p className="text-[13px] text-yene-muted">Loading your delivery…</p>
      </Shell>
    );
  }

  const currentStep = CUSTOMER_PROGRESS_STEPS.indexOf(delivery.status);
  const markers: MapMarker[] = [
    { id: "pickup", latitude: delivery.pickup.latitude, longitude: delivery.pickup.longitude, label: "Pickup", kind: "pickup" },
    { id: "destination", latitude: delivery.destination.latitude, longitude: delivery.destination.longitude, label: "You", kind: "destination" },
  ];
  // The driver marker only exists when there IS a live position. The server
  // withholds it after delivery, and this screen does not re-add it.
  if (delivery.driverPosition) {
    markers.push({
      id: "driver",
      latitude: delivery.driverPosition.latitude,
      longitude: delivery.driverPosition.longitude,
      label: delivery.driver?.fullName ?? "Driver",
      kind: "driver",
      detail: delivery.driver?.vehiclePlate ?? undefined,
    });
  }

  return (
    <Shell onBack={onBack} title="Track your delivery" subtitle={DELIVERY_STATUS_LABELS[delivery.status]}>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <DeliveryMap markers={markers} route={delivery.route} attribution={mapEnv?.attribution || undefined} />

          {/* ---- The progress rail: six steps, not twelve states ---- */}
          <ol className="mt-4 space-y-2">
            {CUSTOMER_PROGRESS_STEPS.map((step, index) => {
              const done = currentStep >= index && currentStep !== -1;
              const current = delivery.status === step;
              return (
                <li key={step} className="flex items-center gap-3">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      done ? "bg-yene-accent text-yene-on-accent" : "bg-yene-raised text-yene-faint"
                    }`}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                  <span className={`text-[13px] ${current ? "font-semibold text-yene-text" : "text-yene-muted"}`}>
                    {DELIVERY_STATUS_LABELS[step]}
                  </span>
                  {current && <span className="ml-auto text-[11px] text-yene-accent">Now</span>}
                </li>
              );
            })}
          </ol>
          {transport && (
            <p className="mt-2 text-[11px] text-yene-faint">
              {transport === "sse" ? "Live updates on" : "Updating every few seconds"}
            </p>
          )}
        </div>

        <div className="space-y-4">
          {/* ---- The courier ---- */}
          <Panel title="Your delivery person">
            {delivery.driver ? (
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-yene-raised text-lg">
                  {delivery.driver.photoUrl ? (
                    <img src={delivery.driver.photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span aria-hidden>🛵</span>
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-yene-text">{delivery.driver.fullName}</p>
                  <p className="text-[12px] text-yene-muted">
                    {delivery.driver.ratingCount > 0
                      ? `${delivery.driver.rating} ★ from ${delivery.driver.ratingCount}`
                      : "New delivery person"}
                    {delivery.driver.vehiclePlate ? ` · ${delivery.driver.vehiclePlate}` : ""}
                  </p>
                </div>
                {delivery.driver.phone && (
                  <a href={`tel:${delivery.driver.phone}`} className={`${TOUCH_TARGET} ml-auto rounded-xl border border-yene-line px-3 text-[12px] text-yene-accent`}>
                    Call
                  </a>
                )}
              </div>
            ) : (
              <p className="text-[13px] text-yene-muted">
                {delivery.statusReason ?? "We are finding the nearest available delivery person."}
              </p>
            )}
          </Panel>

          {/* ---- The door code ---- */}
          {delivery.deliveryCode && (
            <Panel title="Your delivery code">
              <p className="text-[13px] text-yene-muted">Read this out to the delivery person when they arrive.</p>
              <p className="mt-2 text-3xl font-bold tracking-[0.3em] text-yene-accent">{delivery.deliveryCode}</p>
            </Panel>
          )}

          {/* ---- Confirm at the door ---- */}
          {delivery.canConfirm && (
            <Panel title="Confirm your delivery">
              <p className="text-[13px] text-yene-muted">Has your parcel arrived?</p>
              <Button disabled={busy} onClick={() => act(() => confirmDelivery(delivery.id))}>
                Yes, I received it
              </Button>
            </Panel>
          )}

          {/* ---- Rate ---- */}
          {delivery.canRate && (
            <Panel title="Rate your delivery person">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setStars(n)}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    className={`h-11 w-11 text-2xl transition-colors ${stars >= n ? "text-yene-accent" : "text-yene-line"}`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <Button
                disabled={busy || stars === 0}
                onClick={() => act(async () => {
                  const result = await rateDelivery(delivery.id, { stars });
                  setNotice(result.message);
                  setStars(0);
                })}
              >
                Submit rating
              </Button>
            </Panel>
          )}

          {/* ---- Details and the fee, itemised ---- */}
          <Panel title="Delivery details">
            <dl className="space-y-1.5 text-[12.5px]">
              <Row label="Collected from" value={delivery.pickupAddress} />
              <Row label="Delivering to" value={delivery.destinationAddress} />
              <Row label="Vehicle" value={delivery.vehicleType} />
              <Row label="Distance" value={`${delivery.distanceKm} km`} />
              <Row label="Parcel" value={delivery.packageSummary} />
              <Row label="Delivery fee" value={formatEtbUi(delivery.fee.total)} emphasis />
            </dl>
            {delivery.fee.breakdown.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[12px] text-yene-accent">How this price is made up</summary>
                <ul className="mt-1 space-y-0.5">
                  {delivery.fee.breakdown.map((line) => (
                    <li key={line} className="text-[11.5px] text-yene-faint">{line}</li>
                  ))}
                </ul>
              </details>
            )}
          </Panel>

          {/* ---- Actions ---- */}
          <div className="flex flex-wrap gap-2">
            {delivery.canCancel && (
              <Button
                secondary
                disabled={busy}
                onClick={() => act(() => cancelDelivery(delivery.id, "Cancelled by the customer"))}
              >
                Cancel delivery
              </Button>
            )}
            {delivery.canReportProblem && (
              <Button
                secondary
                disabled={busy}
                onClick={() => act(() => reportProblem(delivery.id, "Reported from the tracking screen"))}
              >
                Report a problem
              </Button>
            )}
          </div>

          {notice && <p className="text-[12.5px] text-yene-accent">{notice}</p>}
          {error && <p className="text-[12.5px] text-yene-danger">{error}</p>}
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Small pieces, matching the platform's design system
// ---------------------------------------------------------------------------

function Shell({
  onBack,
  title,
  subtitle,
  children,
}: {
  onBack: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="border-b border-yene-line-soft">
        <div className={`${CONTENT_WIDTH} flex items-center justify-between gap-3 py-4`}>
          <button type="button" onClick={onBack} className={`${TOUCH_TARGET} rounded-xl px-3 text-[13px] text-yene-muted hover:text-yene-accent`}>
            &larr; Back
          </button>
          <div className="text-right">
            <h1 className="text-sm font-semibold text-yene-text">{title}</h1>
            {subtitle && <p className="text-[11.5px] text-yene-muted">{subtitle}</p>}
          </div>
        </div>
      </header>
      <main className={`${CONTENT_WIDTH} py-6`}>{children}</main>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-yene-faint">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-yene-faint">{label}</dt>
      <dd className={`text-right ${emphasis ? "font-semibold text-yene-accent" : "text-yene-text"}`}>{value}</dd>
    </div>
  );
}

function Button({
  children, onClick, disabled, secondary,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; secondary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${TOUCH_TARGET} mt-2 w-full rounded-xl px-4 text-[13px] font-semibold disabled:opacity-50 ${
        secondary
          ? "border border-yene-line text-yene-muted"
          : "bg-yene-accent text-yene-on-accent hover:bg-yene-accent-strong"
      }`}
    >
      {children}
    </button>
  );
}
