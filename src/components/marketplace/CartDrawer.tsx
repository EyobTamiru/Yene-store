/**
 * ============================================================================
 *  CART DRAWER - the minimised cart
 * ============================================================================
 *
 *  WHY A DRAWER AND NOT A PAGE
 *  --------------------------
 *  Opening the cart used to navigate to `#/cart` and replace the whole screen,
 *  which threw away the storefront the shopper was standing on. They had to
 *  navigate back to keep looking. The cart is a glance, not a destination: you
 *  check the total, adjust a quantity, and go straight back to browsing.
 *
 *  The full-screen checkout at `#/cart` still exists and is still correct for
 *  what it is - a six-step, focused flow with an address form. The drawer ends
 *  with a "Proceed to checkout" button that hands over to it. Reviewing a basket
 *  and completing an order are different jobs and now have different screens.
 *
 *  THE FLOATING PILL
 *  ------------------
 *  Because the cart is now closed by default, adding an item would otherwise
 *  look like it did nothing. `CartPill` appears the moment the basket becomes
 *  non-empty and is the button that reopens the drawer - so the two features
 *  are designed together, not bolted on.
 *
 *  THE STORE GROUPING IS PRESERVED (Section 20)
 *  -------------------------------------------
 *  The basket is NOT a flat list, because it is not one order: three stores mean
 *  three delivery fees. Grouping by store is the layout, and it survives the
 *  move to a drawer.
 */

import { useEffect, useState } from "react";
import { Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { priceCart, type CartTotalsView } from "../../lib/platformApi";
import { TOUCH } from "./ProductCard";
import { formatEtbUi } from "../platform/primitives";

export interface DrawerLine {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface DrawerProps {
  open: boolean;
  lines: DrawerLine[];
  onClose: () => void;
  onSetQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
  /** Keeps the drawer shut when a checkout or sign-in screen is showing. */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// The floating "view cart" button
// ---------------------------------------------------------------------------

/**
 * Rendered only while the basket holds something AND the drawer is closed, so
 * it never sits underneath an open drawer competing for the same tap.
 */
export function CartPill({
  itemCount,
  onOpen,
}: {
  itemCount: number;
  onOpen: () => void;
}) {
  if (itemCount <= 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${TOUCH} fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent shadow-lg transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-bg yene-safe-bottom`}
    >
      <ShoppingCart size={16} aria-hidden />
      View cart
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-yene-bg px-1 text-[11px] font-bold text-yene-accent">
        {itemCount}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

export function CartDrawer({
  open,
  lines,
  onClose,
  onSetQuantity,
  onRemove,
  onCheckout,
  disabled,
}: DrawerProps) {
  const [totals, setTotals] = useState<CartTotalsView | null>(null);

  const payload = lines.map((line) => ({ productId: line.productId, quantity: line.quantity }));

  // Re-price from the SERVER whenever the basket changes. The price shown is
  // never the one held in client state, so a stale basket cannot show a total
  // the checkout would then disagree with.
  useEffect(() => {
    if (!open) return;
    priceCart(payload)
      .then((result) => setTotals(result.totals))
      .catch(() => setTotals(null));
    // Re-price whenever the basket changes, never from stale totals.
  }, [open, JSON.stringify(payload)]);

  // Escape closes it. A drawer the keyboard cannot leave is a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Stop the page behind the overlay scrolling under the shopper's finger.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || disabled) return null;

  const itemCount = lines.reduce((total, line) => total + line.quantity, 0);

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Shopping cart"
    >
      {/* Backdrop. Clicking it is the quickest way out. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close cart"
        className="absolute inset-0 h-full w-full cursor-default bg-black/55"
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-yene-line-soft bg-yene-surface shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-yene-line-soft px-4 py-3">
          <h2 className="text-[15px] font-semibold text-yene-text">
            Your cart
            {itemCount > 0 && (
              <span className="ml-2 text-[12.5px] font-normal text-yene-muted">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart"
            className={`${TOUCH} inline-flex items-center justify-center rounded-button px-2.5 text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <ShoppingCart size={26} className="text-yene-faint" aria-hidden />
            <p className="text-[13px] text-yene-muted">Your cart is empty.</p>
            <button
              type="button"
              onClick={onClose}
              className={`${TOUCH} rounded-button border border-yene-line px-4 text-[13px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
            >
              Keep shopping
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {totals ? (
                totals.groups.map((group) => (
                  <section key={group.businessId} className="mb-4 last:mb-0">
                    <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-yene-muted">
                      {group.businessName}
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {group.lines.map((entry) => (
                        <LineRow
                          key={`${entry.product.id}-${entry.variant?.id ?? ""}`}
                          productId={entry.product.id}
                          name={
                            entry.variant
                              ? `${entry.product.name} - ${entry.variant.label}`
                              : entry.product.name
                          }
                          image={entry.product.images?.[0] ?? null}
                          // The EFFECTIVE unit price, not the list price. The
                          // server already discounts in `priceCart` (this line
                          // came back subtotal 1,900 for 2 x 950, not 2 x
                          // 1,200), so showing `price` here would make the
                          // drawer's own arithmetic disagree with the subtotal
                          // printed two inches below it.
                          unitPrice={
                            entry.product.discountPrice ?? entry.product.price
                          }
                          quantity={entry.quantity}
                          onSetQuantity={onSetQuantity}
                          onRemove={onRemove}
                        />
                      ))}
                    </ul>
                  </section>
                ))
              ) : (
                <p className="py-6 text-center text-[13px] text-yene-muted">
                  Pricing your cart...
                </p>
              )}
            </div>

            <footer className="border-t border-yene-line-soft px-4 py-3 yene-safe-bottom">
              <dl className="space-y-1 text-[13px]">
                <Row label="Subtotal" value={formatEtbUi(totals?.productSubtotal ?? null)} />
                <Row label="Delivery" value={formatEtbUi(totals?.delivery ?? null)} />
                {Boolean(totals?.discounts) && (
                  <Row label="Discounts" value={formatEtbUi(totals?.discounts ?? null)} />
                )}
                <div className="flex items-baseline justify-between gap-3 border-t border-yene-line-soft pt-2">
                  <dt className="text-[13px] font-semibold text-yene-text">Total</dt>
                  <dd className="text-[15px] font-semibold text-yene-accent">
                    {formatEtbUi(totals?.grandTotal ?? null)}
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={onCheckout}
                disabled={lines.length === 0}
                className={`${TOUCH} mt-3 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent disabled:opacity-60`}
              >
                Proceed to checkout
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * One product, with its quantity stepper.
 *
 * `productId` - NOT the display name - is what the handlers are keyed by, so
 * the two can never be confused. Stepping down to zero is reported as a
 * removal, so there is one code path for "less of this" rather than two that
 * can disagree.
 */
function LineRow({
  productId,
  name,
  image,
  unitPrice,
  quantity,
  onSetQuantity,
  onRemove,
}: {
  productId: string;
  name: string;
  image: string | null;
  unitPrice: number;
  quantity: number;
  onSetQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
}) {
  return (
    <li className="flex items-start gap-3 rounded-button border border-yene-line-soft p-2.5">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-yene-raised">
        {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : null}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-yene-text">{name}</p>
        <p className="mt-0.5 text-[12.5px] text-yene-muted">{formatEtbUi(unitPrice)} each</p>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex items-center rounded-button border border-yene-line">
            <button
              type="button"
              onClick={() => onSetQuantity(productId, quantity - 1)}
              aria-label={`Reduce quantity of ${name}`}
              className={`${TOUCH} inline-flex items-center justify-center rounded-l-button px-2 text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
            >
              <Minus size={14} aria-hidden />
            </button>
            <span
              className="min-w-8 text-center text-[13px] font-semibold text-yene-text"
              aria-live="polite"
            >
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => onSetQuantity(productId, quantity + 1)}
              aria-label={`Increase quantity of ${name}`}
              className={`${TOUCH} inline-flex items-center justify-center rounded-r-button px-2 text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
            >
              <Plus size={14} aria-hidden />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onRemove(productId)}
            aria-label={`Remove ${name} from cart`}
            className={`${TOUCH} inline-flex items-center justify-center rounded-button px-2 text-yene-faint transition-colors hover:text-yene-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      </div>

      <p className="shrink-0 text-[13px] font-semibold text-yene-text">
        {formatEtbUi(unitPrice * quantity)}
      </p>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-yene-muted">{label}</dt>
      <dd className="text-yene-text">{value}</dd>
    </div>
  );
}
