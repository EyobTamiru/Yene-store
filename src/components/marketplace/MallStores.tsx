/**
 * ============================================================================
 *  MALL STORES (Section 41)
 * ============================================================================
 *
 *  "a stores that register under mall" - so a shopper has to be able to browse
 *  a MALL and see the stores inside it, rather than only seeing stores and
 *  reading their address. This is the browse half; MallStoresView is the page
 *  one mall opens into.
 *
 *  WHAT IS ON A MALL CARD, AND WHY
 *  ------------------------------
 *  Only counts that were counted server-side. A mall with three stores says
 *  three; a mall with no registered store is not rendered at all, because
 *  "Dembel City Center - 0 stores" is a dead end rather than a useful fact.
 *
 *  THE ROOMS ARE THE POINT
 *  -----------------------
 *  Each store line shows the floor and EVERY room it holds. A shop trading out
 *  of GFS-024 and GFS-030 has to be findable by either counter, and it has to
 *  be obvious it is one shop with two counters rather than a rendering bug.
 */

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  DoorOpen,
  MapPin,
  Store as StoreIcon,
} from "lucide-react";
import { fetchMall } from "../../lib/platformApi";
import { CONTENT_WIDTH, StarRow, TOUCH_TARGET } from "../platform/primitives";
import { EmptyState, ErrorState, SectionSkeleton } from "./States";
import { SectionHeading } from "./Sections";
import type { MallCard, MallPage } from "./types";

/**
 * The mall directory, as a section on the marketplace.
 *
 * Not a rail: each card carries a variable number of stores and each of those
 * a variable number of rooms, so a fixed-width carousel row would either clip
 * the list or scroll away the store names that make the card useful. A grid
 * lets the list be read.
 */
export function MallStoresSection({
  malls,
  onOpenMall,
  onOpenStore,
}: {
  malls: MallCard[];
  onOpenMall: (slug: string) => void;
  onOpenStore: (subdomain: string) => void;
}) {
  if (malls.length === 0) return null;

  return (
    <section aria-label="Shopping malls">
      <SectionHeading
        title="Shop by mall"
        subtitle="Stores registered inside each mall on YENE-STORE"
      />

      <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
        {malls.map((mall) => (
          <li key={mall.id}>
            <MallCardView mall={mall} onOpenMall={onOpenMall} onOpenStore={onOpenStore} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MallCardView({
  mall,
  onOpenMall,
  onOpenStore,
}: {
  mall: MallCard;
  onOpenMall: (slug: string) => void;
  onOpenStore: (subdomain: string) => void;
}) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-card border border-yene-line-soft bg-yene-surface transition-colors hover:border-yene-accent/60">
      <div className="relative h-20 w-full shrink-0 overflow-hidden bg-yene-raised">
        {mall.coverImageUrl ? (
          <img
            src={mall.coverImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="h-full w-full bg-gradient-to-br from-yene-raised via-yene-surface to-yene-accent/10"
          />
        )}
        <span className="absolute -bottom-5 left-3 flex h-10 w-10 items-center justify-center rounded-xl border border-yene-line bg-yene-surface text-yene-accent">
          <Building2 size={17} aria-hidden />
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3 pt-8">
        <h3 className="line-clamp-1 text-[14px] font-semibold text-yene-text">{mall.name}</h3>

        <p className="flex items-center gap-1 text-[11.5px] text-yene-muted">
          <MapPin size={12} aria-hidden className="shrink-0 text-yene-faint" />
          <span className="truncate">
            {mall.address}, {mall.city}
          </span>
        </p>

        {/* Counts the server actually returned. */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-yene-faint">
          <span className="flex items-center gap-1">
            <StoreIcon size={12} aria-hidden />
            {mall.storeCount} {mall.storeCount === 1 ? "store" : "stores"}
          </span>
          <span className="flex items-center gap-1">
            <Building2 size={12} aria-hidden />
            {mall.productCount} {mall.productCount === 1 ? "product" : "products"}
          </span>
        </p>

        {/* Every registered store, with ALL of its rooms. */}
        <ul className="mt-1 space-y-0.5 border-t border-yene-line-soft pt-2">
          {mall.stores.map((store) => (
            <li key={store.id}>
              <button
                type="button"
                onClick={() => onOpenStore(store.subdomain)}
                className={`${TOUCH_TARGET} flex w-full items-start gap-1.5 rounded-lg px-1.5 text-left transition-colors hover:bg-yene-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
              >
                <span className="min-w-0 flex-1 py-1">
                  <span className="flex items-center gap-1">
                    <span className="truncate text-[12.5px] font-medium text-yene-text">
                      {store.name}
                    </span>
                    {store.rating > 0 && (
                      <span className="shrink-0 text-[11px] text-yene-muted">
                        {store.rating.toFixed(1)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-yene-faint">
                    <DoorOpen size={11} aria-hidden className="shrink-0" />
                    <span className="truncate">
                      {store.floor ? `${store.floor} · ` : ""}
                      {store.roomLabel || "Room to be confirmed"}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => onOpenMall(mall.slug)}
          className={`${TOUCH_TARGET} mt-auto w-full rounded-button border border-yene-line px-3 text-[12.5px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          All {mall.storeCount} stores in {mall.name}
        </button>
      </div>
    </article>
  );
}
/**
 * One mall, opened as a page: its own detail, every store registered in it, and
 * the counters still unclaimed.
 *
 * The unclaimed rooms are shown because a seller arriving here is often on
 * their way to registering, and being told GFS-024 is taken is far more useful
 * than finding out by being refused.
 */
export function MallStoresView({
  slug,
  onBack,
  onOpenStore,
}: {
  slug: string;
  onBack: () => void;
  onOpenStore: (subdomain: string) => void;
}) {
  const [page, setPage] = useState<MallPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A slow response for a mall the shopper has already navigated away from
    // must not paint over the screen they are now looking at.
    let current = true;
    setLoading(true);
    setError(null);
    fetchMall(slug)
      .then((result) => {
        if (!current) return;
        setPage(result);
        setLoading(false);
      })
      .catch((e: { userMessage?: string }) => {
        if (!current) return;
        setError(e?.userMessage ?? "We could not load this mall.");
        setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [slug, attempt]);

  return (
    <div className="min-h-screen bg-yene-bg">
      <header className="sticky top-0 z-20 border-b border-yene-line-soft bg-yene-bg/95 backdrop-blur">
        <div className={`${CONTENT_WIDTH} flex min-h-11 items-center gap-3 py-2`}>
          <button
            type="button"
            onClick={onBack}
            className={`${TOUCH_TARGET} inline-flex items-center gap-1.5 rounded-button px-2 text-[13px] font-medium text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            <ArrowLeft size={16} aria-hidden />
            Marketplace
          </button>
        </div>
      </header>

      <main className={`${CONTENT_WIDTH} py-5`}>
        {loading && <SectionSkeleton count={3} />}

        {error && !loading && (
          <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />
        )}

        {!loading && !error && !page && (
          <EmptyState
            title="Mall not found"
            hint="This mall may have been renamed or removed."
            action={{ label: "Back to marketplace", onClick: onBack }}
          />
        )}

        {page && (
          <div className="space-y-5">
            <MallHeader mall={page} />

            <section aria-label={`Stores in ${page.mall.name}`}>
              <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-yene-text">
                Stores in this mall
              </h2>
              {page.stores.length === 0 ? (
                <EmptyState
                  title="No stores registered yet"
                  hint="Sellers trading in this mall appear here once they register."
                />
              ) : (
                <StoreGrid stores={page.stores} onOpenStore={onOpenStore} />
              )}
            </section>

            <AvailableRooms mall={page} />
          </div>
        )}
      </main>
    </div>
  );
}

function MallHeader({ mall }: { mall: MallPage }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-yene-line-soft bg-yene-surface">
      <div className="h-24 w-full bg-yene-raised sm:h-32" />
      <div className="px-5 pb-5">
        <div className="-mt-8 flex h-14 w-14 items-center justify-center rounded-2xl border border-yene-line bg-yene-raised text-yene-accent">
          <Building2 size={22} aria-hidden />
        </div>
        <h1 className="mt-3 text-lg font-semibold text-yene-text sm:text-xl">{mall.mall.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-yene-faint">
          <MapPin size={13} aria-hidden />
          <span>
            {mall.mall.address}, {mall.mall.city}
          </span>
          <span aria-hidden>&middot;</span>
          <span>
            {mall.mall.storeCount} registered{" "}
            {mall.mall.storeCount === 1 ? "store" : "stores"}
          </span>
        </p>
        {mall.mall.description && (
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-yene-muted">
            {mall.mall.description}
          </p>
        )}
        <p className="mt-2 flex flex-wrap gap-1.5">
          {mall.mall.floors.map((floor) => (
            <span
              key={floor}
              className="rounded-full border border-yene-line-soft px-2 py-0.5 text-[11px] text-yene-muted"
            >
              {floor}
            </span>
          ))}
        </p>
        {mall.mall.agreementId && (
          <p className="mt-3 inline-flex rounded-button bg-yene-accent-dim px-2.5 py-1 text-[11.5px] font-medium text-yene-accent">
            Covered by a YENE-STORE mall agreement
          </p>
        )}
      </div>
    </section>
  );
}

function StoreGrid({
  stores,
  onOpenStore,
}: {
  stores: MallPage["stores"];
  onOpenStore: (subdomain: string) => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 laptop:grid-cols-3">
      {stores.map((store) => (
        <li key={store.id}>
          <article className="flex h-full flex-col gap-1.5 rounded-card border border-yene-line-soft bg-yene-surface p-3.5">
            <div className="flex items-start gap-1.5">
              <h3 className="line-clamp-1 flex-1 text-[13.5px] font-semibold text-yene-text">
                {store.name}
              </h3>
              {store.verified && (
                <span className="inline-flex shrink-0" title="Verified YENE-STORE seller">
                  <BadgeCheck size={15} className="text-yene-accent" aria-hidden />
                  <span className="sr-only">Verified seller</span>
                </span>
              )}
            </div>

            {/* Section 41: the floor and EVERY room this store holds. */}
            <p className="flex items-center gap-1 text-[11.5px] text-yene-muted">
              <DoorOpen size={12} aria-hidden className="shrink-0 text-yene-faint" />
              <span className="truncate">
                {store.floor ? `${store.floor} · ` : ""}
                {store.roomLabel || "Room to be confirmed"}
              </span>
            </p>

            <p className="flex items-center gap-1 text-[11.5px] text-yene-faint">
              <StoreIcon size={12} aria-hidden className="shrink-0" />
              {store.productCount} {store.productCount === 1 ? "product" : "products"}
            </p>

            {store.description && (
              <p className="line-clamp-2 text-[12px] leading-relaxed text-yene-muted">
                {store.description}
              </p>
            )}

            <div className="mt-auto flex items-center justify-between gap-2 pt-2">
              <StarRow rating={store.rating} count={store.productCount} />
              <button
                type="button"
                onClick={() => onOpenStore(store.subdomain)}
                className={`${TOUCH_TARGET} rounded-button bg-yene-accent px-3 text-[12px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
              >
                View store
              </button>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

/** Section 41: the counters in this mall that nobody has claimed. */
function AvailableRooms({ mall }: { mall: MallPage }) {
  if (mall.availableRooms.length === 0) return null;
  const shown = mall.availableRooms.slice(0, 24);
  return (
    <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
      <h2 className="text-[14px] font-semibold text-yene-text">
        Rooms still available in {mall.mall.name}
      </h2>
      <p className="mt-1 text-[12.5px] text-yene-muted">
        Trading from this mall? Choose an unclaimed room when you register your store.
      </p>
      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {shown.map((room) => (
          <li
            key={room}
            className="rounded-full border border-yene-line-soft px-2.5 py-1 text-[11.5px] text-yene-muted"
          >
            {room}
          </li>
        ))}
      </ul>
      {mall.availableRooms.length > shown.length && (
        <p className="mt-2 text-[11.5px] text-yene-faint">
          and {mall.availableRooms.length - shown.length} more
        </p>
      )}
    </section>
  );
}