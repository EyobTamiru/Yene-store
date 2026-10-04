/**
 * ============================================================================
 *  WALLET PANEL - the drawer the header badge opens
 * ============================================================================
 *
 *  A drawer rather than a page, for the same reason the cart is a drawer
 *  (CartDrawer.tsx): opening a wallet is a glance, not a destination. You check
 *  your balance and go straight back to browsing.
 *
 *  WHAT IS AND IS NOT HERE
 *  ----------------------
 *  Shown: the four balance buckets, the lifetime totals, and the state of the
 *  feature on this deployment.
 *
 *  NOT shown: "Add money", "Withdraw", and the transaction history. Those
 *  require deposits, payouts and a ledger read endpoint respectively, none of
 *  which exist yet (Phases 2-4). Rendering a button that cannot work would be
 *  the decorative navigation spec Â§15 forbids, and offering a withdrawal with
 *  no provider behind it would be worse - so the panel says plainly that the
 *  features are not available rather than pretending.
 *
 *  THE FOUR BUCKETS ARE THE POINT
 *  ------------------------------
 *  Showing available and pending SEPARATELY is what makes the wallet honest. A
 *  single combined number would let a person believe they can spend earnings
 *  that are still inside a dispute window, which is the exact mistake Part 5 is
 *  written to prevent. The reserved row is there for the same reason: money
 *  committed to a withdrawal is not money you still have.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Lock, X } from "lucide-react";
import { formatMoney } from "../../finance/money";
import { fetchWallet, type FinanceState, type WalletResponse } from "../../lib/financeApi";
import { TOUCH } from "../marketplace/ProductCard";

export function WalletPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [finance, setFinance] = useState<FinanceState | null>(null);
  const [loading, setLoading] = useState(false);

  // Re-read on every open, so the figure is current rather than whatever was
  // true when the page loaded. This is a cheap read of a small file.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchWallet()
      .then((result) => {
        if (cancelled) return;
        setWallet(result.wallet);
        setFinance(result.finance);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape closes it, which is what a drawer is expected to do.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Your wallet">
      <button type="button" aria-label="Close wallet" onClick={onClose} className="absolute inset-0 bg-black/50" tabIndex={-1} />
      <div className="yene-scroll relative flex h-full w-full max-w-[420px] flex-col overflow-y-auto border-l border-yene-line-soft bg-yene-surface">
        <header className="flex items-center justify-between gap-3 border-b border-yene-line-soft px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-yene-text">Your wallet</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`${TOUCH} rounded-button px-2 text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="flex-1 px-5 py-4">
          {loading && !wallet ? (
            <p className="text-[13px] text-yene-muted">Loading your balance...</p>
          ) : !wallet ? (
            <p className="text-[13px] text-yene-muted">We could not load your wallet. Please try again.</p>
          ) : (
            <>
              <div className="rounded-card border border-yene-line-soft bg-yene-raised px-4 py-4">
                <p className="text-[12px] font-medium text-yene-muted">Available balance</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-yene-text">
                  {formatMoney(wallet.available)}
                </p>
              </div>
              <WalletBody wallet={wallet} finance={finance} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The buckets, the lifetime totals, and the deployment's finance state. */
function WalletBody({ wallet, finance }: { wallet: WalletResponse; finance: FinanceState | null }) {
  return (
    <>
      <dl className="mt-4 space-y-2">
        <BucketRow label="Pending" amount={wallet.pending} hint="Earned, not yet available" />
        <BucketRow label="Reserved" amount={wallet.reserved} hint="Committed to a withdrawal" />
        <BucketRow label="Withheld" amount={wallet.withheld} hint="Held for review" />
      </dl>

      <div className="mt-5 border-t border-yene-line-soft pt-4">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-yene-faint">Lifetime totals</h3>
        <dl className="mt-2 space-y-2">
          <TotalRow label="Deposits" amount={wallet.totals.deposits} />
          <TotalRow label="Purchases" amount={wallet.totals.purchases} />
          <TotalRow label="Earnings" amount={wallet.totals.earnings} />
          <TotalRow label="Withdrawals" amount={wallet.totals.withdrawals} />
          <TotalRow label="Fees" amount={wallet.totals.fees} />
        </dl>
      </div>

      {wallet.status !== "active" && (
        <p className="mt-4 flex items-start gap-2 rounded-button border border-yene-warn/40 bg-yene-warn/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-yene-warn">
          <Lock size={15} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            This wallet is {wallet.status}. {wallet.frozenReason ?? "Contact support for help."}
          </span>
        </p>
      )}

      {finance?.enabled === false ? (
        <p className="mt-4 flex items-start gap-2 rounded-button border border-yene-info/40 bg-yene-info/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-yene-info">
          <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
          <span>{finance.reason}</span>
        </p>
      ) : (
        <p className="mt-4 rounded-button border border-yene-line-soft bg-yene-raised px-3 py-2.5 text-[12.5px] leading-relaxed text-yene-muted">
          Adding money and withdrawing are not available yet. They arrive with the payment provider
          integration, and will be offered here once that is connected.
        </p>
      )}
    </>
  );
}

function BucketRow({ label, amount, hint }: { label: string; amount: number; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[13px] text-yene-muted">
        {label}
        <span className="block text-[11.5px] text-yene-faint">{hint}</span>
      </dt>
      <dd className="text-[13px] font-semibold tabular-nums text-yene-text">{formatMoney(amount)}</dd>
    </div>
  );
}

function TotalRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12.5px] text-yene-muted">{label}</dt>
      <dd className="text-[12.5px] tabular-nums text-yene-text">{formatMoney(amount)}</dd>
    </div>
  );
}
