/**
 * ============================================================================
 *  MANAGEMENT ROUTER
 * ============================================================================
 *
 *  Mounted at /api/management. Two endpoints:
 *
 *    GET /access    may I open it, and which modules may I see?
 *    GET /overview  the dashboard tiles: sales, orders, customers, low stock
 *
 *  TENANT ISOLATION (the part that matters)
 *  --------------------------------------
 *  Neither route accepts a businessId. Not in the path, not in the query, not
 *  in the body. Every figure below is scoped by `guard.businessId`, which comes
 *  from the session cookie and the user record - so `/api/management/overview`
 *  can only ever describe the caller's own shop. There is deliberately no route
 *  of the shape `/management/:businessId` for this module to be confused with.
 *
 *  The button in the header is a convenience, never the control. Hiding it
 *  proves nothing; these two guards are the control.
 */

import { Router, type Request, type Response } from "express";
import { resolveAuthContext } from "../auth/sessions";
import { SESSION_COOKIE } from "../auth/types";
import { allUsers } from "../auth/store";
import {
  allBusinessOrders,
  allCustomers,
  allExpenses,
  allInventoryItems,
  allMovements,
  allNodes,
  productsForBusiness,
} from "../platform/store";
import { currentStockReport } from "../../src/platform/inventory";
import { resolveManagementAccess } from "./access";

export const managementRouter = Router();

/** The caller's email, from the user record, for the employee-role lookup. */
function callerEmail(req: Request): string | null {
  const context = resolveAuthContext(req, SESSION_COOKIE);
  if (!context) return null;
  const user = allUsers().find((entry) => entry.id === context.userId);
  return user?.email ?? context.email ?? null;
}

// ---------------------------------------------------------------------------
// GET /access
// ---------------------------------------------------------------------------

managementRouter.get("/access", (req: Request, res: Response) => {
  const access = resolveManagementAccess(req, callerEmail(req));

  // A guest is answered 200 with `canAccess: false` rather than 401, because
  // this endpoint is also how the header asks "should I show the button?" - a
  // signed-out visitor gets a clean answer instead of an error.
  return res.status(200).json(access);
});

// ---------------------------------------------------------------------------
// GET /overview
// ---------------------------------------------------------------------------

/** True for orders placed today, in the server's own timezone. */
function isToday(iso: string, now: Date): boolean {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  return (
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  );
}

/** Minimal shape of an order row, so this file does not depend on its layout. */
function orderAmount(order: unknown): number {
  const value = (order as { total?: unknown })?.total;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function orderDate(order: unknown): string {
  const value = (order as { createdAt?: unknown })?.createdAt ?? (order as { at?: unknown })?.at;
  return typeof value === "string" ? value : "";
}

managementRouter.get("/overview", (req: Request, res: Response) => {
  const access = resolveManagementAccess(req, callerEmail(req));

  // §15: an authentication failure and a permission failure are DIFFERENT
  // messages, so the user knows whether to sign in or ask for access.
  if (access.reason === "not-authenticated") {
    return res
      .status(401)
      .json({ error: "Your session has expired. Please sign in again." });
  }
  if (!access.canAccess) {
    return res.status(403).json({
      error: "You don't have permission to access the Management System.",
    });
  }

  // businessId is non-null whenever canAccess is true, and it came from the
  // session. The non-null assertion is safe by that construction, not by trust.
  const businessId = access.business!.id;
  const now = new Date();

  const products = productsForBusiness(businessId);
  const orders = allBusinessOrders().filter((order) => order.businessId === businessId);
  const todayOrders = orders.filter((order) => isToday(orderDate(order), now));

  // Low stock, via the EXISTING Section 27 report rather than a second
  // definition. That function already encodes the real rule - stock is derived
  // from movements, not from a stored counter, and "Reorder"/"Low" are its
  // states - so a second calculation here would drift from the one the
  // inventory screens use.
  const stockRows = currentStockReport(
    allInventoryItems().filter((item) => item.businessId === businessId),
    allMovements().filter((m) => m.businessId === businessId),
    allNodes(),
  );
  const lowStockRows = stockRows.filter((row) => row.status === "Reorder" || row.status === "Low");

  return res.status(200).json({
    ok: true,
    business: access.business,
    packageId: access.packageId,
    role: access.role,
    roleName: access.roleName,
    displayName: access.displayName,
    modules: access.modules,
    stats: {
      todaySales: todayOrders.reduce((total, order) => total + orderAmount(order), 0),
      todayOrders: todayOrders.length,
      orders: orders.length,
      customers: allCustomers().filter((c) => c.businessId === businessId).length,
      products: products.length,
      lowStock: lowStockRows.length,
      lowStockItems: lowStockRows.slice(0, 5).map((row) => ({
        itemId: row.itemId,
        name: row.name,
        onHand: row.onHand,
        reorderLevel: row.reorderLevel,
        status: row.status,
      })),
      expenses: allExpenses().filter((expense) => expense.businessId === businessId).length,
    },
  });
});

// ---------------------------------------------------------------------------
// A catch-all, so an unknown management path is a clean 404.
// ---------------------------------------------------------------------------
// Without this, `/api/management/overview/green-coffee` matches no route, falls
// through the whole app, and reaches the Vite proxy - which answers 500 in
// development. Nothing ever leaked (there is no route to leak through), but a
// 404 that says "no such thing here" is the correct answer, and it makes the
// absence of a `/:businessId` route deliberate rather than accidental.
//
// Registered LAST, after /access and /overview, so it cannot shadow them.
// The wildcard syntax is Express 4's (`*`), not Express 5's `*splat`. On v5
// this pattern is invalid and Express silently treats it as a literal, which is
// why an earlier `*splat` version compiled, type-checked, and still let every
// unknown path fall through to the SPA catch-all.
//
// A bare `use(fn)` is not enough either: it only runs once a request has
// reached this router, and an unmatched path then continues on to
// `app.get("*")` in server.ts, which answers 200 with index.html. Registering a
// real wildcard route is what turns "no such thing here" into a 404.
managementRouter.all("*", (_req: Request, res: Response) => {
  return res.status(404).json({ error: "Not found." });
});
