import { CheckCircle2, Expand, Headset, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BRAND, CONTACT_SUPPORT_BUTTON_LABEL, TALK_TO_HUMAN_LABEL, type QuickAction,
} from "../../constants";
import { getSessionId } from "../../lib/supportApi";
import { useSupportConversation } from "../../lib/useSupportConversation";
import { useLiveChat } from "../../lib/useLiveChat";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { HandoffSheet } from "./HandoffSheet";
import { LiveChatView, ModeBadge } from "./LiveChatView";
import { QuickActions } from "./QuickActions";
import { ResolutionSurvey } from "./ResolutionSurvey";
import { TypingDots } from "./TypingDots";

interface ChatPanelProps {
  variant: "widget" | "page";
  onClose?: () => void;
  onExpand?: () => void;
}

export const ChatPanel = ({ variant, onClose, onExpand }: ChatPanelProps) => {
  const { messages, isThinking, ask, reset, transcript, ticketId, beginInvestigation, attachTicket } =
    useSupportConversation();

  // Section 5: the AI <-> human handoff.
  const live = useLiveChat();
  const isHumanMode = live.mode === "human" && !!live.thread;
  const [handoffOpen, setHandoffOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isThinking]);

  const hasUserMessage = messages.some((message) => message.role === "user");

  const handleQuickAction = (action: QuickAction) => {
    if (action.opensHandoff) {
      setHandoffOpen(true);
      return;
    }
    void ask(action.prompt);
  };

  const isPage = variant === "page";

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden bg-yene-bg ${
        isPage
          ? "h-full w-full"
          : "h-full w-full rounded-2xl border border-yene-line-soft"
      }`}
    >
      {/* ---------------------------------------------------------------- */}
      {/* Header                                                            */}
      {/* ---------------------------------------------------------------- */}
      <header className="flex items-center gap-3 border-b border-yene-line-soft bg-yene-surface px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yene-accent-dim">
          <span className="h-2.5 w-2.5 rounded-full bg-yene-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-yene-text">
            {BRAND.aiName}
          </h2>
          <p className="truncate text-[11.5px] text-yene-muted">
            {isHumanMode
              ? `With ${live.thread?.agent ?? "the Yene Business Group support team"}`
              : "Answers from the official Yene-Store knowledge base"}
          </p>
        </div>

        {/* The current mode is always visible. */}
        <ModeBadge mode={isHumanMode ? "human" : "ai"} />

        {hasUserMessage && (
          <button
            type="button"
            onClick={reset}
            aria-label="Start a new conversation"
            title="New conversation"
            className="rounded-lg p-2 text-yene-muted transition-colors hover:bg-yene-raised hover:text-yene-text focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
          >
            <RotateCcw size={15} />
          </button>
        )}
        {!isPage && onExpand && (
          <button
            type="button"
            onClick={onExpand}
            aria-label="Open full support page"
            title="Open full support page"
            className="rounded-lg p-2 text-yene-muted transition-colors hover:bg-yene-raised hover:text-yene-text focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
          >
            <Expand size={15} />
          </button>
        )}
        {!isPage && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close support chat"
            className="rounded-lg p-2 text-yene-muted transition-colors hover:bg-yene-raised hover:text-yene-text focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
          >
            <X size={16} />
          </button>
        )}
      </header>
      {isHumanMode && live.thread ? (
        <LiveChatView
          thread={live.thread}
          handoffMessage={live.handoffMessage}
          agentTyping={live.agentTyping}
          transport={live.transport}
          isSending={live.isSending}
          onSend={(text) => void live.send(text)}
          onBackToAi={() => void live.backToAi()}
        />
      ) : (
        <>
      {/* Messages */}
      <div
        className="yene-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-label="Support conversation"
      >
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            onContactAgent={() => setHandoffOpen(true)}
          />
        ))}
        {isThinking && <TypingDots />}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions are shown only at the start of a conversation. */}
      {!hasUserMessage && <QuickActions onSelect={handleQuickAction} disabled={isThinking} />}

      {/* Section 3: the ticket button, or the Section 5 live handoff. */}
      {!ticketId && !isHumanMode && (
        <div className="space-y-1.5 border-t border-yene-line-soft bg-yene-surface px-3 py-2">
          <button
            type="button"
            onClick={() => void live.talkToHuman()}
            disabled={live.isHandoffPending || isThinking}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-yene-info/50 bg-yene-info/10 px-3 py-2.5 text-[12.5px] font-semibold text-yene-info transition-colors hover:bg-yene-info/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-info disabled:opacity-50"
          >
            <Headset size={15} />
            {live.isHandoffPending ? "Connecting..." : TALK_TO_HUMAN_LABEL}
          </button>
          <button
            type="button"
            onClick={() => {
              beginInvestigation();
              setHandoffOpen(true);
            }}
            disabled={isThinking}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-yene-accent/40 bg-yene-accent-dim px-3 py-2 text-[12px] font-medium text-yene-accent transition-colors hover:bg-yene-accent/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent disabled:opacity-50"
          >
            {CONTACT_SUPPORT_BUTTON_LABEL}
          </button>
        </div>
      )}

      {ticketId && !isHumanMode && (
        <div className="flex items-center justify-center gap-2 border-t border-yene-line-soft bg-yene-surface px-3 py-2 text-[12px] text-yene-muted">
          <CheckCircle2 size={14} className="text-yene-accent" />
          Ticket <span className="font-semibold text-yene-accent">{ticketId}</span> is
          open with a Yene Business Group support agent
        </div>
      )}

      {!isHumanMode && <ChatInput onSend={(text) => void ask(text)} disabled={isThinking} />}

      {/* Section 7: shown only after the conversation is resolved, and only
          once. The server decides whether it applies at all. */}
      <ResolutionSurvey />
        </>
      )}

      <HandoffSheet
        open={handoffOpen}
        sessionId={getSessionId()}
        turnCount={transcript.length}
        onClose={() => setHandoffOpen(false)}
        onCreated={attachTicket}
      />
    </div>
  );
};
