"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { CloseIcon } from "@/components/ui/Icon";

interface Author {
  name: string;
  role: string;
  share: number | string;
}

interface ApiAuthor {
  name: string;
  role: string;
  shareBasisPoints?: number;
}

const VALID_ROLES = [
  "Author",
  "Composer",
  "Arranger",
  "Adapter",
  "Translator",
  "Lyricist",
];

interface CompositionRecord {
  id: string;
  title?: string;
  iswc?: string | null;
  genre?: string | null;
  authors?: Array<Author | ApiAuthor> | null;
}

export default function CompositionModal({
  onClose,
  onSuccess,
  composition,
}: {
  onClose: () => void;
  onSuccess: () => void;
  composition?: CompositionRecord;
}) {
  const { t } = useI18n();
  const isEdit = !!composition?.id;
  const [title, setTitle] = useState(composition?.title ?? "");
  const [iswc, setIswc] = useState(composition?.iswc ?? "");
  const [genre, setGenre] = useState(composition?.genre ?? "");
  const [authors, setAuthors] = useState<Author[]>(
    composition?.authors && composition.authors.length > 0
      ? composition.authors.map((author) => ({
          name: author.name,
          role: author.role,
          share: "share" in author ? author.share : (author.shareBasisPoints ?? 0) / 100,
        }))
      : [{ name: "", role: "Composer", share: 100 }],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const roleLabel = (role: string) =>
    t(`roles.${role.toLowerCase()}`, role);

  const addAuthor = () => {
    setAuthors([...authors, { name: "", role: "Composer", share: 0 }]);
  };

  const removeAuthor = (index: number) => {
    setAuthors(authors.filter((_, i) => i !== index));
  };

  const updateAuthor = (index: number, field: keyof Author, value: Author[keyof Author]) => {
    const newAuthors = [...authors];
    newAuthors[index] = { ...newAuthors[index], [field]: value };
    setAuthors(newAuthors);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!title.trim()) {
      setError(t("common.titleIsRequired"));
      return;
    }

    const totalShare = authors.reduce((sum, a) => sum + (Number(a.share) || 0), 0);
    if (authors.length > 0 && Math.abs(totalShare - 100) > 0.01) {
      setError(`${t("common.totalSharesError")} (${totalShare}%)`);
      return;
    }

    setLoading(true);
    try {
      const url = isEdit ? `/api/v1/catalog/compositions/${composition!.id}` : "/api/v1/catalog/compositions";
      const method = isEdit ? "PATCH" : "POST";
      await apiRequest(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          iswc: iswc || (isEdit ? null : undefined),
          genre: genre || (isEdit ? null : undefined),
          authors: authors.map((author) => ({
            name: author.name,
            role: author.role,
            shareBasisPoints: Math.round(Number(author.share) * 100),
          })),
        }),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("common.unexpectedError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-primary)] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-[var(--border-primary)] flex justify-between items-center">
          <h2 className="text-xl font-bold text-[var(--text-primary)]">
            {isEdit
              ? t("compositions.editComposition", "Edit Composition")
              : t("compositions.createComposition", "Create Composition")}
          </h2>
          <button
            type="button"
            aria-label={t("ui.modal.closeDialog", "Close dialog")}
            title={t("ui.modal.closeDialog", "Close dialog")}
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-[var(--status-error-surface)] border border-[var(--status-error)]/50 text-[var(--status-error)] text-sm">
              {error}
            </div>
          )}

          <form id="composition-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  {t("compositions.title", "Title")} *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  placeholder={t("compositions.placeholder.title", "e.g. Shape of You")}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  ISWC
                </label>
                <input
                  type="text"
                  value={iswc}
                  onChange={(e) => setIswc(e.target.value)}
                  placeholder={t("compositions.placeholder.iswc", "e.g. T-123.456.789-Z")}
                  className="w-full px-4 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] font-mono text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                {t("form.genre", "Genre")}
              </label>
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder={t("compositions.placeholder.genre", "e.g. Pop")}
                className="w-full px-4 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            <div className="pt-4 border-t border-[var(--border-primary)]">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)]">
                    {t("compositions.authorsSplits", "Authors (Splits)")}
                  </label>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {t("compositions.totalShareMust100", "Total share must equal exactly 100%.")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addAuthor}
                  className="px-3 py-1.5 text-[var(--accent)] hover:bg-[var(--accent-surface)] rounded-lg text-sm font-medium transition-colors"
                >
                  + {t("compositions.addAuthor", "Add Author")}
                </button>
              </div>

              <div className="space-y-3">
                {authors.map((author, index) => (
                  <div key={index} className="flex flex-wrap sm:flex-nowrap items-center gap-3">
                    <input
                      type="text"
                      placeholder={t("compositions.placeholder.authorName", "Author name")}
                      value={author.name}
                      onChange={(e) => updateAuthor(index, "name", e.target.value)}
                      className="flex-1 min-w-[150px] px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                      required
                    />
                    <select
                      value={author.role}
                      onChange={(e) => updateAuthor(index, "role", e.target.value)}
                      className="w-32 px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                    >
                      {VALID_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                    <div className="relative w-24">
                      <input
                        type="number"
                        placeholder={t("compositions.placeholder.share", "Share")}
                        value={author.share}
                        onChange={(e) => updateAuthor(index, "share", e.target.value)}
                        className="w-full px-3 py-2 pr-8 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                        required
                        min="0"
                        max="100"
                        step="0.01"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)] text-sm font-medium">
                        %
                      </span>
                    </div>
                    {authors.length > 1 && (
                      <button
                        type="button"
                        aria-label={`${t("common.remove", "Remove")} ${author.name || t("roles.author", "author")}`}
                        title={t("common.remove", "Remove")}
                        onClick={() => removeAuthor(index)}
                        className="text-[var(--status-error)] opacity-70 hover:opacity-100 hover:bg-[var(--status-error-surface)] p-2 rounded-md transition-all"
                      >
                        <CloseIcon size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </form>
        </div>

        <div className="p-6 border-t border-[var(--border-primary)] flex justify-end gap-3 bg-[var(--bg-primary)] rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-lg font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="composition-form"
            disabled={loading}
            className="px-6 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg font-medium transition-colors disabled:opacity-50 min-w-[140px]"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t("common.saving")}
              </span>
            ) : isEdit ? (
              t("compositions.updateComposition", "Update Composition")
            ) : (
              t("compositions.saveComposition", "Save Composition")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
