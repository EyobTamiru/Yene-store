/**
 * ============================================================================
 *  BUSINESS DASHBOARD (Sections 26, 31-40, 44)
 * ============================================================================
 *
 *  The module list is rendered from the server's `modules` array, where every
 *  entry already carries its `access` decision. This component does not know
 *  what a Platinum can do - it renders what it is told, which is why a fifth
 *  package rule cannot be introduced here by accident.
 *
 *  THE THREE STATES A MODULE CAN BE IN (Section 37)
 *  ------------------------------------------------
 *    available  usable
 *    locked     visible, with the package that would open it and an explicit
 *               note that the DATA IS STILL THERE - because Section 37 says a
 *               feature outside the package is locked, never deleted, and a
 *               merchant who downgraded must be able to SEE that their history
 *               survived
 *    hidden     not offered at all (Super-only custom systems)
 *
 *  The billing block is the most important screen on the platform: it is where
 *  Sections 31-37 are visible to a customer, and every one of those rules is
 *  stated in words drawn from the server's own quote, not paraphrased here.
 */

import { useEffect, useState } from "react";
import { formatEtb } from "../../platform/billing";
import { applyChange, fetchChangeQuote, fetchDashboard, fetchSubscription, renewSubscription, type ChangeQuoteView, type SubscriptionView } from "../../lib/platformApi";
import { DASHBOARD_WIDTH, TOUCH_TARGET, formatEtbUi } from "./primitives";

interface Props {
  onBack: () => void;
}

export function BusinessDashboard({ onBack }: Props) {
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof fetchDashboard>> | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [quote, setQuote] = useState<ChangeQuoteView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetchDashboard().then(setDashboard).catch((e) => setError(e.userMessage));
    fetchSubscription().then(setSubscription).catch((e) => setError(e.userMessage));
  };

  useEffect(load, []);

  async function preview(to: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await fetchChangeQuote(to);
      setQuote(result.quote);
    } catch (e) {
      setError((e as { userMessage?: string }).userMessage ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applyChange(quote.toPackage);
      setNotice(result.notice);
      setQuote(null);
      load();
    } catch (e) {
      setError((e as { userMessage?: string }).userMessage ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="border-b border-yene-line-soft">
        <div className={`${DASHBOARD_WIDTH} flex items-center justify-between gap-3 py-4`}>
          <button
            type="button"
            onClick={onBack}
            className={`${TOUCH_TARGET} rounded-xl px-3 text-[13px] font-medium text-yene-muted hover:text-yene-accent`}
          >
            &larr; Marketplace
          </button>
          <h1 className="text-sm font-semibold text-yene-text">
            {dashboard?.business.name ?? "Business dashboard"}
          </h1>
          <span className="rounded-full bg-yene-accent-dim px-2 py-0.5 text-[11px] font-semibold text-yene-accent">
            {subscription?.summary.packageName ?? dashboard?.packageId ?? ""}
          </span>
        </div>
      </header>

      <div className={`${DASHBOARD_WIDTH} grid gap-6 py-6 lg:grid-cols-[260px_1fr]`}>
        {/* ---- Sidebar on laptop+, stacked on a phone (Section 42) ---- */}
        <aside className="rounded-2xl border border-yene-line-soft bg-yene-surface p-3">
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
            {dashboard?.modules.map((module) => {
              const locked = module.access === "locked";
              return (
                <li key={module.key}>
                  <button
                    type="button"
                    disabled={module.access === "hidden"}
                    className={`${TOUCH_TARGET} flex w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-[13px] ${
                      locked
                        ? "text-yene-faint"
                        : "text-yene-text hover:bg-yene-raised"
                    } disabled:opacity-40`}
                  >
                    <span>{module.label}</span>
                    {locked && (
                      <span title={`Unlocks on ${module.unlockWith}`} className="text-[10px] text-yene-warn">
                        Locked
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="space-y-6">
          {error && (
            <p role="alert" className="rounded-xl border border-yene-danger/40 bg-yene-danger/10 px-3 py-2 text-[13px] text-yene-danger">
              {error}
            </p>
          )}

          {/* ---- Counts (Section 48) ---- */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Products", value: dashboard?.counts.products ?? 0 },
              { label: "Orders", value: dashboard?.counts.orders ?? 0 },
              { label: "Promotions", value: dashboard?.counts.promotions ?? 0 },
              { label: "Reviews", value: dashboard?.counts.reviews ?? 0 },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
                <p className="text-[12px] text-yene-faint">{stat.label}</p>
                <p className="mt-1 text-2xl font-semibold text-yene-text">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* ---- Section 31: the subscription card ---- */}
          {subscription && (
            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5">
              <h2 className="text-sm font-semibold text-yene-text">Packages &amp; Billing</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] text-yene-faint">Current Package</p>
                  <p className="text-lg font-semibold text-yene-accent">{subscription.summary.packageName}</p>
                </div>
                <div>
                  <p className="text-[11px] text-yene-faint">Price</p>
                  <p className="text-lg font-semibold text-yene-text">{subscription.summary.priceLabel}</p>
                </div>
                <div>
                  <p className="text-[11px] text-yene-faint">Status</p>
                  <p className="text-lg font-semibold text-yene-text">{subscription.summary.status}</p>
                </div>
                <div>
                  <p className="text-[11px] text-yene-faint">Renewal Date</p>
                  <p className="text-sm text-yene-text">
                    {subscription.summary.renewalDate.slice(0, 10)}
                  </p>
                </div>
              </div>

              {subscription.summary.pendingChangeLabel && (
                <p className="mt-3 rounded-xl border border-yene-info/40 bg-yene-info/10 px-3 py-2 text-[12px] text-yene-info">
                  Scheduled change: {subscription.summary.pendingChangeLabel}. Your current access
                  continues until then.
                </p>
              )}

              {/* Section 35, shown before anything else can be misread as a refund. */}
              <p className="mt-3 text-[12px] text-yene-muted">
                Downgrading your package does not generate a refund or credit for the price
                difference.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {subscription.summary.canUpgrade.map((pkg) => (
                  <button
                    key={`up-${pkg}`}
                    type="button"
                    onClick={() => preview(pkg)}
                    className={`${TOUCH_TARGET} rounded-xl bg-yene-accent px-3 text-[13px] font-semibold text-yene-on-accent`}
                  >
                    Upgrade to {pkg}
                  </button>
                ))}
                {subscription.summary.canDowngrade.map((pkg) => (
                  <button
                    key={`down-${pkg}`}
                    type="button"
                    onClick={() => preview(pkg)}
                    className={`${TOUCH_TARGET} rounded-xl border border-yene-line px-3 text-[13px] text-yene-muted hover:text-yene-accent`}
                  >
                    Downgrade to {pkg}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => renewSubscription().then(load).catch((e) => setError(e.userMessage))}
                  className={`${TOUCH_TARGET} rounded-xl border border-yene-line px-3 text-[13px] text-yene-muted hover:text-yene-accent`}
                >
                  Renew now
                </button>
              </div>
            </section>
          )}

          {/* ---- The quote, before the customer confirms (Sections 32-36) ---- */}
          {quote && (
            <section className="rounded-2xl border border-yene-accent/50 bg-yene-accent-dim p-5">
              <h3 className="text-sm font-semibold text-yene-text">
                {quote.changeType}: {quote.fromPackage} &rarr; {quote.toPackage}
              </h3>
              <p className="mt-1 text-2xl font-semibold text-yene-accent">{formatEtb(quote.amountDue)}</p>
              {quote.changeType === "Downgrade" && (
                <p className="mt-1 text-sm font-semibold text-yene-text">
                  Refund: {formatEtb(0)}
                </p>
              )}
              <p className="mt-2 text-[12.5px] leading-relaxed text-yene-muted">{quote.notice}</p>
              <p className="mt-2 text-[12px] text-yene-faint">
                Effective: {quote.immediate ? "immediately" : quote.effectiveAt.slice(0, 10)}
                {" · "}Next renewal: {formatEtb(quote.nextRenewalAmount)}
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={confirm}
                  className={`${TOUCH_TARGET} rounded-xl bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent`}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setQuote(null)}
                  className={`${TOUCH_TARGET} rounded-xl border border-yene-line px-4 text-[13px] text-yene-muted`}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

          {notice && (
            <p className="rounded-xl border border-yene-accent/40 bg-yene-accent-dim px-3 py-2 text-[12.5px] text-yene-accent">
              {notice}
            </p>
          )}

          {/* ---- Locked modules, explained (Section 37) ---- */}
          {dashboard && (
            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5">
              <h2 className="text-sm font-semibold text-yene-text">Not included in your package</h2>
              <p className="mt-1 text-[12px] text-yene-muted">
                These are locked, not deleted. Your data stays exactly where it is and becomes
                available again if you upgrade.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {dashboard.modules
                  .filter((module) => module.access === "locked")
                  .map((module) => (
                    <li
                      key={module.key}
                      className="rounded-full border border-yene-line px-3 py-1 text-[11px] text-yene-faint"
                    >
                      {module.label} &middot; unlocks on {module.unlockWith}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {/* ---- Section 39: change history ---- */}
          {subscription && subscription.changeHistory.length > 0 && (
            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5">
              <h2 className="text-sm font-semibold text-yene-text">Package change history</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-[12.5px]">
                  <thead className="text-yene-faint">
                    <tr>
                      <th className="py-2 pr-3">From</th>
                      <th className="py-2 pr-3">To</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Amount</th>
                      <th className="py-2 pr-3">Effective</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscription.changeHistory.map((row) => (
                      <tr key={row.id} className="border-t border-yene-line-soft">
                        <td className="py-2 pr-3 text-yene-muted">{row.previousPackage}</td>
                        <td className="py-2 pr-3 text-yene-text">{row.newPackage}</td>
                        <td className="py-2 pr-3 text-yene-muted">{row.changeType}</td>
                        <td className="py-2 pr-3 text-yene-text">{formatEtb(row.amount)}</td>
                        <td className="py-2 pr-3 text-yene-faint">{row.effectiveAt.slice(0, 10)}</td>
                        <td className="py-2 text-yene-faint">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ---- Section 31: invoices ---- */}
          {subscription && subscription.invoices.length > 0 && (
            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-5">
              <h2 className="text-sm font-semibold text-yene-text">Invoices &amp; Receipts</h2>
              <ul className="mt-3 space-y-2">
                {subscription.invoices.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-yene-line-soft px-3 py-2"
                  >
                    <span className="text-[12.5px] text-yene-muted">
                      {invoice.id} &middot; {invoice.type} &middot; {invoice.issuedAt.slice(0, 10)}
                    </span>
                    <span className="text-[13px] font-semibold text-yene-text">
                      {formatEtbUi(invoice.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
