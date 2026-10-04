/**
 * ============================================================================
 *  ALTERNATIVE SIGN-IN METHODS
 * ============================================================================
 *
 *  Two pieces that sit alongside the original email-code flow:
 *
 *  1. PasswordSignIn - identifier + password. The identifier may be an EMAIL or a
 *     USERNAME; the server decides which namespace it belongs to. The field is
 *     `type="text"` on purpose: `type="email"` would reject a valid username.
 *
 *  2. GoogleButton - Google Identity Services. The ID token is obtained in the
 *     browser and handed to the server, which verifies it with Google before
 *     trusting it. The button renders NOTHING when no client id is configured,
 *     so the UI never offers a social sign-in that cannot work.
 *
 *  Both are additive: the 6-digit email code still works, for accounts with no
 *  password and for anyone who would rather not use one.
 */

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthError, signInWithGoogle, signInWithPassword } from "../../lib/authApi";
import { TOUCH } from "../marketplace/ProductCard";

/** The shape Google's script puts on `window`. */
interface GoogleCredentialResponse {
  credential?: string;
}
interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

export function PasswordSignIn({
  onAuthenticated,
  onError,
  onForgotPassword,
}: {
  onAuthenticated: () => void;
  onError: (message: string) => void;
  /** Opens the reset flow, seeded with whatever identifier was typed. */
  onForgotPassword: (identifier: string) => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!identifier.trim() || !password) return;
    setBusy(true);
    try {
      await signInWithPassword(identifier, password);
      onAuthenticated();
    } catch (cause) {
      onError((cause as AuthError).userMessage ?? "That sign-in did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1 className="text-lg font-semibold tracking-tight text-yene-text">Sign in</h1>
      <p className="mt-1 text-[13px] text-yene-muted">
        Use the email address or username on your account.
      </p>

      <label className="mt-5 block text-[12px] font-medium text-yene-muted" htmlFor="auth-identifier">
        Email or username
      </label>
      <input
        id="auth-identifier"
        type="text"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="you@example.com or abebe"
        required
        className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 text-sm text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none`}
      />

      <label className="mt-3 block text-[12px] font-medium text-yene-muted" htmlFor="auth-password">
        Password
      </label>
      <div className="relative">
        <input
          id="auth-password"
          type={revealed ? "text" : "password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          className={`${TOUCH} mt-1.5 w-full rounded-button border border-yene-line bg-yene-bg px-3 pr-11 text-sm text-yene-text focus:border-yene-accent focus:outline-none`}
        />
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          aria-label={revealed ? "Hide password" : "Show password"}
          className={`${TOUCH} absolute right-0 top-[9px] inline-flex w-11 items-center justify-center text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          {revealed ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => onForgotPassword(identifier)}
          className={`${TOUCH} rounded-button text-[12.5px] font-medium text-yene-accent transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent`}
        >
          Forgot password?
        </button>
      </div>

      <button
        type="submit"
        disabled={busy || !identifier.trim() || !password}
        className={`${TOUCH} mt-5 w-full rounded-button bg-yene-accent px-4 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent disabled:opacity-60`}
      >
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

/** Renders nothing unless the server reports a usable Google client id. */
export function GoogleButton({
  clientId,
  onAuthenticated,
  onError,
}: {
  clientId: string | null;
  onAuthenticated: () => void;
  onError: (message: string) => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    // Google's script is loaded by AuthScreen; poll briefly for it rather than
    // adding a loader that could resolve after this component unmounts.
    const timer = setInterval(() => {
      const id = window.google?.accounts?.id;
      if (!id || cancelled || !holder.current) return;
      clearInterval(timer);
      id.initialize({
        client_id: clientId,
        callback: async (response) => {
          const token = response.credential;
          if (!token) return;
          try {
            await signInWithGoogle(token);
            onAuthenticated();
          } catch (cause) {
            onError((cause as AuthError).userMessage ?? "Google sign-in did not work.");
          }
        },
      });
      // `width: "max(content-width)"` makes the button fill the card, so the
      // layout is identical in both themes without a second CSS override.
      id.renderButton(holder.current, {
        theme: document.documentElement.getAttribute("data-theme") === "light" ? "outline" : "filled_black",
        size: "large",
        width: "max(content-width)",
        text: "continue_with",
        shape: "rectangular",
      });
      setReady(true);
    }, 150);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [clientId, onAuthenticated, onError]);

  if (!clientId) return null;

  return (
    <div className="mt-4">
      <div ref={holder} className={ready ? "flex justify-center" : "hidden"} />
      {!ready && (
        <div className="flex h-11 items-center justify-center text-yene-faint">
          <Loader2 size={16} className="animate-spin" aria-hidden />
        </div>
      )}
    </div>
  );
}
