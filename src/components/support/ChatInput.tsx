import { SendHorizonal } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { MAX_MESSAGE_LENGTH } from "../../constants";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInput = ({
  onSend,
  disabled = false,
  placeholder = "Ask about Yene-Store...",
}: ChatInputProps) => {
  const [value, setValue] = useState("");

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter makes a new line.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 border-t border-yene-line-soft bg-yene-bg px-3 py-2.5"
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={MAX_MESSAGE_LENGTH}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Message Yene AI Support"
        className="yene-scroll max-h-24 min-h-[38px] flex-1 resize-none rounded-xl border border-yene-line bg-yene-surface px-3 py-2 text-[13.5px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none focus:ring-1 focus:ring-yene-accent/40 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        aria-label="Send message"
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-yene-accent text-yene-on-accent transition-colors hover:bg-yene-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        <SendHorizonal size={17} />
      </button>
    </form>
  );
};
