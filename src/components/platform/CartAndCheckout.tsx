/**
 * ============================================================================
 *  CART AND CHECKOUT (Sections 20, 21, 22)
 * ============================================================================
 *
 *  The six checkout steps are rendered as a stepper, in the specification's
 *  order and with its exact labels (Section 21).
 *
 *  TWO THINGS THIS SCREEN DELIBERATELY SHOWS
 *  -----------------------------------------
 *  1. THE STORE GROUPS (Section 20). The basket is never rendered as one flat
 *     list, because it is not one order. A customer who has never seen which
 *     store each item comes from cannot understand why there are three
 *     delivery fees - so the grouping is the layout, not a detail.
 *
 *  2. THE SPLIT, AFTER PLACING (Section 22). Placing a three-store order
 *     returns three business orders and one customer order, and the
 *     confirmation shows both. "Where is my order" is answerable immediately.
 */

import { useEffect, useState } from "react";
import { CHECKOUT_STEPS } from "../../platform/types";
import { placeOrder, priceCart, type CartTotalsView } from "../../lib/platformApi";
import { CONTENT_WIDTH, TOUCH_TARGET, formatEtbUi } from "./primitives";

export interface CartLine {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

interface Props {
  lines: CartLine[];
  onBack: () => void;
  onOrderPlaced: () => void;
}

export function CartAndCheckout({ lines, onBack, onOrderPlaced }: Props) {
  const [totals, setTotals] = useState<CartTotalsView | null>(null);
  const [paymentOptions, setPaymentOptions] = useState<string[]>(["Cash on delivery"]);
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState({ name: "", phone: "", line1: "", city: "", note: "" });
  const [paymentMethod, setPaymentMethod] = useState("Cash on delivery");
  const [placed, setPlaced] = useState<{ id: string; total: number; businessOrderIds: string[]; businessOrders: { id: string; businessName: string; total: number; status: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const payload = lines.map((line) => ({ productId: line.productId, quantity: line.quantity }));

  useEffect(() => {
    priceCart(payload)
      .then((result) => {
        setTotals(result.totals);
        setPaymentOptions(result.paymentOptions);
      })
      .catch((e) => setError((e as { userMessage?: string }).userMessage ?? null));
    // Re-price whenever the basket changes, never from stale totals.
  }, [JSON.stringify(payload)]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await placeOrder({ lines: payload, address, paymentMethod });
      setPlaced(result.order ? { ...result.order, businessOrders: result.businessOrders } : null);
      onOrderPlaced();
    } catch (e) {
      setError((e as { userMessage?: string }).userMessage ?? null);
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    return (
      <div className="min-h-dvh bg-yene-bg">
        <div className={`${CONTENT_WIDTH} py-10`}>
          <h1 className="text-xl font-semibold text-yene-text">Order placed</h1>
          <p className="mt-1 text-[13px] text-yene-muted">
            Reference {placed.id} &middot; {formatEtbUi(placed.total)}
          </p>
          <div className="mt-6 space-y-2">
            {placed.businessOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-yene-line-soft bg-yene-surface px-4 py-3"
              >
                <span className="text-[13px] text-yene-text">{order.businessName}</span>
                <span className="text-[12px] text-yene-faint">
                  {order.id} &middot; {order.status} &middot; {formatEtbUi(order.total)}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onBack}
            className={`${TOUCH_TARGET} mt-6 rounded-xl bg-yene-accent px-5 text-sm font-semibold text-yene-on-accent`}
          >
            Continue shopping
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="border-b border-yene-line-soft">
        <div className={`${CONTENT_WIDTH} flex items-center justify-between py-4`}>
          <button
            type="button"
            onClick={onBack}
            className={`${TOUCH_TARGET} rounded-xl px-3 text-[13px] text-yene-muted hover:text-yene-accent`}
          >
            &larr; Back
          </button>
          <h1 className="text-sm font-semibold text-yene-text">Checkout</h1>
          <span className="text-[12px] text-yene-faint">
            Step {step + 1} of {CHECKOUT_STEPS.length}
          </span>
        </div>
      </header>

      <div className={`${CONTENT_WIDTH} grid gap-6 py-6 lg:grid-cols-[1fr_320px]`}>
        <main className="space-y-4">
          {/* The six steps (Section 21) */}
          <ol className="flex flex-wrap gap-2">
            {CHECKOUT_STEPS.map((label, index) => (
              <li
                key={label}
                className={`rounded-full border px-3 py-1 text-[11px] ${
                  index === step
                    ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                    : index < step
                      ? "border-yene-line text-yene-muted"
                      : "border-yene-line-soft text-yene-faint"
                }`}
              >
                {index + 1}. {label}
              </li>
            ))}
          </ol>

          {error && (
            <p role="alert" className="rounded-xl border border-yene-danger/40 bg-yene-danger/10 px-3 py-2 text-[13px] text-yene-danger">
              {error}
            </p>
          )}

          {step === 0 && (
            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5">
              <h2 className="text-sm font-semibold text-yene-text">Customer Information</h2>
              <p className="mt-1 text-[12.5px] text-yene-muted">
                Delivery details for each store. We never share your number with another store.
              </p>
            </section>
          )}

          {step === 1 && (
            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5">
              <h2 className="text-sm font-semibold text-yene-text">Delivery Address</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(["name", "phone", "line1", "city"] as const).map((field) => (
                  <label key={field} className="block text-[12px] text-yene-muted">
                    {field === "line1" ? "Address" : field}
                    <input
                      value={address[field]}
                      onChange={(event) => setAddress({ ...address, [field]: event.target.value })}
                      className={`${TOUCH_TARGET} mt-1 w-full rounded-xl border border-yene-line bg-yene-bg px-3 text-sm text-yene-text focus:border-yene-accent focus:outline-none`}
                    />
                  </label>
                ))}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5">
              <h2 className="text-sm font-semibold text-yene-text">Delivery Method</h2>
              <ul className="mt-3 space-y-2">
                {totals?.groups.map((group) => (
                  <li key={group.businessId} className="rounded-xl border border-yene-line-soft px-3 py-2">
                    <span className="text-[13px] text-yene-text">{group.businessName}</span>
                    <span className="ml-2 text-[12px] text-yene-faint">
                      {group.delivery === 0 ? "Free" : formatEtbUi(group.delivery)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {step === 3 && (
            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5">
              <h2 className="text-sm font-semibold text-yene-text">Payment Method</h2>
              <div className="mt-3 space-y-2">
                {paymentOptions.map((option) => (
                  <label
                    key={option}
                    className={`flex ${TOUCH_TARGET} cursor-pointer items-center gap-2 rounded-xl border border-yene-line-soft px-3 text-[13px] text-yene-text`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value={option}
                      checked={paymentMethod === option}
                      onChange={() => setPaymentMethod(option)}
                    />
                    {option}
                  </label>
                ))}
              </div>
              {paymentOptions.length === 1 && (
                <p className="mt-2 text-[12px] text-yene-muted">
                  Online payment is available on the Platinum package and above. This store accepts
                  cash on delivery.
                </p>
              )}
            </section>
          )}

          {step === 4 && (
            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5">
              <h2 className="text-sm font-semibold text-yene-text">Order Review</h2>
              {totals?.groups.map((group) => (
                <div key={group.businessId} className="mt-3 rounded-xl border border-yene-line-soft p-3">
                  <p className="text-[13px] font-medium text-yene-text">{group.businessName}</p>
                  <ul className="mt-1 space-y-0.5">
                    {group.lines.map((line) => (
                      <li key={line.product.id} className="text-[12px] text-yene-muted">
                        {line.quantity} &times; {line.product.name}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[12px] text-yene-faint">
                    Delivery {formatEtbUi(group.delivery)} &middot; Tax {formatEtbUi(group.tax)}
                  </p>
                </div>
              ))}
            </section>
          )}

          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className={`${TOUCH_TARGET} rounded-xl border border-yene-line px-4 text-[13px] text-yene-muted`}
              >
                Back
              </button>
            )}
            {step < CHECKOUT_STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className={`${TOUCH_TARGET} rounded-xl bg-yene-accent px-5 text-[13px] font-semibold text-yene-on-accent`}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className={`${TOUCH_TARGET} rounded-xl bg-yene-accent px-5 text-[13px] font-semibold text-yene-on-accent disabled:opacity-50`}
              >
                {busy ? "Placing..." : "Place order"}
              </button>
            )}
          </div>
        </main>

        {/* ---- The basket, grouped by store (Section 20) ---- */}
        <aside className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5 lg:sticky lg:top-6 lg:self-start">
          <h2 className="text-sm font-semibold text-yene-text">Your cart</h2>
          {totals && totals.groups.length === 0 && (
            <p className="mt-2 text-[13px] text-yene-muted">Your cart is empty.</p>
          )}
          <div className="mt-3 space-y-3">
            {totals?.groups.map((group) => (
              <div key={group.businessId} className="rounded-xl border border-yene-line-soft p-3">
                <p className="text-[11px] uppercase tracking-wide text-yene-faint">
                  Order from {group.businessName}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {group.lines.map((line) => (
                    <li key={line.product.id} className="text-[12.5px] text-yene-muted">
                      {line.quantity} &times; {line.product.name}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[12px] text-yene-faint">
                  Subtotal {formatEtbUi(group.subtotal)} &middot; Delivery{" "}
                  {group.delivery === 0 ? "Free" : formatEtbUi(group.delivery)}
                </p>
              </div>
            ))}
          </div>
          {totals && (
            <dl className="mt-4 space-y-1 border-t border-yene-line-soft pt-3 text-[12.5px]">
              {[
                ["Subtotal", totals.productSubtotal],
                ["Discounts", -totals.discounts],
                ["Delivery", totals.delivery],
                ["Tax", totals.taxes],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between">
                  <dt className="text-yene-muted">{label}</dt>
                  <dd className="text-yene-text">{formatEtbUi(value as number)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-yene-line-soft pt-2">
                <dt className="font-semibold text-yene-text">Total</dt>
                <dd className="font-semibold text-yene-accent">{formatEtbUi(totals.grandTotal)}</dd>
              </div>
            </dl>
          )}
        </aside>
      </div>
    </div>
  );
}
