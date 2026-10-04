/**
 * ============================================================================
 *  SECTION BODY
 * ============================================================================
 *
 *  Renders the open section. One `useEffect` owns loading and error so no
 *  section can invent its own version of "spinner forever", and the registry
 *  decides the shape of each one.
 *
 *  THE HONESTNESS RULE, IN ONE PLACE
 *  ---------------------------------
 *  A section the registry marks with no backend renders `NotBuiltNotice` and
 *  stops. It does not render a table of zeros, a disabled form, or a spinner.
 *  A section marked read-only renders its data plus the registry's note about
 *  what is not built - never an "Edit" button.
 *
 *  RE-FETCH
 *  --------
 *  `reload` is stable and keyed on the section, so switching sections and
 *  coming back re-reads. A balance of stock or an order status is live data;
 *  showing a figure from five minutes ago because the user navigated away would
 *  be a quiet lie.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, Send } from "lucide-react";
import {
  DataTable,
  ErrorState,
  Field,
  Loading,
  NotBuiltNotice,
  ReadOnlyNotice,
  SubHeading,
  type Column,
} from "./sectionPrimitives";
import { isSectionAvailable, type SectionDefinition } from "./sectionRegistry";
import {
  changePackage,
  fetchSectionCategories,
  fetchSectionInventory,
  fetchSectionOperations,
  fetchSectionOrders,
  fetchSectionProducts,
  fetchSectionPromotions,
  fetchSectionStore,
  fetchSectionSubscription,
  renewPackage,
  submitProductForReview,
  updateOrderStatus,
  type SectionInventory,
  type SectionOperations,
  type SectionOrder,
  type SectionProduct,
  type SectionSubscription,
} from "../../lib/managementSectionsApi";
import type { ManagementOverview } from "../../lib/managementApi";
import { TOUCH } from "../marketplace/ProductCard";

/** Whole-number ETB, the platform's own convention. */
const etb = (value: number) => `${value.toLocaleString("en-US")} ETB`;
const day = (iso: string) => (iso ? new Date(iso).toISOString().slice(0, 10) : "-");

/** The order lifecycle the server accepts. Mirrors `isValidOrderStatus`. */
const ORDER_STATUSES = ["Pending", "Confirmed", "Packed", "Shipped", "Delivered", "Cancelled"];

export function SectionBody({
  section,
  overview,
  subdomain,
  onNavigateSupport,
}: {
  section: SectionDefinition;
  overview: ManagementOverview;
  subdomain: string;
  onNavigateSupport: () => void;
}) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isSectionAvailable(section)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchFor(section.key, subdomain)
      .then((result) => setData(result))
      .catch((cause) => setError((cause as { userMessage?: string }).userMessage ?? "Something went wrong."))
      .finally(() => setLoading(false));
  }, [section, subdomain]);

  useEffect(load, [load]);

  // A section with no backend never fetches, and says so instead.
  if (!isSectionAvailable(section)) {
    return <NotBuiltNotice missing={section.missing} />;
  }

  // The Overview section reads the data already passed in - it was fetched to
  // render the dashboard this screen was opened from, and re-fetching it would
  // be a second identical request for no gain.
  if (section.key === "dashboard" || section.key === "analytics") {
    return <OverviewBody overview={overview} analytics={section.key === "analytics"} missing={section.missing} />;
  }
  if (section.key === "support") {
    return <SupportBody onOpen={onNavigateSupport} />;
  }

  if (loading) return <Loading label={`Loading ${section.label.toLowerCase()}...`} />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const shared = {
    busyId,
    setBusyId,
    actionError,
    setActionError,
    confirm,
    setConfirm,
    reload: load,
  };

  switch (section.key) {
    case "store":
      return <StoreBody data={data as Awaited<ReturnType<typeof fetchSectionStore>>} section={section} />;
    case "products":
      return <ProductsBody data={data as Awaited<ReturnType<typeof fetchSectionProducts>>} section={section} {...shared} />;
    case "categories":
      return <CategoriesBody data={data as Awaited<ReturnType<typeof fetchSectionCategories>>} section={section} />;
    case "orders":
      return <OrdersBody data={data as Awaited<ReturnType<typeof fetchSectionOrders>>} section={section} {...shared} />;
    case "customers":
      return <CustomersBody data={data as SectionOperations} section={section} />;
    case "employees":
      return <EmployeesBody data={data as SectionOperations} section={section} />;
    case "expenses":
      return <ExpensesBody data={data as SectionOperations} section={section} />;
    case "suppliers":
      return <SuppliersBody data={data as SectionOperations} section={section} />;
    case "purchases":
      return <PurchasesBody data={data as SectionOperations} section={section} />;
    case "roles":
      return <RolesBody data={data as SectionOperations} section={section} />;
    default:
      return <NotBuiltNotice missing={section.missing || "This section has no data source yet."} />;
  }
}

/**
 * The one place a section key turns into a request.
 *
 * An explicit switch rather than a lookup table, so adding a section to the
 * registry WITHOUT giving it a fetch is a visible type error rather than a
 * section that quietly renders `undefined`.
 */
async function fetchFor(key: string, subdomain: string): Promise<unknown> {
  switch (key) {
    case "store":
      return fetchSectionStore(subdomain);
    case "products":
      return fetchSectionProducts();
    case "categories":
      return fetchSectionCategories();
    case "orders":
      return fetchSectionOrders();
    case "inventory":
      return fetchSectionInventory();
    case "promotions":
      return fetchSectionPromotions();
    case "billing":
      return fetchSectionSubscription();
    // Customers, employees, expenses, suppliers, purchases and roles all come
    // from ONE endpoint. Six sections, one request, cached for the session -
    // which is also why opening them is instant after the first.
    case "customers":
    case "employees":
    case "expenses":
    case "suppliers":
    case "purchases":
    case "roles":
      return fetchSectionOperations();
    default:
      throw new Error("This section has no data source yet.");
  }
}

interface ActionState {
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  actionError: string | null;
  setActionError: (message: string | null) => void;
  confirm: string | null;
  setConfirm: (id: string | null) => void;
  reload: () => void;
}

/** Runs a write, surfaces its failure, and re-reads on success. */
async function runAction(
  id: string,
  action: () => Promise<unknown>,
  state: ActionState,
): Promise<void> {
  state.setBusyId(id);
  state.setActionError(null);
  try {
    await action();
    state.setConfirm(null);
    state.reload();
  } catch (cause) {
    state.setActionError((cause as { userMessage?: string }).userMessage ?? "That action did not work.");
  } finally {
    state.setBusyId(null);
  }
}

// ---------------------------------------------------------------------------
// Overview and Analytics - both read the data the dashboard already fetched
// ---------------------------------------------------------------------------

function OverviewBody({
  overview,
  analytics,
  missing,
}: {
  overview: ManagementOverview;
  analytics: boolean;
  missing: string;
}) {
  const { stats } = overview;
  const cards = [
    { label: "Today's sales", value: etb(stats.todaySales) },
    { label: "Orders today", value: String(stats.todayOrders) },
    { label: "All orders", value: String(stats.orders) },
    { label: "Customers", value: String(stats.customers) },
    { label: "Products", value: String(stats.products) },
    { label: "Recorded expenses", value: etb(stats.expenses) },
    { label: "Low stock items", value: String(stats.lowStock) },
    { label: "Package", value: overview.packageId ?? "unknown" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 tablet:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-card border border-yene-line-soft bg-yene-surface px-3 py-3">
            <p className="text-[11.5px] text-yene-muted">{card.label}</p>
            <p className="mt-1 truncate text-[15px] font-semibold capitalize text-yene-text">{card.value}</p>
          </div>
        ))}
      </div>

      {missing && <ReadOnlyNotice missing={missing} />}

      {stats.lowStockItems.length > 0 && (
        <>
          <SubHeading>Needs restocking</SubHeading>
          <DataTable
            caption="Products at or below their reorder level"
            rows={stats.lowStockItems.map((item) => ({ ...item, id: item.itemId }))}
            columns={[
              { key: "name", header: "Product", render: (row) => row.name },
              { key: "onHand", header: "On hand", numeric: true, render: (row) => String(row.onHand) },
              {
                key: "reorder",
                header: "Reorder at",
                numeric: true,
                render: (row) => String(row.reorderLevel),
              },
            ]}
            empty={{ title: "Nothing needs restocking." }}
          />
        </>
      )}

      {analytics && (
        <p className="rounded-button border border-yene-line-soft bg-yene-raised px-3 py-2.5 text-[12.5px] leading-relaxed text-yene-muted">
          These are live totals for your business as the server calculates them now. Choosing a
          date range is not offered until an endpoint exists that aggregates over a period, and
          presenting a made-up trend line would be worse than presenting none.
        </p>
      )}
    </div>
  );
}

function SupportBody({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-yene-muted">
        Yene Business Group support handles tickets, live chat and the knowledge base. Your
        existing requests and any new ones live there.
      </p>
      <button
        type="button"
        onClick={onOpen}
        className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
      >
        <Send size={14} aria-hidden />
        Open support
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type StoreData = Awaited<ReturnType<typeof fetchSectionStore>>;

function StoreBody({ data, section }: { data: StoreData; section: SectionDefinition }) {
  return (
    <div className="space-y-4">
      <dl className="rounded-card border border-yene-line-soft bg-yene-surface px-4 py-1">
        <Field label="Business name" value={data.customization.businessName || data.business.name} />
        <Field label="Subdomain" value={<span className="font-mono text-[12px]">{data.business.subdomain}</span>} />
        <Field label="Store status" value={data.business.status} />
        <Field label="Rating" value={String(data.rating)} />
        <Field label="Phone" value={data.customization.contact.phone || "-"} />
        <Field label="Email" value={data.customization.contact.email || "-"} />
        <Field label="Address" value={data.customization.contact.address || "-"} />
      </dl>
      <ReadOnlyNotice missing={section.missing} />
      <SubHeading>Published products ({data.products.length})</SubHeading>
      <DataTable
        rows={data.products}
        caption="Products currently visible on your storefront"
        columns={[
          { key: "name", header: "Product", render: (row) => row.name },
          { key: "price", header: "Price", numeric: true, render: (row) => etb(row.price) },
        ]}
        empty={{ title: "No products are published on your storefront yet." }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Products - read plus the one real write: submit for marketplace review
// ---------------------------------------------------------------------------

type ProductsData = Awaited<ReturnType<typeof fetchSectionProducts>>;

function ProductsBody({
  data,
  section,
  busyId,
  setBusyId,
  actionError,
  setActionError,
  reload,
}: { data: ProductsData; section: SectionDefinition } & ActionState) {
  const [query, setQuery] = useState("");
  // The route nests the product under a wrapper that also carries the
  // marketplace status. `DataTable` keys on a flat `id`, so the rows are
  // flattened here rather than weakening the table's own type.
  const rows: (SectionProduct & { id: string })[] = data.products.map((row) => ({
    ...row,
    id: row.product.id,
  }));
  const filtered = rows.filter((row) =>
    row.product.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const columns: Column<SectionProduct & { id: string }>[] = [
    { key: "name", header: "Product", render: (row) => row.product.name },
    { key: "price", header: "Price", numeric: true, render: (row) => etb(row.product.price) },
    { key: "stock", header: "Stock", numeric: true, render: (row) => String(row.product.stock) },
    { key: "status", header: "Marketplace", render: (row) => row.marketplaceStatus },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <ActionButton
          label="Submit for review"
          busy={busyId === row.product.id}
          disabled={row.marketplaceStatus !== "Not Submitted"}
          title={
            row.marketplaceStatus !== "Not Submitted"
              ? "This product is already in review or published."
              : "Send this product for marketplace review."
          }
          onClick={() =>
            void runAction(row.product.id, () => submitProductForReview(row.product.id), {
              busyId,
              setBusyId,
              actionError,
              setActionError,
              confirm: null,
              setConfirm: () => undefined,
              reload,
            })
          }
        />
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} placeholder="Search products..." />
      {actionError && <ActionError message={actionError} />}
      <ReadOnlyNotice missing={section.missing} />
      <DataTable
        rows={filtered}
        caption="Your product catalogue and marketplace status"
        columns={columns}
        empty={
          query
            ? { title: "No products match that search." }
            : {
                title: "You have no products yet.",
                hint: "Products appear here once they exist for your business.",
              }
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

type CategoriesData = Awaited<ReturnType<typeof fetchSectionCategories>>;

function CategoriesBody({ data, section }: { data: CategoriesData; section: SectionDefinition }) {
  const [query, setQuery] = useState("");
  const rows = data.categories.filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} placeholder="Search categories..." />
      <ReadOnlyNotice missing={section.missing} />
      <DataTable
        rows={rows}
        caption="Product category tree"
        columns={[
          { key: "name", header: "Category", render: (row) => row.name },
          { key: "parent", header: "Parent", render: (row) => row.parentId ?? "Top level" },
          { key: "enabled", header: "Enabled", render: (row) => (row.enabled ? "Yes" : "No") },
        ]}
        empty={{ title: "No categories match that search." }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders - the section with a real write: the status lifecycle
// ---------------------------------------------------------------------------

type OrdersData = Awaited<ReturnType<typeof fetchSectionOrders>>;

function OrdersBody({
  data,
  section,
  busyId,
  setBusyId,
  actionError,
  setActionError,
  confirm,
  setConfirm,
  reload,
}: { data: OrdersData; section: SectionDefinition } & ActionState) {
  const [query, setQuery] = useState("");
  const rows = data.orders.filter((row) =>
    `${row.customerName} ${row.id} ${row.status}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const columns: Column<SectionOrder>[] = [
    { key: "id", header: "Order", render: (row) => <span className="font-mono text-[11.5px]">{row.id}</span> },
    { key: "customer", header: "Customer", render: (row) => row.customerName },
    { key: "date", header: "Date", render: (row) => day(row.createdAt) },
    { key: "total", header: "Total", numeric: true, render: (row) => etb(row.total) },
    { key: "payment", header: "Payment", render: (row) => row.paymentStatus },
    { key: "status", header: "Status", render: (row) => row.status },
  ];

  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} placeholder="Search by customer, order or status..." />
      {actionError && <ActionError message={actionError} />}

      <DataTable
        rows={rows}
        caption="Orders placed against your business"
        columns={columns}
        empty={
          query
            ? { title: "No orders match that search." }
            : { title: "No orders yet.", hint: "Orders appear here as customers check out." }
        }
      />

      <SubHeading>Update a status</SubHeading>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-yene-muted">There are no orders to update.</p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 10).map((order) => (
            <li key={order.id} className="rounded-card border border-yene-line-soft bg-yene-surface px-3 py-2.5">
              {confirm === order.id ? (
                <div className="space-y-2">
                  <p className="text-[12.5px] text-yene-text">
                    Move order <span className="font-mono">{order.id}</span> from{" "}
                    <strong>{order.status}</strong> to:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ORDER_STATUSES.filter((status) => status !== order.status).map((status) => (
                      <button
                        key={status}
                        type="button"
                        disabled={busyId !== null}
                        onClick={() =>
                          void runAction(
                            order.id,
                            () => updateOrderStatus(order.id, status),
                            { busyId, setBusyId, actionError, setActionError, confirm, setConfirm, reload },
                          )
                        }
                        className={`${TOUCH} rounded-button border border-yene-line px-2.5 text-[12px] font-medium text-yene-text transition-colors hover:border-yene-accent hover:text-yene-accent disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                      >
                        {status}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setConfirm(null)}
                      className={`${TOUCH} rounded-button px-2.5 text-[12px] text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] text-yene-text">
                    <span className="font-mono text-[11.5px]">{order.id}</span> &middot; {order.status}
                  </span>
                  <ActionButton
                    label="Change status"
                    busy={false}
                    disabled={busyId !== null}
                    onClick={() => setConfirm(order.id)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {section.missing && <ReadOnlyNotice missing={section.missing} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The six sections that share GET /api/platform/operations
// ---------------------------------------------------------------------------

/**
 * A read-only table over one collection from the operations payload.
 *
 * One component for all six, because they differ only in which array they read
 * and which columns they show. Writing six near-identical components is how
 * they drift apart.
 */
function CollectionSection({
  title,
  rows,
  columns,
  section,
  emptyTitle,
  emptyHint,
}: {
  title: string;
  rows: { id: string }[];
  columns: Column<{ id: string }>[];
  section: SectionDefinition;
  emptyTitle: string;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? (rows as Record<string, unknown>[]).filter((row) =>
        Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(needle)),
      )
    : rows;

  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} placeholder={`Search ${title.toLowerCase()}...`} />
      <ReadOnlyNotice missing={section.missing} />
      <DataTable
        rows={filtered as { id: string }[]}
        caption={title}
        columns={columns}
        empty={query ? { title: "Nothing matches that search." } : { title: emptyTitle, hint: emptyHint }}
      />
    </div>
  );
}

function CustomersBody({ data, section }: { data: SectionOperations; section: SectionDefinition }) {
  return (
    <CollectionSection
      title="Customers"
      rows={data.customers}
      section={section}
      emptyTitle="No customers yet."
      emptyHint="Customers are added as they check out."
      columns={[
        { key: "name", header: "Name", render: (row) => String((row as { name?: string }).name ?? "") },
        { key: "email", header: "Email", render: (row) => String((row as { email?: string }).email ?? "") },
        { key: "phone", header: "Phone", render: (row) => String((row as { phone?: string }).phone ?? "-") },
        { key: "since", header: "Since", render: (row) => day(String((row as { createdAt?: string }).createdAt ?? "")) },
      ]}
    />
  );
}

function EmployeesBody({ data, section }: { data: SectionOperations; section: SectionDefinition }) {
  return (
    <CollectionSection
      title="Employees"
      rows={data.employees}
      section={section}
      emptyTitle="No employees recorded."
      columns={[
        { key: "name", header: "Name", render: (row) => String((row as { name?: string }).name ?? "") },
        { key: "email", header: "Email", render: (row) => String((row as { email?: string }).email ?? "") },
        { key: "role", header: "Role", render: (row) => String((row as { role?: string }).role ?? "-") },
      ]}
    />
  );
}

function ExpensesBody({ data, section }: { data: SectionOperations; section: SectionDefinition }) {
  return (
    <CollectionSection
      title="Expenses"
      rows={data.expenses}
      section={section}
      emptyTitle="No expenses recorded."
      columns={[
        { key: "category", header: "Category", render: (row) => String((row as { category?: string }).category ?? "") },
        { key: "note", header: "Note", render: (row) => String((row as { note?: string }).note ?? "-") },
        { key: "amount", header: "Amount", numeric: true, render: (row) => etb(Number((row as { amount?: number }).amount ?? 0)) },
        { key: "date", header: "Date", render: (row) => day(String((row as { createdAt?: string }).createdAt ?? "")) },
      ]}
    />
  );
}

function SuppliersBody({ data, section }: { data: SectionOperations; section: SectionDefinition }) {
  return (
    <CollectionSection
      title="Suppliers"
      rows={data.suppliers}
      section={section}
      emptyTitle="No suppliers recorded."
      columns={[
        { key: "name", header: "Name", render: (row) => String((row as { name?: string }).name ?? "") },
        { key: "email", header: "Email", render: (row) => String((row as { email?: string }).email ?? "") },
        { key: "phone", header: "Phone", render: (row) => String((row as { phone?: string }).phone ?? "-") },
      ]}
    />
  );
}

function PurchasesBody({ data, section }: { data: SectionOperations; section: SectionDefinition }) {
  return (
    <CollectionSection
      title="Purchases"
      rows={data.purchases}
      section={section}
      emptyTitle="No purchases recorded."
      columns={[
        { key: "id", header: "Reference", render: (row) => <span className="font-mono text-[11.5px]">{row.id}</span> },
        { key: "supplier", header: "Supplier", render: (row) => String((row as { supplierId?: string }).supplierId ?? "-") },
        { key: "status", header: "Status", render: (row) => String((row as { status?: string }).status ?? "-") },
        { key: "total", header: "Total", numeric: true, render: (row) => etb(Number((row as { total?: number }).total ?? 0)) },
        { key: "date", header: "Date", render: (row) => day(String((row as { createdAt?: string }).createdAt ?? "")) },
      ]}
    />
  );
}

function RolesBody({ data, section }: { data: SectionOperations; section: SectionDefinition }) {
  return (
    <CollectionSection
      title="Roles"
      rows={data.roles}
      section={section}
      emptyTitle="No roles defined for your business."
      columns={[
        { key: "name", header: "Role", render: (row) => String((row as { name?: string }).name ?? "") },
        {
          key: "features",
          header: "Grants",
          render: (row) => `${((row as { features?: string[] }).features ?? []).length} features`,
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

function InventoryBody({ data, section }: { data: SectionInventory; section: SectionDefinition }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const items = data.items.filter((item) => `${item.name} ${item.sku}`.toLowerCase().includes(needle));
  const low = new Set(data.lowStock);

  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} placeholder="Search by name or SKU..." />
      <ReadOnlyNotice missing={section.missing} />
      <DataTable
        rows={items}
        caption="Stock on hand"
        columns={[
          { key: "name", header: "Item", render: (row) => row.name },
          { key: "sku", header: "SKU", render: (row) => <span className="font-mono text-[11.5px]">{row.sku}</span> },
          { key: "onHand", header: "On hand", numeric: true, render: (row) => String(row.onHand) },
          { key: "reorder", header: "Reorder at", numeric: true, render: (row) => String(row.reorderLevel) },
          {
            key: "state",
            header: "State",
            render: (row) =>
              low.has(row.id) ? (
                <span className="font-medium text-yene-warn">Low stock</span>
              ) : (
                <span className="text-yene-muted">OK</span>
              ),
          },
        ]}
        empty={
          query
            ? { title: "No items match that search." }
            : { title: "No inventory items yet.", hint: "Items appear here once stock is recorded for your business." }
        }
      />
      {data.movements.length > 0 && (
        <>
          <SubHeading>Recent movements</SubHeading>
          <DataTable
            rows={data.movements}
            caption="Recent stock movements"
            columns={[
              { key: "item", header: "Item", render: (row) => row.itemName },
              { key: "kind", header: "Movement", render: (row) => row.kind },
              { key: "qty", header: "Quantity", numeric: true, render: (row) => String(row.quantity) },
              { key: "at", header: "When", render: (row) => day(row.at) },
            ]}
            empty={{ title: "No movements recorded." }}
          />
        </>
      )}
      {data.nodes.length > 0 && (
        <>
          <SubHeading>Locations</SubHeading>
          <ul className="flex flex-wrap gap-1.5">
            {data.nodes.map((node) => (
              <li
                key={node.id}
                className="rounded-button border border-yene-line-soft bg-yene-raised px-2.5 py-1 text-[12px] text-yene-muted"
              >
                {node.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

function PromotionsBody({
  data,
  section,
}: {
  data: Awaited<ReturnType<typeof fetchSectionPromotions>>;
  section: SectionDefinition;
}) {
  const now = Date.now();
  return (
    <div className="space-y-3">
      <ReadOnlyNotice missing={section.missing} />
      <DataTable
        rows={data.promotions}
        caption="Promotions running across the marketplace"
        columns={[
          { key: "label", header: "Promotion", render: (row) => row.label },
          { key: "code", header: "Code", render: (row) => <span className="font-mono text-[11.5px]">{row.code}</span> },
          { key: "off", header: "Off", numeric: true, render: (row) => `${row.percentOff}%` },
          { key: "window", header: "Runs", render: (row) => `${day(row.startsAt)} to ${day(row.endsAt)}` },
          {
            key: "state",
            header: "State",
            render: (row) => {
              const started = new Date(row.startsAt).getTime() <= now;
              const ended = new Date(row.endsAt).getTime() < now;
              return (
                <span className={ended ? "text-yene-faint" : started ? "text-yene-accent" : "text-yene-muted"}>
                  {ended ? "Ended" : started ? "Running" : "Scheduled"}
                </span>
              );
            },
          },
        ]}
        empty={{ title: "No promotions are running." }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Packages & Billing - the second section with real writes
// ---------------------------------------------------------------------------

function BillingBody({
  data,
  section,
  busyId,
  setBusyId,
  actionError,
  setActionError,
  confirm,
  setConfirm,
  reload,
}: { data: SectionSubscription; section: SectionDefinition } & ActionState) {
  const state: ActionState = { busyId, setBusyId, actionError, setActionError, confirm, setConfirm, reload };
  const current = data.packages.find((entry) => entry.id === data.subscription.packageId);
  // Destructured rather than read as `data.entitlements`: this project has
  // strictNullChecks OFF, and reading a `Record<string, boolean>` straight off a
  // parameter in a JSX-heavy file confuses inference in a way that produces a
  // spurious "property does not exist" against a type that plainly has it.
  const entitlements: Record<string, boolean> = data.entitlements;
  const granted = Object.entries(entitlements).filter(([, value]) => value).length;

  return (
    <div className="space-y-4">
      {actionError && <ActionError message={actionError} />}

      <div className="rounded-card border border-yene-accent/40 bg-yene-accent-dim px-4 py-4">
        <p className="text-[12px] text-yene-muted">Current package</p>
        <p className="mt-1 text-xl font-semibold capitalize text-yene-text">
          {current?.name ?? data.subscription.packageId}
        </p>
        <p className="mt-0.5 text-[12.5px] text-yene-muted">
          {current ? `${etb(current.monthlyPrice)} per month` : ""} &middot; {granted} features included
        </p>
      </div>

      <dl className="rounded-card border border-yene-line-soft bg-yene-surface px-4 py-1">
        <Field label="Status" value={data.subscription.status} />
        <Field label="Current period ends" value={day(data.subscription.currentPeriodEnd)} />
        <Field label="Auto renew" value={data.subscription.autoRenew ? "Yes" : "No"} />
        {data.subscription.pendingChange && (
          <Field
            label="Scheduled change"
            value={`To ${data.subscription.pendingChange.toPackage} on ${day(data.subscription.pendingChange.effectiveAt)}`}
          />
        )}
      </dl>

      <div>
        <ActionButton
          label="Renew for the next period"
          busy={busyId === "renew"}
          disabled={busyId !== null}
          title="Pays the full price of your current package for the next period."
          onClick={() => void runAction("renew", () => renewPackage(), state)}
        />
        <p className="mt-2 text-[11.5px] leading-relaxed text-yene-faint">
          Renewal charges the full price of the package you are on. A mid-period upgrade already
          paid is a surcharge against this period and is not carried over as a discount.
        </p>
      </div>

      <SubHeading>Billing history</SubHeading>
      <DataTable
        rows={data.invoices}
        caption="Invoices raised against your subscription"
        columns={[
          { key: "number", header: "Invoice", render: (row) => <span className="font-mono text-[11.5px]">{row.number}</span> },
          { key: "date", header: "Issued", render: (row) => day(row.issuedAt) },
          { key: "total", header: "Total", numeric: true, render: (row) => etb(row.total) },
          { key: "status", header: "Status", render: (row) => row.status },
        ]}
        empty={{ title: "No invoices yet." }}
      />

      <SubHeading>Change package</SubHeading>
      <div className="grid gap-2 tablet:grid-cols-2">
        {data.packages
          .filter((entry) => entry.id !== data.subscription.packageId)
          .map((entry) => (
            <div key={entry.id} className="rounded-card border border-yene-line-soft bg-yene-surface px-3 py-3">
              <p className="text-[13px] font-semibold text-yene-text">{entry.name}</p>
              <p className="mt-0.5 text-[12.5px] text-yene-muted">{etb(entry.monthlyPrice)} / month</p>
              <p className="mt-1 text-[11.5px] text-yene-faint">{entry.tagline}</p>
              <div className="mt-2">
                <ActionButton
                  label={
                    Number(entry.monthlyPrice) > Number(current?.monthlyPrice ?? 0) ? "Upgrade" : "Downgrade"
                  }
                  busy={busyId === entry.id}
                  disabled={busyId !== null}
                  onClick={() => void runAction(entry.id, () => changePackage(entry.id), state)}
                />
              </div>
            </div>
          ))}
      </div>
      {section.missing && <ReadOnlyNotice missing={section.missing} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={`${TOUCH} w-full rounded-button border border-yene-line bg-yene-bg px-3 text-[13px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none`}
    />
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button border border-yene-line px-2.5 text-[12px] font-medium text-yene-text transition-colors hover:border-yene-accent hover:text-yene-accent disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
    >
      {busy ? (
        <RefreshCw size={13} className="animate-spin" aria-hidden />
      ) : (
        <Check size={13} aria-hidden />
      )}
      {label}
    </button>
  );
}

function ActionError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-button border border-yene-danger/40 bg-yene-danger/10 px-3 py-2 text-[12.5px] text-yene-danger"
    >
      {message}
    </p>
  );
}
