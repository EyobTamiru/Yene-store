import { useCallback, useMemo, useRef, useState } from "react";
import { GREETING_MESSAGE, SERVICE_UNAVAILABLE_MESSAGE } from "../constants";
import {
  sendMessage,
  SupportUnavailableError,
  type ChatResponse,
  type OutgoingTurn,
} from "./supportApi";

export interface SupportMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: { id: string; title: string }[];
  /** True when the assistant offered a human agent for this reply. */
  offersHuman: boolean;
  /** True for locally-generated system notices (e.g. service unavailable). */
  isSystemNotice?: boolean;
  /** True while the assistant is checking an escalation condition. */
  isInvestigating?: boolean;
  /** Set once a ticket exists for the conversation. */
  ticketId?: string;
}

function makeId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const GREETING: SupportMessage = {
  id: "greeting",
  role: "assistant",
  content: GREETING_MESSAGE,
  sources: [],
  offersHuman: false,
};

export function useSupportConversation() {
  const [messages, setMessages] = useState<SupportMessage[]>([GREETING]);
  const [isThinking, setIsThinking] = useState(false);
  const [viewer, setViewer] = useState<ChatResponse["viewer"] | null>(null);
  const [isHandingOff, setIsHandingOff] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);

  // A ref, because the async handler must read the latest history without
  // re-creating the callback on every keystroke.
  const historyRef = useRef<OutgoingTurn[]>([]);

  const push = useCallback((message: SupportMessage) => {
    setMessages((current) => [...current, message]);
  }, []);

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isThinking) return;

      const userMessage: SupportMessage = {
        id: makeId(),
        role: "user",
        content: trimmed,
        sources: [],
        offersHuman: false,
      };
      push(userMessage);
      setIsThinking(true);

      try {
        const response = await sendMessage(trimmed, historyRef.current);
        setViewer(response.viewer);

        push({
          id: makeId(),
          role: "assistant",
          content: response.reply,
          sources: response.sources,
          offersHuman: response.needsHuman,
        });

        historyRef.current = [
          ...historyRef.current,
          { role: "user", content: trimmed },
          { role: "assistant", content: response.reply },
        ];
      } catch (error) {
        // The user never sees the cause - only the approved fallback copy.
        console.error("[support] chat failed:", error);
        push({
          id: makeId(),
          role: "assistant",
          content: `${SERVICE_UNAVAILABLE_MESSAGE}\n\nI'll connect you with a Yene Business Group support agent who can help.`,
          sources: [],
          offersHuman: true,
          isSystemNotice: true,
        });
        if (!(error instanceof SupportUnavailableError)) {
          console.error("[support] unexpected failure type");
        }
      } finally {
        setIsThinking(false);
      }
    },
    [isThinking, push],
  );

  /**
   * Show the "let me check a few things" notice while the client confirms the
   * handoff with the server, so the customer sees progress rather than a stall.
   */
  const beginInvestigation = useCallback(() => {
    push({
      id: makeId(),
      role: "assistant",
      content: "Let me check a few things...",
      sources: [],
      offersHuman: false,
      isInvestigating: true,
    });
  }, [push]);

  /** Record the ticket id on the conversation once one exists. */
  const attachTicket = useCallback((ticketId: string) => {
    setTicketId(ticketId);
  }, []);

  const reset = useCallback(() => {
    setMessages([GREETING]);
    setViewer(null);
    setTicketId(null);
    historyRef.current = [];
    setIsThinking(false);
  }, []);

  /** History for the transcript handed to a human agent. */
  const transcript = useMemo<OutgoingTurn[]>(
    () =>
      messages
        .filter((message) => message.role === "user" || !message.isSystemNotice)
        .map((message) => ({ role: message.role, content: message.content })),
    [messages],
  );

  return {
    messages,
    isThinking,
    viewer,
    isHandingOff,
    setIsHandingOff,
    ticketId,
    ask,
    reset,
    transcript,
    beginInvestigation,
    attachTicket,
  };
}
