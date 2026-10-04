import { ArrowLeft, History, Mail, MessageSquare, Phone, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { BRAND, SUPPORT_CONTACT } from "../../constants";
import { ChatPanel } from "./ChatPanel";
import { SupportHistory } from "./SupportHistory";

interface SupportPageProps {
  onBack?: () => void;
}

const TRUST_POINTS = [
  "Answers come only from the official Yene-Store knowledge base.",
  "If I don't have a confirmed answer, I'll tell you instead of guessing.",
  "You can talk to a Yene Business Group support agent at any time.",
];

/**
 * The two halves of the customer journey, as tabs on a narrow screen.
 *
 * "Chat" is where a problem gets solved. "My requests" is where a customer
 * checks what happened after the conversation ended - the step that was
 * impossible before Section 9.
 *
 * On a phone the chat and the history cannot sit side by side, so a tab is the
 * honest control: both are full width, and the customer is never shown a
 * squeezed half-column. From lg up they sit side by side, because there is
 * genuinely room to work and refer at the same time.
 */
type MobileTab = "chat" | "history";

export const SupportPage = ({ onBack }: SupportPageProps) => {
  const [tab, setTab] = useState<MobileTab>("chat");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-5 px-3 py-4 sm:px-6 sm:py-6 lg:flex-row lg:gap-6 xl:gap-8">
      {/* ------------------------------------------------------------------ */}
      {/* Intro column. Collapses above the work area on a small screen.     */}
      {/* ------------------------------------------------------------------ */}
      <aside className="lg:w-[20rem] lg:shrink-0 xl:w-[22rem]">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-yene-muted transition-colors hover:text-yene-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
          >
            <ArrowLeft size={15} />
            Back
          </button>
        )}

        <h1 className="text-xl font-semibold tracking-tight text-yene-text sm:text-2xl lg:text-3xl">
          {BRAND.aiName}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-yene-muted lg:mt-2 lg:text-[13.5px]">
          24/7 help for {BRAND.name} customers, business owners and employees.
          Ask a question and I will answer from the official knowledge base.
        </p>

        <ul className="mt-4 hidden space-y-2.5 lg:block">
          {TRUST_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-2.5">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-yene-accent" />
              <span className="text-[12.5px] leading-relaxed text-yene-muted">{point}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-2xl border border-yene-line-soft bg-yene-surface p-4 lg:mt-6">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-yene-faint">
            Talk to a person
          </p>
          <a
            href={`tel:${SUPPORT_CONTACT.phone.replace(/\s/g, "")}`}
            className="flex items-center gap-2 text-[13px] text-yene-text transition-colors hover:text-yene-accent"
          >
            <Phone size={14} className="shrink-0 text-yene-muted" />
            {SUPPORT_CONTACT.phone}
          </a>
          <a
            href={`mailto:${SUPPORT_CONTACT.email}`}
            className="mt-2 flex items-center gap-2 text-[13px] text-yene-text transition-colors hover:text-yene-accent"
          >
            <Mail size={14} className="shrink-0 text-yene-muted" />
            <span className="truncate">{SUPPORT_CONTACT.email}</span>
          </a>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Work area                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="min-w-0 flex-1">
        {/* Tabs are for narrow screens only. From lg up both panes are visible
            and a tab would hide something the customer asked to see. */}
        <div
          role="tablist"
          aria-label="Support"
          className="mb-2.5 grid grid-cols-2 gap-1 rounded-xl border border-yene-line-soft bg-yene-surface p-1 lg:hidden"
        >
          {(
            [
              { id: "chat" as const, label: "Chat", icon: MessageSquare },
              { id: "history" as const, label: "My requests", icon: History },
            ]
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
                  active
                    ? "bg-yene-accent-dim text-yene-accent"
                    : "text-yene-muted hover:text-yene-text"
                }`}
              >
                <Icon size={14} />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div
            className={`min-h-0 overflow-hidden rounded-2xl border border-yene-line-soft shadow-2xl shadow-black/40 ${
              tab === "chat" ? "block" : "hidden lg:block"
            } lg:h-[calc(100dvh-5rem)]`}
          >
            <ChatPanel variant="page" />
          </div>

          <div
            className={`min-w-0 lg:h-[calc(100dvh-5rem)] lg:overflow-y-auto ${
              tab === "history" ? "block" : "hidden lg:block"
            }`}
          >
            <SupportHistory />
          </div>
        </div>
      </div>
    </div>
  );
};
