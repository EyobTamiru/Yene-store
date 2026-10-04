import { Check, Star } from "lucide-react";
import { useEffect, useState } from "react";
import {
  MAX_SURVEY_RATING,
  RESOLUTION_SURVEY_FEEDBACK_PROMPT,
  RESOLUTION_SURVEY_INTRO,
  RESOLUTION_SURVEY_OPTIONS,
  RESOLUTION_SURVEY_QUESTION,
  RESOLUTION_SURVEY_RATING_PROMPT,
  RESOLUTION_SURVEY_SENDING_LABEL,
  RESOLUTION_SURVEY_SKIP_LABEL,
  RESOLUTION_SURVEY_SUBMIT_LABEL,
  RESOLUTION_SURVEY_THANKS,
  type ResolutionAnswer,
} from "../../constants";
import { fetchSurveyState, submitSurveyFeedback } from "../../lib/supportApi";

/**
 * Section 7: "Was your issue resolved?" - Yes / Partially / No.
 *
 * The rating and the comment are optional by design. The specification calls
 * both of them optional, so the form must be submittable having answered only
 * the required question, and must never make a customer feel obliged to write
 * an essay to finish a conversation.
 *
 * Whether the survey is shown at all is decided by the server
 * (`GET /api/support/survey`), never here. The component renders nothing until
 * the server says the conversation has been resolved and not yet surveyed, so a
 * customer mid-conversation is never interrupted by a form.
 */
export const ResolutionSurvey = () => {
  const [show, setShow] = useState(false);
  const [answer, setAnswer] = useState<ResolutionAnswer | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchSurveyState().then((state) => {
      if (active) setShow(state.show);
    });
    return () => {
      active = false;
    };
  }, []);

  // Skipping is a real choice: the customer simply never sees it again.
  const dismiss = () => {
    setShow(false);
    void submitSurveyFeedback({ resolved: answer ?? "partially" }).catch(() => {
      /* a skipped survey is not worth an error */
    });
  };

  const submit = async () => {
    if (!answer || sending) return;
    setSending(true);
    try {
      await submitSurveyFeedback({
        resolved: answer,
        rating: rating || undefined,
        comment: comment.trim() || undefined,
      });
    } catch (error) {
      console.error("[support] could not record the survey answer:", error);
    } finally {
      setSending(false);
      setDone(true);
    }
  };

  if (!show || done) return null;

  return (
    <div className="border-t border-yene-line-soft bg-yene-surface px-4 py-4">
      <p className="text-[11.5px] uppercase tracking-wider text-yene-faint">
        {RESOLUTION_SURVEY_INTRO}
      </p>
      <p className="mt-1.5 text-[13.5px] font-medium text-yene-text">
        {RESOLUTION_SURVEY_QUESTION}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {RESOLUTION_SURVEY_OPTIONS.map((option) => {
          const selected = answer === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setAnswer(option.value)}
              aria-pressed={selected}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent ${
                selected
                  ? "border-yene-accent bg-yene-accent-dim text-yene-accent"
                  : "border-yene-line bg-yene-raised text-yene-muted hover:text-yene-text"
              }`}
            >
              {selected && <Check size={13} />}
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Both of these are optional, so neither blocks submitting. */}
      <div className="mt-4">
        <p className="text-[12px] text-yene-muted">{RESOLUTION_SURVEY_RATING_PROMPT}</p>
        <div className="mt-1.5 flex items-center gap-1">
          {Array.from({ length: MAX_SURVEY_RATING }, (_, index) => index + 1).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(rating === value ? 0 : value)}
              aria-label={`${value} of ${MAX_SURVEY_RATING}`}
              aria-pressed={rating === value}
              className="rounded p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent"
            >
              <Star
                size={17}
                className={value <= rating ? "text-yene-accent" : "text-yene-faint"}
                fill={value <= rating ? "currentColor" : "none"}
              />
            </button>
          ))}
          {rating > 0 && <span className="ml-1 text-[11.5px] text-yene-faint">{rating}/5</span>}
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="yene-survey-comment" className="block text-[12px] text-yene-muted">
          {RESOLUTION_SURVEY_FEEDBACK_PROMPT}
        </label>
        <textarea
          id="yene-survey-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={1000}
          rows={2}
          className="mt-1.5 w-full resize-none rounded-lg border border-yene-line bg-yene-raised px-3 py-2 text-[12.5px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none focus:ring-1 focus:ring-yene-accent/40"
        />
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg px-3 py-1.5 text-[12px] text-yene-muted transition-colors hover:text-yene-text"
        >
          {RESOLUTION_SURVEY_SKIP_LABEL}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!answer || sending}
          className="rounded-lg bg-yene-accent px-3.5 py-1.5 text-[12px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong disabled:opacity-40"
        >
          {sending ? RESOLUTION_SURVEY_SENDING_LABEL : RESOLUTION_SURVEY_SUBMIT_LABEL}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-yene-faint">{RESOLUTION_SURVEY_THANKS}</p>
    </div>
  );
};

