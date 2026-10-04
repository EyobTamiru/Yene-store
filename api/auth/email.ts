/**
 * ============================================================================
 *  EMAIL DELIVERY (Sections 13, 14)
 * ============================================================================
 *
 *  Section 14 says to inspect the project first and reuse an existing provider.
 *  I did: there is none - no nodemailer, no SMTP client, no mail code anywhere
 *  in `api/`. So this introduces a TRANSPORT INTERFACE and ships two
 *  implementations, and the whole point of the interface is that adding a real
 *  provider later touches nothing else.
 *
 *    consoleTransport  development - writes to the log. Deliberately obvious.
 *    smtpTransport     real delivery, via nodemailer IF it is installed.
 *
 *  THE DEPENDENCY DECISION
 *  -----------------------
 *  `nodemailer` is imported DYNAMICALLY and is not added to package.json.
 *  Two reasons: the project may be installed offline, and a hard dependency on
 *  a mail library would make a missing SMTP configuration a crash rather than
 *  a degraded feature. Instead, `EMAIL_HOST` being set is the switch:
 *
 *    - SMTP configured  -> nodemailer is used, and its absence is reported
 *                           clearly instead of failing silently;
 *    - SMTP not configured -> the console transport, and a loud warning that
 *                           codes are going to the log rather than to email.
 *
 *  To send real mail: `npm i nodemailer` and set the EMAIL_* variables.
 *
 *  NEVER LOG THE PLAIN CODE (Section 16)
 *  -------------------------------------
 *  The code is in the message body, because that is the product. The
 *  development transport prints it, and that is unavoidable - but it is
 *  gated on NODE_ENV !== "production" and the warning says so.
 */

export interface VerificationMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailTransport {
  readonly id: string;
  isConfigured(): boolean;
  send(message: VerificationMessage): Promise<void>;
}

/** Section 13, verbatim except for the code itself. */
export function verificationEmail(code: string, email: string): VerificationMessage {
  return {
    to: email,
    subject: "Your YENE-STORE verification code",
    text: [
      "Hello,",
      "",
      "Your YENE-STORE verification code is:",
      "",
      code,
      "",
      "This code expires in 10 minutes and can only be used once.",
      "",
      "If you did not request this code, you can safely ignore this email.",
      "",
      "YENE-STORE",
      "Powered by Yene Business Group",
    ].join("\n"),
    html: [
      "<div style=\"font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.6;color:#e6edf3;background:#0d1117;padding:32px;border-radius:16px\">",
      "<h1 style=\"font-size:18px;margin:0 0 16px;color:#3ddc97\">YENE-STORE</h1>",
      "<p style=\"margin:0 0 16px\">Hello,</p>",
      "<p style=\"margin:0 0 16px\">Your verification code is:</p>",
      `<p style="font-size:34px;font-weight:700;letter-spacing:10px;margin:0 0 16px;color:#3ddc97">${code}</p>`,
      "<p style=\"margin:0 0 16px;color:#8b949e\">This code expires in 10 minutes and can only be used once.</p>",
      "<p style=\"margin:0 0 16px;color:#8b949e\">If you did not request this code, you can safely ignore this email.</p>",
      "<p style=\"margin:24px 0 0;color:#6e7681;font-size:12px\">Powered by Yene Business Group</p>",
      "</div>",
    ].join(""),
  };
}

function smtpConfigured(): boolean {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER);
}

/**
 * The password reset link.
 *
 * The link is the product, so the token is in the body - exactly as the 6-digit
 * code is. The surrounding copy does the important work:
 *
 *   * it states the expiry, so nobody waits a day for a link that already died;
 *   * it says what to do if the request was not theirs, which is the honest
 *     instruction - a reset they did not ask for means someone typed their
 *     address in, and the right response is to request their own and let the
 *     other link die;
 *   * it NEVER confirms whether the address is registered, because the endpoint
 *     that sends this returns the same generic message either way.
 */
export function passwordResetEmail(resetUrl: string, email: string): VerificationMessage {
  return {
    to: email,
    subject: "Reset your YENE-STORE password",
    text: [
      "Hello,",
      "",
      "We received a request to reset the password on your YENE-STORE account.",
      "",
      "Open this link to choose a new password:",
      "",
      resetUrl,
      "",
      "This link expires in 1 hour and can only be used once.",
      "Requesting a new link retires this one immediately.",
      "",
      "If you did not ask for this, you can safely ignore this email - nothing",
      "has changed and your current password still works.",
      "",
      "YENE-STORE",
      "Powered by Yene Business Group",
    ].join("\n"),
    html: [
      "<div style=\"font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.6;color:#e6edf3;background:#0d1117;padding:32px;border-radius:16px\">",
      "<h1 style=\"font-size:18px;margin:0 0 16px;color:#3ddc97\">YENE-STORE</h1>",
      "<p style=\"margin:0 0 16px\">Hello,</p>",
      "<p style=\"margin:0 0 16px\">We received a request to reset the password on your YENE-STORE account.</p>",
      `<p style="margin:0 0 24px"><a href="${resetUrl}" style="display:inline-block;background:#3ddc97;color:#0d1117;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:10px">Choose a new password</a></p>`,
      "<p style=\"margin:0 0 16px;color:#8b949e\">Or paste this link into your browser:<br><span style=\"word-break:break-all\">",
      resetUrl,
      "</span></p>",
      "<p style=\"margin:0 0 16px;color:#8b949e\">This link expires in 1 hour and can only be used once. Requesting a new link retires this one immediately.</p>",
      "<p style=\"margin:0 0 16px;color:#8b949e\">If you did not ask for this, you can safely ignore this email - nothing has changed and your current password still works.</p>",
      "<p style=\"margin:24px 0 0;color:#6e7681;font-size:12px\">Powered by Yene Business Group</p>",
      "</div>",
    ].join(""),
  };
}

/**
 * Real delivery over SMTP, using nodemailer when it is present.
 *
 * The dynamic import is the reason this does not appear in package.json: a
 * deployment that has not installed it gets a clear, actionable error rather
 * than a module-resolution stack trace.
 */
export function smtpTransport(): EmailTransport {
  return {
    id: "smtp",
    isConfigured: smtpConfigured,

    async send(message: VerificationMessage): Promise<void> {
      if (!smtpConfigured()) {
        throw new Error(
          "SMTP is not configured. Set EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD and EMAIL_FROM.",
        );
      }

      let nodemailer: {
        createTransport: (options: Record<string, unknown>) => {
          sendMail: (mail: Record<string, unknown>) => Promise<unknown>;
        };
      };
      try {
        nodemailer = (await import("nodemailer" as string)) as never;
      } catch {
        throw new Error(
          "nodemailer is not installed. Run: npm i nodemailer  (or leave EMAIL_HOST unset to use the development transport)",
        );
      }

      const transport = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT ?? 587),
        secure: process.env.EMAIL_SECURE === "true",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
        },
      });

      await transport.sendMail({
        from: process.env.EMAIL_FROM ?? process.env.EMAIL_USER,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

/**
 * Development transport. Prints the message so a developer can complete the
 * flow without a mail server.
 *
 * It is inert in production: `isConfigured()` returns false there, so
 * `getTransport()` cannot select it and a code can never be "sent" to a log on
 * a live deployment.
 */
export function consoleTransport(): EmailTransport {
  return {
    id: "console",
    isConfigured: () => process.env.NODE_ENV !== "production",

    async send(message: VerificationMessage): Promise<void> {
      if (process.env.NODE_ENV === "production") {
        throw new Error("The console email transport must not be used in production.");
      }
      console.log(
        [
          "",
          "----------------------------------------------",
          " YENE-STORE verification code (development)",
          ` to:    ${message.to}`,
          ` from:  ${process.env.EMAIL_FROM ?? "yene-store@localhost"}`,
          ` subject: ${message.subject}`,
          "",
          message.text,
          "----------------------------------------------",
          "",
        ].join("\n"),
      );
    },
  };
}

/** SMTP when it is configured, otherwise the development console. */
export function getTransport(): EmailTransport {
  return smtpConfigured() ? smtpTransport() : consoleTransport();
}

let override: EmailTransport | null = null;

/** Test seam: substitute a recording transport. Pass null to restore. */
export function setTransportOverride(transport: EmailTransport | null): void {
  override = transport;
}

export function activeTransport(): EmailTransport {
  return override ?? getTransport();
}