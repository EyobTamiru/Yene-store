import { AlertTriangle, ArrowLeft, Check, Eye, LogIn, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LANGUAGE,
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_STATUSES,
  type KnowledgeArticle,
  type ValidationIssue,
} from "../../knowledge/types";
import {
  AdminError,
  getAdminToken,
  getKnowledgeArticle,
  listKnowledge,
  testKnowledge,
  saveKnowledgeArticle,
  setAdminToken,
  type AdminStats,
  type ArticleSummary,
  type TestResult,
} from "../../lib/adminApi";

const inputClass =
  "w-full rounded-lg border border-yene-line bg-yene-raised px-3 py-2 text-[13px] text-yene-text placeholder:text-yene-faint focus:border-yene-accent focus:outline-none focus:ring-1 focus:ring-yene-accent/40";
const labelClass = "mb-1 block text-[11.5px] font-medium text-yene-muted";

/** The shape a new article starts from. */
function blankArticle(): KnowledgeArticle {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  return {
    id: "",
    title: "",
    category: "platform",
    status: "draft",
    audience: "all",
    language: DEFAULT_LANGUAGE,
    version: 1,
    createdBy: "",
    createdAt: now,
    updatedBy: "",
    updatedAt: now,
    lastReviewed: today,
    reviewedBy: "",
    requiresAccountData: false,
    keywords: [],
    related: [],
    body: "",
  };
}

const selectClass = `${inputClass} appearance-none`;

export const KnowledgeAdminPage = ({ onBack }: { onBack?: () => void }) => {
  const [token, setToken] = useState(getAdminToken());
  const [unlocked, setUnlocked] = useState(Boolean(getAdminToken()));
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<KnowledgeArticle | null>(null);
  const [draft, setDraft] = useState<KnowledgeArticle | null>(null);
  const [saveState, setSaveState] = useState<{ kind: string; message?: string }>({ kind: "idle" });
  const [saveIssues, setSaveIssues] = useState<ValidationIssue[]>([]);
  const [previewQuery, setPreviewQuery] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await listKnowledge();
      setStats(data.stats);
      setArticles(data.articles);
      setIssues(data.issues);
      setUnlocked(true);
    } catch (error) {
      setUnlocked(false);
      setLoadError(error instanceof AdminError ? error.message : "Could not reach the admin API.");
    }
  }, []);

  useEffect(() => {
    if (getAdminToken()) void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter(
      (a) =>
        a.id.includes(q) ||
        a.title.toLowerCase().includes(q) ||
        a.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  }, [articles, filter]);

  const openArticle = async (id: string) => {
    setSaveState({ kind: "idle" });
    setSaveIssues([]);
    try {
      const { article } = await getKnowledgeArticle(id);
      setEditing(article);
      setDraft({ ...article });
    } catch (error) {
      setSaveIssues([{ file: id, level: "error", message: (error as Error).message }]);
    }
  };

  const createNew = () => {
    setEditing(blankArticle());
    setDraft(blankArticle());
    setSaveState({ kind: "idle" });
    setSaveIssues([]);
  };

  const save = async () => {
    if (!draft) return;
    setSaveState({ kind: "saving" });
    setSaveIssues([]);
    try {
      // Recorded in the version history alongside the change.
      const changeNote = draft.status === "published" ? "Published update" : "Draft update";
      const result = await saveKnowledgeArticle(draft, changeNote);
      setStats(result.stats);
      setSaveIssues(result.warnings);
      setSaveState({ kind: "saved", message: `Saved to knowledge-base/${result.file.replace(/\\/g, "/")}` });
      await load();
    } catch (error) {
      setSaveState({ kind: "error" });
      setSaveIssues(
        error instanceof AdminError
          ? error.issues.length
            ? error.issues
            : [{ file: draft.id, level: "error", message: error.message }]
          : [{ file: draft.id, level: "error", message: "Save failed." }],
      );
    }
  };

  const runTest = async () => {
    if (!previewQuery.trim()) return;
    setIsTesting(true);
    try {
      setTestResult(await testKnowledge(previewQuery));
    } catch (e) {
      setSaveIssues([{ file: "test", level: "error", message: (e as Error).message }]);
    } finally {
      setIsTesting(false);
    }
  };

  // ---------------------------------------------------------------- unlock
  if (!unlocked) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
        <div className="rounded-2xl border border-yene-line-soft bg-yene-surface p-6">
          <h1 className="text-lg font-semibold text-yene-text">Knowledge base admin</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-yene-muted">
            Enter the <code className="text-yene-accent">YENE_KB_ADMIN_TOKEN</code> to
            manage the Yene-Store knowledge base. The token is kept in this tab only.
          </p>
          {loadError && (
            <p className="mt-3 rounded-lg border border-yene-danger/30 bg-yene-danger/10 p-2.5 text-[12.5px] text-yene-text">
              {loadError}
            </p>
          )}
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setAdminToken(token);
              void load();
            }}
          >
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Admin token"
              className={inputClass}
              autoComplete="off"
            />
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-yene-accent px-4 py-2.5 text-sm font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong"
            >
              <LogIn size={15} /> Unlock
            </button>
          </form>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-yene-muted hover:text-yene-accent"
            >
              <ArrowLeft size={14} /> Back to support
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- editor
  if (editing && draft) {
    const patch = (next: Partial<KnowledgeArticle>) =>
      setDraft((current) => (current ? { ...current, ...next } : current));

    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft(null);
                setSaveState({ kind: "idle" });
              }}
              className="rounded-lg p-1.5 text-yene-muted hover:bg-yene-raised hover:text-yene-text"
              aria-label="Back to article list"
            >
              <ArrowLeft size={16} />
            </button>
            <h1 className="text-base font-semibold text-yene-text">
              {editing.id ? `Edit ${editing.id}` : "New article"}
            </h1>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saveState.kind === "saving"}
            className="rounded-lg bg-yene-accent px-4 py-2 text-[13px] font-semibold text-yene-on-accent transition-colors hover:bg-yene-accent-strong disabled:opacity-50"
          >
            {saveState.kind === "saving" ? "Saving..." : "Save article"}
          </button>
        </div>

        {saveState.kind === "saved" && saveState.message && (
          <p className="mb-3 flex items-center gap-2 rounded-lg border border-yene-accent/30 bg-yene-accent-dim p-2.5 text-[12.5px] text-yene-text">
            <Check size={14} className="text-yene-accent" /> {saveState.message}
          </p>
        )}

        {saveIssues.length > 0 && (
          <div className="mb-3 rounded-lg border border-yene-danger/30 bg-yene-danger/10 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-yene-text">
              <AlertTriangle size={13} className="text-yene-danger" /> Fix before saving
            </p>
            <ul className="space-y-1">
              {saveIssues.map((issue, i) => (
                <li key={i} className="text-[12px] text-yene-muted">
                  {issue.file}: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Id (the filename becomes id.md)</label>
            <input
              value={draft.id}
              disabled={Boolean(editing.id)}
              onChange={(e) => patch({ id: e.target.value.trim().toLowerCase() })}
              placeholder="features-store"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Title</label>
            <input
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Store"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Category</label>
            <select
              value={draft.category}
              onChange={(e) => patch({ category: e.target.value as KnowledgeArticle["category"] })}
              className={selectClass}
            >
              {KNOWLEDGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select
              value={draft.status}
              onChange={(e) => patch({ status: e.target.value as KnowledgeArticle["status"] })}
              className={selectClass}
            >
              {KNOWLEDGE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Audience</label>
            <select
              value={draft.audience}
              onChange={(e) => patch({ audience: e.target.value as KnowledgeArticle["audience"] })}
              className={selectClass}
            >
              {KNOWLEDGE_AUDIENCES.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Last reviewed</label>
            <input
              type="date"
              value={draft.lastReviewed}
              onChange={(e) => patch({ lastReviewed: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Reviewed by</label>
            <input
              value={draft.reviewedBy}
              onChange={(e) => patch({ reviewedBy: e.target.value })}
              placeholder="Yene Business Group"
              className={inputClass}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-[12.5px] text-yene-text">
              <input
                type="checkbox"
                checked={Boolean(draft.requiresAccountData)}
                onChange={(e) => patch({ requiresAccountData: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#3DDC97]"
              />
              Requires live account data
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Keywords (one per line)</label>
            <textarea
              value={(draft.keywords ?? []).join("\n")}
              onChange={(e) =>
                patch({ keywords: e.target.value.split("\n").map((k) => k.trim()).filter(Boolean) })
              }
              rows={4}
              placeholder={"store\nproducts\ncart\ncheckout"}
              className={`${inputClass} resize-y font-mono text-[12px]`}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Related article ids (comma separated)</label>
            <input
              value={(draft.related ?? []).join(", ")}
              onChange={(e) =>
                patch({ related: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })
              }
              placeholder="packages-standard, features-orders"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Body (markdown)</label>
            <textarea
              value={draft.body}
              onChange={(e) => patch({ body: e.target.value })}
              rows={16}
              className={`${inputClass} resize-y font-mono text-[12px] leading-relaxed`}
            />
          </div>
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-yene-faint">
          An article can only be set to <strong className="text-yene-muted">approved</strong> once
          its body has no TODO placeholder. Drafts are never shown to the model as answerable
          sources.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------ list
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-yene-text">Knowledge base</h1>
          {stats && (
            <p className="mt-0.5 text-[12.5px] text-yene-muted">
              {stats.total} articles &middot; {stats.published} published &middot;{" "}
              {stats.draft} draft &middot; {stats.archived} archived
              {stats.errors > 0 && (
                <span className="ml-2 text-yene-danger">{stats.errors} error(s)</span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setAdminToken("");
              setUnlocked(false);
            }}
            className="rounded-lg border border-yene-line px-3 py-1.5 text-[12.5px] text-yene-muted hover:text-yene-text"
          >
            Lock
          </button>
          <button
            type="button"
            onClick={createNew}
            className="rounded-lg bg-yene-accent px-3 py-1.5 text-[12.5px] font-semibold text-yene-on-accent hover:bg-yene-accent-strong"
          >
            New article
          </button>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="mb-4 rounded-lg border border-yene-warn/30 bg-yene-warn/10 p-3">
          <p className="mb-1.5 text-[12.5px] font-medium text-yene-text">Validation issues</p>
          <ul className="space-y-1">
            {issues.map((issue, i) => (
              <li key={i} className="text-[12px] text-yene-muted">
                <span className={issue.level === "error" ? "text-yene-danger" : "text-yene-warn"}>
                  [{issue.level}]
                </span>{" "}
                {issue.file}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-yene-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by id, title or keyword"
            className={`${inputClass} pl-9`}
          />
        </div>
        <div className="flex flex-1 gap-2">
          <input
            value={previewQuery}
            onChange={(e) => setPreviewQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runTest()}
            placeholder='Test: "how much does super cost"'
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => void runTest()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-yene-line px-3 text-[12.5px] text-yene-text hover:border-yene-accent hover:text-yene-accent"
          >
            <Eye size={14} /> {isTesting ? "Testing..." : "Test answer"}
          </button>
        </div>
      </div>

      {testResult && (
        <div
          className={`mb-4 rounded-xl border p-3.5 ${
            testResult.coverage.level === "ready"
              ? "border-yene-accent/30 bg-yene-accent-dim"
              : testResult.coverage.level === "review"
                ? "border-yene-warn/30 bg-yene-warn/10"
                : "border-yene-danger/30 bg-yene-danger/10"
          }`}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                testResult.coverage.level === "ready"
                  ? "bg-yene-accent text-yene-on-accent"
                  : testResult.coverage.level === "review"
                    ? "bg-yene-warn/20 text-yene-warn"
                    : "bg-yene-danger/20 text-yene-danger"
              }`}
            >
              COVERAGE: {testResult.coverage.level.toUpperCase()}
            </span>
            <span className="text-[11.5px] text-yene-muted">
              {testResult.coverage.publishedSourcesMatched} published source(s) reached
              {testResult.coverage.citedSources > 0 &&
                ` | ${testResult.coverage.citedSources} cited`}
              {testResult.coverage.willRefuse && " | will refuse to the customer"}
            </span>
          </div>

          {testResult.coverage.note && (
            <p className="mb-2 text-[11.5px] text-yene-warn">{testResult.coverage.note}</p>
          )}

          <p className="mb-1 text-[11px] uppercase tracking-wider text-yene-faint">
            AI answer
          </p>
          <p className="whitespace-pre-wrap rounded-lg border border-yene-line-soft bg-yene-bg p-2.5 text-[12.5px] leading-relaxed text-yene-text">
            {testResult.answer}
          </p>

          <p className="mb-1 mt-2.5 text-[11px] uppercase tracking-wider text-yene-faint">
            Knowledge sources used
          </p>
          {testResult.matchedSources.length > 0 ? (
            <ul className="space-y-0.5">
              {testResult.matchedSources.map((source) => (
                <li key={source.id} className="text-[11.5px] text-yene-muted">
                  <span className="text-yene-text">{source.title}</span> &middot;{" "}
                  {source.id} &middot; v{source.version} &middot; {source.status} &middot;{" "}
                  {source.categoryLabel} &middot; tier {source.tier}
                  {testResult.sources.some((c) => c.id === source.id) && (
                    <span className="text-yene-accent"> (cited)</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] text-yene-faint">No published sources reached.</p>
          )}

          {testResult.coverage.unpublishedMatches.length > 0 && (
            <>
              <p className="mb-1 mt-2.5 text-[11px] uppercase tracking-wider text-yene-faint">
                Not yet published
              </p>
              <ul className="space-y-0.5">
                {testResult.coverage.unpublishedMatches.map((m) => (
                  <li key={m.id} className="text-[11.5px] text-yene-warn">
                    {m.title} ({m.status}) — the assistant will refuse this until published
                  </li>
                ))}
              </ul>
            </>
          )}

          <details className="mt-2.5">
            <summary className="cursor-pointer text-[11.5px] text-yene-faint hover:text-yene-accent">
              AI source priority
            </summary>
            <ol className="mt-1 space-y-0.5">
              {testResult.sourcePriority.map((tier) => (
                <li key={tier.tier} className="text-[11.5px] text-yene-muted">
                  {tier.tier}. {tier.label}
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-yene-line-soft">
        <table className="w-full text-left text-[12.5px]">
          <thead className="bg-yene-surface text-yene-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Article</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">Category</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((article) => (
              <tr
                key={article.id}
                onClick={() => void openArticle(article.id)}
                className="cursor-pointer border-t border-yene-line-soft hover:bg-yene-raised"
              >
                <td className="px-3 py-2">
                  <span className="block text-yene-text">{article.title}</span>
                  <span className="text-[11px] text-yene-faint">
                    {article.id} &middot; v{article.version} &middot; {article.language}
                  </span>
                </td>
                <td className="hidden px-3 py-2 text-yene-muted sm:table-cell">
                  {article.categoryLabel}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                      article.status === "published"
                        ? "bg-yene-accent-dim text-yene-accent"
                        : article.status === "archived"
                          ? "bg-yene-raised text-yene-faint"
                          : "bg-yene-warn/15 text-yene-warn"
                    }`}
                  >
                    {article.statusLabel}
                  </span>
                </td>
                <td className="hidden px-3 py-2 text-yene-muted md:table-cell">
                  {article.lastReviewed}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-yene-muted">
                  No articles match that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-yene-muted hover:text-yene-accent"
        >
          <X size={14} /> Close admin
        </button>
      )}
    </div>
  );
};

