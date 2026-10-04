/**
 * ============================================================================
 *  FORGOT PASSWORD - step 1 of the recovery flow
 * ============================================================================
 *
 *  Reached from the "Forgot password?" link on the password sign-in form. It
 *  asks for an address and emails a link; the form that redeems that link is
 *  `ResetPassword` in the same file.
 *
 *  THE ONE RULE THIS SCREEN ENFORCES
 *  ---------------------------------
 *  It never says whether the address is registered. The server returns one
 *  message for every address and the screen shows that message verbatim, so
 *  this form cannot be used to discover who has an account - not by reading the
 *  text, and not by watching which branch it takes. That is also why the form
 *  does not disable itself or relabel the button after a success: a difference
 *  a script could observe is a difference a script can exploit.
 */

import { useState } from "react";
import { Eye, EyeOff, Mail } from "lucide-react";
import { AuthError, requestPasswordReset, resetPassword } from "../../lib/authApi";
import { TOUCH } from "../marketplace/ProductCard";

function ResetField({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <div className="mt-4">
      <label className="block text-[12px] font-medium text-yene-muted" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 text-sm text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none`}
      />
      {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-yene-faint">{hint}</p>}
    </div>
  );
}

export function ForgotPassword({
  initialEmail,
  onBack,
}: {
  /** Pre-filled with whatever the person typed on the sign-in form. */
  initialEmail?: string;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.includes("@")) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email);
      // The server's own words, shown verbatim on purpose.
      setNotice(result.message);
    } catch (cause) {
      setError((cause as AuthError).userMessage ?? "We could not send that link right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1 className="text-lg font-semibold tracking-tight text-yene-text">Reset your password</h1>
      <p className="mt-1 text-[13px] text-yene-muted">
        Enter your email and we will send you a link to choose a new password.
      </p>

      {notice && (
        <p className="mt-4 flex items-start gap-2 rounded-button border border-yene-accent/40 bg-yene-accent-dim px-3 py-2.5 text-[12.5px] leading-relaxed text-yene-accent">
          <Mail size={15} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {notice} The link expires in 1 hour and can only be used once.
          </span>
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-button border border-yene-danger/40 bg-yene-danger/10 px-3 py-2 text-[12.5px] text-yene-danger"
        >
          {error}
        </p>
      )}

      <ResetField
        id="reset-email"
        label="Email address"
        value={email}
        onChange={setEmail}
        type="email"
        autoComplete="email"
        placeholder="you@yourbusiness.com"
        hint="Use the address on your account, not your username."
      />

      <button
        type="submit"
        disabled={busy || !email.includes("@")}
        className={`${TOUCH} mt-5 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-surface disabled:opacity-60`}
      >
        {busy ? "Sending..." : "Send reset link"}
      </button>

      <button
        type="button"
        onClick={onBack}
        className={`${TOUCH} mt-3 w-full rounded-button text-[12.5px] text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
      >
        Back to sign in
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 2 - the link in the inbox
// ---------------------------------------------------------------------------

/**
 * Redeems `#/reset-password?token=...`, so the token arrives in the URL and is
 * never typed by hand.
 *
 * Two details worth stating:
 *
 *   * the two fields must MATCH. That is a usability guard, not a security
 *     one - the server never sees the confirmation - but a typo silently
 *     producing a password nobody expected is worse than one extra field.
 *
 *   * on success it returns to sign-in rather than straight into the app. The
 *     reset revoked every session on the account, and quietly minting a new
 *     one here would undo the very protection the reset was for.
 */
export function ResetPassword({
  token,
  onDone,
}: {
  /** From the emailed link. Null means the link was malformed. */
  token: string | null;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (cause) {
      setError((cause as AuthError).userMessage ?? "That link could not be used.");
    } finally {
      setBusy(false);
    }
  }

  // A link with no token never reaches the form, so this branch is reachable
  // but not a sign of anything being wrong with the account.
  if (!token) {
    return (
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-yene-text">This link is not valid</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-yene-muted">
          The password reset link is incomplete, so it cannot be used. Request a new one and open
          the link straight from that email.
        </p>
        <button
          type="button"
          onClick={onDone}
          className={`${TOUCH} mt-5 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          Request a new link
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-yene-text">Password updated</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-yene-muted">
          Your new password is live. You have been signed out on every device, so sign in again
          with the password you just chose.
        </p>
        <button
          type="button"
          onClick={onDone}
          className={`${TOUCH} mt-5 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          Go to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <h1 className="text-lg font-semibold tracking-tight text-yene-text">
        Choose a new password
      </h1>
      <p className="mt-1 text-[13px] text-yene-muted">
        Pick something you have not used here before.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-button border border-yene-danger/40 bg-yene-danger/10 px-3 py-2 text-[12.5px] text-yene-danger"
        >
          {error}
        </p>
      )}

      <div className="relative">
        <ResetField
          id="reset-new-password"
          label="New password"
          value={password}
          onChange={setPassword}
          type={revealed ? "text" : "password"}
          autoComplete="new-password"
          hint="At least 8 characters."
        />
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          aria-label={revealed ? "Hide password" : "Show password"}
          className={`${TOUCH} absolute right-0 top-[42px] inline-flex w-11 items-center justify-center text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          {revealed ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>

      <ResetField
        id="reset-confirm-password"
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        type={revealed ? "text" : "password"}
        autoComplete="new-password"
      />

      <button
        type="submit"
        disabled={busy || !password || !confirm}
        className={`${TOUCH} mt-5 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-surface disabled:opacity-60`}
      >
        {busy ? "Saving..." : "Set new password"}
      </button>

      <p className="mt-3 text-[11.5px] leading-relaxed text-yene-faint">
        Changing your password signs you out everywhere. That is deliberate - it is what removes
        anyone else who may be signed in.
      </p>
    </form>
  );
}
