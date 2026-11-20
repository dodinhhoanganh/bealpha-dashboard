"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { SearchIcon, AddIcon, RefreshIcon, EditIcon, AlbumIcon } from "@/components/ui/Icon";
import Pagination from "@/components/ui/Pagination";
import CompositionModal from "@/components/releases/CompositionModal";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { apiRequest } from "@/lib/api-client";
import type { UserSession } from "@/lib/types";
import { canManageCatalogRecord } from "@/lib/ui-capabilities";

interface CompositionAuthor {
  name: string;
  role: string;
  share?: number | string;
  shareBasisPoints?: number;
}

export interface CompositionSummary {
  id: string;
  title: string;
  iswc?: string | null;
  authors?: CompositionAuthor[] | null;
  trackCount?: number | null;
  createdAt: string;
  genre?: string | null;
}

interface CompositionsPanelProps {
  user: UserSession;
}

export default function CompositionsPanel({ user }: CompositionsPanelProps) {
  const { t } = useI18n();
  const canRead = user.permissions.includes("release.read");
  const canCreate = canManageCatalogRecord(user, "composition", "create");
  const canUpdate = canManageCatalogRecord(user, "composition", "update");
  const [compositions, setCompositions] = useState<CompositionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editingComposition, setEditingComposition] = useState<CompositionSummary | null>(null);

  const fetchCompositions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiRequest<CompositionSummary[]>("/api/v1/catalog/compositions");
      const query = search.trim().toLowerCase();
      const filtered = query
        ? rows.filter((composition) => composition.title.toLowerCase().includes(query))
        : rows;
      setCompositions(filtered.slice((page - 1) * limit, page * limit));
      setTotal(filtered.length);
      setTotalPages(Math.max(1, Math.ceil(filtered.length / limit)));
    } catch (e) {
      console.error("Failed to load compositions", e);
      setCompositions([]);
      setTotal(0);
      setTotalPages(1);
      setError(e instanceof Error ? e.message : t("common.errorOccurred", "Something went wrong."));
    } finally {
      setLoading(false);
    }
  }, [limit, page, search, t]);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      setError(t("errors.forbidden.description", "You do not have access to this area."));
      return;
    }
    void fetchCompositions();
  }, [canRead, fetchCompositions, t]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("nav.compositions", "Compositions")}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {t("compositions.manageDescription", "Manage publishing rights, authors, and musical works")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void fetchCompositions()}
            disabled={loading || !canRead}
            className="flex items-center gap-2 px-4 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] rounded-lg transition-colors text-sm font-medium"
          >
            <RefreshIcon size={18} /> {t("common.refresh", "Refresh")}
          </button>
          {canCreate && (
            <button type="button" onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors text-sm font-medium">
              <AddIcon size={18} /> {t("compositions.createComposition", "Create Composition")}
            </button>
          )}
        </div>
      </div>

      <div className="relative max-w-md mb-6">
        <SearchIcon
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]"
        />
        <input
          type="text"
          placeholder={t("compositions.searchPlaceholder", "Search by title...")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full pl-9 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {loading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : error ? (
        <div role="alert" className="border-y border-[var(--border-primary)] py-10 text-center text-sm text-[var(--status-error)]">
          <p>{error}</p>
          <button type="button" onClick={() => void fetchCompositions()} className="mt-3 underline underline-offset-2">
            {t("common.retry", "Retry")}
          </button>
        </div>
      ) : compositions.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-disabled)]">
          <AlbumIcon size={48} className="mx-auto mb-3 opacity-50" />
          <p>{t("compositions.noCompositions", "No compositions found.")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-primary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider bg-[var(--bg-elevated)]">
                <th className="text-left px-4 py-3 font-medium">{t("compositions.title", "Title")}</th>
                <th className="text-left px-4 py-3 font-medium">ISWC</th>
                <th className="text-left px-4 py-3 font-medium">{t("compositions.authors", "Authors")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("heading.tracks", "Tracks")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("common.created", "Created")}</th>
                {canUpdate && <th className="text-right px-4 py-3 font-medium">{t("common.actions", "Actions")}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-primary)]">
              {compositions.map((comp) => (
                <tr key={comp.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                  <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                    {comp.title}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] font-mono text-xs">
                    {comp.iswc || t("common.na", "N/A")}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {comp.authors ? comp.authors.length + " " + t("compositions.authors", "Authors") : t("common.none")}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {comp.trackCount ?? 0}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">
                    {new Date(comp.createdAt).toLocaleDateString()}
                  </td>
                  {canUpdate && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingComposition(comp);
                          setShowModal(true);
                        }}
                        className="text-[var(--accent)] hover:text-[var(--accent-hover)] px-2 py-1"
                        aria-label={t("common.edit", "Edit")}
                        title={t("common.edit", "Edit")}
                      >
                        <EditIcon size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPageChange={(p) => setPage(p)}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
      />

      {showModal && (
        <CompositionModal
          composition={editingComposition ?? undefined}
          onClose={() => {
            setShowModal(false);
            setEditingComposition(null);
          }}
          onSuccess={() => {
            setShowModal(false);
            setEditingComposition(null);
            fetchCompositions();
          }}
        />
      )}
    </div>
  );
}
