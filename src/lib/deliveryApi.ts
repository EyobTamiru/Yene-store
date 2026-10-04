/**
 * ============================================================================
 *  DELIVERY API CLIENT
 * ============================================================================
 *
 *  The browser's only door to the delivery system, mirroring `platformApi.ts`:
 *  same cookie session, JSON in and out, and a generic error the UI shows
 *  verbatim rather than a stack trace.
 *
 *  NO TENANT, NO DRIVER ID, EVER
 *  ----------------------------
 *  Notice what is NOT here: there is no function that sends a `businessId` or a
 *  `driverId`. The server resolves both from the session. A caller cannot read
 *  another customer's delivery or act as another courier, because there is
 *  nothing in this client that would let it try.
 *
 *  TRANSPORT STRATEGY, copied from `liveApi.ts`
 *  --------------------------------------------
 *  Tracking prefers SSE and falls back to polling, so the customer's map keeps
 *  moving whether or not a proxy allows the stream through.
 */

export class DeliveryUnavailableError extends Error {
  readonly userMessage: string;
  constructor(userMessage = "We could not reach the delivery service. Please try again.") {
    super("delivery_unavailable");
    this.name = "DeliveryUnavailableError";
    this.userMessage = userMessage;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    console.error("[delivery] network failure:", error);
    throw new DeliveryUnavailableError();
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // A non-JSON body from a proxy. Treated as a generic failure rather than
    // shown to a customer verbatim.
    throw new DeliveryUnavailableError();
  }
  if (!response.ok) {
    console.error(`[delivery] ${path} returned ${response.status}`);
    throw new DeliveryUnavailableError(
      typeof body.error === "string" ? body.error : undefined,
    );
  }
  return body as T;
}

const get = <T,>(path: string) => call<T>(path);
const post = <T,>(path: string, payload?: unknown) =>
  call<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}) });
const put = <T,>(path: string, payload?: unknown) =>
  call<T>(path, { method: "PUT", body: JSON.stringify(payload ?? {}) });

// ---------------------------------------------------------------------------
// Shapes - deliberately narrow, so a field the server does not send cannot be
// rendered by accident.
// ---------------------------------------------------------------------------

export type VehicleType = "bicycle" | "motorcycle" | "car" | "van" | "truck";

export interface VehicleOption {
  id: string;
  type: VehicleType;
  name: string;
  icon: string;
  description: string;
  active: boolean;
  maxWeightKg: number;
  maxPackageSizeCm: number;
  maxItems: number;
  carriesFragile: boolean;
  baseFee: number;
  pricePerKm: number;
  minFee: number;
}

export interface PackageInfo {
  weightKg: number;
  itemCount: number;
  longestSideCm: number;
  fragile: boolean;
  handlingNotes: string[];
  summary: string;
}

export interface DeliveryConfig {
  vehicles: VehicleOption[];
  zones: { id: string; name: string; area: string }[];
  proofMethod: "otp" | "customer-confirmation" | "code";
  commissionBps: number;
  currency: string;
  map: { provider: string; configured: boolean; routesAreRoadAccurate: boolean; note: string };
}

export interface PublicMapEnv {
  tileProvider: string | null;
  browserToken: string;
  attribution: string;
}

export interface PriceQuote {
  currency: string;
  subtotal: number;
  driverEarnings: number;
  platformCommission: number;
  commissionBps: number;
  breakdown: string[];
  minFeeApplied: boolean;
  maxFeeApplied: boolean;
}

export interface PublicDriver {
  id: string;
  fullName: string;
  photoUrl: string | null;
  vehicleType: VehicleType;
  vehiclePlate: string | null;
  rating: number;
  ratingCount: number;
  phone: string | null;
  totalDeliveries: number;
}

export type DeliveryStatus =
  | "REQUESTED" | "SEARCHING_DRIVER" | "DRIVER_ASSIGNED" | "DRIVER_GOING_TO_PICKUP"
  | "ARRIVED_AT_PICKUP" | "ORDER_PICKED_UP" | "IN_TRANSIT" | "ARRIVING"
  | "DELIVERED" | "CANCELLED" | "FAILED" | "RETURNED";

/** The CUSTOMER's view. What the tracking screen renders. */
export interface CustomerDelivery {
  id: string;
  status: DeliveryStatus;
  reference: string | null;
  orderId: string | null;
  vehicleType: VehicleType;
  pickupAddress: string;
  destinationAddress: string;
  pickup: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  route: { latitude: number; longitude: number }[] | null;
  distanceKm: number;
  estimatedDurationSec: number;
  fee: { total: number; currency: string; breakdown: string[] };
  packageSummary: string;
  fragile: boolean;
  handlingNotes: string[];
  driver: PublicDriver | null;
  driverPosition: { latitude: number; longitude: number; at: string } | null;
  /** Present only at the door, and only while it is unused. */
  deliveryCode: string | null;
  canConfirm: boolean;
  canRate: boolean;
  canCancel: boolean;
  canReportProblem: boolean;
  statusReason: string | null;
  history: { at: string; status: DeliveryStatus; note: string }[];
  requestedAt: string;
  deliveredAt: string | null;
}

/** The DRIVER's view of a job - both contact numbers, and the fee. */
export interface DriverJob {
  id: string;
  status: DeliveryStatus;
  pickupAddress: string;
  destinationAddress: string;
  pickup: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  pickupContactName: string;
  pickupContactPhone: string;
  destinationContactName: string;
  destinationContactPhone: string;
  distanceKm: number;
  estimatedDurationSec: number;
  vehicleType: VehicleType;
  fee: { total: number; currency: string; breakdown: string[] };
  earnings: number;
  packageSummary: string;
  fragile: boolean;
  handlingNotes: string[];
  deliveryNotes: string;
}

export interface DriverOffer {
  offerId: string;
  expiresInSec: number;
  rank: number;
  delivery: DriverJob;
}

export interface DriverProfileView {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: string;
  availability: "OFFLINE" | "ONLINE" | "BUSY" | "SUSPENDED";
  statusReason: string | null;
  vehicle: { type: VehicleType; make: string; model: string; plateNumber: string | null };
  address: string;
  emergencyContact: { name: string; phone: string } | null;
  rating: number;
  ratingCount: number;
  deliveriesCompleted: number;
  earningsTotal: number;
  registeredAt: string;
}

export interface NextAction { to: DeliveryStatus; label: string }

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

export const fetchDeliveryConfig = () => get<DeliveryConfig>("/api/delivery/config");

/**
 * The only map configuration the browser may see.
 *
 * A browser-restricted token and an attribution string; the server key is never
 * reachable from here, because the server builds this object field by field.
 */
export const fetchMapEnv = () => get<PublicMapEnv>("/api/delivery/map/config");

export interface QuoteRequest {
  vehicleType: VehicleType;
  destination: { latitude: number; longitude: number };
  pickup?: { latitude: number; longitude: number } | null;
  lines?: { productId: string; quantity: number; name?: string; weightKg?: number | null }[];
  overrides?: { fragile?: boolean; handlingNotes?: string[] };
}

/**
 * A price for an address and a vehicle, creating nothing.
 *
 * Called as the customer picks a vehicle or moves the pin, so the figure on
 * screen is produced by the same engine that will charge them.
 */
export const fetchQuote = (request: QuoteRequest) =>
  post<{
    quote: PriceQuote;
    distanceKm: number;
    estimatedDurationSec: number;
    /** True when the km figure is a straight-line estimate, not a road route. */
    distanceIsEstimate: boolean;
    zone: { id: string; name: string } | null;
    package: PackageInfo;
  }>("/api/delivery/quote", request);

/** Which vehicle classes could carry this parcel, cheapest first. */
export const fetchVehiclesForParcel = (lines: QuoteRequest["lines"]) =>
  post<{ package: PackageInfo; vehicles: { type: VehicleType; name: string; icon: string; description: string }[] }>(
    "/api/delivery/vehicles-for",
    { lines },
  );

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export const fetchDeliveries = (status?: string) =>
  get<{ deliveries: CustomerDelivery[] }>(
    `/api/delivery${status ? `?status=${encodeURIComponent(status)}` : ""}`,
  );

export const fetchDelivery = (id: string) =>
  get<{ delivery: CustomerDelivery }>(`/api/delivery/${encodeURIComponent(id)}`);

export const requestDelivery = (request: {
  orderId: string;
  vehicleType: VehicleType;
  destination?: { latitude: number; longitude: number; address: string };
  deliveryNotes?: string;
  overrides?: { fragile?: boolean; handlingNotes?: string[] };
}) => post<{ delivery: CustomerDelivery }>("/api/delivery/request", request);

/** Choose the pickup point, which starts the search. */
export const setPickupPoint = (id: string, pickup: { latitude: number; longitude: number; address: string }) =>
  post<{ delivery: CustomerDelivery }>(`/api/delivery/${encodeURIComponent(id)}/pickup`, pickup);

export const cancelDelivery = (id: string, reason: string) =>
  post<{ delivery: CustomerDelivery }>(`/api/delivery/${encodeURIComponent(id)}/cancel`, { reason });

/** The customer confirms receipt at the door (when that is the configured proof). */
export const confirmDelivery = (id: string) =>
  post<{ delivery: CustomerDelivery }>(`/api/delivery/${encodeURIComponent(id)}/confirm`);

export const rateDelivery = (id: string, rating: { stars: number; comment?: string; traits?: string[] }) =>
  post<{ rating: { stars: number }; driverRating: number; atRisk: boolean; message: string }>(
    `/api/delivery/${encodeURIComponent(id)}/rate`,
    rating,
  );

export const reportProblem = (id: string, description: string) =>
  post<{ ok: boolean; message: string }>(`/api/delivery/${encodeURIComponent(id)}/problem`, { description });

export const fetchNotifications = () =>
  get<{ notifications: { id: string; title: string; body: string; read: boolean; createdAt: string; event: string }[] }>(
    "/api/delivery/notifications",
  );

export const markNotificationsRead = (ids?: string[]) =>
  post<{ ok: boolean; read: number }>("/api/delivery/notifications/read", { ids });

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export const registerDriver = (details: {
  fullName: string;
  phone: string;
  address: string;
  vehicleType: VehicleType;
  email?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  plateNumber?: string;
  vehicleYear?: number;
  licenceNumber?: string;
  licenceExpiry?: string;
  idNumber?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  photoUrl?: string;
}) => post<{ driver: DriverProfileView; message: string }>("/api/delivery/driver/register", details);

export const fetchMyDriverProfile = () =>
  get<{ driver: DriverProfileView }>("/api/delivery/driver/me");

/** Go online or offline. The server refuses ONLINE until the driver is approved. */
export const setAvailability = (availability: "ONLINE" | "OFFLINE") =>
  post<{ driver: DriverProfileView; message: string }>("/api/delivery/driver/availability", {
    availability,
  });

export const fetchOffers = () =>
  get<{ offers: DriverOffer[]; availability: string; status: string }>("/api/delivery/driver/offers");

export const acceptOffer = (offerId: string) =>
  post<{ delivery: DriverJob; message: string }>(
    `/api/delivery/driver/offers/${encodeURIComponent(offerId)}/accept`,
  );

export const declineOffer = (offerId: string) =>
  post<{ ok: boolean }>(`/api/delivery/driver/offers/${encodeURIComponent(offerId)}/decline`);

export const fetchActiveJob = () =>
  get<{ delivery: DriverJob | null; nextAction: NextAction | null; proofRequired: boolean }>(
    "/api/delivery/driver/active",
  );

/** The next legal step. There is no `status` parameter - the server decides. */
export const advanceJob = () =>
  post<{ delivery: DriverJob; nextAction: NextAction | null; deliveryCode: string | null }>(
    "/api/delivery/driver/active/advance",
  );

/** Hand the parcel over. Requires the code the customer reads out. */
export const completeJob = (deliveryCode?: string) =>
  post<{ delivery: DriverJob; earnings: number; message: string }>(
    "/api/delivery/driver/complete",
    deliveryCode ? { deliveryCode } : {},
  );

/** A live position ping. Accepted while online, on or off a job. */
export const sendLocation = (position: {
  latitude: number;
  longitude: number;
  heading?: number;
  speedMps?: number;
}) => post<{ ok: boolean; at: string; onDelivery: string | null }>("/api/delivery/driver/location", position);

export const fetchEarnings = () =>
  get<{
    earnings: { id: string; deliveryId: string; netEarnings: number; grossFee: number; earnedOn: string }[];
    total: number;
    lifetime: number;
    deliveries: number;
    commissionBps: number;
  }>("/api/delivery/driver/earnings");

// ---------------------------------------------------------------------------
// Real-time - SSE with a polling fallback
// ---------------------------------------------------------------------------

export interface DeliveryWatchHandlers {
  onTransport?: (transport: "sse" | "polling") => void;
  onSnapshot?: (delivery: CustomerDelivery) => void;
  onEvent?: (event: { deliveryId: string; event: string; status: DeliveryStatus; driverPosition: { latitude: number; longitude: number; at: string } | null }) => void;
}

const BUSY_POLL_MS = 4_000;
const IDLE_POLL_MS = 15_000;

/**
 * Watch one delivery.
 *
 * Prefers SSE and falls back to polling, so tracking keeps working behind a
 * proxy that buffers the stream. Returns a disposer.
 */
export function watchDelivery(id: string, handlers: DeliveryWatchHandlers): () => void {
  let disposed = false;
  let source: EventSource | null = null;
  let timer: number | null = null;
  let idleTicks = 0;

  const startPolling = () => {
    if (disposed) return;
    handlers.onTransport?.("polling");
    const tick = async () => {
      if (disposed) return;
      try {
        const result = await fetchDelivery(id);
        handlers.onSnapshot?.(result.delivery);
        // A live delivery polls fast; a finished one backs off so an open tab
        // does not hammer the server forever.
        idleTicks = isFinished(result.delivery.status) ? idleTicks + 1 : 0;
        timer = window.setTimeout(
          tick,
          idleTicks === 0 ? BUSY_POLL_MS : Math.min(IDLE_POLL_MS, BUSY_POLL_MS * idleTicks),
        );
      } catch {
        // Transient: keep trying rather than tearing the tracker down.
        timer = window.setTimeout(tick, 5_000);
      }
    };
    void tick();
  };

  const read = (event: Event): Record<string, unknown> | null => {
    try {
      return JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  try {
    source = new EventSource(`/api/delivery/${encodeURIComponent(id)}/stream`);
    source.addEventListener("open", () => {
      if (!disposed) handlers.onTransport?.("sse");
    });
    source.addEventListener("snapshot", (event) => {
      const data = read(event) as { delivery?: CustomerDelivery } | null;
      if (data?.delivery) handlers.onSnapshot?.(data.delivery);
    });
    source.addEventListener("message", (event) => {
      const data = read(event) as { deliveryId?: string; event?: string } | null;
      if (data?.event) {
        handlers.onEvent?.(data as never);
        // A status event means our snapshot is stale; refresh it.
        void fetchDelivery(id)
          .then((r) => handlers.onSnapshot?.(r.delivery))
          .catch(() => undefined);
      }
    });
    source.addEventListener("error", () => {
      // EventSource retries on its own, but if the stream is blocked outright we
      // fall back to polling so the customer still sees their parcel move.
      if (source && source.readyState === EventSource.CLOSED) {
        source.close();
        source = null;
        startPolling();
      }
    });
  } catch {
    startPolling();
  }

  return () => {
    disposed = true;
    if (timer) window.clearTimeout(timer);
    source?.close();
  };
}

function isFinished(status: DeliveryStatus): boolean {
  return status === "DELIVERED" || status === "CANCELLED" || status === "FAILED" || status === "RETURNED";
}
