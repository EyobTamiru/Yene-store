/**
 * ============================================================================
 *  STOREFRONT AND PRODUCT (Sections 10, 11, 13, 22, 23)
 * ============================================================================
 *
 *  The rented store a business activates at e.g. abcfashion.yene-store.com,
 *  and the product page for anything sold on it.
 *
 *  SECTION 13 IS VISIBLE HERE
 *  --------------------------
 *  The product page shows a "Also on the YENE Marketplace" line whose text
 *  comes from the submission status. It is a STATUS, not a second product: the
 *  name, price and seller on screen are read from the one product row, whether
 *  the shopper arrived through the marketplace or the store.
 */

import { useEffect, useState } from "react";
import { Building2, DoorOpen } from "lucide-react";
import { fetchProduct, fetchStore, type ProductSummary, type Storefront } from "../../lib/platformApi";
import { CONTENT_WIDTH, ProductCard, StarRow, TOUCH_TARGET, formatEtbUi } from "./primitives";
import type { MarketplaceCard } from "../marketplace/types";

export function StorefrontView({
  subdomain,
  onBack,
  onOpenProduct,
  onAddToCart,
}: {
  subdomain: string;
  onBack: () => void;
  onOpenProduct: (id: string) => void;
  onAddToCart: (line: { productId: string; name: string; price: number; quantity: number }) => void;
}) {
  const [store, setStore] = useState<Storefront | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStore(subdomain)
      .then(setStore)
      .catch((e) => setError((e as { userMessage?: string }).userMessage ?? null));
  }, [subdomain]);

  if (error) {
    return (
      <Shell onBack={onBack}>
        <p role="alert" className="rounded-xl border border-yene-danger/40 bg-yene-danger/10 px-3 py-2 text-[13px] text-yene-danger">
          {error}
        </p>
      </Shell>
    );
  }
  if (!store) {
    return <Shell onBack={onBack}><p className="text-[13px] text-yene-muted">Loading store...</p></Shell>;
  }

  const { business } = store;
  const customization = business.customization;

  return (
    <Shell onBack={onBack}>
      {/* Cover and logo (Section 11) */}
      <header className="overflow-hidden rounded-2xl border border-yene-line-soft bg-yene-surface">
        <div className="h-28 w-full bg-yene-raised sm:h-40" />
        <div className="px-5 pb-5">
          <div className="-mt-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-yene-line bg-yene-raised text-xl font-bold text-yene-accent">
            {business.name.slice(0, 1)}
          </div>
          <h1 className="mt-3 text-lg font-semibold text-yene-text sm:text-xl">{business.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-yene-faint">
            <span>{business.subdomain}</span>
            <span>&middot;</span>
            <span>{business.location}</span>
            <span>&middot;</span>
            <StarRow rating={business.rating} count={store.products.length + store.featured.length} />
            <span
              className={`rounded-full px-2 py-0.5 ${
                business.status === "Active"
                  ? "bg-yene-accent-dim text-yene-accent"
                  : "bg-yene-warn/15 text-yene-warn"
              }`}
            >
              {business.status}
            </span>
          </div>

          {/* Section 41: the mall a business trades from.
              Every room is listed, not just the primary one - a store holding
              two counters must show both or a shopper will go to the wrong
              one. */}
          {business.mall && business.mall.mallName && (
            <div className="mt-2 rounded-xl border border-yene-line-soft px-3 py-2 text-[12px] text-yene-muted">
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <Building2 size={13} aria-hidden className="shrink-0 text-yene-faint" />
                <span className="font-medium text-yene-text">{business.mall.mallName}</span>
                {business.mall.floor && (
                  <>
                    <span aria-hidden>&middot;</span>
                    <span>Floor {business.mall.floor}</span>
                  </>
                )}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <DoorOpen size={13} aria-hidden className="shrink-0 text-yene-faint" />
                {business.mall.rooms.length > 0 ? (
                  <span>
                    {business.mall.rooms.length === 1 ? "Room" : "Rooms"}{" "}
                    <span className="font-medium text-yene-text">
                      {business.mall.rooms.join(" & ")}
                    </span>
                  </span>
                ) : (
                  <span>Room to be confirmed</span>
                )}
              </p>
              <p className="mt-1 text-yene-faint">
                {business.mall.agreementId
                  ? "Included in a YENE-STORE mall agreement."
                  : "Registered under this mall on YENE-STORE."}
              </p>
            </div>
          )}

          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-yene-muted">
            {customization.description}
          </p>
          <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-yene-faint">
            {customization.businessInformation}
          </p>

          {customization.socialLinks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {customization.socialLinks.map((link) => (
                <a
                  key={link.platform}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={`${TOUCH_TARGET} inline-flex items-center rounded-full border border-yene-line px-3 text-[12px] text-yene-muted hover:text-yene-accent`}
                >
                  {link.platform}
                </a>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Section 18/19: this store's active promotions. */}
      {store.promotions.length > 0 && (
        <section className="mt-5">
          {store.promotions.map((promotion) => (
            <div key={promotion.id} className="rounded-2xl border border-yene-accent/40 bg-yene-accent-dim p-4">
              <p className="text-sm font-semibold text-yene-text">{promotion.title}</p>
              <p className="mt-1 text-[12.5px] text-yene-muted">{promotion.description}</p>
              <p className="mt-1 text-[11px] text-yene-faint">{promotion.cta} &middot; {promotion.type}</p>
            </div>
          ))}
        </section>
      )}

      {store.featured.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-yene-text">Featured</h2>
          <div className="grid grid-cols-2 gap-3 tablet:grid-cols-3 laptop:grid-cols-4">
            {store.featured.map((product) => (
              <StoreProduct
                key={product.id}
                product={product}
                business={business}
                onOpen={onOpenProduct}
                onAdd={onAddToCart}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-yene-text">Products</h2>
        {store.products.length === 0 ? (
          <p className="text-[13px] text-yene-muted">This store has no products yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 tablet:grid-cols-3 laptop:grid-cols-4">
            {store.products.map((product) => (
              <StoreProduct
                key={product.id}
                product={product}
                business={business}
                onOpen={onOpenProduct}
                onAdd={onAddToCart}
              />
            ))}
          </div>
        )}
      </section>

      {/* Section 10: policies, delivery and payment options. */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Info title="Contact">
          <p>{customization.contact.phone}</p>
          <p>{customization.contact.email}</p>
          <p>{customization.contact.address}</p>
        </Info>
        <Info title="Delivery">
          {customization.delivery.options.length === 0 ? (
            <p>Delivery options are not set yet.</p>
          ) : (
            customization.delivery.options.map((option) => (
              <p key={option.id}>
                {option.label} &middot; {option.fee === 0 ? "Free" : formatEtbUi(option.fee)} &middot; {option.etaDays} day(s)
              </p>
            ))
          )}
          {customization.delivery.freeAbove !== null && (
            <p className="text-yene-faint">Free above {formatEtbUi(customization.delivery.freeAbove)}</p>
          )}
        </Info>
        <Info title="Payment options">
          {customization.paymentOptions.length === 0 ? (
            <p>Not set yet.</p>
          ) : (
            customization.paymentOptions.map((option) => <p key={option}>{option}</p>)
          )}
        </Info>
        <Info title="Returns">{customization.policies.returns}</Info>
        <Info title="Shipping">{customization.policies.shipping}</Info>
        <Info title="Terms">{customization.policies.terms}</Info>
      </section>
    </Shell>
  );
}

/**
 * Adapt a storefront product to the canonical card shape.
 *
 * Spec Ã‚Â§12 forbids multiple product cards. This storefront previously had its
 * own `StoreProduct`; it now renders the same `ProductCard` as the
 * marketplace, with only the projection adapted. Fields that the storefront
 * endpoint does not return (rating, review count) are left at their neutral
 * values so the card OMITS them rather than showing a fabricated zero.
 */
function toMarketplaceCard(
  product: ProductSummary,
  business: { id: string; name: string; subdomain: string },
): MarketplaceCard {
  const finalPrice = product.discountPrice ?? product.price;
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    imageUrl: product.images[0] ?? null,
    imageCount: product.images.length,
    price: product.price,
    finalPrice,
    discountPercent:
      finalPrice < product.price ? Math.round((1 - finalPrice / product.price) * 100) : null,
    inStock: product.stock > 0,
    stock: product.stock,
    // Not returned by this endpoint. 0 makes the card omit the rating row
    // rather than display an invented 0.0.
    rating: 0,
    reviewCount: 0,
    businessId: business.id,
    businessName: business.name,
    businessSubdomain: business.subdomain,
    categoryId: product.categoryId,
    subcategoryId: product.subcategoryId,
    promotion: null,
  };
}

function StoreProduct({
  product,
  business,
  onOpen,
  onAdd,
}: {
  product: ProductSummary;
  business: { id: string; name: string; subdomain: string };
  onOpen: (id: string) => void;
  onAdd: (line: { productId: string; name: string; price: number; quantity: number }) => void;
}) {
  const card = toMarketplaceCard(product, business);
  return (
    <ProductCard
      card={card}
      onOpen={onOpen}
      onAddToCart={(entry) =>
        onAdd({
          productId: entry.id,
          name: entry.name,
          price: entry.finalPrice,
          quantity: 1,
        })
      }
    />
  );
}

function Info({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4 text-[12.5px] leading-relaxed text-yene-muted">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-yene-faint">{title}</p>
      {children}
    </div>
  );
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="border-b border-yene-line-soft">
        <div className={`${CONTENT_WIDTH} py-4`}>
          <button
            type="button"
            onClick={onBack}
            className={`${TOUCH_TARGET} rounded-xl px-3 text-[13px] text-yene-muted hover:text-yene-accent`}
          >
            &larr; Back
          </button>
        </div>
      </header>
      <main className={`${CONTENT_WIDTH} space-y-5 py-6`}>{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product page
// ---------------------------------------------------------------------------

export function ProductView({
  productId,
  onBack,
  onAddToCart,
}: {
  productId: string;
  onBack: () => void;
  onAddToCart: (line: { productId: string; name: string; price: number; quantity: number }) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchProduct>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProduct(productId)
      .then(setData)
      .catch((e) => setError((e as { userMessage?: string }).userMessage ?? null));
  }, [productId]);

  if (error) {
    return <Shell onBack={onBack}><p role="alert" className="text-[13px] text-yene-danger">{error}</p></Shell>;
  }
  if (!data) {
    return <Shell onBack={onBack}><p className="text-[13px] text-yene-muted">Loading...</p></Shell>;
  }

  const { product, seller, ratings, reviews, marketplace } = data;
  const onSale = product.discountPrice !== null && product.discountPrice < product.price;
  const price = onSale ? product.discountPrice! : product.price;

  return (
    <Shell onBack={onBack}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="text-lg font-semibold text-yene-text sm:text-xl">{product.name}</h1>
          <p className="mt-1 text-[13px] text-yene-muted">{product.brand} &middot; SKU {product.sku}</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-yene-text">{formatEtbUi(price)}</span>
            {onSale && <span className="text-[13px] text-yene-faint line-through">{formatEtbUi(product.price)}</span>}
            <StarRow rating={ratings.average} count={ratings.count} />
          </div>

          <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-yene-muted">{product.description}</p>

          {product.attributes.length > 0 && (
            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              {product.attributes.map((attribute) => (
                <div key={attribute.name} className="flex justify-between rounded-xl border border-yene-line-soft px-3 py-2 text-[12.5px]">
                  <dt className="text-yene-faint">{attribute.name}</dt>
                  <dd className="text-yene-text">{attribute.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {/* Section 23: rating distribution and reviews. */}
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-yene-text">Reviews</h2>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="text-2xl font-semibold text-yene-text">{ratings.average}</span>
              <div className="space-y-0.5">
                {ratings.distribution.map((count, index) => (
                  <div key={index} className="flex items-center gap-2 text-[11px] text-yene-faint">
                    <span>{5 - index}*</span>
                    <span className="h-1 w-24 overflow-hidden rounded-full bg-yene-raised">
                      <span
                        className="block h-full rounded-full bg-yene-accent"
                        style={{ width: `${ratings.count ? (count / ratings.count) * 100 : 0}%` }}
                      />
                    </span>
                    <span>{count}</span>
                  </div>
                ))}
              </div>
            </div>
            <ul className="mt-4 space-y-3">
              {reviews.map((review) => (
                <li key={review.id} className="rounded-xl border border-yene-line-soft bg-yene-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-yene-text">{review.customerName}</span>
                    <StarRow rating={review.rating} count={1} />
                    {review.verifiedPurchase && (
                      <span className="rounded-full bg-yene-accent-dim px-2 py-0.5 text-[10px] font-semibold text-yene-accent">
                        Verified purchase
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-yene-muted">{review.body}</p>
                  {review.businessResponse && (
                    <p className="mt-2 rounded-lg bg-yene-raised px-3 py-2 text-[12px] text-yene-faint">
                      <span className="font-semibold text-yene-muted">Store reply: </span>
                      {review.businessResponse}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
            <button
              type="button"
              disabled={product.stock <= 0}
              onClick={() => onAddToCart({ productId: product.id, name: product.name, price, quantity: 1 })}
              className={`${TOUCH_TARGET} w-full rounded-xl bg-yene-accent text-sm font-semibold text-yene-on-accent disabled:bg-yene-raised disabled:text-yene-faint`}
            >
              {product.stock > 0 ? "Add to cart" : "Out of stock"}
            </button>
            {seller && (
              <p className="mt-3 text-[12px] text-yene-faint">
                Sold by{" "}
                <span className="text-yene-muted">{seller.name}</span> &middot; {seller.subdomain}
              </p>
            )}
            <p className="mt-1 text-[12px] text-yene-faint">{product.deliveryInfo}</p>
          </div>

          {/* Section 13: a STATUS, not a second product. */}
          <div className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
            <p className="text-[11px] uppercase tracking-wide text-yene-faint">Marketplace</p>
            <p className="mt-1 text-[12.5px] text-yene-muted">
              {marketplace.status === "Published"
                ? "Also listed on the YENE Marketplace."
                : marketplace.status === "Not Submitted"
                  ? "Sold from this store only."
                  : `Marketplace status: ${marketplace.status}`}
            </p>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
