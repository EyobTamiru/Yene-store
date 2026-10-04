/**
 * ============================================================================
 *  OROMO - Afaan Oromoo (Section 51)
 * ============================================================================
 *
 *  PROVENANCE: MACHINE-ASSISTED - NEEDS REVIEW
 *  ------------------------------------------
 *  These strings were machine-assisted from the English source and have NOT
 *  been reviewed by a fluent Oromo speaker. They are a STARTING POINT, and the
 *  admin screen reports them as such.
 *
 *  WHY IT IS MARKED RATHER THAN SHIPPED AS FINAL
 *  ---------------------------------------------
 *  A wrong translation is worse than no translation: an Oromo-speaking customer
 *  shown "Saajjetto" for "Order" cannot tell whether the platform is broken or
 *  the word is simply wrong, and they may act on the misunderstanding. English
 *  they can read and check. So the machinery labels this honestly, and
 *  `verify-i18n.ts` asserts the label - a machine-assisted catalogue cannot
 *  quietly promote itself to reviewed.
 *
 *  Oromo orthography uses Latin letters with diacritics (ä, ee, ñ, ç...), so
 *  the script check for this catalogue is deliberately WEAKER than for Ge'ez:
 *  it rejects only a stray Ge'ez string pasted in by mistake.
 */

export const OROMO: Record<string, string> = {
  // ---- navigation ----
  "nav.home": "Mana",
  "nav.categories": "Kutaa",
  "nav.search": "Barbaadi",
  "nav.cart": "Saanduu",
  "nav.orders": "Galmee",
  "nav.account": "Akkaawuntii",
  "nav.help": "Gargaarsa",
  "nav.wishlist": "Liis wannaa",
  "nav.store": "Dukaana",
  "nav.promotions": "Sochiiwwaa",
  "nav.dashboard": "Daashboardii daldalaa",

  // ---- preferences ----
  "lang.label": "Afaan",
  "currency.label": "Qabeenyuu",

  // ---- hero ----
  "hero.title": "Hunda qabeenyuu daldalaa kee irratti argama",
  "hero.cta": "Daldalaa eegalii",

  // ---- marketplace sections ----
  "section.flashDeals": "Daldalaa daataa",
  "section.trending": "Qabeenyuudda dhugaa",
  "section.newArrivals": "Qabeenyuudda haaraa",
  "section.bestSellers": "Qabeenyuudda olaanaa",
  "section.recommended": "Siifattiif taanaa",
  "section.featuredBusinesses": "Dukaana olaanaa",
  "section.spotlight": "Dukaana siifattiif argama",
  "section.promotions": "Sochiiwwaa",
  "section.categories": "Kutaa taajjaj",

  // ---- product ----
  "product.addToCart": "Saanduu dabalati",
  "product.buyNow": "AAmmaa ofi",
  "product.outOfStock": "Harkaan hin jiru",
  "product.inStock": "Harkaa jira",
  "product.reviews": "Yaadannoo",
  "product.writeReview": "Yaadannoo barbaadhi",
  "product.verifiedPurchase": "Ol'aaamee ragaa'i",
  "product.seller": "Iyyee",

  // ---- cart ----
  "cart.title": "Saanduu kee",
  "cart.empty": "Saanduu kee duwwaa dha.",
  "cart.subtotal": "Waldaa",
  "cart.delivery": "Barbaa",
  "cart.tax": "Kataa",
  "cart.total": "Walqixa",
  "cart.checkout": "Kaffaltii kutaa itti fufi",
  "cart.storeGroup": "Karraa kanaan",

  // ---- checkout ----
  "checkout.step1": "Ragaa mootummaa",
  "checkout.step2": "Manzalee baraa",
  "checkout.step3": "Tarree barbaa",
  "checkout.step4": "Tarree kaffaltii",
  "checkout.step5": "Galmee ilaalama",
  "checkout.step6": "Galmee kennama",
  "checkout.placeOrder": "Galmee kennami",
  "checkout.cod": "Naannoo harki irratti",
  "checkout.chapa": "Kaffaltii interneetii Chapa",

  // ---- order ----
  "order.status": "Haala",
  "order.myOrders": "Galmeewwan akkii",
  "order.number": "Galmee",

  // ---- packages & billing ----
  "pkg.current": "Paakeejjii ammaa",
  "pkg.status": "Haala",
  "pkg.renewal": "Guyya haaromsa",
  "pkg.manage": "Paakeejjii bulchi",
  "pkg.upgrade": "Oolchi",
  "pkg.change": "Paakeejjii jijjiiri",
  "pkg.history": "Taariikhduma",
  "pkg.invoices": "Ragaa kaffaltii",
  "pkg.locked": "Kutaa kooni paakee keessatti hin banne",
  "pkg.noRefund": "Qabeenyuu dabarfamtu lama hin deebi'u; paakee jijjiiruunnisa maallaqa dabarsa.",

  // ---- business dashboard ----
  "dashboard.store": "Dukaana",
  "dashboard.products": "Qabeenyuudda",
  "dashboard.categories": "Kutaa",
  "dashboard.orders": "Galmee",
  "dashboard.customers": "Maatii",
  "dashboard.inventory": "Bakka bu'u",
  "dashboard.promotions": "Sochiiwwaa",
  "dashboard.analytics": "Qabeessuu",
  "dashboard.employees": "Hojjetonni",
  "dashboard.expenses": "Kharashidha",
  "dashboard.suppliers": "Dhiiftota",
  "dashboard.purchases": "Barbaadhiffannoi",
  "dashboard.reports": "Gabaasa",
  "dashboard.users": "Faydaamuu",
  "dashboard.roles": "Qabiyye",
  "dashboard.billing": "Paakeejjii kaffaltii",
  "dashboard.support": "Gargaarsa",
  "dashboard.settings": "Qindaa'ina",

  // ---- authentication ----
  "auth.signIn": "Seera",
  "auth.signOut": "Baajaa",

  // ---- common ----
  "common.close": "Cufi",
  "common.save": "Ol'aa'i",
  "common.cancel": "Haqi",
  "common.loading": "Fe'aa jira…",
  "common.retry": "Irra deebi'i",
  "common.etb": "Qaallee",

  // ---- custom systems ----
  "custom.erpName": "Yene ERP & Inventory System",
  "custom.erpDescription":
    "Yene Business Group dhaabbate iftiinsaa daldalaa hubatee yoo barbaachuu irratti ERP seeraa ammaa irratti fudhattee, barbaachuu hojii maatii kennuu irratti qophaa'e.",
  "custom.requestPackage": "Paakee gaaranaa kaffali",
};
