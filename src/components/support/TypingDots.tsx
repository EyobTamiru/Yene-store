export const TypingDots = () => (
  <div className="flex gap-2.5" aria-live="polite" aria-label="Yene AI Support is typing">
    <div
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-yene-accent-dim"
      aria-hidden="true"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-yene-accent" />
    </div>
    <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-yene-line-soft bg-yene-surface px-3.5 py-3">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="yene-dot h-1.5 w-1.5 rounded-full bg-yene-muted"
          style={{ animationDelay: `${index * 0.15}s` }}
        />
      ))}
    </div>
  </div>
);
