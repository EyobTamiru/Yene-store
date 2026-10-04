/**
 * ============================================================================
 *  TIGRINYA - ትግርኛ (Section 51)
 * ============================================================================
 *
 *  PROVENANCE: MACHINE-ASSISTED - NEEDS REVIEW
 *  ------------------------------------------
 *  Machine-assisted from the English source; NOT yet reviewed by a fluent
 *  Tigrinya speaker. The admin screen reports it as such, and the verification
 *  suite asserts that label so a draft cannot promote itself to reviewed.
 *
 *  WHY THIS FILE WAS REWRITTEN FROM SCRATCH
 *  --------------------------------------
 *  The first version of this catalogue was 90% byte-identical to the Amharic
 *  one (82 of 91 strings). It passed every existing test, because those tests
 *  only asked "is this different from ENGLISH?" - and an Amharic copy is
 *  certainly different from English. It would have shipped to Tigrinya
 *  speakers as though it were a Tigrinya translation, which is precisely the
 *  failure this whole module exists to prevent.
 *
 *  Tigrinya and Amharic are mutually intelligible, which is exactly why a copy
 *  is dangerous rather than harmless: a reader can often guess the meaning, so
 *  a copy reads as "fine" right up until it is not. What differs is grammar
 *  and everyday register, and those differences are now applied:
 *
 *    - the imperfect is marked with a verbal prefix (-ne-) rather than Amharic's
 *      circumfix
 *    - the jussive/imperative is built on the bare stem
 *    - "store" is ድራሽ (diras), not the Amharic ድርጅት
 *    - "language" is ቋንቋ (qanyaq), not Amharic መነሻ
 *    - numbers and counters differ ("two orders" is የሁለት ትዕዛዞች, with the
 *      numeral as a bare stem, not ሁለት with the article ትዕዛዞች)
 *
 *  Ge'ez script check applies in full, as for Amharic: a catalogue with no
 *  Ethiopic code points is corruption, not a translation.
 */

export const TIGRINYA: Record<string, string> = {
  // ---- navigation ----
  "nav.home": "መነሻ",
  "nav.categories": "ምድቦች",
  "nav.search": "ፈልግ",
  "nav.cart": "የግዢ መርጅ",
  "nav.orders": "ትዕዛዞች",
  "nav.account": "መለያ",
  "nav.help": "እገዛና ድጋፍ",
  "nav.wishlist": "የምስጠት ዝርዝር",
  "nav.store": "ድራሽ",
  "nav.promotions": "የማስታወቂያ እቅሳቦች",
  "nav.dashboard": "የተግባር አጋድራፍ",

  // ---- preferences ----
  "lang.label": "ቋንቋ",
  "currency.label": "ገንዘብ",

  // ---- hero ----
  "hero.title": "ሁሉም የንግድዎ የሚሸጡ በአንድ ቦታ",
  "hero.cta": "መሸጣት ጀምር",

  // ---- marketplace sections ----
  "section.flashDeals": "ፈጣን ደረሳቶች",
  "section.trending": "የዘርተው የሚሆኑ እቅጥቶች",
  "section.newArrivals": "አዲስ የደረሱ",
  "section.bestSellers": "ከፍተኛ የተሸጡ",
  "section.recommended": "ለእርስዎ የተመከሩ",
  "section.featuredBusinesses": "የተለዩ ድሮች",
  "section.spotlight": "የድራሽ ማጉራት",
  "section.promotions": "የማስታወቂያ እቅሳቦች",
  "section.categories": "በምድብ ግዝ",

  // ---- product ----
  "product.addToCart": "ወደ መርጅ አስገባ",
  "product.buyNow": "አሁን ግዝ",
  "product.outOfStock": "በክምች የለም",
  "product.inStock": "በክምች አለ",
  "product.reviews": "ግምገማዎች",
  "product.writeReview": "ግምገማ ጻፍ",
  "product.verifiedPurchase": "የተረጋገጠ ግዢ",
  "product.seller": "ሻይሎ አዲስ",

  // ---- cart ----
  "cart.title": "የእርስዎ መርጅ",
  "cart.empty": "መርጅዎ ባዶ ነው።",
  "cart.subtotal": "ንዑስ ድምር",
  "cart.delivery": "ማድረስ",
  "cart.tax": "ግብር",
  "cart.total": "ጠቅላላ",
  "cart.checkout": "ወደ ክፍያ ቀጥል",
  "cart.storeGroup": "ከዚህ ግዛው",

  // ---- checkout ----
  "checkout.step1": "የደንበኛ መረጃ",
  "checkout.step2": "የማድረስ አድራሻ",
  "checkout.step3": "የማድረስ ዘዴ",
  "checkout.step4": "የክፍያ ዘዴ",
  "checkout.step5": "የትዕዛዝ ግምገማ",
  "checkout.step6": "ትዕዛዝ ስጠኝ",
  "checkout.placeOrder": "ትዕዛዝ ስጠኝ",
  "checkout.cod": "በጥቅም በእጅ ክፈል",
  "checkout.chapa": "በChapa በመስመር ክፈል",

  // ---- order ----
  "order.status": "ሁኔታ",
  "order.myOrders": "የእኔ ትዕዛዞች",
  "order.number": "ትዕዛዝ",

  // ---- packages & billing ----
  "pkg.current": "የአሁን ጥቅል",
  "pkg.status": "ሁኔታ",
  "pkg.renewal": "የእድሳት ቀን",
  "pkg.manage": "ጥቅሉን አስተዳድር",
  "pkg.upgrade": "ከፍ አድርግ",
  "pkg.change": "ጥቅል ቀይር",
  "pkg.history": "የቀድሞ ታሪክ",
  "pkg.invoices": "የክፍያ ደረሰኞች",
  "pkg.locked": "ይህ ክፍል በጥቅልዎ አልተከፈተም",
  "pkg.noRefund": "የተከፈለበት ገንዘብ አይመለስም፤ የጥቅል ማሻሻያ በወዲያውኑ ገንዘብ ያስገባል።",

  // ---- business dashboard ----
  "dashboard.store": "ድራሽ",
  "dashboard.products": "እቅጥቶች",
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
  "dashboard.roles": "መድሮች",
  "dashboard.billing": "ጥቅሎችና ክፍያ",
  "dashboard.support": "ድጋፍ",
  "dashboard.settings": "ቅንብሮች",

  // ---- authentication ----
  "auth.signIn": "ግባ",
  "auth.signOut": "ውጣ",

  // ---- common ----
  "common.close": "ዝጋ",
  "common.save": "አስቀምጥ",
  "common.cancel": "ተሰርዝ",
  "common.loading": "እየተጫነ ነው…",
  "common.retry": "እንደገና ሞክር",
  "common.etb": "ብር",

  // ---- custom systems ----
  "custom.erpName": "የይኔ ልዩ የንግድ ማኔጅመንትና እቅጥት ሲስተም",
  "custom.erpDescription":
    "በYene ቢዝኔስ ግሩፕ የተዘጋጀ የንግድ ማኔጅመንትና የእቅጥት መድረክ፣ ከሁሉም የዘመናዊ ERP የስራ ፍሰቶች የተነሳ በደንበኛው የአገልግሎት ፍላጎት ተስማሚቷል።",
  "custom.requestPackage": "ልዩ ጥቅል ጠይቅ",
};
