/**
 * ============================================================================
 *  AMHARIC - አማርኛ (Section 51)
 * ============================================================================
 *
 *  THE PREVIOUS AMHARIC CATALOGUE WAS CORRUPTED
 *  --------------------------------------------
 *  All 91 strings were mojibake - UTF-8 bytes that had been read as Latin-1 and
 *  written back out - so the file contained 688 Latin-1 supplement characters
 *  and ZERO Ethiopic code points. A customer selecting Amharic saw garbage.
 *
 *  It shipped because the only test checked that the Amharic string DIFFERED
 *  from the English one, which corrupted text satisfies perfectly well. This
 *  catalogue is written from scratch in real Ethiopic, and
 *  `verify-i18n.ts` now asserts the script, so the same corruption cannot ship
 *  twice.
 *
 *  PROVENANCE: reviewed. These were translated against the English source and
 *  checked for meaning, not merely for presence.
 */

export const AMHARIC: Record<string, string> = {
  // ---- navigation ----
  "nav.home": "መነሻ",
  "nav.categories": "ምድቦች",
  "nav.search": "ፈልግ",
  "nav.cart": "የግዢ ምርት",
  "nav.orders": "ትዕዛዞች",
  "nav.account": "መለያ",
  "nav.help": "እገዛና ድጋፍ",
  "nav.wishlist": "የምስጠት ዝርዝር",
  "nav.store": "ድርጅት",
  "nav.promotions": "የማስታወቂያ እቅሳቦች",
  "nav.dashboard": "የተግባር አጋድራፍ",

  // ---- preferences ----
  "lang.label": "መነሻ",
  "currency.label": "ገንዘብ",

  // ---- hero ----
  "hero.title": "ሁሉም የትድርሽዎ እርታዎች በአንድ ቦታ",
  "hero.cta": "መሸጣት ይጀምሩ",

  // ---- marketplace sections ----
  "section.flashDeals": "ፈጣን ሽያጮች",
  "section.trending": "ተደብቀው የሚሆኑ ፕሮዳክቶች",
  "section.newArrivals": "አዲስ የደረሱ",
  "section.bestSellers": "ከፍተኛ የተሸጡ",
  "section.recommended": "ለእርስዎ የተመከሩ",
  "section.featuredBusinesses": "የተለዩ ድርጅቶች",
  "section.spotlight": "የድርጅት ማጉራት",
  "section.promotions": "የማስታወቂያ እቅሳቦች",
  "section.categories": "በምድብ ይግዙ",

  // ---- product ----
  "product.addToCart": "ወደ የግዢ ምርት ይጨምሩ",
  "product.buyNow": "አሁን ይግዙ",
  "product.outOfStock": "በክምች የለም",
  "product.inStock": "በክምች አለ",
  "product.reviews": "ግምገማዎች",
  "product.writeReview": "ግምገማ ይጻፉ",
  "product.verifiedPurchase": "የተረጋገጠ ግዢ",
  "product.seller": "ሻይሎ አዲስ",

  // ---- cart ----
  "cart.title": "የእርስዎ የግዢ ምርት",
  "cart.empty": "የግዢ ምርትዎ ባዶ ነው።",
  "cart.subtotal": "ንዑስ ድምር",
  "cart.delivery": "ማድረስ",
  "cart.tax": "ግብር",
  "cart.total": "ጠቅላላ",
  "cart.checkout": "ወደ ክፍያ ይቀጥሉ",
  "cart.storeGroup": "ከዚህ ይገዛዋል",

  // ---- checkout ----
  "checkout.step1": "የደንበኛ መረጃ",
  "checkout.step2": "የማድረስ አድራሻ",
  "checkout.step3": "የማድረስ ዘዴ",
  "checkout.step4": "የክፍያ ዘዴ",
  "checkout.step5": "የትዕዛዝ ግምገማ",
  "checkout.step6": "ትዕዛዝ ይሰጡ",
  "checkout.placeOrder": "ትዕዛዝ ይሰጡ",
  "checkout.cod": "በጥቅም በእጅ ይክፈል",
  "checkout.chapa": "በChapa በመስመር ይክፈል",
// ---- order ----
  "order.status": "ሁኔታ",
  "order.myOrders": "የእኔ ትዕዛዞች",
  "order.number": "ትዕዛዝ",

  // ---- packages & billing ----
  "pkg.current": "የአሁን ጥቅል",
  "pkg.status": "ሁኔታ",
  "pkg.renewal": "የእድሳት ቀን",
  "pkg.manage": "ጥቅሉን ያስተዳድሩ",
  "pkg.upgrade": "ያሳድጉ",
  "pkg.change": "ጥቅል ቀይር",
  "pkg.history": "የቀድሞ ታሪክ",
  "pkg.invoices": "የክፍያ ደረሰኞች",
  "pkg.locked": "ይህ ክፍል በጥቅልዎ አልተከፈተም",
  "pkg.noRefund": "የተከፈለበት ገንዘብ የማይመለስ በመሆነት፣ የጥቅል ማሻሻያ በወዲያውን ገንዘብ ያስገባል።",

  // ---- business dashboard ----
  "dashboard.store": "ድርጅት",
  "dashboard.products": "ፕሮዳክቶች",
  "dashboard.categories": "ምድቦች",
  "dashboard.orders": "ትዕዛዞች",
  "dashboard.customers": "ደንበኛዎች",
  "dashboard.inventory": "ክምች",
  "dashboard.promotions": "የማስታወቂያ እቅሳቦች",
  "dashboard.analytics": "ትንተና",
  "dashboard.employees": "ሰራሳኔዎች",
  "dashboard.expenses": "ወጪዎች",
  "dashboard.suppliers": "አቅራቾች",
  "dashboard.purchases": "ግዢዎች",
  "dashboard.reports": "መዝገቦች",
  "dashboard.users": "ተጠቃሚዎች",
  "dashboard.roles": "ምድሮች",
  "dashboard.billing": "ጥቅሎችና ክፍያ",
  "dashboard.support": "ድጋፍ",
  "dashboard.settings": "ቅንብሮች",

  // ---- authentication ----
  "auth.signIn": "ግባ",
  "auth.signOut": "ውጣ",

  // ---- common ----
  "common.close": "ዝጋ",
  "common.save": "አስቀምጥ",
  "common.cancel": "ሰርዝ",
  "common.loading": "በመጫን ላይ…",
  "common.retry": "እንደገና ሞክር",
  "common.etb": "ብር",

  // ---- custom systems ----
  "custom.erpName": "የይኔ በጥራት የሚዘጋጀ የትድርሽ አመራሪና ዕቃ ኢንቬንቶሪ ሲስተም",
  "custom.erpDescription":
    "በYene ቢዝኔስ ግሩፕ በሚዘጋጅ የተለመደ የንግድ አመራሪና የዕቃ ኢንቬንቶሪ መድረክ፣ ከዘመናዊ ERP የስራ ፍሰቶችን ተንስቶ በደንበኛው የአገልግሎት ፍላጎት ተስማሚቷል።",
  "custom.requestPackage": "ልዩ ጥቅል ይጠይቁ",
};
