/**
 * ============================================================================
 *  AuthScreen - Sign in and Sign up (specification section 18)
 * ============================================================================
 *
 *  Both are real flows against `/api/auth`, not a mock. Section 18 asks for
 *  exactly this shape:
 *
 *    Step 1   email address            [ Send Verification Code ]
 *    Step 2   "We sent a code to..."   [ _ _ _ _ _ _ ]  [ Verify & Sign In ]
 *             countdown                Didn't receive it? [ Resend Code ]
 *
 *  FOUR THINGS THIS SCREEN GETS RIGHT
 *  -----------------------------------
 *  * It NEVER says whether the email exists. The server's generic message is
 *    shown verbatim, so the UI cannot become an account oracle even if it
 *    wanted to be one.
 *  * The code is six boxes, so a paste lands correctly and each box takes
 *    exactly one digit.
 *  * The countdown runs against the `expiresAt` the SERVER returned, not a
 *    local 10-minute guess, so client and server never disagree about expiry.
 *  * Resend is disabled until a floor of 30s remains, which stops an
 *    impatient double-tap from burning the 5-per-15-minutes limit.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Mail } from "lucide-react";
import {
  AuthError,
  fetchProviders,
  requestCode,
  signInWithGoogle,
  signInWithPassword,
  signUp,
  verifyCode,
} from "../../lib/authApi";
import { fetchMalls, packageCards, type PackageConfigCard } from "../../lib/platformApi";
import type { MallCard } from "../marketplace/types";
import { TOUCH } from "../marketplace/ProductCard";
import { ThemeToggle, useTheme } from "../marketplace/ThemeToggle";
import { PasswordSignIn, GoogleButton } from "./AuthMethods";
import { ForgotPassword } from "./ForgotPassword";

const CODE_LENGTH = 6;
/** Do not offer a resend before this many seconds remain. */
const RESEND_FLOOR_SECONDS = 30;

export type AuthMode = "signin" | "signup";
/** Which sign-in method the Sign in tab is currently showing. */
type SignInMethod = "password" | "code";
/**
 * Which card is on screen. "forgot" replaces the sign-in form entirely rather
 * than opening a dialog, so a reset on a shared computer is not left sitting in
 * a pop-over over the credentials someone else can see.
 */
type AuthPanel = "signin" | "forgot";

export function AuthScreen({
  mode: initialMode,
  onClose,
  onSwitchMode,
  onAuthenticated,
}: {
  mode: AuthMode;
  onClose: () => void;
  onSwitchMode: (mode: AuthMode) => void;
  onAuthenticated: () => void;
}) {
  const { theme, toggle } = useTheme();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [panel, setPanel] = useState<AuthPanel>("signin");
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; subdomain: string } | null>(null);
  // Password is the default; the code flow stays one tap away for anyone
  // without a password, and for accounts created before passwords existed.
  const [method, setMethod] = useState<SignInMethod>("password");
  const [providers, setProviders] = useState<{ google: boolean; googleClientId: string | null }>({
    google: false,
    googleClientId: null,
  });

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const packages = packageCards();

  // Ask the server which federated options it can actually serve, so a disabled
  // Google button is never rendered as if it were broken.
  useEffect(() => {
    fetchProviders()
      .then(setProviders)
      .catch(() => setProviders({ google: false, googleClientId: null }));
  }, []);

  // A new Google Identity Services script is only injected when a client id
  // exists, and only once, so switching tabs does not re-add the tag.
  useEffect(() => {
    if (!providers.google || !providers.googleClientId) return;
    if (document.getElementById("google-identity-services")) return;
    const script = document.createElement("script");
    script.id = "google-identity-services";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, [providers.google, providers.googleClientId]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(
      () => setSecondsLeft((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [secondsLeft]);


  async function sendCode(targetEmail = email) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestCode(targetEmail);
      // The server's own message, shown verbatim on purpose.
      setNotice(result.message);
      setStep(2);
      const expires = result.expiresAt
        ? new Date(result.expiresAt).getTime()
        : Date.now() + 10 * 60_000;
      setSecondsLeft(Math.max(0, Math.floor((expires - Date.now()) / 1000)));
      setDigits(Array(CODE_LENGTH).fill(""));
      setTimeout(() => inputRefs.current[0]?.focus(), 60);
    } catch (cause) {
      setError((cause as AuthError).userMessage ?? "We could not send a code right now.");
    } finally {
      setBusy(false);
    }
  }

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < CODE_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  }

  function onPaste(event: React.ClipboardEvent) {
    event.preventDefault();
    const pasted = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, CODE_LENGTH);
    if (!pasted) return;
    const next = Array(CODE_LENGTH).fill("");
    pasted.split("").forEach((digit, index) => {
      next[index] = digit;
    });
    setDigits(next);
    inputRefs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  }

  async function verify() {
    const code = digits.join("");
    if (code.length !== CODE_LENGTH) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email, code);
      onAuthenticated();
    } catch (cause) {
      setError((cause as AuthError).userMessage ?? "That code could not be verified.");
      setDigits(Array(CODE_LENGTH).fill(""));
      inputRefs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function register(details: SignUpDetails) {
    setBusy(true);
    setError(null);
    try {
      const result = await signUp(details);
      setCreated(result.business);
      await sendCode(details.email);
    } catch (cause) {
      setError((cause as AuthError).userMessage ?? "We could not create that account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-yene-bg">
      <header className="border-b border-yene-line-soft">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 tablet:px-6">
          <button
            type="button"
            onClick={onClose}
            className={`${TOUCH} inline-flex items-center gap-1.5 rounded-button px-2.5 text-[13px] font-medium text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
          >
            <ArrowLeft size={16} aria-hidden />
            Back to YENE-STORE
          </button>
          <ThemeToggle theme={theme} onToggle={toggle} />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] justify-center px-4 py-10 tablet:px-6">
        <div className="w-full max-w-md">
          <div className="rounded-card border border-yene-line-soft bg-yene-surface p-6">
            <div className="mb-5 flex gap-1.5" role="tablist" aria-label="Account">
              {(["signin", "signup"] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  aria-selected={mode === entry}
                  onClick={() => {
                    setMode(entry);
                    setPanel("signin");
                    setError(null);
                    setNotice(null);
                    setCreated(null);
                    setStep(1);
                    onSwitchMode(entry);
                  }}
                  className={`${TOUCH} flex-1 rounded-button border px-3 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
                    mode === entry
                      ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                      : "border-yene-line-soft text-yene-muted hover:text-yene-text"
                  }`}
                >
                  {entry === "signin" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>

            {error && (
              <p
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-button border border-yene-danger/40 bg-yene-danger/10 px-3 py-2 text-[12.5px] text-yene-danger"
              >
                <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            {created && (
              <p className="mb-4 flex items-start gap-2 rounded-button border border-yene-accent/40 bg-yene-accent-dim px-3 py-2 text-[12.5px] text-yene-accent">
                <Check size={15} aria-hidden className="mt-0.5 shrink-0" />
                <span>
                  <strong className="font-semibold">{created.name}</strong> is ready at{" "}
                  <span className="font-mono">{created.subdomain}</span>. Confirm your email to
                  finish.
                </span>
              </p>
            )}

            {panel === "forgot" ? (
              <ForgotPassword
                initialEmail={email}
                onBack={() => {
                  setPanel("signin");
                  setError(null);
                }}
              />
            ) : mode === "signup" && step === 1 ? (
              <SignUpStep packages={packages} busy={busy} onSubmit={register} />
            ) : step === 1 ? (
              <>
                <div className="mb-4 flex gap-1.5" role="tablist" aria-label="Sign-in method">
                  {([
                    { id: "password" as const, label: "Password" },
                    { id: "code" as const, label: "Email code" },
                  ]).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="tab"
                      aria-selected={method === option.id}
                      onClick={() => {
                        setMethod(option.id);
                        setError(null);
                        setNotice(null);
                      }}
                      className={`${TOUCH} flex-1 rounded-button border px-3 text-[12.5px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
                        method === option.id
                          ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                          : "border-yene-line-soft text-yene-muted hover:text-yene-text"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {method === "password" ? (
                  <>
                    <PasswordSignIn
                      onAuthenticated={onAuthenticated}
                      onError={setError}
                      onForgotPassword={(typed) => {
                        // Seed the reset form with whatever was typed, but only
                        // when it looks like an email - a username is not an
                        // address and pre-filling it would be a wrong answer.
                        setEmail(typed.includes("@") ? typed : "");
                        setPanel("forgot");
                        setError(null);
                      }}
                    />
                    {providers.googleClientId && (
                      <>
                        <div className="my-4 flex items-center gap-3">
                          <span className="h-px flex-1 bg-yene-line-soft" />
                          <span className="text-[11.5px] text-yene-faint">or</span>
                          <span className="h-px flex-1 bg-yene-line-soft" />
                        </div>
                        <GoogleButton
                          clientId={providers.googleClientId}
                          onAuthenticated={onAuthenticated}
                          onError={setError}
                        />
                      </>
                    )}
                  </>
                ) : (
                  <EmailStep
                    email={email}
                    setEmail={setEmail}
                    busy={busy}
                    onSubmit={() => sendCode()}
                  />
                )}
              </>
            ) : (
              <CodeStep
                email={email}
                digits={digits}
                setDigit={setDigit}
                onPaste={onPaste}
                inputRefs={inputRefs}
                busy={busy}
                secondsLeft={secondsLeft}
                notice={notice}
                onVerify={verify}
                onResend={() => sendCode()}
                onEditEmail={() => {
                  setStep(1);
                  setNotice(null);
                  setDigits(Array(CODE_LENGTH).fill(""));
                }}
              />
            )}
          </div>

          <p className="mt-4 text-center text-[12px] text-yene-faint">
            YENE-STORE &middot; Powered by Yene Business Group
          </p>
        </div>
      </main>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Step 1 - email
// ---------------------------------------------------------------------------

function EmailStep({
  email,
  setEmail,
  busy,
  onSubmit,
}: {
  email: string;
  setEmail: (value: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h1 className="text-lg font-semibold tracking-tight text-yene-text">Sign in</h1>
      <p className="mt-1 text-[13px] text-yene-muted">
        We will email you a 6-digit verification code. No password to remember.
      </p>

      <label className="mt-5 block text-[12px] font-medium text-yene-muted" htmlFor="auth-email">
        Email address
      </label>
      <input
        id="auth-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@yourbusiness.com"
        className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 text-sm text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none`}
      />

      <button
        type="submit"
        disabled={busy || !email.includes("@")}
        className={`${TOUCH} mt-4 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-surface disabled:opacity-60`}
      >
        {busy ? "Sending..." : "Send Verification Code"}
      </button>
    </form>
  );
}


// ---------------------------------------------------------------------------
// Step 2 - the six-digit code
// ---------------------------------------------------------------------------

function CodeStep({
  email,
  digits,
  setDigit,
  onPaste,
  inputRefs,
  busy,
  secondsLeft,
  notice,
  onVerify,
  onResend,
  onEditEmail,
}: {
  email: string;
  digits: string[];
  setDigit: (index: number, value: string) => void;
  onPaste: (event: React.ClipboardEvent) => void;
  inputRefs: React.RefObject<Array<HTMLInputElement | null>>;
  busy: boolean;
  secondsLeft: number;
  notice: string | null;
  onVerify: () => void;
  onResend: () => void;
  onEditEmail: () => void;
}) {
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const canResend = secondsLeft <= RESEND_FLOOR_SECONDS;

  return (
    <div>
      <h1 className="text-lg font-semibold tracking-tight text-yene-text">Check your email</h1>
      {/* The server's generic message plus the address the user typed. Nothing
          here reveals whether that address has an account. */}
      <p className="mt-1 text-[13px] text-yene-muted">
        {notice ?? "If an account exists for this email, a verification code has been sent."}
      </p>
      <p className="mt-2 flex items-center gap-1.5 break-all text-[13px] font-medium text-yene-text">
        <Mail size={14} aria-hidden className="shrink-0 text-yene-faint" />
        {email}
      </p>

      <label className="mt-5 block text-[12px] font-medium text-yene-muted" htmlFor="auth-code-0">
        Verification code
      </label>
      <div className="mt-1.5 flex gap-2" onPaste={onPaste}>
        {digits.map((digit, index) => (
          <input
            key={index}
            id={`auth-code-${index}`}
            ref={(node) => {
              inputRefs.current[index] = node;
            }}
            value={digit}
            onChange={(event) => setDigit(index, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !digit && index > 0) {
                inputRefs.current[index - 1]?.focus();
              }
            }}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
            className={`${TOUCH} w-full max-w-[52px] rounded-button border border-yene-line bg-yene-bg text-center text-lg font-semibold text-yene-text focus:border-yene-accent focus:outline-none`}
          />
        ))}
      </div>

      {secondsLeft > 0 && (
        <p className="mt-3 text-[12.5px] text-yene-muted">
          Code expires in{" "}
          <span className="font-semibold tabular-nums text-yene-text">
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </span>
        </p>
      )}

      <button
        type="button"
        onClick={onVerify}
        disabled={busy || digits.join("").length !== CODE_LENGTH}
        className={`${TOUCH} mt-4 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-surface disabled:opacity-60`}
      >
        {busy ? "Verifying..." : "Verify & Sign In"}
      </button>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onEditEmail}
          className={`${TOUCH} rounded-button text-[12.5px] text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          Use a different email
        </button>
        <button
          type="button"
          onClick={onResend}
          disabled={!canResend || busy}
          className={`${TOUCH} rounded-button text-[12.5px] font-medium text-yene-accent transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent disabled:text-yene-faint disabled:no-underline`}
        >
          {canResend ? "Resend Code" : `Resend in ${secondsLeft}s`}
        </button>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Step 1 of sign-up - the business
// ---------------------------------------------------------------------------

export interface SignUpDetails {
  businessName: string;
  email: string;
  phone: string;
  location: string;
  packageId: string;
  type: "standalone" | "mall";
  /** Section 41: the mall's id, resolved server-side against the directory. */
  mall: string;
  floor: string;
  /**
   * Section 41: every room this store occupies.
   *
   * An ARRAY rather than one string, because a shop may hold more than one
   * counter - Hub Jewellery trades out of GFS-024 and GFS-030. The server
   * re-parses the array for separators as a safety net, so a client sending
   * "GFS-024 & GFS-030" as a single entry still produces two rooms.
   */
  rooms: string[];
}

/**
 * Section 10: a business rents a store, so sign-up collects a BUSINESS, not
 * just a person. Section 41's mall fields appear only when the type is "mall",
 * because asking a standalone shop for a room number is noise.
 *
 * Package prices are the real ones from `packageCards()`, and Super reads
 * "30,000 ETB+" because its price is a quotation (Section 40).
 */
function SignUpStep({
  packages,
  busy,
  onSubmit,
}: {
  packages: PackageConfigCard[];
  busy: boolean;
  onSubmit: (details: SignUpDetails) => void;
}) {
  const [form, setForm] = useState<SignUpDetails>({
    businessName: "",
    email: "",
    phone: "",
    location: "Addis Ababa",
    packageId: "silver",
    type: "standalone",
    mall: "",
    floor: "",
    rooms: [],
  });
  const [showPackages, setShowPackages] = useState(false);

  // Section 41: the real mall directory, so the picker can only offer malls
  // that exist. Loaded on mount rather than on selecting "Mall store" so the
  // list is ready the moment the fields appear - a picker that populates after
  // a click reads as an empty mall to somebody in a hurry.
  const [malls, setMalls] = useState<MallCard[]>([]);
  const [mallsError, setMallsError] = useState<string | null>(null);
  useEffect(() => {
    fetchMalls()
      .then((result) => setMalls(result.malls))
      .catch(() => setMallsError("The mall list could not be loaded."));
  }, []);

  const selectedMall = useMemo(
    () => malls.find((entry) => entry.id === form.mall) ?? null,
    [malls, form.mall],
  );

  const set = <K extends keyof SignUpDetails>(key: K, value: SignUpDetails[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const ready = form.businessName.trim().length >= 2 && form.email.includes("@");
  const selected = packages.find((entry) => entry.id === form.packageId);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
    >
      <h1 className="text-lg font-semibold tracking-tight text-yene-text">Open your store</h1>
      <p className="mt-1 text-[13px] text-yene-muted">
        Start a free trial. You can change or upgrade your package at any time.
      </p>
      <p className="mt-2 rounded-button border border-yene-line-soft bg-yene-raised px-3 py-2 text-[12px] leading-relaxed text-yene-muted">
        Renting a store needs a verified Fayda ID and TIN number. You can start now and
        complete verification from your profile before you go live.
      </p>

      <Field
        id="su-name"
        label="Business name"
        value={form.businessName}
        onChange={(value) => set("businessName", value)}
        placeholder="ABC Fashion"
        autoComplete="organization"
        required
      />
      <Field
        id="su-email"
        label="Email address"
        type="email"
        value={form.email}
        onChange={(value) => set("email", value)}
        placeholder="you@yourbusiness.com"
        autoComplete="email"
        required
      />
      <div className="grid gap-3 tablet:grid-cols-2">
        <Field
          id="su-phone"
          label="Phone"
          value={form.phone}
          onChange={(value) => set("phone", value)}
          placeholder="+251 ..."
          autoComplete="tel"
        />
        <Field
          id="su-location"
          label="Location"
          value={form.location}
          onChange={(value) => set("location", value)}
          placeholder="Addis Ababa"
        />
      </div>

      <fieldset className="mt-4">
        <legend className="text-[12px] font-medium text-yene-muted">Business type</legend>
        <div className="mt-1.5 flex gap-2">
          {(["standalone", "mall"] as const).map((entry) => (
            <label
              key={entry}
              className={`${TOUCH} flex flex-1 cursor-pointer items-center justify-center rounded-button border px-3 text-[13px] font-medium transition-colors ${
                form.type === entry
                  ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                  : "border-yene-line-soft text-yene-muted hover:text-yene-text"
              }`}
            >
              <input
                type="radio"
                name="business-type"
                value={entry}
                checked={form.type === entry}
                onChange={() => set("type", entry)}
                className="sr-only"
              />
              {entry === "standalone" ? "Own store" : "Mall store"}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Section 41: mall details only when they mean something.

          The mall is a PICKER over the real directory rather than a free-text
          field. A typed name would let a stranger invent a mall by signing up,
          and would let the directory show one name while the store carries
          another. The rooms are an editable list because one counter is the
          common case and two is normal - not an either/or. */}
      {form.type === "mall" && (
        <div className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="su-mall"
              className="text-[12px] font-medium text-yene-muted"
            >
              Mall
            </label>
            <select
              id="su-mall"
              value={form.mall}
              onChange={(event) => {
                const chosen = event.target.value;
                set("mall", chosen);
                // Floors belong to the mall, so changing mall resets them rather
                // than leaving a "3F" behind on a mall with no third floor.
                set("floor", "");
              }}
              className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 text-[13px] text-yene-text focus:border-yene-accent focus:outline-none`}
            >
              <option value="">Choose your mall...</option>
              {malls.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} - {entry.city}
                </option>
              ))}
            </select>
            {mallsError && (
              <p className="mt-1 text-[11.5px] text-yene-warn">{mallsError}</p>
            )}
            {malls.length === 0 && !mallsError && (
              <p className="mt-1 text-[11.5px] text-yene-faint">
                The mall list could not be loaded. Contact Yene Business Group to
                register your store.
              </p>
            )}
          </div>

          {selectedMall && (
            <div className="grid gap-3 tablet:grid-cols-2">
              <div>
                <label htmlFor="su-floor" className="text-[12px] font-medium text-yene-muted">
                  Floor
                </label>
                <select
                  id="su-floor"
                  value={form.floor}
                  onChange={(event) => set("floor", event.target.value)}
                  className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 text-[13px] text-yene-text focus:border-yene-accent focus:outline-none`}
                >
                  <option value="">Choose a floor...</option>
                  {selectedMall.floors.map((floor) => (
                    <option key={floor} value={floor}>
                      {floor}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Every room this store occupies. */}
          <div>
            <p className="text-[12px] font-medium text-yene-muted">
              Room / shop number
              <span className="ml-1.5 font-normal text-yene-faint">
                Add more than one if you trade from several counters.
              </span>
            </p>

            {form.rooms.length === 0 && (
              <p className="mt-1.5 rounded-button border border-yene-line-soft bg-yene-raised px-3 py-2 text-[12px] text-yene-muted">
                No room added yet. You can register first and confirm the number
                later.
              </p>
            )}

            <ul className="mt-1.5 space-y-1.5">
              {form.rooms.map((room, index) => (
                <li key={index} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={room}
                    aria-label={`Room number ${index + 1}`}
                    placeholder={selectedMall ? `${form.floor || "GFS"}-01` : "GFS-024"}
                    onChange={(event) => {
                      const next = [...form.rooms];
                      next[index] = event.target.value;
                      set("rooms", next);
                    }}
                    className={`${TOUCH} flex-1 rounded-button border border-yene-line bg-yene-bg px-3 text-[13px] uppercase text-yene-text focus:border-yene-accent focus:outline-none`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        "rooms",
                        form.rooms.filter((_, position) => position !== index),
                      )
                    }
                    aria-label={`Remove room ${index + 1}`}
                    className={`${TOUCH} shrink-0 rounded-button border border-yene-line px-2.5 text-[12px] text-yene-muted transition-colors hover:border-yene-danger hover:text-yene-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => set("rooms", [...form.rooms, ""])}
              className={`${TOUCH} mt-1.5 rounded-button border border-yene-line-soft px-3 text-[12px] font-medium text-yene-muted transition-colors hover:border-yene-accent hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
            >
              + Add another room
            </button>
          </div>
        </div>
      )}


      <div className="mt-4">
        <p className="text-[12px] font-medium text-yene-muted">Package</p>
        <button
          type="button"
          onClick={() => setShowPackages((value) => !value)}
          aria-expanded={showPackages}
          className={`${TOUCH} mt-1.5 flex w-full items-center justify-between rounded-button border border-yene-line bg-yene-bg px-3 text-left text-[13px] text-yene-text focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          <span>
            {selected?.name ?? "Silver"}
            <span className="ml-2 text-yene-muted">{selected?.priceLabel}</span>
          </span>
          <span className="text-[12px] text-yene-accent">
            {showPackages ? "Hide" : "Change"}
          </span>
        </button>

        {showPackages && (
          <ul className="mt-2 space-y-1.5">
            {packages.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    set("packageId", entry.id);
                    setShowPackages(false);
                  }}
                  className={`${TOUCH} w-full rounded-button border px-3 py-2 text-left transition-colors ${
                    form.packageId === entry.id
                      ? "border-yene-accent bg-yene-accent-dim"
                      : "border-yene-line-soft hover:border-yene-accent/50"
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold text-yene-text">{entry.name}</span>
                    <span className="text-[12.5px] font-semibold text-yene-accent">
                      {entry.priceLabel}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-yene-muted">{entry.tagline}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="submit"
        disabled={busy || !ready}
        className={`${TOUCH} mt-5 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-surface disabled:opacity-60`}
      >
        {busy ? "Creating your store..." : "Create store & continue"}
      </button>

      <p className="mt-3 text-[11.5px] leading-relaxed text-yene-faint">
        We will email a verification code to confirm this address. No payment is taken now.
      </p>
    </form>
  );
}

/** One labelled input, shared by both steps. */
function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div className="mt-3">
      <label className="block text-[12px] font-medium text-yene-muted" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 text-sm text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none`}
      />
    </div>
  );
}

