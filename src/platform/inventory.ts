/**
 * ============================================================================
 *  INVENTORY (Section 27, extended by Section 29)
 * ============================================================================
 *
 *  Platinum carries "custom inventory management developed by Yene Business
 *  Group", so this module is intentionally generic: item master, hierarchy,
 *  movements and reports are data-driven rather than hard-coded to one
 *  industry. The client-requirements gathering for a real deployment lives in
 *  the Section 40 quotation, not in the code.
 *
 *  THE HIERARCHY (Section 27)
 *  -------------------------
 *      Main Warehouse
 *      |-- Room 1
 *      |-- Room 2
 *      `-- Shelf A
 *
 *      Branch 1
 *      |-- Store
 *      `-- Storage
 *
 *      Branch 2
 *      `-- Store
 *
 *  Nodes are a tree (`parentId`). Stock is counted PER NODE, because "how
 *  much is on Shelf A" and "how much is in total" are different questions and
 *  a warehouse manager needs both.
 *
 *  THE LEDGER RULE
 *  ---------------
 *  Every change to stock is a `StockMovement`. Current stock is never edited
 *  in place - it is derived by replaying the ledger. That is what makes the
 *  "stock movement", "stock reconciliation" and "stock valuation" reports
 *  possible at all, and it means a miscount is corrected by a recorded
 *  adjustment rather than by an edit that leaves no trace.
 *
 *  Super adds batch numbers, serial numbers, barcode scanning, reorder
 *  management and purchase planning on top of this same ledger; they are
 *  fields on a movement, not a second stock system.
 */

import type {
  InventoryItem,
  Product,
  StockMovement,
  StockMovementType,
  WarehouseNode,
} from "./types";
import { STOCK_MOVEMENT_TYPES } from "./types";

export function isValidMovementType(value: unknown): value is StockMovementType {
  return typeof value === "string" && (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Movements that ADD stock to a node, and those that REMOVE it.
 *
 * A transfer appears in neither list: it adds to the destination and removes
 * from the source in the same operation, which is what keeps both sides
 * balanced.
 */
const INFLOW: Record<StockMovementType, boolean> = {
  "Stock receipt": true,
  "Stock issue": false,
  "Stock transfer": false,
  "Stock adjustment": false,
  "Stock reconciliation": false,
  "Opening stock": true,
  "Damaged stock": false,
  "Lost stock": false,
  "Returned stock": true,
  "Stock reservation": false,
};

/**
 * Stock at one node = every inflow minus every outflow, replayed in order.
 *
 * `Stock transfer` is applied on its `toNodeId` here; the source is handled by
 * the same replay with the sign flipped, so a transfer can never lose or
 * invent a unit.
 */
export function stockAt(
  itemId: string,
  nodeId: string,
  movements: StockMovement[],
): number {
  let total = 0;
  for (const movement of movements) {
    if (movement.itemId !== itemId) continue;
    // A transfer is the one movement that touches TWO nodes: it credits the
    // destination and debits the source in the same operation. Handling only
    // the destination would let a warehouse grow on paper every time stock
    // moved, which is how an inventory starts lying.
    if (movement.type === "Stock transfer") {
      if (movement.toNodeId === nodeId) total += movement.quantity;
      if (movement.fromNodeId === nodeId) total -= movement.quantity;
      continue;
    }
    if (movement.toNodeId !== nodeId) continue;
    total += INFLOW[movement.type] ? movement.quantity : -movement.quantity;
  }
  return total;
}

/** Total stock across every node - the number a shopper's availability uses. */
export function totalStock(
  itemId: string,
  movements: StockMovement[],
  nodes: WarehouseNode[],
): number {
  return nodes.reduce((sum, node) => sum + stockAt(itemId, node.id, movements), 0);
}

/**
 * Section 27's structure check: a node may not be its own parent, and a cycle
 * may not be created. Cheap to check, and the alternative is an inventory
 * that cannot be walked.
 */
export function canAttachNode(
  nodes: WarehouseNode[],
  parentId: string | null,
  childId: string,
): boolean {
  if (!parentId) return true;
  if (parentId === childId) return false;
  // Walk up from the proposed parent; if we meet the child, it is a cycle.
  let cursor: string | null = parentId;
  const guard = new Set<string>();
  while (cursor) {
    if (cursor === childId) return false;
    if (guard.has(cursor)) return false;
    guard.add(cursor);
    cursor = nodes.find((n) => n.id === cursor)?.parentId ?? null;
  }
  return true;
}

/** Render a node tree as the indented text Section 27 illustrates. */
export function renderHierarchy(nodes: WarehouseNode[]): string {
  const lines: string[] = [];
  const walk = (parentId: string | null, prefix: string, isRoot: boolean) => {
    const children = nodes
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
    children.forEach((node, index) => {
      const last = index === children.length - 1;
      lines.push(isRoot ? node.name : `${prefix}${last ? "`-- " : "|-- "}${node.name}`);
      walk(node.id, isRoot ? "" : `${prefix}${last ? "    " : "|   "}`, false);
    });
  };
  walk(null, "", true);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Reports (Section 27)
// ---------------------------------------------------------------------------

export interface StockReportRow {
  itemId: string;
  name: string;
  sku: string;
  onHand: number;
  reorderLevel: number;
  status: "In stock" | "Low" | "Reorder" | "Out of stock";
}

/** Section 27: current stock and the low-stock report. */
export function currentStockReport(
  items: InventoryItem[],
  movements: StockMovement[],
  nodes: WarehouseNode[],
): StockReportRow[] {
  return items.map((item) => {
    const onHand = totalStock(item.id, movements, nodes);
    const status: StockReportRow["status"] =
      onHand === 0
        ? "Out of stock"
        : onHand <= item.reorderLevel
          ? "Reorder"
          : onHand <= item.minStock
            ? "Low"
            : "In stock";
    return {
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      onHand,
      reorderLevel: item.reorderLevel,
      status,
    };
  });
}

/** Section 27: stock valuation = quantity x unit cost. */

/** Section 27: a purchase receipt is a stock receipt with a reference. */
export function applyPurchaseReceipt(
  businessId: string,
  itemId: string,
  quantity: number,
  nodeId: string,
  reference: string,
  now: Date = new Date(),
): StockMovement {
  if (quantity <= 0) throw new Error("A receipt must be for a positive quantity.");
  return {
    id: `SM-${now.getTime()}-${itemId}`,
    businessId,
    itemId,
    type: "Stock receipt",
    quantity,
    fromNodeId: null,
    toNodeId: nodeId,
    note: `Purchase receipt ${reference}`,
    reference,
    at: now.toISOString(),
  };
}

/**
 * Section 27: a transfer. Validated before it is written, because a transfer
 * that moves stock out of a location it does not hold is the classic way an
 * inventory starts lying.
 */
export function buildTransfer(
  businessId: string,
  itemId: string,
  quantity: number,
  fromNodeId: string,
  toNodeId: string,
  movements: StockMovement[],
  now: Date = new Date(),
): StockMovement {
  if (fromNodeId === toNodeId) throw new Error("Source and destination are the same location.");
  const available = stockAt(itemId, fromNodeId, movements);
  if (quantity <= 0) throw new Error("A transfer must be for a positive quantity.");
  if (quantity > available) {
    throw new Error(`Only ${available} unit(s) available at the source location.`);
  }
  return {
    id: `SM-${now.getTime()}-${itemId}`,
    businessId,
    itemId,
    type: "Stock transfer",
    quantity,
    fromNodeId,
    toNodeId,
    note: "Stock transfer",
    reference: null,
    at: now.toISOString(),
  };
}

/** Section 49: a business is told when stock crosses its reorder level. */
export function needsRestock(
  item: InventoryItem,
  movements: StockMovement[],
  nodes: WarehouseNode[],
): boolean {
  return totalStock(item.id, movements, nodes) <= item.reorderLevel;
}

/**
 * Section 27: a store product and an inventory item are two views of the same
 * thing, linked by `productId`. The link is nullable and one-directional, so
 * a product can be retired without touching the stock history.
 */
export function itemsWithoutProducts(
  items: InventoryItem[],
  products: Product[],
): InventoryItem[] {
  const ids = new Set(products.map((p) => p.id));
  return items.filter((item) => !item.productId || !ids.has(item.productId));
}

export function stockValuation(
  items: InventoryItem[],
  movements: StockMovement[],
  nodes: WarehouseNode[],
): number {
  return items.reduce(
    (sum, item) => sum + totalStock(item.id, movements, nodes) * item.unitCost,
    0,
  );
}

/** Section 27: the stock movement report, newest first. */
export function movementReport(
  businessId: string,
  movements: StockMovement[],
  limit = 100,
): StockMovement[] {
  return movements
    .filter((m) => m.businessId === businessId)
    .slice()
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}
