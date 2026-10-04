/**
 * ============================================================================
 *  YENE DELIVERY DRIVER CONSOLE
 * ============================================================================
 *
 *  MOBILE-FIRST, because a courier uses this on a phone, one-handed, in traffic.
 *  Every control is at least 44px, the primary action is at the bottom of the
 *  screen where a thumb reaches, and nothing important is behind a hover.
 *
 *  THE FOUR SCREENS, IN THE ORDER THEY HAPPEN
 *  -----------------------------------------
 *  1. APPLY     - register; the state is PENDING until an administrator approves
 *  2. OFFERS    - live requests with a countdown and one big ACCEPT button
 *  3. JOB       - one button per step, because `nextAction` offers exactly one
 *  4. EARNINGS  - what was earned, and what the platform took
 *
 *  WHY THERE IS ONE BUTTON, NOT A MENU
 *  ----------------------------------
 *  The server returns the ONE legal next step. This screen renders it. An
 *  illegal move has no button to press, which is a stronger control than
 *  disabling one - the request cannot be constructed from this screen at all.
 *
 *  THE LOCATION LOOP IS NOT FAKE
 *  ------------------------------
 *  When the browser exposes a real geolocation API it is used, and pings are
 *  sent to the server. When it does not, the console says so plainly and offers
 *  a manual position instead. It never animates a marker along a route.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptOffer,
  advanceJob,
  completeJob,
  declineOffer,
  fetchActiveJob,
  fetchEarnings,
  fetchMyDriverProfile,
  fetchOffers,
  registerDriver,
  sendLocation,
  setAvailability,
  type DriverOffer,
  type DriverProfileView,
  type DriverJob,
  type NextAction,
  type VehicleType,
} from "../../lib/deliveryApi";
import { DELIVERY_STATUS_LABELS, formatCountdown, formatDuration } from "../../platform/deliveryLabels";
import { CONTENT_WIDTH, TOUCH_TARGET, formatEtbUi } from "../platform/primitives";
import { DeliveryMap, type MapMarker } from "./DeliveryMap";

interface Props {
  onBack: () => void;
}

/** How often an offered job's countdown is recomputed. */
const TICK_MS = 1000;
/** How often a position is sent while a job is live. */
const LOCATION_MS = 15_000;

export function DriverConsole({ onBack }: Props) {
  const [tab, setTab] = useState<"offer" | "job" | "earnings">("offer");
  const [profile, setProfile] = useState<DriverProfileView | null>(null);
  const [offers, setOffers] = useState<DriverOffer[]>([]);
  const [job, setJob] = useState<DriverJob | null>(null);
  const [next, setNext] = useState<NextAction | null>(null);
  const [proofCode, setProofCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [earnings, setEarnings] = useState<{ total: number; lifetime: number; deliveries: number; commissionBps: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** When the offers were last fetched, so each countdown has a base time. */
  const [offersFetchedAt, setOffersFetchedAt] = useState(() => Date.now());
  /** Ticks purely to repaint the countdown; it carries no state of its own. */
  const [tick, setTick] = useState(0);
  void tick;

  // ---- Load ----
  const loadProfile = useCallback(async () => {
    try {
      const result = await fetchMyDriverProfile();
      setProfile(result.driver);
    } catch (e) {
      // No driver record yet: this is an applicant, not an error.
      setProfile(null);
      setError((e as { userMessage?: string }).userMessage ?? null);
    }
  }, []);

  const loadOffers = useCallback(async () => {
    try {
      const result = await fetchOffers();
      setOffers(result.offers);
      // Stamped AFTER the response, so the countdown is never over-estimated by
      // the network round trip.
      setOffersFetchedAt(Date.now());
    } catch {
      // Transient; the next poll retries.
    }
  }, []);

  const loadJob = useCallback(async () => {
    try {
      const result = await fetchActiveJob();
      setJob(result.delivery);
      setNext(result.nextAction);
    } catch {
      // Transient.
    }
  }, []);

  useEffect(() => {
    void loadProfile();
    void loadOffers();
    void loadJob();
  }, [loadProfile, loadOffers, loadJob]);

  // Offers expire on the SERVER's clock. This only forces a re-render so the
  // countdown repaints; it never decides whether an offer is still valid - that
  // is `acceptOffer`'s compare-and-set, and a stale button simply gets a refusal.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (tab !== "offer") return;
    const timer = window.setInterval(() => void loadOffers(), 5000);
    return () => window.clearInterval(timer);
  }, [tab, loadOffers]);

  useEffect(() => {
    if (tab !== "earnings") return;
    void fetchEarnings().then(setEarnings).catch(() => undefined);
  }, [tab]);

  // ---- Live position, only while online ----
  const geolocating = useRef(false);
  useEffect(() => {
    if (!profile || profile.availability === "OFFLINE") return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const ping = () => {
      if (geolocating.current) return;
      geolocating.current = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          geolocating.current = false;
          void sendLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            heading: position.coords.heading ?? undefined,
            speedMps: position.coords.speed ?? undefined,
          }).catch(() => undefined);
        },
        () => {
          // Permission denied or unavailable. The console already says so; this
          // is not an error worth interrupting the courier over.
          geolocating.current = false;
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10_000 },
      );
    };
    ping();
    const timer = window.setInterval(ping, LOCATION_MS);
    return () => window.clearInterval(timer);
  }, [profile]);

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

  // ---- Unregistered: the application form ----
  if (profile === null && !error) return <ApplyForm onBack={onBack} onDone={() => void loadProfile()} />;
  if (profile === null) return <ApplyForm onBack={onBack} onDone={() => void loadProfile()} />;

  const approved = profile.status === "APPROVED";
  const markers: MapMarker[] = job
    ? [
        { id: "pickup", latitude: job.pickup.latitude, longitude: job.pickup.longitude, label: "Pickup", kind: "pickup" },
        { id: "destination", latitude: job.destination.latitude, longitude: job.destination.longitude, label: "Drop", kind: "destination" },
      ]
    : [];

  return (
    <div className="min-h-dvh bg-yene-bg pb-24">
      <header className="sticky top-0 z-10 border-b border-yene-line-soft bg-yene-bg">
        <div className={`${CONTENT_WIDTH} flex items-center justify-between gap-3 py-3`}>
          <button type="button" onClick={onBack} className={`${TOUCH_TARGET} rounded-xl px-3 text-[13px] text-yene-muted`}>
            &larr;
          </button>
          <div className="text-center">
            <p className="text-[13px] font-semibold text-yene-text">{profile.fullName}</p>
            <p className="text-[11px] text-yene-faint">{DELIVERY_STATUS_LABELS[profile.status as never] ?? profile.status}</p>
          </div>
          <Toggle online={profile.availability === "ONLINE"} disabled={!approved || busy}
            onClick={() => act(async () => {
              const result = await setAvailability(profile.availability === "ONLINE" ? "OFFLINE" : "ONLINE");
              setProfile(result.driver);
              setNotice(result.message);
            })} />
        </div>
      </header>

      <main className={`${CONTENT_WIDTH} space-y-4 py-4`}>
        {!approved && (
          <div className="rounded-2xl border border-yene-line bg-yene-raised p-4">
            <p className="text-[13px] font-semibold text-yene-text">Waiting for verification</p>
            <p className="mt-1 text-[12.5px] text-yene-muted">
              {profile.statusReason ??
                "Yene Business Group is checking your details. You will be able to go online once you are approved."}
            </p>
          </div>
        )}

        {approved && <Notice error={error} notice={notice} />}

        {tab === "offer" && (
          offers.length === 0 ? (
            <Empty
              title="No delivery requests"
              body={
                profile.availability === "ONLINE"
                  ? "You are online. Requests will appear here."
                  : "Go online to start receiving delivery requests."
              }
            />
          ) : (
            <ul className="space-y-3">
              {offers.map((offer) => (
                <OfferCard
                  key={offer.offerId}
                  offer={offer}
                  fetchedAt={offersFetchedAt}
                  busy={busy}
                  onAccept={() => act(async () => {
                    const result = await acceptOffer(offer.offerId);
                    setNotice(result.message);
                    setTab("job");
                    await Promise.all([loadOffers(), loadJob(), loadProfile()]);
                  })}
                  onDecline={() => act(async () => {
                    await declineOffer(offer.offerId);
                    await loadOffers();
                  })}
                />
              ))}
            </ul>
          )
        )}

        {tab === "job" && (
          !job ? (
            <Empty title="No active delivery" body="Accept a request to start a delivery." />
          ) : (
            <div className="space-y-4">
              <DeliveryMap markers={markers} />
              <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
                <h2 className="text-[13px] font-semibold text-yene-text">{DELIVERY_STATUS_LABELS[job.status]}</h2>
                <dl className="mt-2 space-y-1.5 text-[12.5px]">
                  <Row label="Pickup" value={job.pickupAddress} />
                  <Row label="Contact" value={`${job.pickupContactName} · ${job.pickupContactPhone}`} />
                  <Row label="Drop off" value={job.destinationAddress} />
                  <Row label="Recipient" value={`${job.destinationContactName} · ${job.destinationContactPhone}`} />
                  <Row label="Distance" value={`${job.distanceKm} km`} />
                  <Row label="Parcel" value={job.packageSummary} />
                  {job.fragile && <Row label="Handling" value="FRAGILE - handle with care" />}
                  {job.handlingNotes.length > 0 && <Row label="Notes" value={job.handlingNotes.join(", ")} />}
                  {job.deliveryNotes && <Row label="Customer note" value={job.deliveryNotes} />}
                  <Row label="You earn" value={formatEtbUi(job.earnings)} emphasis />
                </dl>
              </section>

              {/* The door code, shown to the COURIER so they can read it out. */}
              {proofCode && (
                <section className="rounded-2xl border border-yene-accent bg-yene-accent-dim p-4 text-center">
                  <p className="text-[12px] text-yene-muted">Ask the customer for this code</p>
                  <p className="mt-1 text-3xl font-bold tracking-[0.3em] text-yene-accent">{proofCode}</p>
                </section>
              )}

              {next ? (
                next.to === "DELIVERED" ? (
                  <div className="space-y-2">
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ""))}
                      placeholder="4-digit code"
                      className="w-full rounded-xl border border-yene-line bg-yene-surface px-4 py-3 text-center text-2xl tracking-[0.4em] text-yene-text"
                    />
                    <Primary disabled={busy || codeInput.length !== 4} onClick={() => act(async () => {
                      const result = await completeJob(codeInput);
                      setNotice(`${result.message} You earned ${formatEtbUi(result.earnings)}.`);
                      setCodeInput("");
                      setProofCode(null);
                      setJob(null);
                      setNext(null);
                      setTab("offer");
                      await loadProfile();
                    })}>
                      Complete delivery
                    </Primary>
                  </div>
                ) : (
                  <Primary disabled={busy} onClick={() => act(async () => {
                    const result = await advanceJob();
                    setJob(result.delivery as never);
                    setNext(result.nextAction);
                    if (result.deliveryCode) setProofCode(result.deliveryCode);
                    if (result.nextAction === null) {
                      setJob(null);
                      setTab("offer");
                    }
                  })}>
                    {next.label}
                  </Primary>
                )
              ) : (
                <Empty title="Nothing to do" body="This delivery is complete." />
              )}
            </div>
          )
        )}

        {tab === "earnings" && (
          earnings ? (
            <div className="space-y-4">
              <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5 text-center">
                <p className="text-[12px] uppercase tracking-wide text-yene-faint">You have earned</p>
                <p className="mt-1 text-3xl font-bold text-yene-accent">{formatEtbUi(earnings.lifetime)}</p>
                <p className="mt-1 text-[12px] text-yene-muted">
                  {earnings.deliveries} deliveries completed
                </p>
              </section>
              <p className="text-[12px] text-yene-faint">
                Delivery fees less the platform commission of {(earnings.commissionBps / 100).toFixed(0)}%.
              </p>
            </div>
          ) : (
            <Empty title="Loading earnings" body="" />
          )
        )}
      </main>

      {/* The bottom bar: the three screens, thumb-reachable. */}
      <nav className="fixed bottom-0 left-0 right-0 border-t border-yene-line-soft bg-yene-surface">
        <div className="mx-auto flex max-w-lg">
          {(["offer", "job", "earnings"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 py-3 text-[12px] font-medium ${
                tab === key ? "text-yene-accent" : "text-yene-muted"
              }`}
            >
              {key === "offer" ? `Requests${offers.length ? ` (${offers.length})` : ""}` : key === "job" ? "Current job" : "Earnings"}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The offer card - the specification's "NEW DELIVERY" screen
// ---------------------------------------------------------------------------

function OfferCard({
  offer, fetchedAt, busy, onAccept, onDecline,
}: {
  offer: DriverOffer;
  /** When the server sent this offer, so the countdown can be recomputed here. */
  fetchedAt: number;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const d = offer.delivery;
  // The server sends SECONDS REMAINING, not an absolute time. Counting that down
  // against a local clock is only meaningful relative to when it was fetched, so
  // the deadline is reconstructed here rather than trusted as-is.
  const secondsLeft = Math.max(0, offer.expiresInSec - Math.floor((Date.now() - fetchedAt) / 1000));

  return (
    <li className="rounded-2xl border border-yene-line bg-yene-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-yene-text">New delivery</h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          secondsLeft < 15 ? "bg-yene-danger text-white" : "bg-yene-raised text-yene-muted"
        }`}>
          {formatCountdown(secondsLeft)}
        </span>
      </div>
      <dl className="mt-2 space-y-1 text-[12.5px]">
        <Row label="Pickup" value={d.pickupAddress} />
        <Row label="Destination" value={d.destinationAddress} />
        <Row label="Distance" value={`${d.distanceKm} km`} />
        <Row label="Estimated time" value={formatDuration(d.estimatedDurationSec)} />
        <Row label="Vehicle" value={d.vehicleType} />
        <Row label="Parcel" value={d.packageSummary} />
        <Row label="You earn" value={formatEtbUi(d.earnings)} emphasis />
      </dl>
      <div className="mt-3 flex gap-2">
        <Primary disabled={busy || secondsLeft === 0} onClick={onAccept}>ACCEPT</Primary>
        <button
          type="button"
          onClick={onDecline}
          disabled={busy}
          className={`${TOUCH_TARGET} flex-1 rounded-xl border border-yene-line text-[13px] font-semibold text-yene-muted`}
        >
          DECLINE
        </button>
      </div>
    </li>
  );
}


// ---------------------------------------------------------------------------
// The application form
// ---------------------------------------------------------------------------

function ApplyForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    fullName: "", phone: "", address: "", vehicleType: "motorcycle" as VehicleType,
    vehicleMake: "", plateNumber: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="border-b border-yene-line-soft">
        <div className={`${CONTENT_WIDTH} flex items-center gap-3 py-4`}>
          <button type="button" onClick={onBack} className={`${TOUCH_TARGET} rounded-xl px-3 text-[13px] text-yene-muted`}>&larr;</button>
          <h1 className="text-sm font-semibold text-yene-text">Become a delivery person</h1>
        </div>
      </header>
      <main className={`${CONTENT_WIDTH} max-w-lg space-y-4 py-6`}>
        {done ? (
          <div className="rounded-2xl border border-yene-accent bg-yene-accent-dim p-5">
            <p className="text-[13px] font-semibold text-yene-text">Application received</p>
            <p className="mt-1 text-[12.5px] text-yene-muted">{done}</p>
            <Primary onClick={onDone}>Check my status</Primary>
          </div>
        ) : (
          <>
            <p className="text-[12.5px] text-yene-muted">
              Yene Business Group checks every delivery person before they can take any delivery.
            </p>
            {[
              { key: "fullName", label: "Full name", type: "text" },
              { key: "phone", label: "Phone number", type: "tel" },
              { key: "address", label: "Your address", type: "text" },
              { key: "vehicleMake", label: "Vehicle make", type: "text" },
              { key: "plateNumber", label: "Plate number", type: "text" },
            ].map((field) => (
              <input
                key={field.key}
                type={field.type}
                value={form[field.key as keyof typeof form]}
                onChange={set(field.key as keyof typeof form)}
                placeholder={field.label}
                className="w-full rounded-xl border border-yene-line bg-yene-surface px-4 py-3 text-[13px] text-yene-text"
              />
            ))}
            <select
              value={form.vehicleType}
              onChange={set("vehicleType")}
              className="w-full rounded-xl border border-yene-line bg-yene-surface px-4 py-3 text-[13px] text-yene-text"
            >
              <option value="bicycle">Bicycle</option>
              <option value="motorcycle">Motorcycle</option>
              <option value="car">Car</option>
              <option value="van">Van</option>
              <option value="truck">Truck</option>
            </select>
            {error && <p className="text-[12.5px] text-yene-danger">{error}</p>}
            <Primary disabled={busy} onClick={() => {
              setBusy(true); setError(null);
              registerDriver(form)
                .then((r) => setDone(r.message))
                .catch((e) => setError(e.userMessage))
                .finally(() => setBusy(false));
            }}>
              {busy ? "Submitting…" : "Apply to deliver"}
            </Primary>
          </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Toggle({ online, disabled, onClick }: { online: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "You must be approved before going online" : undefined}
      className={`${TOUCH_TARGET} rounded-xl px-3 text-[12px] font-semibold disabled:opacity-50 ${
        online ? "bg-yene-accent text-yene-on-accent" : "border border-yene-line text-yene-muted"
      }`}
    >
      {online ? "ONLINE" : "OFFLINE"}
    </button>
  );
}

function Primary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${TOUCH_TARGET} w-full rounded-xl bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent hover:bg-yene-accent-strong disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-yene-faint">{label}</dt>
      <dd className={`text-right ${emphasis ? "font-semibold text-yene-accent" : "text-yene-text"}`}>{value}</dd>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-yene-line p-8 text-center">
      <p className="text-[13px] font-semibold text-yene-text">{title}</p>
      {body && <p className="mt-1 text-[12.5px] text-yene-muted">{body}</p>}
    </div>
  );
}

function Notice({ error, notice }: { error: string | null; notice: string | null }) {
  if (!error && !notice) return null;
  return (
    <p className={`rounded-xl px-3 py-2 text-[12.5px] ${error ? "bg-yene-danger/10 text-yene-danger" : "bg-yene-accent-dim text-yene-accent"}`}>
      {error ?? notice}
    </p>
  );
}
