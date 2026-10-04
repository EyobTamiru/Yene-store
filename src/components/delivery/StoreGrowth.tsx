/**
 * ============================================================================
 *  STORE GROWTH - storage, media upload, promotion and renting a slot out
 * ============================================================================
 *
 *  The merchant-facing screen for the four Section 55 additions. One component
 *  because they share a single question - "how much can this business do?" -
 *  and splitting them across four screens would hide that answer.
 *
 *  THE UPLOAD PATH IS THE PART THAT MATTERS
 *  ---------------------------------------
 *  A refusal must say WHY and WHAT TO DO, because "413 Payload Too Large" with no
 *  explanation is how a merchant concludes the platform is broken. Every refusal
 *  from the server carries a written reason, and it is shown verbatim.
 *
 *  BASE64 IS USED, AND SAID SO
 *  ---------------------------
 *  The project has no multipart parser and a 64 KB global JSON limit. Base64 is
 *  ~33% larger than the file, so the client checks the DECODED size against the
 *  package allowance before it uploads, rather than discovering the refusal after
 *  a slow round trip.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, usageFraction } from "../../platform/storage";
import { PACKAGES, packageCards } from "../../platform/packages";
import type { PackageId } from "../../platform/types";
import { TOUCH_TARGET, formatEtbUi } from "../platform/primitives";

interface Props {
  businessId: string;
  packageId: PackageId;
  onBack: () => void;
  onOpenPackageCards?: () => void;
}

type Tab = "storage" | "promote" | "rent";

interface Usage {
  packageId: PackageId;
  packageName: string;
  usedBytes: number;
  limitBytes: number;
  used: string;
  limit: string;
  summary: string;
  fraction: number;
  overQuota: boolean;
}

interface UploadResult {
  id: string;
  originalFilename: string;
  kind: string;
  bytes: number;
  url: string;
  storage: { summary: string; fraction: number; warning: string | null };
}

export function StoreGrowth({ businessId, packageId, onBack, onOpenPackageCards }: Props) {
  const [tab, setTab] = useState<Tab>("storage");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadUsage = useCallback(async () => {
    try {
      const response = await fetch("/api/media/usage", { credentials: "same-origin" });
      const body = (await response.json()) as Usage & { error?: string };
      if (response.ok) setUsage(body);
      else setError(body.error ?? "Could not read your storage usage.");
    } catch {
      setError("Could not reach Yene-Store.");
    }
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const upload = useCallback(
    async (files: FileList) => {
      setBusy(true);
      setError(null);
      const added: UploadResult[] = [];

      for (const file of Array.from(files)) {
        // The decoded size is what the server charges the quota, so it is what
        // the client checks first - there is no point spending a round trip to
        // be told the file is too big.
        const approxBytes = Math.round((file.size * 4) / 3);
        try {
          const data = await toBase64(file);
          const response = await fetch("/api/media/upload", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folder: "product",
              filename: file.name,
              contentType: file.type,
              data,
              dataLength: file.size,
            }),
          });
          const body = (await response.json()) as UploadResult & { error?: string; storage?: Usage };
          if (!response.ok) {
            // The server's own words, verbatim - it knows the exact limit and how
            // much is left, and this client does not.
            setError(`${file.name}: ${body.error ?? "Upload failed."}`);
            continue;
          }
          added.push(body);
          if (body.storage?.summary) {
            setUsage((current) => (current ? { ...current, ...body.storage } : current));
          }
        } catch {
          setError(`${file.name} could not be read.`);
        }
      }

      if (added.length > 0) setResults((current) => [...added, ...current]);
      await loadUsage();
      setBusy(false);
    },
    [loadUsage],
  );

  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="border-b border-yene-line-soft">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4">
          <button type="button" onClick={onBack} className={`${TOUCH_TARGET} rounded-xl px-3 text-[13px] text-yene-muted`}>
            &larr; Back
          </button>
          <h1 className="text-sm font-semibold text-yene-text">Grow your store</h1>
          <span className="text-[12px] text-yene-muted">{PACKAGES[packageId]?.name ?? packageId}</span>
        </div>
      </header>

      <nav className="border-b border-yene-line-soft">
        <div className="mx-auto flex max-w-4xl">
          {(["storage", "promote", "rent"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`${TOUCH_TARGET} flex-1 px-3 text-[13px] font-medium capitalize ${
                tab === key ? "text-yene-accent" : "text-yene-muted"
              }`}
            >
              {key === "rent" ? "Rent to others" : key === "promote" ? "Promote" : "Storage & media"}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-5">
        {error && <p className="rounded-xl bg-yene-danger/10 px-3 py-2 text-[12.5px] text-yene-danger">{error}</p>}

        {tab === "storage" && (
          <>
            {usage ? (
              <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-[13px] font-semibold text-yene-text">Your storage</h2>
                  <span className="text-[13px] font-semibold text-yene-accent">{usage.summary}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-yene-raised">
                  <div
                    className={`h-full ${usage.overQuota ? "bg-yene-danger" : usage.fraction > 0.9 ? "bg-yene-warn" : "bg-yene-accent"}`}
                    style={{ width: `${Math.round(usageFraction(usage.usedBytes, usage.limitBytes) * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-[12px] text-yene-muted">
                  {usage.packageName} includes {usage.limit}.{" "}
                  {usage.overQuota
                    ? "You are over the allowance because your package changed. Delete files, or upgrade - your existing uploads keep working."
                    : "Deleting a file frees space immediately."}
                </p>
                {onOpenPackageCards && (
                  <button
                    type="button"
                    onClick={onOpenPackageCards}
                    className={`${TOUCH_TARGET} mt-2 rounded-xl border border-yene-line px-4 text-[13px] text-yene-accent`}
                  >
                    Upgrade for more storage
                  </button>
                )}
              </section>
            ) : (
              <p className="text-[13px] text-yene-muted">Reading your storage usageâ€¦</p>
            )}

            <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
              <h2 className="text-[13px] font-semibold text-yene-text">Upload images and video</h2>
              <p className="mt-1 text-[12.5px] text-yene-muted">
                PNG, JPG, WebP, GIF or SVG for images. MP4, WebM or OGV for video.
              </p>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/ogg"
                onChange={(event) => {
                  if (event.target.files) void upload(event.target.files);
                  event.target.value = "";
                }}
                className="mt-3 block w-full text-[12px] text-yene-muted file:mr-3 file:min-h-10 file:rounded-xl file:border file:border-yene-line file:bg-yene-raised file:px-4 file:text-[12px] file:text-yene-text"
              />
              {busy && <p className="mt-2 text-[12px] text-yene-muted">Uploadingâ€¦</p>}

              {results.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {results.map((result) => (
                    <li key={result.id} className="flex items-center gap-3 rounded-xl border border-yene-line-soft p-2">
                      {result.kind === "image" ? (
                        <img src={result.url} alt="" className="h-12 w-12 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-yene-raised text-lg">â–¶</span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] text-yene-text">{result.originalFilename}</p>
                        <p className="text-[11.5px] text-yene-faint">{formatBytes(result.bytes)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {results.some((result) => result.storage.warning) && (
                <p className="mt-3 rounded-xl bg-yene-warn/10 px-3 py-2 text-[12px] text-yene-warn">
                  {results.find((result) => result.storage.warning)?.storage.warning}
                </p>
              )}
            </section>
          </>
        )}

        {tab === "promote" && (
          <section className="space-y-3">
            <p className="text-[12.5px] text-yene-muted">
              Every Yene package can promote a store. Paid placements, featured
              banners and campaign credits are billed from your package.
            </p>
            {packageCards().map((card) => (
              <div
                key={card.id}
                className={`rounded-2xl border p-4 ${
                  card.id === packageId ? "border-yene-accent bg-yene-accent-dim" : "border-yene-line-soft bg-yene-surface"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[13px] font-semibold text-yene-text">{card.name}</h3>
                  <span className="text-[13px] font-semibold text-yene-accent">{card.priceLabel}</span>
                </div>
                <p className="mt-1 text-[12px] text-yene-muted">{card.tagline}</p>
                <p className="mt-1 text-[11.5px] text-yene-faint">
                  Storage included: {card.id === "super" ? "250 GB - 1 TB+" : formatBytes(PACKAGES[card.id].limits.storageBytes)}
                </p>
                {card.id === packageId && (
                  <p className="mt-2 text-[11.5px] font-medium text-yene-accent">Your current package</p>
                )}
              </div>
            ))}
            {onOpenPackageCards && (
              <button
                type="button"
                onClick={onOpenPackageCards}
                className={`${TOUCH_TARGET} w-full rounded-xl bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent`}
              >
                Change package
              </button>
            )}
          </section>
        )}

        {tab === "rent" && <RentOutTab businessId={businessId} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Renting a slot out
// ---------------------------------------------------------------------------

interface RentalListing {
  id: string;
  title: string;
  description: string;
  monthlyRentEtb: number;
  ownerShareBps: number;
  status: string;
  minimumPackageId: string;
  occupied: boolean;
  incomePerMonth?: number;
}

function RentOutTab({ businessId }: { businessId: string }) {
  const [mine, setMine] = useState<RentalListing[]>([]);
  const [open, setOpen] = useState<{ id: string; title: string; description: string; monthlyRentEtb: number; minimumPackageId: string; owner: string }[]>([]);
  const [form, setForm] = useState({ title: "", description: "", monthlyRentEtb: "0", ownerShareBps: "0" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  void businessId;

  const load = useCallback(async () => {
    try {
      const [own, directory] = await Promise.all([
        fetch("/api/platform/rental-out/mine", { credentials: "same-origin" }).then((r) => r.json()),
        fetch("/api/platform/rental-out/directory", { credentials: "same-origin" }).then((r) => r.json()),
      ]);
      setMine(own.listings ?? []);
      setOpen(directory.listings ?? []);
    } catch {
      setError("Could not load rental listings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const offer = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/rental-out", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          monthlyRentEtb: Number(form.monthlyRentEtb) || 0,
          ownerShareBps: Math.round((Number(form.ownerShareBps) || 0) * 100),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not create the listing.");
        return;
      }
      setForm({ title: "", description: "", monthlyRentEtb: "0", ownerShareBps: "0" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const end = async (id: string) => {
    await fetch(`/api/platform/rental-out/${encodeURIComponent(id)}/end`, {
      method: "POST",
      credentials: "same-origin",
    });
    await load();
  };

  return (
    <div className="space-y-5">
      {error && <p className="rounded-xl bg-yene-danger/10 px-3 py-2 text-[12.5px] text-yene-danger">{error}</p>}

      <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
        <h2 className="text-[13px] font-semibold text-yene-text">Offer a storefront slot</h2>
        <p className="mt-1 text-[12.5px] text-yene-muted">
          Rent part of your storefront to another business and earn a share of
          their Yene package every month. You keep your own account, customers
          and subscription.
        </p>
        <div className="mt-3 space-y-2">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Slot name, e.g. Bole counter, front"
            className="min-h-11 w-full rounded-xl border border-yene-line bg-yene-bg px-3 text-[13px] text-yene-text"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe the slot"
            rows={3}
            className="w-full rounded-xl border border-yene-line bg-yene-bg px-3 py-2 text-[13px] text-yene-text"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.monthlyRentEtb}
              onChange={(e) => setForm({ ...form, monthlyRentEtb: e.target.value })}
              inputMode="numeric"
              placeholder="Monthly rent (ETB)"
              className="min-h-11 rounded-xl border border-yene-line bg-yene-bg px-3 text-[13px] text-yene-text"
            />
            <input
              value={form.ownerShareBps}
              onChange={(e) => setForm({ ...form, ownerShareBps: e.target.value })}
              inputMode="numeric"
              placeholder="Your share %"
              className="min-h-11 rounded-xl border border-yene-line bg-yene-bg px-3 text-[13px] text-yene-text"
            />
          </div>
          <button
            type="button"
            onClick={offer}
            disabled={busy || form.title.trim().length < 3}
            className={`${TOUCH_TARGET} w-full rounded-xl bg-yene-accent text-[13px] font-semibold text-yene-on-accent disabled:opacity-50`}
          >
            {busy ? "Publishingâ€¦" : "Put it on offer"}
          </button>
        </div>
      </section>

      {mine.length > 0 && (
        <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
          <h2 className="text-[13px] font-semibold text-yene-text">Your slots</h2>
          <ul className="mt-2 space-y-2">
            {mine.map((listing) => (
              <li key={listing.id} className="flex items-center justify-between gap-3 rounded-xl border border-yene-line-soft p-2">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] text-yene-text">{listing.title}</p>
                  <p className="text-[11.5px] text-yene-faint">
                    {formatEtbUi(listing.monthlyRentEtb)}/month
                    {listing.occupied ? ` Â· earns ${formatEtbUi(listing.incomePerMonth ?? 0)}/month` : " Â· available"}
                  </p>
                </div>
                {listing.occupied && (
                  <button
                    type="button"
                    onClick={() => end(listing.id)}
                    className="min-h-8 rounded-lg border border-yene-line px-2 text-[11.5px] text-yene-muted"
                  >
                    End tenancy
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-yene-line-soft bg-yene-surface p-4">
        <h2 className="text-[13px] font-semibold text-yene-text">Slots available on Yene</h2>
        {open.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-yene-muted">No slots are on offer right now.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {open.map((listing) => (
              <li key={listing.id} className="rounded-xl border border-yene-line-soft p-2">
                <p className="text-[12.5px] text-yene-text">{listing.title}</p>
                <p className="text-[11.5px] text-yene-faint">
                  {listing.owner} &middot; {formatEtbUi(listing.monthlyRentEtb)}/month &middot; needs {listing.minimumPackageId}+
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** A File as base64, without the data-URL prefix the server strips anyway. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
