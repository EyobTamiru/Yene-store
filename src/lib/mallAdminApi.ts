/**
 * ============================================================================
 *  MALL ADMINISTRATION CLIENT
 * ============================================================================
 *
 *  The Super Admin's control surface for malls: show and hide them, price their
 *  counters, record the agreement with the landlord, and watch the rent roll.
 *
 *  The browser can ask the server to change any of that. It can never COMPUTE
 *  any of it - occupancy, the rent roll and the landlord's payout all come from
 *  the server, because a total recomputed in the browser from a list the browser
 *  happens to be holding is a number that can disagree with the ledger.
 */

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    console.error("[mallAdmin] network failure:", error);
    throw new MallAdminError("We could not reach YENE-STORE. Please check your connection.");
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new MallAdminError(
      typeof body.error === "string" ? body.error : "Something went wrong. Please try again.",
    );
  }
  return body as T;
}

export class MallAdminError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super("mall_admin_failed");
    this.name = "MallAdminError";
    this.userMessage = userMessage;
  }
}

export interface MallOccupancy {
  total: number;
  leased: number;
  held: number;
  available: number;
  unlisted: number;
  occupancyPercent: number | null;
}

export interface MallRentRoll {
  contractedMonthlyEtb: number;
  listedMonthlyEtb: number;
  potentialMonthlyEtb: number;
  depositsHeldEtb: number;
  leaseCount: number;
}

export interface AdminMall {
  id: string;
  name: string;
  slug: string;
  city: string;
  address: string;
  description: string;
  floors: string[];
  agreementId: string | null;
  visible: boolean;
  storeCount: number;
  occupancy: MallOccupancy;
  rentRoll: MallRentRoll;
  agreement: {
    id: string;
    landlordName: string;
    status: string;
    revenueSharePercent: number;
    monthlyFeeEtb: number;
    endDate: string | null;
    payoutEtb: number;
  } | null;
}

export interface AdminMallList {
  malls: AdminMall[];
  totals: {
    malls: number;
    visible: number;
    units: number;
    leased: number;
    contractedMonthlyEtb: number;
    potentialMonthlyEtb: number;
  };
}

export interface AdminUnit {
  id: string;
  mallId: string;
  floor: string;
  number: string;
  sizeSqm: number;
  monthlyRentEtb: number;
  status: "available" | "held" | "leased";
  listable: boolean;
  businessId: string | null;
  applicationId: string | null;
  tenantName: string | null;
  currentLeaseRentEtb: number | null;
}

export interface AdminLease {
  id: string;
  mallId: string;
  businessId: string;
  unitId: string;
  unitNumber: string;
  unitSizeSqm: number | null;
  tenantName: string;
  tenantSubdomain: string | null;
  monthlyRentEtb: number;
  depositEtb: number;
  listedRentEtb: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
}

export interface AdminAgreement {
  id: string;
  mallId: string;
  landlordName: string;
  landlordPhone: string;
  landlordEmail: string;
  status: "draft" | "active" | "expired" | "terminated";
  monthlyFeeEtb: number;
  revenueSharePercent: number;
  startDate: string;
  endDate: string | null;
  signedByLandlord: boolean;
  notes: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const fetchAdminMalls = () => call<AdminMallList>("/api/platform/admin/malls");

export const fetchAdminUnits = (mallId: string) =>
  call<{ mall: { id: string; name: string; floors: string[] }; units: AdminUnit[] }>(
    `/api/platform/admin/malls/${encodeURIComponent(mallId)}/units`,
  );

export const fetchAdminLeases = (mallId: string) =>
  call<{ leases: AdminLease[]; rentRoll: MallRentRoll }>(
    `/api/platform/admin/malls/${encodeURIComponent(mallId)}/leases`,
  );

export const fetchAdminAgreement = (mallId: string) =>
  call<{
    mall: { id: string; name: string; agreementId: string | null };
    agreements: AdminAgreement[];
    current: AdminAgreement | null;
    rentRoll: MallRentRoll;
    payoutPreview: { revenueSharePercent: number; payoutEtb: number } | null;
  }>(`/api/platform/admin/malls/${encodeURIComponent(mallId)}/agreement`);

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const createMall = (details: {
  name: string;
  city?: string;
  address?: string;
  description?: string;
  floors: string;
  visible?: boolean;
}) =>
  call<{ success: boolean; mall: AdminMall }>("/api/platform/admin/malls", {
    method: "POST",
    body: JSON.stringify(details),
  });

/** The show/hide switch for a whole mall. */
export const setMallVisible = (mallId: string, visible: boolean) =>
  call<{ success: boolean; mall: AdminMall }>(
    `/api/platform/admin/malls/${encodeURIComponent(mallId)}`,
    { method: "PATCH", body: JSON.stringify({ visible }) },
  );

export const updateMall = (mallId: string, details: Record<string, unknown>) =>
  call<{ success: boolean; mall: AdminMall }>(
    `/api/platform/admin/malls/${encodeURIComponent(mallId)}`,
    { method: "PATCH", body: JSON.stringify(details) },
  );

export const deleteMall = (mallId: string) =>
  call<{ success: boolean; message: string }>(
    `/api/platform/admin/malls/${encodeURIComponent(mallId)}`,
    { method: "DELETE" },
  );

/**
 * The switch for ONE counter: whether it appears in "Rooms still available".
 *
 * Deliberately its own call rather than a field on `updateUnit`, so the action an
 * administrator performs most often cannot be blocked by a malformed price
 * somewhere else in the same form.
 */
export const setUnitListable = (unitId: string, listable: boolean) =>
  call<{ success: boolean; unit: AdminUnit }>(
    `/api/platform/admin/units/${encodeURIComponent(unitId)}`,
    { method: "PATCH", body: JSON.stringify({ listable }) },
  );

export const updateUnit = (
  unitId: string,
  details: { monthlyRentEtb?: number; sizeSqm?: number; floor?: string; number?: string },
) =>
  call<{ success: boolean; unit: AdminUnit }>(
    `/api/platform/admin/units/${encodeURIComponent(unitId)}`,
    { method: "PATCH", body: JSON.stringify(details) },
  );

export const addUnit = (
  mallId: string,
  details: {
    floor: string;
    number: string;
    sizeSqm: number;
    monthlyRentEtb: number;
    listable?: boolean;
  },
) =>
  call<{ success: boolean; unit: AdminUnit }>(
    `/api/platform/admin/malls/${encodeURIComponent(mallId)}/units`,
    { method: "POST", body: JSON.stringify(details) },
  );

export const deleteUnit = (unitId: string) =>
  call<{ success: boolean; message: string }>(
    `/api/platform/admin/units/${encodeURIComponent(unitId)}`,
    { method: "DELETE" },
  );

export const saveAgreement = (
  mallId: string,
  details: {
    landlordName: string;
    landlordPhone?: string;
    landlordEmail?: string;
    status: string;
    monthlyFeeEtb: number;
    revenueSharePercent: number;
    startDate?: string;
    endDate?: string | null;
    signedByLandlord?: boolean;
    notes?: string;
  },
) =>
  call<{
    success: boolean;
    agreementId: string;
    active: boolean;
    payoutEtb: number;
    message: string;
  }>(`/api/platform/admin/malls/${encodeURIComponent(mallId)}/agreement`, {
    method: "PUT",
    body: JSON.stringify(details),
  });

/** End a lease - which releases the counter back onto the market. */
export const setLeaseActive = (leaseId: string, active: boolean) =>
  call<{ success: boolean; message: string; lease: AdminLease }>(
    `/api/platform/admin/leases/${encodeURIComponent(leaseId)}`,
    { method: "PATCH", body: JSON.stringify({ active }) },
  );

export const updateLease = (
  leaseId: string,
  details: { monthlyRentEtb?: number; depositEtb?: number },
) =>
  call<{ success: boolean; lease: AdminLease }>(
    `/api/platform/admin/leases/${encodeURIComponent(leaseId)}`,
    { method: "PATCH", body: JSON.stringify(details) },
  );