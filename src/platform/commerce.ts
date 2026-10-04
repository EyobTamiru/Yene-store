/**
 * ============================================================================
 *  COMMERCE - CART AND ORDERS (Sections 20, 22)
 * ============================================================================
 *
 *  Pure functions, so every rule is provable in the verification suite.
 *
 *  THE RULE THAT SHAPES THIS FILE
 *  -----------------------------
 *  Section 20: a customer can add products from several businesses, and the
 *  cart is GROUPED BY STORE. Section 22 then turns each group into its own
 *  business order, with one aggregate order the customer can see.
 *
 *  That ordering matters. If the totals were computed over a flat list of
 *  lines, a delivery fee would be charged once for the whole basket - which
 *  is exactly the multi-vendor accounting bug this design prevents. So
 *  `groupCartByStore` runs first, and every figure afterwards is a sum of
 *  per-store figures. There is no path that adds a fee to a flat list.
 */

import type {
  Business,
  BusinessOrder,
  CartLine,
  CartStoreGroup,
  CartTotals,
  CustomerOrder,
  OrderAddress,
  OrderLine,
  OrderStatus,
  Product,
} from "./types";
import { ORDER_STATUSES } from "./types";

/** Ethiopian VAT. Applied per store group, never once over the basket. */
export const DEFAULT_TAX_RATE = 0.15;

function linePrice(product: Product, variantPrice: number | null): number {
  return variantPrice ?? product.discountPrice ?? product.price;
}

/**
 * Section 20: group a cart by store, then price each group.
 *
 * A line whose product no longer exists is DROPPED rather than priced at
 * zero, so a deleted product cannot silently make a total look wrong.
 */
export function groupCartByStore(
  lines: CartLine[],
  products: Product[],
  businesses: Business[],
  options: { taxRate?: number; deliveryChoiceByBusiness?: Record<string, string> } = {},
): CartTotals {
  const taxRate = options.taxRate ?? DEFAULT_TAX_RATE;
  const productById = new Map(products.map((p) => [p.id, p]));
  const businessById = new Map(businesses.map((b) => [b.id, b]));
  const groups: CartStoreGroup[] = [];

  // Insertion order is preserved: the store the customer shopped from first
  // appears first, which is the order the checkout steps read in.
  const byBusiness = new Map<string, CartLine[]>();
  for (const line of lines) {
    const product = productById.get(line.productId);
    if (!product) continue;
    const bucket = byBusiness.get(line.businessId) ?? [];
    bucket.push(line);
    byBusiness.set(line.businessId, bucket);
  }

  for (const [businessId, businessLines] of byBusiness) {
    const business = businessById.get(businessId);
    const resolved = businessLines
      .map((line) => {
        const product = productById.get(line.productId);
        if (!product) return null;
        const variant = line.variantId
          ? product.variants.find((v) => v.id === line.variantId) ?? null
          : null;
        return { product, variant, quantity: line.quantity };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const subtotal = resolved.reduce(
      (sum, entry) => sum + linePrice(entry.product, entry.variant?.price ?? null) * entry.quantity,
      0,
    );

    // A discount is a variant price, or a product with a discount price.
    const discount = resolved.reduce((sum, entry) => {
      const unit = linePrice(entry.product, entry.variant?.price ?? null);
      const listUnit = entry.variant?.price ?? entry.product.price;
      return sum + Math.max(0, listUnit - unit) * entry.quantity;
    }, 0);

    const deliveryConfig = business?.customization.delivery;
    const freeAbove = deliveryConfig?.freeAbove ?? null;
    const chosenId = options.deliveryChoiceByBusiness?.[businessId];
    const chosen = deliveryConfig?.options.find((o) => o.id === chosenId);
    const delivery =
      !business || !deliveryConfig?.options.length
        ? 0
        : freeAbove !== null && subtotal >= freeAbove
          ? 0
          : (chosen?.fee ?? deliveryConfig.options[0].fee);

    const taxable = Math.max(0, subtotal - discount);
    const tax = Math.round(taxable * taxRate);

    groups.push({
      businessId,
      businessName: business?.name ?? "YENE-STORE seller",
      lines: resolved,
      subtotal,
      discount,
      delivery,
      tax,
      total: taxable + delivery + tax,
    });
  }

  return {
    groups,
    itemCount: groups.reduce(
      (sum, g) => sum + g.lines.reduce((n, entry) => n + entry.quantity, 0),
      0,
    ),
    productSubtotal: groups.reduce((sum, g) => sum + g.subtotal, 0),
    // The sum of the per-store subtotals, kept as its own field so any
    // discrepancy between the two is visible rather than hidden.
    storeSubtotalTotal: groups.reduce((sum, g) => sum + g.subtotal, 0),
    discounts: groups.reduce((sum, g) => sum + g.discount, 0),
    delivery: groups.reduce((sum, g) => sum + g.delivery, 0),
    taxes: groups.reduce((sum, g) => sum + g.tax, 0),
    grandTotal: groups.reduce((sum, g) => sum + g.total, 0),
  };
}

export interface PlaceOrderInput {
  customerId: string;
  parentOrderId: string;
  address: OrderAddress;
  lines: { product: Product; variantId: string | null; quantity: number }[];
  subtotal: number;
  discount: number;
  delivery: number;
  tax: number;
  total: number;
  businessId: string;
  businessName: string;
  deliveryOptionId: string | null;
  now?: Date;
}

/** Section 22: one business order per store, built from one cart group. */
export function buildBusinessOrder(input: PlaceOrderInput): BusinessOrder {
  const at = (input.now ?? new Date()).toISOString();
  const lines: OrderLine[] = input.lines.map((entry) => {
    const variant = entry.variantId
      ? entry.product.variants.find((v) => v.id === entry.variantId) ?? null
      : null;
    const unitPrice = linePrice(entry.product, variant?.price ?? null);
    return {
      productId: entry.product.id,
      name: entry.product.name,
      variantLabel: variant?.label ?? null,
      quantity: entry.quantity,
      unitPrice,
      lineTotal: unitPrice * entry.quantity,
    };
  });

  return {
    id: `BO-${input.parentOrderId}-${input.businessId}`,
    parentOrderId: input.parentOrderId,
    businessId: input.businessId,
    businessName: input.businessName,
    customerId: input.customerId,
    lines,
    subtotal: input.subtotal,
    discount: input.discount,
    delivery: input.delivery,
    tax: input.tax,
    total: input.total,
    status: "Pending",
    address: input.address,
    deliveryOptionId: input.deliveryOptionId,
    paymentReference: null,
    createdAt: at,
    updatedAt: at,
    history: [{ at, status: "Pending", note: "Order placed" }],
  };
}

/**
 * Section 22: the customer sees ONE order; each store fulfils its own part.
 *
 * `buildCustomerOrder` takes the already-built business orders, so the
 * customer total can never drift from the sum of what the stores expect.
 */
export function buildCustomerOrder(
  parentOrderId: string,
  customerId: string,
  businessOrders: BusinessOrder[],
  now: Date = new Date(),
): CustomerOrder {
  return {
    id: parentOrderId,
    customerId,
    businessOrderIds: businessOrders.map((o) => o.id),
    total: businessOrders.reduce((sum, o) => sum + o.total, 0),
    createdAt: now.toISOString(),
  };
}

export function advanceOrder(order: BusinessOrder, to: OrderStatus, note: string): BusinessOrder {
  if (!canTransitionOrder(order.status, to)) {
    throw new Error(`Cannot move an order from ${order.status} to ${to}.`);
  }
  const at = new Date().toISOString();
  return {
    ...order,
    status: to,
    updatedAt: at,
    history: [...order.history, { at, status: to, note }],
  };
}

/** Section 22: the declared order lifecycle, as legal transitions. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  Pending: ["Confirmed", "Cancelled"],
  Confirmed: ["Processing", "Cancelled"],
  Processing: ["Preparing", "Cancelled"],
  Preparing: ["Shipped", "Cancelled"],
  Shipped: ["Out for Delivery"],
  "Out for Delivery": ["Delivered", "Returned"],
  Delivered: ["Returned"],
  Cancelled: [],
  Returned: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export function isValidOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}
