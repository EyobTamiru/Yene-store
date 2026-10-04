import { Bot, BookOpen, User } from "lucide-react";
import type { ReactNode } from "react";
import type { SupportMessage } from "../../lib/useSupportConversation";

/**
 * Minimal, safe text renderer.
 *
 * Everything is rendered as React text nodes, so any HTML in a reply is
 * escaped rather than executed. We only add structure the model is told to
 * produce: paragraphs, numbered steps, bullets, and **bold**.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, index) => {
    const key = `${keyPrefix}-${index}`;
    if (chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4) {
      return (
        <strong key={key} className="font-semibold text-yene-text">
          {chunk.slice(2, -2)}
        </strong>
      );
    }
    return <span key={key}>{chunk}</span>;
  });
}

function renderBlock(block: string, key: string): ReactNode {
  const lines = block.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return null;

  const numbered = lines.every((line) => /^\d+[.)]\s/.test(line.trim()));
  const bulleted = lines.every((line) => /^[-*]\s/.test(line.trim()));

  if (numbered || bulleted) {
    const Tag = numbered ? "ol" : "ul";
    return (
      <Tag
        key={key}
        className={`my-2 space-y-1.5 pl-1 ${
          numbered ? "list-none" : "list-none"
        }`}
      >
        {lines.map((line, index) => {
          const content = line.replace(/^(\d+[.)]|[-*])\s*/, "");
          return (
            <li key={`${key}-${index}`} className="flex gap-2.5">
              {numbered ? (
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-yene-accent-dim text-[11px] font-semibold text-yene-accent">
                  {line.trim().match(/^(\d+)/)?.[1] ?? index + 1}
                </span>
              ) : (
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-yene-faint" />
              )}
              <span className="text-[13.5px] leading-relaxed">
                {renderInline(content, `${key}-${index}`)}
              </span>
            </li>
          );
        })}
      </Tag>
    );
  }

  return (
    <p key={key} className="my-1.5 text-[13.5px] leading-relaxed first:mt-0 last:mb-0">
      {renderInline(block, key)}
    </p>
  );
}

interface ChatMessageProps {
  message: SupportMessage;
  onContactAgent: () => void;
}

export const ChatMessage = ({ message, onContactAgent }: ChatMessageProps) => {
  const isUser = message.role === "user";
  const blocks = message.content.split(/\n{2,}/);

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          isUser
            ? "bg-yene-raised text-yene-muted"
            : "bg-yene-accent-dim text-yene-accent"
        }`}
        aria-hidden="true"
      >
        {isUser ? <User size={14} /> : <Bot size={15} />}
      </div>

      <div className={`min-w-0 max-w-[85%] ${isUser ? "items-end" : ""}`}>
        <div
          className={`rounded-2xl px-3.5 py-2.5 ${
            isUser
              ? "rounded-tr-md bg-yene-accent text-yene-on-accent"
              : message.isSystemNotice
                ? "rounded-tl-md border border-yene-warn/30 bg-yene-warn/10"
                : "rounded-tl-md border border-yene-line-soft bg-yene-surface text-yene-text"
          }`}
        >
          <div className={isUser ? "font-medium" : ""}>
            {blocks.map((block, index) => renderBlock(block, `${message.id}-${index}`))}
          </div>
        </div>

        {!isUser && message.sources.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <BookOpen size={11} className="text-yene-faint" />
            {message.sources.map((source) => (
              <span
                key={source.id}
                className="rounded-md border border-yene-line-soft bg-yene-surface px-1.5 py-0.5 text-[10px] text-yene-faint"
                title={source.title}
              >
                {source.title}
              </span>
            ))}
          </div>
        )}

        {!isUser && message.offersHuman && (
          <button
            type="button"
            onClick={onContactAgent}
            className="mt-2 w-full rounded-xl border border-yene-accent/40 bg-yene-accent-dim px-3 py-2 text-left text-[12.5px] font-medium text-yene-accent transition-colors hover:bg-yene-accent/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
          >
            Connect me with a support agent
          </button>
        )}
      </div>
    </div>
  );
};
