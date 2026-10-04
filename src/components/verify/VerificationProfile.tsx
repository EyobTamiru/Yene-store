/**
 * ============================================================================
 *  IDENTITY VERIFICATION SCREEN
 * ============================================================================
 *
 *  Why this screen exists: anyone may sign up and SHOP as a customer. To RENT A
 *  STORE on YENE-STORE, the person must prove who they are with a Fayda ID and
 *  a TIN number. The Fayda card photographs (front and back) are optional, as
 *  specified; the ID number and the TIN are required.
 *
 *  WHAT THIS SCREEN DELIBERATELY DOES NOT DO
 *  -----------------------------------------
 *  It never says "verified" on its own. Every status shown here is read from
 *  the server, and the only two things that can produce `verified` are a real
 *  external verifier response and a super-admin approval. If no verifier is
 *  configured the screen says so plainly and shows `pending review` - a fake
 *  green tick on a government ID check would defeat the purpose of the
 *  feature.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, BadgeCheck, Check, Clock, Loader2, Upload } from "lucide-react";
import {
  documentUrl,
  fetchVerification,
  submitVerificationProfile,
  uploadDocument,
  VerifyError,
  type VerificationState,
} from "../../lib/verifyApi";
import { TOUCH } from "../marketplace/ProductCard";
import { ThemeToggle, useTheme } from "../marketplace/ThemeToggle";

const STATUS_COPY: Record<
  VerificationState["status"],
  { label: string; tone: "muted" | "warn" | "good" | "bad"; help: string }
> = {
  "not-started": {
    label: "Not started",
    tone: "muted",
    help: "Add your Fayda ID and TIN to rent a store on YENE-STORE.",
  },
  "pending-review": {
    label: "Pending review",
    tone: "warn",
    help: "We have your details. They are checked before you can rent a store.",
  },
  verified: {
    label: "Verified",
    tone: "good",
    help: "Your identity is verified. You can rent a store on YENE-STORE.",
  },
  rejected: {
    label: "Not approved",
    tone: "bad",
    help: "Please correct the details below and submit again.",
  },
};

const TONE_CLASS = {
  muted: "border-yene-line-soft bg-yene-raised text-yene-muted",
  warn: "border-yene-warn/40 bg-yene-warn/10 text-yene-warn",
  good: "border-yene-accent/40 bg-yene-accent-dim text-yene-accent",
  bad: "border-yene-danger/40 bg-yene-danger/10 text-yene-danger",
} as const;

const STATUS_ICON = {
  "not-started": Clock,
  "pending-review": Clock,
  verified: BadgeCheck,
  rejected: AlertTriangle,
} as const;

export function VerificationProfile({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: () => void;
}) {
  const { theme, toggle } = useTheme();
  const [state, setState] = useState<VerificationState | null>(null);
  const [verifierConfigured, setVerifierConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"front" | "back" | null>(null);

  const [faydaId, setFaydaId] = useState("");
  const [tinNumber, setTinNumber] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const load = useCallback(() => {
    fetchVerification()
      .then((result) => {
        setState(result.verification);
        setVerifierConfigured(result.externalVerifierConfigured);
        setFaydaId((value) => value || result.verification.faydaId || "");
        setTinNumber((value) => value || result.verification.tinNumber || "");
        setFullName((value) => value || result.verification.fullName || "");
        setPhone((value) => value || result.verification.phone || "");
      })
      .catch((cause) => setError((cause as VerifyError).userMessage))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function submitProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await submitVerificationProfile({ faydaId, tinNumber, fullName, phone });
      setState(result.verification);
      setNotice(result.message);
    } catch (cause) {
      setError((cause as VerifyError).userMessage);
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(side: "front" | "back", file: File | null) {
    if (!file) return;
    setUploading(side);
    setError(null);
    try {
      const result = await uploadDocument(side, file);
      setState(result.verification);
      setNotice(side === "front" ? "Front photo saved." : "Back photo saved.");
    } catch (cause) {
      setError((cause as VerifyError).userMessage);
    } finally {
      setUploading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-yene-bg">
        <Loader2 size={22} className="animate-spin text-yene-accent" aria-hidden />
      </div>
    );
  }

  const status = state?.status ?? "not-started";
  const copy = STATUS_COPY[status];
  const StatusIcon = STATUS_ICON[status];

  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="border-b border-yene-line-soft">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 tablet:px-6">
          <button
            type="button"
            onClick={onBack}
            className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button px-2.5 text-[13px] font-medium text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            <ArrowLeft size={16} aria-hidden />
            Back
          </button>
          <ThemeToggle theme={theme} onToggle={toggle} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-10 tablet:px-6">
        <h1 className="text-xl font-semibold tracking-tight text-yene-text">
          Verify your identity
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-yene-muted">
          You can browse and shop as a customer straight away. To rent a store on
          YENE-STORE, add your Fayda ID and TIN number so sellers and buyers know who
          they are dealing with.
        </p>

        <div className={`mt-6 flex items-start gap-2.5 rounded-button border px-3 py-2.5 ${TONE_CLASS[copy.tone]}`}>
          <StatusIcon size={17} aria-hidden className="mt-0.5 shrink-0" />
          <div>
            <p className="text-[13px] font-semibold">{copy.label}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed opacity-90">{copy.help}</p>
            {state?.reason && status === "rejected" && (
              <p className="mt-1 text-[12.5px] font-medium">{state.reason}</p>
            )}
          </div>
        </div>

        {verifierConfigured === false && (
          <p className="mt-3 rounded-button border border-yene-line-soft bg-yene-raised px-3 py-2.5 text-[12px] leading-relaxed text-yene-muted">
            Automatic Fayda/TIN checking is not connected on this server yet, so your
            submission will be confirmed by a Yene Business Group administrator. Your
            details are still recorded and you can rent a store once it is approved.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-button border border-yene-danger/40 bg-yene-danger/10 px-3 py-2 text-[12.5px] text-yene-danger">
            <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-3 flex items-start gap-2 rounded-button border border-yene-accent/40 bg-yene-accent-dim px-3 py-2 text-[12.5px] text-yene-accent">
            <Check size={15} aria-hidden className="mt-0.5 shrink-0" />
            {notice}
          </p>
        )}

        <form onSubmit={submitProfile} className="mt-6 rounded-card border border-yene-line-soft bg-yene-surface p-5">
          <h2 className="text-sm font-semibold text-yene-text">Your details</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-yene-muted">
            Enter these exactly as they appear on your documents.
          </p>

          <div className="mt-4">
            <label className="block text-[12px] font-medium text-yene-muted" htmlFor="v-name">
              Full name <span className="text-yene-faint">(as printed)</span>
            </label>
            <input
              id="v-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Abebe Bekele"
              className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 text-sm text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none`}
            />
          </div>

          <div className="mt-3">
            <label className="block text-[12px] font-medium text-yene-muted" htmlFor="v-fayda">
              Fayda ID <span className="text-yene-danger">*</span>
            </label>
            <input
              id="v-fayda"
              value={faydaId}
              onChange={(event) => setFaydaId(event.target.value.toUpperCase())}
              placeholder="AB1234567890"
              required
              className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 font-mono text-sm text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none`}
            />
          </div>

          <div className="mt-3">
            <label className="block text-[12px] font-medium text-yene-muted" htmlFor="v-tin">
              TIN Number <span className="text-yene-danger">*</span>
            </label>
            <input
              id="v-tin"
              value={tinNumber}
              onChange={(event) => setTinNumber(event.target.value)}
              placeholder="0012345678"
              required
              className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 font-mono text-sm text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none`}
            />
          </div>

          <div className="mt-3">
            <label className="block text-[12px] font-medium text-yene-muted" htmlFor="v-phone">
              Phone <span className="text-yene-faint">(optional)</span>
            </label>
            <input
              id="v-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+251 ..."
              className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 text-sm text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none`}
            />
          </div>

          <button
            type="submit"
            disabled={busy || !faydaId.trim() || !tinNumber.trim()}
            className={`${TOUCH} mt-5 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent disabled:opacity-60`}
          >
            {busy ? "Submitting..." : "Submit for verification"}
          </button>
        </form>

        <div className="mt-4 rounded-card border border-yene-line-soft bg-yene-surface p-5">
          <h2 className="text-sm font-semibold text-yene-text">Fayda card photos</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-yene-muted">
            Optional. Clear photos of the front and back speed up verification, but you
            can submit without them.
          </p>

          <div className="mt-4 grid gap-3 tablet:grid-cols-2">
            {(["front", "back"] as const).map((side) => (
              <DocumentSlot
                key={side}
                side={side}
                has={side === "front" ? Boolean(state?.hasFront) : Boolean(state?.hasBack)}
                uploading={uploading === side}
                onPick={(file) => handleFile(side, file)}
              />
            ))}
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-yene-faint">
            JPEG, PNG or WebP, up to 4 MB each. Photos are stored privately and are only
            shown to you and to Yene Business Group administrators reviewing your request.
          </p>
        </div>

        {state?.approvedForRental && (
          <button
            type="button"
            onClick={onDone}
            className={`${TOUCH} mt-6 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            Continue to rent a store
          </button>
        )}
      </main>
    </div>
  );
}

/** One upload slot, with a preview of what is already stored. */
function DocumentSlot({
  side,
  has,
  uploading,
  onPick,
}: {
  side: "front" | "back";
  has: boolean;
  uploading: boolean;
  onPick: (file: File | null) => void;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const label = side === "front" ? "Front of card" : "Back of card";

  return (
    <div className="rounded-button border border-dashed border-yene-line p-3">
      <p className="text-[12px] font-medium text-yene-muted">{label}</p>

      {has && !previewFailed ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-yene-line-soft">
          <img
            src={documentUrl(side)}
            alt={`${label} preview`}
            onError={() => setPreviewFailed(true)}
            className="h-32 w-full bg-yene-raised object-cover"
          />
        </div>
      ) : (
        <div className="mt-2 flex h-32 items-center justify-center rounded-lg bg-yene-raised text-yene-faint">
          {uploading ? (
            <Loader2 size={20} className="animate-spin" aria-hidden />
          ) : (
            <Upload size={20} aria-hidden />
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <label className={`${TOUCH} inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-button border border-yene-line px-2 text-[12px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus-within:ring-2 focus-within:ring-yene-accent`}>
          {has ? "Replace" : "Choose photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              onPick(event.target.files?.[0] ?? null);
              // Reset so choosing the same file twice still fires a change.
              event.target.value = "";
            }}
          />
        </label>
        {has && (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-yene-accent">
            <Check size={13} aria-hidden /> Saved
          </span>
        )}
      </div>
    </div>
  );
}

