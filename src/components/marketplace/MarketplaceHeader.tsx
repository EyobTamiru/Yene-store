/**
 * ============================================================================
 *  MarketplaceHeader (spec §4 desktop, §7 phone)
 * ============================================================================
 *
 *  SPEC §2 IN PRACTICE
 *  --------------------
 *  "All three layouts must use the same branding, product data, card design,
 *  typography, colour system, navigation style and functionality. Only the
 *  layout and component sizing should adapt."
 *
 *  So there is ONE header component that lays itself out three ways:
 *
 *    phone   logo + account + cart on one row, then the search bar FULL WIDTH
 *            on a second row. Icon buttons, 44x44, and the search is never
 *            collapsed behind a magnifier icon.
 *    tablet  logo + search, with the secondary links reduced to a compact row.
 *    laptop+ logo + inline search + language + currency +
 *            help + account + orders + cart, all in one balanced row.
 *
 *  Everything here is REAL navigation. Spec §15: "Do not create decorative
 *  navigation that does nothing" - every control calls a handler the parent
 *  supplied, and the language selector actually changes the page copy.
 */

import { BadgeCheck, Briefcase, HelpCircle, LayoutGrid, Package, ShoppingCart, User } from "lucide-react";
import { BRAND } from "../../constants";
import { MarketplaceSearch } from "./MarketplaceSearch";
import { TOUCH } from "./ProductCard";
import { ThemeToggle } from "./ThemeToggle";
import { WalletBadge } from "../finance/WalletBadge";

export interface HeaderProps {
  /**
   * The category currently selected in `CategoryNavigation`.
   *
   * Passed down so the search box scopes to the category the shopper can see
   * highlighted, rather than keeping a private copy that could disagree with it.
   */
  category: string;
  language: "en" | "am";
  onLanguage: (language: "en" | "am") => void;
  cartCount: number;
  onOpenCart: () => void;
  onOpenAccount: () => void;
  onOpenOrders: () => void;
  onOpenHelp: () => void;
  onOpenDashboard: () => void;
  onSearch: (query: string, category: string) => void;
  onSuggest?: (term: string) => void;

  /** Server-resolved identity. Note there is no `onSignInAs` - the client
   *  cannot assert a business, it can only ask. */
  me: {
    authenticated: boolean;
    user?: { name: string; email: string };
    business?: { name: string; packageId: string } | null;
  } | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  onSignOut: () => void;
  /** Opens identity verification (Fayda ID + TIN). Required before renting. */
  onOpenVerification: () => void;
  /**
   * Opens the business Management System.
   *
   * Optional, and it is optional on PURPOSE: the parent passes it only when
   * `/api/management/access` has said this person may enter. A customer or a
   * signed-out visitor therefore never receives the handler, so the button has
   * nothing to call. The server still re-checks on every request - this is a
   * convenience, never the control (§8).
   */
  onOpenManagement?: () => void;
  /**
   * Opens the wallet drawer.
   *
   * Required, not optional, and it always has something to do: the badge
   * fetches a real balance from `/api/wallet` and opens a panel with real
   * figures in it. That is deliberate against spec §15 - an icon that opens
   * nothing is the thing this codebase forbids.
   */
  onOpenWallet: () => void;
}

export function MarketplaceHeader(props: HeaderProps) {
  const count = props.cartCount;

  return (
    <header className="sticky top-0 z-40 border-b border-yene-line-soft bg-yene-bg/95 backdrop-blur">
      <div className="mx-auto w-full max-w-[1600px] px-4 tablet:px-6 desktop:px-8">
        <div className="flex items-center justify-between gap-3 py-3">
          {/* Brand: a text wordmark built from the brand name. No borrowed
              logo, per spec §15. */}
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className={`${TOUCH} flex shrink-0 items-center gap-2 rounded-button px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
            aria-label={`${BRAND.name} home`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-yene-accent text-[15px] font-bold text-yene-on-accent">
              Y
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-yene-text laptop:text-base">
              {BRAND.name.toUpperCase()}
            </span>
          </button>

          {/* Inline search, laptop and up. */}
          <div className="hidden min-w-0 flex-1 items-center laptop:flex">
            <MarketplaceSearch
              category={props.category}
              language={props.language}
              onSearch={props.onSearch}
              onSuggest={props.onSuggest}
              variant="inline"
            />
          </div>

          <nav aria-label="Marketplace" className="flex shrink-0 items-center gap-1 tablet:gap-1.5">
            <div className="mr-1 hidden items-center gap-1.5 laptop:flex">
              <label className="sr-only" htmlFor="mk-language">
                Language
              </label>
              <select
                id="mk-language"
                value={props.language}
                onChange={(event) => props.onLanguage(event.target.value as "en" | "am")}
                className={`${TOUCH} rounded-button border border-yene-line bg-yene-surface px-2 text-[12.5px] text-yene-muted focus:border-yene-accent focus:outline-none`}
              >
                <option value="en">EN</option>
                <option value="am">አማ</option>
              </select>
              <span
                className={`${TOUCH} inline-flex items-center rounded-button border border-yene-line px-2.5 text-[12.5px] text-yene-muted`}
                title="All prices are in Ethiopian Birr"
              >
                ETB
              </span>
            </div>

            <ThemeToggle theme={props.theme} onToggle={props.onToggleTheme} />

            <IconAction icon={<HelpCircle size={17} />} label="Help & support" onClick={props.onOpenHelp} className="hidden tablet:inline-flex" />
            <IconAction icon={<Package size={17} />} label="My Orders" onClick={props.onOpenOrders} className="hidden desktop:inline-flex" />

            {props.me?.authenticated ? (
              // Signed in: the business name comes from the server, so the label
              // is always the real one and the client cannot fake it.
              <div className="hidden items-center gap-1 tablet:flex">
                <button
                  type="button"
                  onClick={props.onOpenDashboard}
                  title={`${props.me.business?.name ?? "Business"} - open your dashboard`}
                  className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button border border-yene-line px-2.5 text-[12.5px] font-medium text-yene-text transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                >
                  <LayoutGrid size={14} aria-hidden />
                  <span className="max-w-[140px] truncate">
                    {props.me.business?.name ?? props.me.user?.name}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={props.onSignOut}
                  className={`${TOUCH} rounded-button px-2 text-[12.5px] text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                >
                  Sign out
                </button>
                {/* Identity verification. Always present once signed in, because
                    renting a store is gated on it and a customer needs a way to
                    reach it. */}
                <button
                  type="button"
                  onClick={props.onOpenVerification}
                  title="Fayda ID and TIN verification"
                  className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button border border-yene-line px-2.5 text-[12.5px] font-medium text-yene-text transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                >
                  <BadgeCheck size={14} aria-hidden />
                  <span className="hidden desktop:inline">Verify</span>
                </button>

                {/* MANAGEMENT SYSTEM. Rendered only when the server has said
                    this account may enter, so a customer never sees it. */}
                {props.onOpenManagement && (
                  <button
                    type="button"
                    onClick={props.onOpenManagement}
                    title="Open your business management system"
                    className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button bg-yene-accent px-3 text-[12.5px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-bg`}
                  >
                    <Briefcase size={14} aria-hidden />
                    <span className="hidden tablet:inline">Management System</span>
                    <span className="sr-only tablet:hidden">Management System</span>
                  </button>
                )}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={props.onSignIn}
                  className={`${TOUCH} hidden items-center rounded-button border border-yene-line px-3 text-[12.5px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent tablet:inline-flex`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={props.onSignUp}
                  className={`${TOUCH} hidden items-center rounded-button bg-yene-accent px-3 text-[12.5px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-bg tablet:inline-flex`}
                >
                  Sign up
                </button>
              </>
            )}

            {/* Phone-only account control, plus the identity entry point. */}
            {props.me?.authenticated ? (
              <IconAction
                icon={<LayoutGrid size={17} />}
                label="Your dashboard"
                onClick={props.onOpenDashboard}
                className="tablet:hidden"
              />
            ) : (
              <IconAction
                icon={<User size={17} />}
                label="Sign in or create an account"
                onClick={props.onSignIn}
                className="tablet:hidden"
              />
            )}

            {/* Wallet: the signed-in person's real spendable balance, read from
                /api/wallet. Renders nothing while signed out, so the account
                button stays the only "not signed in" affordance. */}
            <WalletBadge
              authenticated={Boolean(props.me?.authenticated)}
              onOpen={props.onOpenWallet}
              onSignIn={props.onSignIn}
            />

            {/* Cart: always visible, with a live count. */}
            <button
              type="button"
              onClick={props.onOpenCart}
              className={`${TOUCH} relative inline-flex items-center gap-1.5 rounded-button bg-yene-accent px-3 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-bg`}
            >
              <ShoppingCart size={16} aria-hidden />
              <span className="hidden laptop:inline">Cart</span>
              {count > 0 && (
                <span
                  className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-yene-bg px-1 text-[11px] font-bold text-yene-accent"
                  aria-hidden
                >
                  {count}
                </span>
              )}
              <span className="sr-only">
                Cart, {count} {count === 1 ? "item" : "items"}
              </span>
            </button>
          </nav>
        </div>

        {/* Full-width search for phone and tablet. Spec §7. Hidden from laptop
            up so the shopper never sees two search boxes at once. */}
        <div className="pb-3 laptop:hidden">
          <MarketplaceSearch
            category={props.category}
            language={props.language}
            onSearch={props.onSearch}
            onSuggest={props.onSuggest}
            variant="stacked"
          />
        </div>
      </div>

      {/* Spec §6: tablet keeps a reduced set of secondary links. */}
      <div className="border-t border-yene-line-soft tablet:hidden">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-1 px-2 py-1.5">
          <QuickLink label="Help" onClick={props.onOpenHelp} />
          <QuickLink label="Orders" onClick={props.onOpenOrders} />
          <QuickLink label="Account" onClick={props.onOpenAccount} />
        </div>
      </div>
    </header>
  );
}

function IconAction({
  icon,
  label,
  onClick,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${TOUCH} inline-flex items-center justify-center rounded-button border border-transparent px-2.5 text-yene-muted transition-colors hover:border-yene-line hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${className}`}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function QuickLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${TOUCH} flex-1 rounded-button text-[12.5px] font-medium text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
    >
      {label}
    </button>
  );
}

