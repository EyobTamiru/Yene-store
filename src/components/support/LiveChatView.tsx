import { ArrowLeft, Check, Clock, Ticket, Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  AGENTS_UNAVAILABLE_MESSAGE,
  MAX_MESSAGE_LENGTH,
  MODE_AI_LABEL,
  MODE_HUMAN_LABEL,
  RESOLVED_RETURN_PROMPT,
} from "../../constants";
import type { LiveMessage, LiveThread } from "../../lib/liveApi";

/** The AI / Human mode indicator, always visible in the chat header. */
export const ModeBadge = ({ mode }: { mode: "ai" | "human" }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
      mode === "human"
        ? "bg-yene-info/15 text-yene-info"
        : "bg-yene-accent-dim text-yene-accent"
    }`}
  >
    <span
      className={`h-1.5 w-1.5 rounded-full ${mode === "human" ? "bg-yene-info" : "bg-yene-accent"}`}
    />
    {mode === "human" ? MODE_HUMAN_LABEL : MODE_AI_LABEL}
  </span>
);

/** Shows which transport is actually carrying the conversation. */
const TransportHint = ({ transport }: { transport: "sse" | "polling" | null }) => {
  if (!transport) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] text-yene-faint"
      title={
        transport === "sse"
          ? "Live updates are streaming"
          : "Live updates are refreshing periodically"
      }
    >
      {transport === "sse" ? <Wifi size={10} /> : <WifiOff size={10} />}
      {transport === "sse" ? "Live" : "Refreshing"}
    </span>
  );
};

const bubbleFor = (message: LiveMessage) => {
  if (message.senderType === "customer") {
    return "ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-yene-accent px-3 py-2 text-yene-on-accent";
  }
  if (message.senderType === "agent") {
    return "mr-auto max-w-[85%] rounded-2xl rounded-tl-md border border-yene-line-soft bg-yene-surface px-3 py-2 text-yene-text";
  }
  if (message.senderType === "ai") {
    return "mr-auto max-w-[85%] rounded-2xl rounded-tl-md border border-yene-line-soft bg-yene-raised px-3 py-2 text-yene-muted";
  }
  return "mx-auto max-w-[90%] rounded-lg bg-yene-raised px-3 py-1.5 text-center text-[11.5px] text-yene-faint";
};

const statusText = (status: LiveThread["status"]): string => {
  if (status === "waiting-for-agent") return "Waiting for an agent";
  if (status === "resolved" || status === "closed") return "Resolved";
  return "In progress with an agent";
};

interface LiveChatViewProps {
  thread: LiveThread;
  handoffMessage: string;
  agentTyping: boolean;
  transport: "sse" | "polling" | null;
  isSending: boolean;
  onSend: (text: string) => void;
  onBackToAi: () => void;
}

export const LiveChatView = ({
  thread, handoffMessage, agentTyping, transport,
  isSending, onSend, onBackToAi,
}: LiveChatViewProps) => {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread.messages.length, agentTyping]);

  const waiting = thread.status === "waiting-for-agent";
  const resolved = thread.status === "resolved" || thread.status === "closed";

  const submit = () => {
    const text = draft.trim();
    if (!text || isSending) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="yene-scroll flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {/* Handoff outcome - the exact message the specification requires. */}
        <div
          className={`rounded-xl border p-3 text-[12.5px] leading-relaxed ${
            thread.agent
              ? "border-yene-info/30 bg-yene-info/10 text-yene-text"
              : "border-yene-warn/30 bg-yene-warn/10 text-yene-text"
          }`}
        >
          <p className="font-medium">{handoffMessage || AGENTS_UNAVAILABLE_MESSAGE}</p>

          {/* Facts only. No invented response time, ever. */}
          <dl className="mt-2 space-y-0.5 text-[11.5px]">
            {thread.ticketId && (
              <div className="flex gap-1.5">
                <dt className="inline-flex items-center gap-1 text-yene-faint">
                  <Ticket size={10} /> Ticket
                </dt>
                <dd className="font-mono text-yene-accent">{thread.ticketId}</dd>
              </div>
            )}
            <div className="flex gap-1.5">
              <dt className="inline-flex items-center gap-1 text-yene-faint">
                <Clock size={10} /> Status
              </dt>
              <dd>{statusText(thread.status)}</dd>
            </div>
            {thread.agent && (
              <div className="flex gap-1.5">
                <dt className="text-yene-faint">Agent</dt>
                <dd>{thread.agent}</dd>
              </div>
            )}
            {/* Only rendered when the team has actually published hours. */}
            {thread.supportHours && (
              <div className="flex gap-1.5">
                <dt className="text-yene-faint">Support hours</dt>
                <dd>{thread.supportHours}</dd>
              </div>
            )}
          </dl>
        </div>

        {waiting && (
          <p className="text-center text-[11.5px] text-yene-faint">
            You are in the support queue. Anything you write here stays with your
            ticket, and the agent will see it.
          </p>
        )}

        {thread.messages.map((message) => (
          <div key={message.id} className={bubbleFor(message)}>
            {message.senderType === "agent" && (
              <p className="mb-0.5 text-[10.5px] font-semibold text-yene-info">
                {message.senderName}
              </p>
            )}
            {message.senderType === "ai" && (
              <p className="mb-0.5 text-[10.5px] text-yene-faint">
                {message.senderName}
              </p>
            )}
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
              {message.body}
            </p>
            {message.senderType === "agent" && message.readByCustomer && (
              <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-yene-faint">
                <Check size={9} /> Read
              </p>
            )}
          </div>
        ))}

        {agentTyping && (
          <div className="mr-auto flex items-center gap-2 rounded-2xl rounded-tl-md border border-yene-line-soft bg-yene-surface px-3 py-2 text-[12px] text-yene-muted">
            <span className="yene-dot h-1.5 w-1.5 rounded-full bg-yene-info" />
            <span className="yene-dot h-1.5 w-1.5 rounded-full bg-yene-info" style={{ animationDelay: "0.15s" }} />
            <span className="yene-dot h-1.5 w-1.5 rounded-full bg-yene-info" style={{ animationDelay: "0.3s" }} />
            agent is typing
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {resolved ? (
        <div className="border-t border-yene-line-soft bg-yene-surface p-3">
          <p className="mb-2 text-[12px] text-yene-muted">{RESOLVED_RETURN_PROMPT}</p>
          <button
            type="button"
            onClick={onBackToAi}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-yene-accent px-3 py-2.5 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong"
          >
            <ArrowLeft size={14} /> Return to AI Support
          </button>
        </div>
      ) : (
        <form
          className="border-t border-yene-line-soft bg-yene-bg p-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={1}
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder={
                waiting ? "You are in the queue - leave a message" : "Message your support agent"
              }
              aria-label="Message your support agent"
              className="yene-scroll max-h-24 min-h-[38px] flex-1 resize-none rounded-xl border border-yene-line bg-yene-surface px-3 py-2 text-[13.5px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSending || !draft.trim()}
              className="h-[38px] rounded-xl bg-yene-accent px-4 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </form>
      )}

      <div className="flex items-center justify-between border-t border-yene-line-soft bg-yene-surface px-3 py-1.5">
        <TransportHint transport={transport} />
        {!resolved && (
          <button
            type="button"
            onClick={onBackToAi}
            className="inline-flex items-center gap-1 text-[11.5px] text-yene-muted hover:text-yene-accent"
          >
            <ArrowLeft size={11} /> Back to AI Support
          </button>
        )}
      </div>
    </div>
  );
};
