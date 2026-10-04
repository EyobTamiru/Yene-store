/**
 * ============================================================================
 *  MarketplaceFooter (spec §12)
 * ============================================================================
 *
 *  Real contact details, real package prices, and honest links. Every action
 *  calls a handler the parent supplied - the footer is the last place where a
 *  dead "Privacy Policy" link would be most conspicuous.
 */

import { useEffect, useState } from "react";
import { BRAND, SUPPORT_CONTACT } from "../../constants";
import { fetchPlatformConfig } from "../../lib/platformApi";
import { TOUCH } from "./ProductCard";
import type { PackageConfigCard } from "../../lib/platformApi";

export function MarketplaceFooter({
  onNavigate,
}: {
  onNavigate: (view: "marketplace" | "cart" | "business-dashboard" | "support") => void;
}) {
  // Real prices from the API, not a hard-coded list (spec §15).
  const [packages, setPackages] = useState<PackageConfigCard[]>([]);
  useEffect(() => {
    fetchPlatformConfig().then((config) => setPackages(config.packages)).catch(() => setPackages([]));
  }, []);
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-yene-line-soft bg-yene-surface/40">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-10 tablet:px-6 desktop:px-8">
        <div className="grid gap-8 tablet:grid-cols-2 laptop:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-yene-accent text-[15px] font-bold text-yene-on-accent">
                Y
              </span>
              <span className="text-sm font-semibold text-yene-text">
                {BRAND.name.toUpperCase()}
              </span>
            </div>
            <p className="mt-3 max-w-xs text-[12.5px] leading-relaxed text-yene-muted">
              Build. Sell. Manage. Automate. Grow.
            </p>
            <p className="mt-2 text-[11.5px] text-yene-faint">
              Powered by {BRAND.company}
            </p>
          </div>

          <nav aria-label="Packages">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-yene-faint">
              Packages
            </h2>
            <ul className="mt-3 space-y-1.5">
              {packages.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate("business-dashboard")}
                    className={`${TOUCH} flex w-full items-baseline gap-2 rounded text-left text-[12.5px] text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                  >
                    <span className="font-medium text-yene-text">{entry.name}</span>
                    <span className="text-yene-faint">{entry.priceLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Support">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-yene-faint">
              Support
            </h2>
            <ul className="mt-3 space-y-1.5">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate("support")}
                  className={`${TOUCH} w-full rounded text-left text-[12.5px] text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                >
                  Help &amp; support
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate("marketplace")}
                  className={`${TOUCH} w-full rounded text-left text-[12.5px] text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                >
                  Browse the marketplace
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate("business-dashboard")}
                  className={`${TOUCH} w-full rounded text-left text-[12.5px] text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                >
                  Business dashboard
                </button>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-yene-faint">
              Contact
            </h2>
            <ul className="mt-3 space-y-1.5 text-[12.5px] text-yene-muted">
              <li>
                <a
                  href={`tel:${SUPPORT_CONTACT.phone.replace(/\s/g, "")}`}
                  className={`${TOUCH} inline-flex items-center rounded text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                >
                  {SUPPORT_CONTACT.phone}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${SUPPORT_CONTACT.email}`}
                  className={`${TOUCH} inline-flex items-center break-all rounded text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                >
                  {SUPPORT_CONTACT.email}
                </a>
              </li>
              <li className="text-yene-faint">{SUPPORT_CONTACT.location}</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-3 border-t border-yene-line-soft pt-5 tablet:flex-row tablet:items-center">
          <p className="text-[11.5px] text-yene-faint">
            &copy; {year} {BRAND.company}. All rights reserved.
          </p>
          <p className="text-[11.5px] text-yene-faint">
            Prices shown in Ethiopian Birr (ETB), inclusive of tax.
          </p>
        </div>
      </div>
    </footer>
  );
}
