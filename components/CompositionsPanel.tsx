"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { SearchIcon, AddIcon, RefreshIcon, EditIcon, AlbumIcon } from "./Icon";
import Pagination from "./Pagination";
import CompositionModal from "./CompositionModal";
import { TableSkeleton } from "./Skeleton";

interface CompositionsPanelProps {
  user: any;
}

export default function CompositionsPanel({ user }: CompositionsPanelProps) {
  const { t } = useI18n();
  const [compositions, setCompositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [showModal, setShowModal] = useState(false);

  const fetchCompositions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/compositions?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`);
      const data = await res.json();
      if (res.ok) {
        setCompositions(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 0);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCompositions();
  }, [page, limit, search]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("nav.compositions", "Compositions")}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Manage publishing rights, authors, and musical works
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchCompositions}
            className="flex items-center gap-2 px-4 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] rounded-lg transition-colors text-sm font-medium"
          >
            <RefreshIcon size={18} /> {t("common.refresh", "Refresh")}
          </button>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors text-sm font-medium">
            <AddIcon size={18} /> Create Composition
          </button>
        </div>
      </div>

      <div className="relative max-w-md mb-6">
        <SearchIcon
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]"
        />
        <input
          type="text"
          placeholder="Search by title..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full pl-9 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {loading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : compositions.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-disabled)]">
          <AlbumIcon size={48} className="mx-auto mb-3 opacity-50" />
          <p>No compositions found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-primary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider bg-[var(--bg-elevated)]">
                <th className="text-left px-4 py-3 font-medium">Title</th>
                <th className="text-left px-4 py-3 font-medium">ISWC</th>
                <th className="text-left px-4 py-3 font-medium">Authors</th>
                <th className="text-left px-4 py-3 font-medium">Tracks</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-primary)]">
              {compositions.map((comp) => (
                <tr key={comp.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                  <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                    {comp.title}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] font-mono text-xs">
                    {comp.iswc || "N/A"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {comp.authors ? comp.authors.length + " Authors" : "None"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {comp.tracks ? comp.tracks.length : 0}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">
                    {new Date(comp.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-[var(--accent)] hover:text-[var(--accent-hover)] px-2 py-1">
                      <EditIcon size={16} />
                    </button>
                  </td>
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
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            fetchCompositions();
          }}
        />
      )}
    </div>
  );
}
