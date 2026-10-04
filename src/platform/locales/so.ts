/**
 * ============================================================================
 *  SOMALI - Af-Soomaali (Section 51)
 * ============================================================================
 *
 *  PROVENANCE: MACHINE-ASSISTED - NEEDS REVIEW
 *  ------------------------------------------
 *  Machine-assisted from the English source; not yet reviewed by a fluent Somali
 *  speaker. A STARTING POINT, reported as such in the admin screen.
 *
 *  Somali is written in a Latin orthography, so the script check here is weaker
 *  than for Ge'ez languages and deliberately so: a Somali sentence legitimately
 *  contains English product names, numbers and "ETB", all of which are Latin.
 *  Rejecting a Latin script would reject correct Somali.
 */

export const SOMALI: Record<string, string> = {
  // ---- navigation ----
  "nav.home": "Hoy",
  "nav.categories": "Qaybaha",
  "nav.search": "Raadi",
  "nav.cart": "Karto",
  "nav.orders": "Dalabka",
  "nav.account": "Xisaabta",
  "nav.help": "Caawimaad iyo taageero",
  "nav.wishlist": "Liiska danbeedka",
  "nav.store": "Dukaanka",
  "nav.promotions": "Soo-saaraha",
  "nav.dashboard": "Khadka ganacsiga",

  // ---- preferences ----
  "lang.label": "Luqadda",
  "currency.label": "Lacagta",

  // ---- hero ----
  "hero.title": "Wax kasta oo aad iibiso, halkan ayay ku jiraan",
  "hero.cta": "Ku bilaabso iibka",

  // ---- marketplace sections ----
  "section.flashDeals": "Khaybaarad Degdeg ah",
  "section.trending": "Alaabta duug ah",
  "section.newArrivals": "Alaabta cusub",
  "section.bestSellers": "Alaabta ugu iibsanayso",
  "section.recommended": "Loo talagalay",
  "section.featuredBusinesses": "Dukaannada la xuldo",
  "section.spotlight": "Dukan in iftiimaada uu shaqeeyo",
  "section.promotions": "Soo-saaraha",
  "section.categories": "Dooro qaybta",

  // ---- product ----
  "product.addToCart": "Karto dheji",
  "product.buyNow": "Hadda iibso",
  "product.outOfStock": "Ma jiro",
  "product.inStock": "Waa jira",
  "product.reviews": "Dib u eegis",
  "product.writeReview": "Qor dib u eegis",
  "product.verifiedPurchase": "Iib la xaqiijiyay",
  "product.seller": "Iibay",

  // ---- cart ----
  "cart.title": "Kartaada",
  "cart.empty": "Kartaada waa maran.",
  "cart.subtotal": "Wadarta",
  "cart.delivery": "Bixin",
  "cart.tax": "Caddaal",
  "cart.total": "Wadarta guud",
  "cart.checkout": "U gudb",
  "cart.storeGroup": "Ka iibso",

  // ---- checkout ----
  "checkout.step1": "Macluumaadka macaamiisha",
  "checkout.step2": "Manhajka bixinta",
  "checkout.step3": "Habka bixinta",
  "checkout.step4": "Habka lacag bixinta",
  "checkout.step5": "Hubinta dalabka",
  "checkout.step6": "Dalabka",
  "checkout.placeOrder": "Dalabka",
  "checkout.cod": "Lacagta gacanta",
  "checkout.chapa": "Ku bixi internetka Chapa",

  // ---- order ----
  "order.status": "Xaaladda",
  "order.myOrders": "Dalabkayga",
  "order.number": "Dalab",

  // ---- packages & billing ----
  "pkg.current": "Qaaybta Hadda",
  "pkg.status": "Xaaladda",
  "pkg.renewal": "Maalinta cusubaynta",
  "pkg.manage": "Maamul qaaybta",
  "pkg.upgrade": "Sii sar",
  "pkg.change": "Bedel qaaybta",
  "pkg.history": "Taariikhda",
  "pkg.invoices": "Rasmada lacag-bixinta",
  "pkg.locked": "Tan qaaybta kuma furmin",
  "pkg.noRefund": "Lacag la bixiyay ma celinno; bedelka qaaybta waxay ku qaadanaysaa lacag cusub.",

  // ---- business dashboard ----
  "dashboard.store": "Dukaanka",
  "dashboard.products": "Alaabta",
  "dashboard.categories": "Qaybaha",
  "dashboard.orders": "Dalabka",
  "dashboard.customers": "Macamiisha",
  "dashboard.inventory": "Bakhaarka",
  "dashboard.promotions": "Soo-saaraha",
  "dashboard.analytics": "Falanqaynta",
  "dashboard.employees": "Shaqaalaha",
  "dashboard.expenses": "Kharashidka",
  "dashboard.suppliers": "Iibiyayaasha",
  "dashboard.purchases": "Iibka",
  "dashboard.reports": "Warbixinnada",
  "dashboard.users": "Isticmaallayaasha",
  "dashboard.roles": "Dookhyada",
  "dashboard.billing": "Qaaybaha iyo bixinta",
  "dashboard.support": "Taageero",
  "dashboard.settings": "Dejimaha",

  // ---- authentication ----
  "auth.signIn": "Soo gal",
  "auth.signOut": "Bax",

  // ---- common ----
  "common.close": "Xir",
  "common.save": "Kaydi",
  "common.cancel": "Jabi",
  "common.loading": "Waa la soo raraya…",
  "common.retry": "Mar kale isku day",
  "common.etb": "Birr",

  // ---- custom systems ----
  "custom.erpName": "Yene ERP & Inventory System",
  "custom.erpDescription":
    "Nidaamyo hawlo maamul iyo khad lagu haysto oo Yene Business Group gaareyay, oo laga soo qaatay hab-raacaanka ERP ee casliga ah, kuna hagaajiyay baahida hawlooda macaamiisha.",
  "custom.requestPackage": "Codso qaayb gaar ah",
};