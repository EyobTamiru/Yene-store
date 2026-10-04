const base = "http://127.0.0.1:3581";
function session() {
  let cookie = "";
  return async function call(method, path, body) {
    const res = await fetch(base + path, { method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
    const s = res.headers.get("set-cookie"); if (s) cookie = s.split(";")[0];
    const t = await res.text();
    try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, json: null, text: t }; }
  };
}
const courier = session(), customer = session(), admin = session();
await courier("POST", "/api/auth/signin", { identifier: "lumiere_perfume@yene-store.com", password: "lumiere123" });
await customer("POST", "/api/auth/signin", { identifier: "lumiere_perfume@yene-store.com", password: "lumiere123" });
await admin("POST", "/api/auth/signin", { identifier: "super_admin@yene-store.com", password: "admin@123" });

const offers = await courier("GET", "/api/delivery/driver/offers");
const offer = (offers.json?.offers ?? [])[0];
const id = offer.delivery.id;

// --- FRAUD: a stale/absent offer id is invisible, and a replay is refused ---
console.log("A. bogus offer accept  ", (await courier("POST", "/api/delivery/driver/offers/ofr-x/accept", {})).status);
const acc = await courier("POST", `/api/delivery/driver/offers/${offer.offerId}/accept`, {});
console.log("B. ACCEPT              ", acc.status, "-> " + acc.json?.delivery?.status);
console.log("   replay               ", (await courier("POST", `/api/delivery/driver/offers/${offer.offerId}/accept`, {})).status, "(refused)");

// --- FRAUD: the customer cannot drive the courier's steps ---
console.log("C. customer advance    ", (await customer("POST", "/api/delivery/driver/active/advance", {})).status, "|", (await customer("POST", "/api/delivery/driver/active/advance", {})).json?.error);

// --- THE COURIER WALKS THE STATE MACHINE ---
const step = async () => {
  const r = await courier("GET", "/api/delivery/driver/active");
  return { status: r.json?.delivery?.status, next: r.json?.nextAction?.label };
};
console.log("D. now at              ", (await step()).status);

for (const label of ["Start travelling to pickup", "I have arrived at pickup", "Confirm pickup", "Start delivery", "I am arriving"]) {
  const before = await step();
  if (before.next?.label !== label) { console.log("   UNEXPECTED, next is:", before.next?.label); break; }
  const r = await courier("POST", "/api/delivery/driver/active/advance", {});
  console.log("   " + label.padEnd(28), "->", r.json?.delivery?.status ?? r.json?.error);
}

// --- "advance" CANNOT skip to DELIVERED: that edge is not offered ---
console.log("E. next step offered   ", JSON.stringify((await step()).next));
const skip = await courier("POST", "/api/delivery/driver/active/advance", {});
console.log("   trying to complete   ", skip.status, "|", skip.json?.error ?? "(blocked: proof required)");
console.log("DELIVERY_ID=" + id);
