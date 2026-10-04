import { useCallback, useEffect, useRef, useState } from "react";
import { getSessionId } from "./supportApi";
import {
  markRead,
  requestHuman,
  returnToAi,
  sendMessage,
  watchThread,
  type ChatMode,
  type LiveMessage,
  type LiveThread,
  type ThreadStatus,
} from "./liveApi";

/**
 * Conversation state for the human half of the handoff.
 *
 * The AI conversation is untouched by this hook - switching modes never loses
 * history, because the thread carried the AI messages across on handoff and
 * returning to AI keeps both in the panel.
 */
export function useLiveChat() {
  const [thread, setThread] = useState<LiveThread | null>(null);
  const [mode, setMode] = useState<ChatMode>("ai");
  const [isHandoffPending, setIsHandoffPending] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState("");
  const [agentTyping, setAgentTyping] = useState(false);
  const [transport, setTransport] = useState<"sse" | "polling" | null>(null);
  const [error, setError] = useState("");

  const stopWatching = useRef<(() => void) | null>(null);

  // Subscribe for as long as we are in human mode.
  useEffect(() => {
    if (mode !== "human" || !thread) return;

    stopWatching.current = watchThread(thread.threadId, {
      onTransport: setTransport,
      onSnapshot: setThread,
      onThread: setThread,
      onTyping: ({ typing }) => setAgentTyping(typing),
      onMessage: (message: LiveMessage) => {
        setThread((current) =>
          current
            ? {
                ...current,
                messages: current.messages.some((m) => m.id === message.id)
                  ? current.messages
                  : [...current.messages, message],
              }
            : current,
        );
        // The agent has replied, so the customer has seen it.
        void markRead(thread.threadId).catch(() => undefined);
      },
    });

    return () => {
      stopWatching.current?.();
      stopWatching.current = null;
    };
  }, [mode, thread?.threadId]);

  const talkToHuman = useCallback(async () => {
    setIsHandoffPending(true);
    setError("");
    try {
      const result = await requestHuman(getSessionId());
      setThread(result.thread);
      setHandoffMessage(result.message);
      setMode("human");
    } catch (e) {
      console.error("[live] handoff failed:", e);
      setError(
        "I could not start a live conversation. Please try again, or contact Yene Business Group support directly.",
      );
    } finally {
      setIsHandoffPending(false);
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body || !thread || isSending) return;
      setIsSending(true);
      setError("");
      try {
        const result = await sendMessage(thread.threadId, body);
        setThread((current) =>
          current
            ? {
                ...current,
                messages: [...current.messages, result.message],
              }
            : current,
        );
      } catch (e) {
        console.error("[live] send failed:", e);
        setError("That message did not send. Please try again.");
      } finally {
        setIsSending(false);
      }
    },
    [thread, isSending],
  );

  const backToAi = useCallback(async () => {
    if (!thread) return;
    setError("");
    try {
      await returnToAi(thread.threadId);
      stopWatching.current?.();
      setMode("ai");
      setThread(null);
      setAgentTyping(false);
      setTransport(null);
    } catch (e) {
      console.error("[live] return to AI failed:", e);
      setError("Could not switch back to AI Support just now.");
    }
  }, [thread]);

  return {
    mode,
    thread,
    status: (thread?.status ?? null) as ThreadStatus | null,
    isHandoffPending,
    isSending,
    handoffMessage,
    agentTyping,
    transport,
    error,
    talkToHuman,
    send,
    backToAi,
  };
}
