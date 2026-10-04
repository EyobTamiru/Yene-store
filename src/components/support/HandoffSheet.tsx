import { CheckCircle2, Mail, MessageSquare, Phone, X } from "lucide-react";
import { useState } from "react";
import { CONTACT_AGENT_EXPLANATION, SUPPORT_CONTACT } from "../../constants";
import { requestHandoff } from "../../lib/supportApi";

interface HandoffSheetProps {
  open: boolean;
  sessionId: string;
  turnCount: number;
  onClose: () => void;
  onCreated?: (ticketId: string) => void;
}

type Preference = "either" | "phone" | "email";

const PREFERENCES: { value: Preference; label: string; icon: typeof Phone }[] = [
  { value: "either", label: "Either", icon: MessageSquare },
  { value: "phone", label: "Phone call", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
];

const inputClass =
  "w-full rounded-xl border border-yene-line bg-yene-raised px-3 py-2 text-[13px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none focus:ring-1 focus:ring-yene-accent/40";

export const HandoffSheet = ({
  open,
  sessionId,
  turnCount,
  onClose,
  onCreated,
}: HandoffSheetProps) => {
  const [reason, setReason] = useState("");
  const [preference, setPreference] = useState<Preference>("either");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [reference, setReference] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState("");

  if (!open) return null;

  const submit = async () => {
    setState("sending");
    try {
      const response = await requestHandoff(sessionId, reason.trim() || undefined);
      setReference(response.ticketId);
      setConfirmMessage(response.message);
      onCreated?.(response.ticketId);
      setState("done");
    } catch (error) {
      // Log the cause, show only approved copy.
      console.error("[support] handoff failed:", error);
      setState("error");
    }
  };

  return (
    <div
      className="absolute inset-0 z-20 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Contact a support agent"
    >
      <div className="yene-safe-bottom max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-yene-line-soft bg-yene-surface p-5 sm:max-w-md sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-yene-text">
              Contact a support agent
            </h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-yene-muted">
              {CONTACT_AGENT_EXPLANATION}
            </p>
            {turnCount > 0 && (
              <p className="mt-1 text-[12px] text-yene-faint">
                Our conversation ({turnCount} message{turnCount === 1 ? "" : "s"}) is
                attached automatically.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-yene-muted transition-colors hover:bg-yene-raised hover:text-yene-text focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
          >
            <X size={16} />
          </button>
        </div>
        {state === "done" ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-yene-accent/30 bg-yene-accent-dim p-4">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-yene-accent" />
              <div>
                <p className="text-[13.5px] leading-relaxed text-yene-text">
                  {confirmMessage}
                </p>
                <p className="mt-2 text-[13px] font-semibold text-yene-accent">
                  Ticket: {reference}
                </p>
                <p className="mt-1 text-[12px] text-yene-muted">Status: Open</p>
              </div>
            </div>
            <div className="rounded-xl border border-yene-line-soft bg-yene-raised p-3 text-[12.5px] text-yene-muted">
              <p className="mb-1 font-medium text-yene-text">
                You can also reach us directly
              </p>
              <p>Phone: {SUPPORT_CONTACT.phone}</p>
              <p>Email: {SUPPORT_CONTACT.email}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-yene-accent px-4 py-2.5 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {state === "error" && (
              <p className="rounded-xl border border-yene-danger/30 bg-yene-danger/10 p-3 text-[12.5px] text-yene-text">
                I could not open the request automatically. Please contact Yene
                Business Group support at {SUPPORT_CONTACT.phone} or{" "}
                {SUPPORT_CONTACT.email}.
              </p>
            )}

            <div>
              <span className="mb-1.5 block text-[12px] font-medium text-yene-text">
                How should we contact you?
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {PREFERENCES.map((option) => {
                  const Icon = option.icon;
                  const active = preference === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPreference(option.value)}
                      className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
                        active
                          ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                          : "border-yene-line bg-yene-raised text-yene-muted hover:text-yene-text"
                      }`}
                    >
                      <Icon size={15} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                htmlFor="handoff-reason"
                className="mb-1.5 block text-[12px] font-medium text-yene-text"
              >
                What do you need help with?{" "}
                <span className="font-normal text-yene-faint">(optional)</span>
              </label>
              <textarea
                id="handoff-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                rows={3}
                placeholder="A short description helps the agent prepare."
                className={`${inputClass} resize-none`}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-yene-line px-4 py-2.5 text-sm font-medium text-yene-muted transition-colors hover:text-yene-text focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={state === "sending"}
                className="flex-1 rounded-xl bg-yene-accent px-4 py-2.5 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent disabled:opacity-50"
              >
                {state === "sending" ? "Sending..." : "Request agent"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
