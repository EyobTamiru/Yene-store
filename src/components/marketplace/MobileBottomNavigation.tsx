/**
 * ============================================================================
 *  MobileBottomNavigation (spec §7)
 * ============================================================================
 *
 *  Home | Categories | Cart | Orders | Account, fixed to the bottom of a
 *  phone viewport.
 *
 *  SPEC §7 REQUIREMENTS, EACH ONE HANDLED
 *  -------------------------------------
 *  * Clear active state      The active tab gets the accent colour AND a 2px
 *                            top bar, so state is never conveyed by colour
 *                            alone (spec §13).
 *  * Touch targets 44x44     `min-h-11` on every tab.
 *  * Proper spacing          Even flex distribution, no cramped edges.
 *  * Safe-area support       `env(safe-area-inset-bottom)` so the home
 *                            indicator on a modern phone never overlaps a tab.
 *  * Never covers content    The page reserves the height with matching bottom
 *                            padding, so the last card is always scrollable
 *                            into view rather than trapped underneath.
 *  * Nothing decorative      Every tab calls a real handler. There is no tab
 *                            that does nothing (spec §15).
 */

import { Home, LayoutGrid, Package, ShoppingCart, User } from "lucide-react";
import { TOUCH } from "./ProductCard";

export type BottomTab = "home" | "categories" | "cart" | "orders" | "account";

const TABS: { id: BottomTab; label: string; icon: React.ReactNode }[] = [
  { id: "home", label: "Home", icon: <Home size={19} /> },
  { id: "categories", label: "Categories", icon: <LayoutGrid size={19} /> },
  { id: "cart", label: "Cart", icon: <ShoppingCart size={19} /> },
  { id: "orders", label: "Orders", icon: <Package size={19} /> },
  { id: "account", label: "Account", icon: <User size={19} /> },
];

export function MobileBottomNavigation({
  active,
  cartCount,
  onSelect,
}: {
  active: BottomTab;
  cartCount: number;
  onSelect: (tab: BottomTab) => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="yene-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-yene-line-soft bg-yene-bg/95 backdrop-blur laptop:hidden"
    >
      <ul className="mx-auto flex w-full max-w-[1600px] items-stretch">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li key={tab.id} className="flex-1">
              <button
                type="button"
                onClick={() => onSelect(tab.id)}
                aria-current={isActive ? "page" : undefined}
                className={`${TOUCH} relative flex w-full flex-col items-center justify-center gap-0.5 rounded-none px-1 py-2 text-[10.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-yene-accent ${
                  isActive ? "text-yene-accent" : "text-yene-muted"
                }`}
              >
                {/* Active marker: a bar as well as a colour, so the state is
                    legible without relying on colour. */}
                <span
                  aria-hidden
                  className={`absolute inset-x-3 top-0 h-0.5 rounded-full transition-opacity ${
                    isActive ? "bg-yene-accent opacity-100" : "opacity-0"
                  }`}
                />
                <span className="relative">
                  {tab.icon}
                  {tab.id === "cart" && cartCount > 0 && (
                    <span
                      aria-hidden
                      className="absolute -right-2 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-yene-accent px-1 text-[9.5px] font-bold text-yene-on-accent"
                    >
                      {cartCount}
                    </span>
                  )}
                </span>
                {tab.label}
                {tab.id === "cart" && <span className="sr-only">, {cartCount} items</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The page reserves exactly this much space so the fixed bar never sits on
 * top of the last row of content.
 */
export const BOTTOM_NAV_SPACE = "pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] laptop:pb-0";
