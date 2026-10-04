import { BarChart3, Headset, LayoutDashboard, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BRAND, SUPPORT_CONTACT } from "./constants";
import { KnowledgeAdminPage } from "./components/admin/KnowledgeAdminPage";
import { SupportAnalyticsPage } from "./components/admin/SupportAnalyticsPage";
import { SupportDashboardPage } from "./components/admin/SupportDashboardPage";
import { SupportPage } from "./components/support/SupportPage";
import { SupportWidget } from "./components/support/SupportWidget";
import { setStoredToken } from "./lib/supportApi";
import { BusinessDashboard } from "./components/platform/BusinessDashboard";
import { CartAndCheckout, type CartLine } from "./components/platform/CartAndCheckout";
import { CartDrawer, CartPill } from "./components/marketplace/CartDrawer";
import { MarketplaceHome } from "./components/marketplace/MarketplaceHome";
import { MallStoresView } from "./components/marketplace/MallStores";
import { ProductView, StorefrontView } from "./components/platform/StorefrontView";
import { AuthScreen, type AuthMode } from "./components/auth/AuthScreen";
import { ResetPassword } from "./components/auth/ForgotPassword";
import { WalletPanel } from "./components/finance/WalletPanel";
import { VerificationProfile } from "./components/verify/VerificationProfile";
import { RentalQueuePage } from "./components/admin/RentalQueuePage";
import { MallAdminPage } from "./components/admin/MallAdminPage";
import { ManagementSystem } from "./components/management/ManagementSystem";
import { ManagementSectionHost } from "./components/management/ManagementSectionHost";
import { DriverConsole } from "./components/delivery/DriverConsole";
import { DeliveryTracking } from "./components/delivery/DeliveryTracking";
import { DeliveryAdmin } from "./components/delivery/DeliveryAdmin";
import { ThemeToggle, useTheme } from "./components/marketplace/ThemeToggle";
import { TOUCH } from "./components/marketplace/ProductCard";
import { fetchMe, resetTokenFromLocation, signOut, type MeResponse } from "./lib/authApi";
import { fetchManagementAccess, type ManagementAccess } from "./lib/managementApi";

type View =
  | "home"
  | "support"
  | "admin"
  | "support-admin"
  | "analytics"
  // YENE-STORE platform (Sections 10-55).
  | "marketplace"
  // Section 41: one mall and the stores registered inside it.
  | "mall"
  | "store"
  | "product"
  | "cart"
  | "business-dashboard"
  | "signin"
  | "reset-password"
  | "verify"
  // Sections 10/41: the administrator's view of who may rent a mall counter.
  | "rental-queue"
  // Sections 10/41: the administrator's control surface for malls.
  | "mall-admin"
  | "management"
  // YENE DELIVERY. Hash routes rather than nested ones, because this app's
  // router is a single table and a new view has to be added to it - which is
  // deliberate, so a delivery screen cannot be reached by a forgotten link.
  | "driver"
  | "track-delivery"
  | "delivery-admin";

/**
 * Every view and the hash that selects it.
 *
 * This table is the single source of truth for routing. It exists because the
 * previous implementation used a fall-through `if/else` chain in `go()` that
 * only covered six of the eleven views: anything not named fell through to
 * `""`, which `readView()` maps to "marketplace". The visible symptom was that
 * the Sign in, Sign up and Cart buttons silently returned to the marketplace
 * instead of opening their screens.
 */
const VIEW_HASHES: Record<View, string> = {
  home: "#/home",
  support: "#/support",
  admin: "#/admin",
  "support-admin": "#/support-admin",
  analytics: "#/analytics",
  marketplace: "#/marketplace",
  mall: "#/mall",
  store: "#/store",
  product: "#/product",
  cart: "#/cart",
  "business-dashboard": "#/business",
  signin: "#/signin",
  "reset-password": "#/reset-password",
  verify: "#/verify",
  "rental-queue": "#/rental-queue",
  "mall-admin": "#/mall-admin",
  management: "#/management",
  driver: "#/driver",
  "track-delivery": "#/track-delivery",
  "delivery-admin": "#/delivery-admin",};

/**
 * Maps a location hash to a view.
 *
 * `#/store/<subdomain>` and `#/product/<id>` are matched on their prefix so a
 * deep link survives a refresh with the right item selected.
 */
/** The delivery to track, from `#/track-delivery/<id>`. */
function readDeliveryId(): string {
  const hash = window.location.hash;
  if (hash.startsWith("#/track-delivery/")) {
    const value = decodeURIComponent(hash.slice("#/track-delivery/".length).trim());
    if (value) return value;
  }
  return "";
}

function readView(): View {
  const hash = window.location.hash;
  if (hash.startsWith("#/support-admin")) return "support-admin";
  if (hash.startsWith("#/analytics")) return "analytics";
  if (hash.startsWith("#/support")) return "support";
  if (hash.startsWith("#/admin")) return "admin";
  if (hash.startsWith("#/marketplace")) return "marketplace";
  if (hash.startsWith("#/mall")) return "mall";
  if (hash.startsWith("#/store")) return "store";
  if (hash.startsWith("#/product")) return "product";
  if (hash.startsWith("#/cart")) return "cart";
  if (hash.startsWith("#/business")) return "business-dashboard";
  if (hash.startsWith("#/signin")) return "signin";
  // Checked BEFORE the bare `#/signin` prefix above would matter only if the two
  // shared a prefix; they do not, but the reset link is matched here because it
  // carries a query string - `#/reset-password?token=...` - that must still land
  // on the reset screen rather than falling through to the marketplace.
  if (hash.startsWith("#/reset-password")) return "reset-password";
  if (hash.startsWith("#/verify")) return "verify";
  if (hash.startsWith("#/rental-queue")) return "rental-queue";
  if (hash.startsWith("#/mall-admin")) return "mall-admin";
  if (hash.startsWith("#/management")) return "management";
  if (hash.startsWith("#/track-delivery")) return "track-delivery";
  if (hash.startsWith("#/delivery-admin")) return "delivery-admin";
  if (hash.startsWith("#/driver")) return "driver";
  // No hash at all: open the marketplace. YENE-STORE is an e-commerce
  // platform, so the storefront is the front door, not the support bot. This
  // is what makes the bare site URL land on the shopping experience.
  if (!hash || hash === "#" || hash === "#/") return "marketplace";
  return "home";
}

/** Restores the selected store from a `#/store/<subdomain>` deep link. */
function readSubdomain(): string {
  const hash = window.location.hash;
  if (hash.startsWith("#/store/")) {
    const value = decodeURIComponent(hash.slice("#/store/".length)).trim();
    if (value) return value;
  }
  return "greencoffee.yene-store.com";
}

/** Restores the selected mall from a `#/mall/<slug>` deep link (Section 41). */
function readMallSlug(): string {
  const hash = window.location.hash;
  if (hash.startsWith("#/mall/")) {
    const value = decodeURIComponent(hash.slice("#/mall/".length)).trim();
    if (value) return value;
  }
  return "dembel-city-center";
}

/** Restores the selected product from a `#/product/<id>` deep link. */
function readProductId(): string {
  const hash = window.location.hash;
  if (hash.startsWith("#/product/")) {
    const value = decodeURIComponent(hash.slice("#/product/".length)).trim();
    if (value) return value;
  }
  return "p-001";
}

/**
 * Reads the token out of a `#/reset-password?token=...` link.
 *
 * Read from the hash rather than the query string because this app routes on
 * the hash, and because a fragment is never sent to the server - so the token
 * does not end up in an access log on the way in. `resetTokenFromLocation`
 * owns the parsing; this only supplies the hash.
 */
function readResetToken(): string | null {
  return resetTokenFromLocation(window.location.hash);
}

/**
 * The open section from `#/management/<key>`, or null on the overview.
 *
 * The key is read from the HASH and then checked against the server's own module
 * list before anything renders. That order matters: a hand-typed key that the
 * caller has no permission for is simply not found, so the URL cannot be used to
 * reach a module the server would have withheld.
 */
function readManagementSection(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith("#/management/")) return null;
  const key = decodeURIComponent(hash.slice("#/management/".length).split(/[?&]/)[0] ?? "").trim();
  return key || null;
}

export default function App() {
  const [view, setView] = useState<View>(readView);
  // Section 41: which mall is open, restored from the hash on reload.
  const [mallSlug, setMallSlug] = useState<string>(readMallSlug);
  const [token, setToken] = useState<string | null>(null);
  // The reset token lives in the URL, so it is state rather than a read at
  // render: a `hashchange` has to be able to replace it, which is what happens
  // when someone opens a second reset link in the same tab.
  const [resetToken, setResetToken] = useState<string | null>(readResetToken);

  useEffect(() => {
    const onHashChange = () => {
      setView(readView());
      setResetToken(readResetToken());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  /**
   * Routes. The support views (Sections 1-9) are untouched; the platform views
   * (Sections 10-55) are additional destinations, not replacements.
   */
  const go = (next: View) => {
    // Set the state as well as the hash. Assigning an identical hash does not
    // fire `hashchange`, so without this a tap on the control for the view you
    // are already on would do nothing at all.
    window.location.hash = VIEW_HASHES[next] ?? VIEW_HASHES.home;
    setView(next);
  };

  // -------------------------------------------------------------------------
  // YENE-STORE platform (Sections 10-55)
  //
  // The cart lives here rather than in a store, because it is genuinely shared
  // across stores: a customer can hold products from several businesses at once
  // (Section 20), and a cart that lived inside one store would have to be copied
  // between them.
  // -------------------------------------------------------------------------
  const [cart, setCart] = useState<CartLine[]>([]);
  // The wallet drawer, opened by the header badge. `open` rather than a stored
  // wallet, because the panel re-reads the balance itself on every open - so
  // the figure is current and nothing stale is cached here.
  const [walletOpen, setWalletOpen] = useState(false);
  // The cart is a DRAWER, not a page: closed by default, and it overlays
  // whatever the shopper is looking at so browsing is never interrupted.
  // `#/cart` remains the full checkout flow, reached from the drawer.
  const [cartOpen, setCartOpen] = useState(false);
  // Seeded from the hash so that reloading or sharing `#/store/<subdomain>` or
  // `#/product/<id>` restores the same item rather than the hard-coded default.
  const [subdomain, setSubdomain] = useState<string>(readSubdomain);
  const [productId, setProductId] = useState<string>(readProductId);

  // -------------------------------------------------------------------------
  // Identity and appearance
  //
  // `me` is SERVER state, read from the HTTP-only session cookie. The browser
  // never holds a businessId and never chooses one - it asks who it is and
  // renders the answer (specification sections 10, 12, 20).
  // -------------------------------------------------------------------------
  const { theme, toggle: toggleTheme } = useTheme();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");

  // Whether the header offers the Management System. This is a UI convenience
  // only: the server re-checks on every call, so hiding the button enforces
  // nothing (ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§8). It is fetched once per sign-in rather than per render.
  const [managementAccess, setManagementAccess] = useState<ManagementAccess | null>(null);

  const loadManagementAccess = useCallback(() => {
    fetchManagementAccess().then(setManagementAccess).catch(() => setManagementAccess(null));
  }, []);

  useEffect(loadManagementAccess, [loadManagementAccess]);

  const loadMe = useCallback(() => {
    fetchMe().then(setMe).catch(() => setMe({ authenticated: false }));
  }, []);

  useEffect(loadMe, [loadMe]);

  async function handleSignOut() {
    await signOut().catch(() => undefined);
    setMe({ authenticated: false });
    // Drop the cached decision so the Management System button disappears
    // immediately rather than lingering until the next full reload.
    setManagementAccess(null);
  }

  const addToCart = (line: { productId: string; name: string; price: number; quantity: number }) => {
    setCart((current) => {
      const existing = current.find((item) => item.productId === line.productId);
      if (existing) {
        return current.map((item) =>
          item.productId === line.productId
            ? { ...item, quantity: item.quantity + line.quantity }
            : item,
        );
      }
      return [...current, line];
    });
  };

  /**
   * Set an absolute quantity, or remove the line at zero.
   *
   * A single path for "less of this": the stepper and the remove button both
   * end up here, so they cannot disagree about what quantity 0 means.
   */
  const setCartQuantity = (productId: string, quantity: number) => {
    setCart((current) => {
      if (quantity <= 0) return current.filter((item) => item.productId !== productId);
      return current.map((item) =>
        item.productId === productId ? { ...item, quantity } : item,
      );
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((current) => current.filter((item) => item.productId !== productId));
  };

  const openStore = (target: string) => {
    // The marketplace passes a business id here; resolve it to a subdomain.
    const sub = target.includes(".") ? target : `${target}.yene-store.com`;
    setSubdomain(sub);
    // The subdomain travels in the hash, so this link can be bookmarked,
    // shared and reloaded.
    window.location.hash = `#/store/${encodeURIComponent(sub)}`;
    setView("store");
  };

  const openProduct = (id: string) => {
    setProductId(id);
    window.location.hash = `#/product/${encodeURIComponent(id)}`;
    setView("product");
  };

  /**
   * Section 41: open one mall and the stores registered inside it.
   *
   * The slug travels in the hash for the same reason the subdomain does - the
   * link is bookmarkable and survives a reload, which is what makes "the stores
   * in Dembel City Center" a thing someone can send to a friend.
   */
  const openMall = (slug: string) => {
    setMallSlug(slug);
    window.location.hash = `#/mall/${encodeURIComponent(slug)}`;
    setView("mall");
  };

  /**
   * The cart overlay, shared by every shopping screen.
   *
   * `disabled` on the checkout, sign-in and management screens: those have
   * their own full-page layouts, and a floating drawer on top of them would be
   * an overlay over an overlay. The header cart button is also hidden there, so
   * this stays consistent rather than becoming a second way in.
   */
  const cartItemCount = cart.reduce((total, line) => total + line.quantity, 0);
  const cartDisabled =
    view === "cart" ||
    view === "signin" ||
    view === "reset-password" ||
    view === "verify" ||
    view === "rental-queue" ||
    view === "mall-admin" ||
    view === "management" ||
    // YENE DELIVERY screens are full-page applications in their own right - a
    // courier console and a dispatch centre - so they carry no cart overlay.
    view === "driver" ||
    view === "track-delivery" ||
    view === "delivery-admin";

  const cartLayer = (
    <>
      <CartPill
        itemCount={cartItemCount}
        onOpen={() => setCartOpen(true)}
      />
      <CartDrawer
        open={cartOpen}
        disabled={cartDisabled}
        lines={cart}
        onClose={() => setCartOpen(false)}
        onSetQuantity={setCartQuantity}
        onRemove={removeFromCart}
        onCheckout={() => {
          setCartOpen(false);
          go("cart");
        }}
      />
      {/* The wallet drawer rides the same layer, so it is reachable from every
          screen that shows the marketplace header. */}
      <WalletPanel open={walletOpen} onClose={() => setWalletOpen(false)} />
    </>
  );

  /** Wrap a shopping screen so the cart overlay travels with it. */
  const withCart = (screen: React.ReactNode) => <>{screen}{cartLayer}</>;

  if (view === "marketplace") {
    return withCart(
      <MarketplaceHome
        cart={cart}
        onOpenProduct={openProduct}
        onOpenStore={openStore}
        onOpenMall={openMall}
        onAddToCart={addToCart}
        onOpenCart={() => setCartOpen(true)}
        onOpenOrders={() => go("business-dashboard")}
        onOpenAccount={() => go("signin")}
        onOpenHelp={() => go("support")}
        onOpenDashboard={() => go("business-dashboard")}
        onNavigate={(target) => go(target)}
        me={me}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignIn={() => {
          setAuthMode("signin");
          go("signin");
        }}
        onSignUp={() => {
          setAuthMode("signup");
          go("signin");
        }}
        onSignOut={handleSignOut}
        onOpenVerification={() => go("verify")}
        onOpenManagement={
          // Only handed down when permitted, so the button has nothing to call
          // for a customer. `?? undefined` also means a network failure hides
          // it rather than offering a route that would 403.
          managementAccess?.canAccess ? () => go("management") : undefined
        }
        onOpenWallet={() => setWalletOpen(true)}
      />
    );
  }

  // Section 41: one mall, with every store registered under it.
  if (view === "mall") {
    return withCart(
      <MallStoresView
        slug={mallSlug}
        onBack={() => go("marketplace")}
        onOpenStore={openStore}
      />,
    );
  }

  if (view === "store") {
    return withCart(
      <StorefrontView
        subdomain={subdomain}
        onBack={() => go("marketplace")}
        onOpenProduct={openProduct}
        onAddToCart={addToCart}
      />
    );
  }

  if (view === "product") {
    return withCart(
      <ProductView productId={productId} onBack={() => go("marketplace")} onAddToCart={addToCart} />,
    );
  }

  if (view === "cart") {
    return (
      <CartAndCheckout
        lines={cart}
        onBack={() => go("marketplace")}
        onOrderPlaced={() => setCart([])}
      />
    );
  }

  if (view === "business-dashboard") {
    return <BusinessDashboard onBack={() => go("marketplace")} />;
  }

  // ---- YENE DELIVERY ----
  // The courier console is mobile-first and self-contained, so it hides the
  // cart overlay: a floating drawer over a courier's job screen would be an
  // overlay over an overlay.
  if (view === "driver") {
    return <DriverConsole onBack={() => go("marketplace")} />;
  }

  if (view === "delivery-admin") {
    return <DeliveryAdmin onBack={() => go("marketplace")} />;
  }

  if (view === "track-delivery") {
    // The delivery id comes from the HASH, never from state, so a tracking link
    // can be bookmarked and shared - and so the id is still checked against the
    // session by the server, which answers 404 for anybody else's delivery.
    return <DeliveryTracking deliveryId={readDeliveryId()} onBack={() => go("marketplace")} />;
  }

  if (view === "management") {
    // A section is open. The key is read from the hash, never from state, so a
    // link to `#/management/orders` survives a refresh and can be shared.
    const sectionKey = readManagementSection();
    const sectionModule = sectionKey
      ? managementAccess?.modules.find((entry) => entry.key === sectionKey)
      : undefined;
    // An unknown or withheld key is a dead end rather than a crash: a stale
    // bookmark, or a hand-typed key the server never offered this caller, should
    // fall back to the overview rather than crash or leak that it exists.
    if (sectionModule) {
      return (
        <ManagementSectionHost
          moduleKey={sectionModule.key}
          modules={managementAccess!.modules}
          onBack={() => go("management")}
          onOpenSupport={() => go("support")}
        />
      );
    }
    // No section - the Management System overview. No short-circuit for "not
    // signed in" here: the Management System screen asks the server itself and
    // shows the exact reason - an expired session and a permission failure are
    // different messages (ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§15). Redirecting to sign-in would hide that.
    return (
      <ManagementSystem
        onExit={() => go("marketplace")}
        onOpenStorefront={() => {
          // The business's own public store, resolved from the session. Never
          // from a URL the visitor typed, so there is no cross-tenant path.
          if (managementAccess?.business) openStore(managementAccess.business.id);
          else go("marketplace");
        }}
        onSignOut={handleSignOut}
      />
    );
  }

  if (view === "verify") {
    // The verification screen is only meaningful for a signed-in person. With
    // no session there is nothing to verify, so send them to sign in first
    // rather than showing a form whose every request would 401.
    if (!me?.authenticated) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-yene-bg px-4 text-center">
          <p className="text-[14px] text-yene-text">Please sign in to verify your identity.</p>
          <button
            type="button"
            onClick={() => {
              setAuthMode("signin");
              go("signin");
            }}
            className="min-h-11 rounded-button bg-yene-accent px-5 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
          >
            Sign in
          </button>
        </div>
      );
    }
    return (
      <VerificationProfile
        onBack={() => go("marketplace")}
        onDone={() => go("signin")}
      />
    );
  }

  // Sections 10/41: the two administrator surfaces - who may rent a counter, and
  // the malls themselves.
  //
  // Gated on the CLIENT only as a convenience. The server independently refuses
  // every one of these routes to a non-administrator, so hiding the page here is
  // usability, not security.
  if (view === "rental-queue" || view === "mall-admin") {
    if (!me?.authenticated) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-yene-bg px-4 text-center">
          <p className="text-[14px] text-yene-text">Please sign in to continue.</p>
          <button
            type="button"
            onClick={() => {
              setAuthMode("signin");
              go("signin");
            }}
            className="min-h-11 rounded-button bg-yene-accent px-5 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong"
          >
            Sign in
          </button>
        </div>
      );
    }
    if (!me.isSuperAdmin) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-yene-bg px-4 text-center">
          <p className="text-[14px] text-yene-text">
            This area is restricted to Yene Business Group administrators.
          </p>
          <button
            type="button"
            onClick={() => go("marketplace")}
            className="min-h-11 rounded-button border border-yene-line px-5 text-sm text-yene-muted transition-colors hover:border-yene-accent"
          >
            Back to the marketplace
          </button>
        </div>
      );
    }
    return view === "mall-admin" ? <MallAdminPage /> : <RentalQueuePage />;
  }

  if (view === "reset-password") {
    // The destination of the link in the reset email. It is deliberately NOT
    // wrapped in the sign-in screen: someone who followed a link from their
    // inbox has not chosen a tab, and asking them to pick one first is a
    // pointless extra step on the path back into their own account.
    return (
      <div className="min-h-dvh bg-yene-bg">
        <header className="border-b border-yene-line-soft">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 tablet:px-6">
            <button
              type="button"
              onClick={() => go("marketplace")}
              className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button px-2.5 text-[13px] font-medium text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
            >
              Back to YENE-STORE
            </button>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[1600px] justify-center px-4 py-10 tablet:px-6">
          <div className="w-full max-w-md">
            <div className="rounded-card border border-yene-line-soft bg-yene-surface p-6">
              <ResetPassword
                token={resetToken}
                onDone={() => {
                  setAuthMode("signin");
                  go("signin");
                }}
              />
            </div>
            <p className="mt-4 text-center text-[12px] text-yene-faint">
              YENE-STORE &middot; Powered by Yene Business Group
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (view === "signin") {
    return (
      <AuthScreen
        mode={authMode}
        onClose={() => go("marketplace")}
        onSwitchMode={setAuthMode}
        onAuthenticated={() => {
          loadMe();
          // A first-time customer goes straight to identity verification,
          // because that is the next thing they need before renting a store.
          go("marketplace");
        }}
      />
    );
  }

  const changeIdentity = (next: string | null) => {
    setStoredToken(next);
    setToken(next);
  };

  if (view === "support-admin") {
    return (
      <div className="min-h-dvh bg-yene-bg">
        <SupportDashboardPage onBack={() => go("home")} />
      </div>
    );
  }

  if (view === "analytics") {
    return (
      <div className="min-h-dvh bg-yene-bg">
        <SupportAnalyticsPage onBack={() => go("home")} />
      </div>
    );
  }

  if (view === "admin") {
    return (
      <div className="min-h-dvh bg-yene-bg">
        <KnowledgeAdminPage onBack={() => go("home")} />
      </div>
    );
  }

  if (view === "support") {
    return (
      <div className="min-h-dvh bg-yene-bg">
        <SupportPage onBack={() => go("home")} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="border-b border-yene-line-soft">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yene-accent-dim">
              <Store size={16} className="text-yene-accent" />
            </div>
            <span className="text-sm font-semibold text-yene-text">
              {BRAND.name}
            </span>
          </div>
          {/* Section 42: the nav wraps rather than overflowing once the phone
              is this wide. min-h-11 keeps every header control at the 44px
              minimum touch target. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => go("marketplace")}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
            >
              <Store size={14} />
              Marketplace
            </button>
            <button
              type="button"
              onClick={() => go("business-dashboard")}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-yene-line px-3 text-[13px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
            >
              <LayoutDashboard size={14} /> Business dashboard
            </button>
            <button
              type="button"
              onClick={() => go("support-admin")}
              className="inline-flex min-h-11 items-center rounded-lg border border-yene-line px-3 text-[13px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
            >
              Support dashboard
            </button>
            <button
              type="button"
              onClick={() => go("analytics")}
              className="inline-flex min-h-11 items-center rounded-lg border border-yene-line px-3 text-[13px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
            >
              <BarChart3 size={14} /> Analytics
            </button>
            <button
              type="button"
              onClick={() => go("admin")}
              className="inline-flex min-h-11 items-center rounded-lg border border-yene-line px-3 text-[13px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
            >
              KB admin
            </button>
            <button
              type="button"
              onClick={() => go("support")}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-yene-line px-3 text-[13px] font-medium text-yene-text transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
            >
              <Headset size={14} />
              Full support page
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-yene-text sm:text-4xl">
          Customer support that never guesses.
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-yene-muted">
          This is the integration host for {BRAND.aiName}. Use the floating
          button in the bottom-right corner, or open the full support page. The
          assistant answers strictly from the official knowledge base and offers
          a {BRAND.company} support agent whenever it cannot.
        </p>

        <button
          type="button"
          onClick={() => go("marketplace")}
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-yene-accent px-5 text-sm font-semibold text-yene-on-accent hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
        >
          <Store size={16} />
          Open the YENE-STORE marketplace
        </button>

        <div className="mt-10 max-w-2xl rounded-2xl border border-yene-line-soft bg-yene-surface p-5">
          <h2 className="text-sm font-semibold text-yene-text">
            Demo: simulate a signed-in user
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-yene-muted">
            Only works with <code className="text-yene-accent">AUTH_MODE=development</code>.
            The token is verified server-side, and the business it resolves to is
            the only account the assistant can read.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              { label: "Guest", value: null },
              { label: "Business owner", value: "dev:green-coffee" },
              { label: "Employee", value: "dev:staff-member" },
              { label: "Customer", value: "dev:shopper" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => changeIdentity(option.value)}
                className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
                  token === option.value
                    ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                    : "border-yene-line bg-yene-raised text-yene-muted hover:text-yene-text"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-10 text-[12.5px] text-yene-faint">
          {BRAND.company} &middot; {SUPPORT_CONTACT.phone} &middot;{" "}
          {SUPPORT_CONTACT.email}
        </p>
      </main>

      <SupportWidget onOpenFullPage={() => go("support")} />
    </div>
  );
}
