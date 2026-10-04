/**
 * ============================================================================
 *  WALLET BADGE - the header's money control
 * ============================================================================
 *
 *  A pill in the marketplace header showing the signed-in person's spendable
 *  balance, next to the cart.
 *
 *  WHY IT IS NOT JUST AN ICON
 *  -------------------------
 *  Spec §15 is the rule this component exists to satisfy: "Do not create
 *  decorative navigation that does nothing." A wallet icon that opens nothing
 *  would be exactly that. So the button shows a REAL number fetched from
 *  `/api/wallet`, and it opens a real panel.
 *
 *  WHAT IT SHOWS, AND WHY
 *  ----------------------
 *  The badge shows the AVAILABLE balance only. Pending and reserved money are
 *  deliberately not in the badge: a reserved withdrawal is already committed,
 *  and pending earnings are not spendable, so folding them into one headline
 *  number would overstate what the person can actually use today. The panel
 *  breaks all four buckets out, and that is where the nuance lives.
 *
 *  THE THREE HONEST STATES
 *  -----------------------
 *  A wallet control that lies is worse than no wallet control, so each state is
 *  explicit rather than approximated:
 *
 *    signed out     the pill is absent, and the account button already says
 *                   "Sign in". There is no balance to show and inventing a
 *                   zero would imply a wallet exists.
 *    signed in      the real balance, formatted from integer cents.
 *    finance off    the real balance, plus a "Paused" marker, because the
 *                   feature is genuinely disabled on this deployment and the
 *                   user deserves to know why nothing can be added.
 *
 *  FORMATTING HAPPENS HERE, FROM CENTS
 *  -----------------------------------
 *  The API returns integers. `formatMoney` is the single place a number of
 *  cents becomes a number of birrs, so the header cannot disagree with the
 *  wallet screen about what the balance is. There is no `parseFloat` anywhere
 *  in this component - the number that arrives is the number that is shown.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Lock, Wallet } from "lucide-react";
import { formatMoney } from "../../finance/money";
import { fetchWallet, type FinanceState, type WalletResponse } from "../../lib/financeApi";
import { TOUCH } from "../marketplace/ProductCard";

/**
 * The header pill.
 *
 * Renders nothing while signed out - the account control already covers that
 * case, and an empty "0.00 ETB" would suggest a wallet that does not exist.
 */
export function WalletBadge({
  authenticated,
  onOpen,
  onSignIn,
}: {
  authenticated: boolean;
  onOpen: (wallet: WalletResponse, finance: FinanceState) => void;
  onSignIn: () => void;
}) {
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [finance, setFinance] = useState<FinanceState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!authenticated) {
      setWallet(null);
      setFinance(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    fetchWallet()
      .then((result) => {
        if (cancelled) return;
        setWallet(result.wallet);
        setFinance(result.finance);
      })
      .catch(() => {
        // A failed read shows the sign-in affordance rather than a fake zero.
        // Showing "0.00" here would be a lie about a balance we failed to read.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (!authenticated) return null;

  if (failed || !wallet) {
    return (
      <button
        type="button"
        onClick={onSignIn}
        aria-label="Reload your wallet"
        title="We could not load your wallet"
        className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button border border-yene-line px-2.5 text-[12.5px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
      >
        <Wallet size={15} aria-hidden />
        <span className="hidden desktop:inline">Wallet</span>
      </button>
    );
  }

  const paused = finance?.enabled === false;
  const frozen = wallet.status !== "active";

  return (
    <button
      type="button"
      onClick={() => onOpen(wallet, finance ?? { enabled: false, mode: "off", reason: "" })}
      title={frozen ? `Wallet ${wallet.status}: ${wallet.frozenReason ?? "contact support"}` : "Open your wallet"}
      className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button border px-2.5 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
        frozen
          ? "border-yene-warn/50 text-yene-warn hover:border-yene-warn"
          : "border-yene-line text-yene-text hover:border-yene-accent hover:text-yene-accent"
      }`}
    >
      {frozen ? <Lock size={14} aria-hidden /> : <Wallet size={15} aria-hidden />}
      <span className="tabular-nums">{formatMoney(wallet.available)}</span>
      {paused && (
        <span className="rounded-full bg-yene-warn/15 px-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-yene-warn">
          Paused
        </span>
      )}
      <span className="sr-only">Open your wallet, available balance {formatMoney(wallet.available)}</span>
    </button>
  );
}
