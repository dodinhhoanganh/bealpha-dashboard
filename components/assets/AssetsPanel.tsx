"use client";

import { useState, useEffect, useCallback } from "react";
import { UserSession } from "@/lib/types";
import { apiRequest } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import AssetForm from "@/components/releases/AssetForm";
import Pagination from "@/components/ui/Pagination";
import { TableSkeleton } from "@/components/ui/Skeleton";
import {
  AudioFileIcon,
  SearchIcon,
  DeleteIcon,
  ArrowBackIcon,
  FilterListIcon,
  CloudUploadIcon,
  CheckCircleIcon,
  PendingIcon,
  CancelIcon,
} from "@/components/ui/Icon";

// ============ ASSETS COMPONENT ============
export default function AssetsPanel({ user }: { user: UserSession }) {
  const { t } = useI18n(); // Auto-injected

  const [assets, setAssets] = useState<any[]>([]);
  const [artists, setArtists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [view, setView] = useState<"list" | "upload">("list");

  const canUpload = user.permissions.includes("release.create");
  const canDelete = user.permissions.includes("release.delete");

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiRequest<any[]>("/api/v1/media/assets");
      const query = search.trim().toLowerCase();
      const filtered = rows.filter((asset) =>
        (typeFilter === "all" || asset.type === typeFilter) &&
        (!query || asset.fileName?.toLowerCase().includes(query)),
      );
      setAssets(filtered.slice((page - 1) * limit, page * limit));
      setTotal(filtered.length);
      setTotalPages(Math.max(1, Math.ceil(filtered.length / limit)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, search, page, limit]);

  const fetchArtists = useCallback(async () => {
    try {
      setArtists(await apiRequest<any[]>("/api/v1/catalog/artists"));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleCreateArtist = async (artist: {
    name: string;
    spotifyId?: string;
    appleMusicId?: string;
  }): Promise<string> => {
    try {
      const newArtist = await apiRequest<{ artistId: string }>("/api/v1/catalog/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artist),
      });
      await fetchArtists();
      return newArtist.artistId;
    } catch (error) {
      console.error("Error creating artist:", error);
      throw error;
    }
  };

  useEffect(() => {
    fetchAssets();
    fetchArtists();
  }, [fetchAssets, fetchArtists]);

  // Global search listener
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail.type === "ASSET") {
        setSearch(e.detail.title);
        setPage(1);
      }
    };
    window.addEventListener("open-entity", handler as EventListener);
    return () => window.removeEventListener("open-entity", handler as EventListener);
  }, []);

  const handleDelete = async (id: string) => {
    const asset = assets.find((a) => a.id === id);
    const msg = t("common.confirmDeleteAsset", `Are you sure you want to delete "${asset?.originalFileName || asset?.fileName || "this asset"}"?`) + `\n\n- ` + t("common.tracksWillBeUnlinked", "Tracks using this audio file will be unlinked") + `\n- ` + t("common.audioWillBeDeleted", "The audio file will be permanently deleted") + `\n\n` + t("common.cannotBeUndone");
    if (!confirm(msg)) return;
    try {
      await apiRequest(`/api/v1/media/assets/${id}`, { method: "DELETE" });
      fetchAssets();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSubmitAsset = async (formData: any) => {
    try {
      if (!formData.assetId) throw new Error(t("common.audioFileRequired"));

      setView("list");
      fetchAssets();
    } catch (error: any) {
      alert(error.message || t("common.errorOccurred"));
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "-";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Upload/Edit Form View
  if (view === "upload") {
    return (
      <div className="p-6">
        {/* Header with Back button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setView("list")}
            className="p-2 hover: rounded-lg transition-colors"
          >
            <ArrowBackIcon size={24} />
          </button>
          <h2 className="text-xl font-medium">
            {t("common.uploadAsset")}
          </h2>
        </div>

        <div className="max-w-4xl">
          <AssetForm
            asset={null}
            artists={artists}
            onSubmit={handleSubmitAsset}
            onCancel={() => setView("list")}
            onCreateArtist={handleCreateArtist}
          />
        </div>
      </div>
    );
  }

  // Assets now use server-side search
  const filteredAssets = assets;

  // List View
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("assets.title")}</h2>
        {canUpload && (
          <button
            onClick={() => setView("upload")}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg text-sm font-medium transition-colors"
          >
            <CloudUploadIcon size={18} />
            {t("common.upload")}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <SearchIcon
            size={20}
            color="#6b7280"
            className="absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("assets.searchPlaceholder")}
            className="w-full pl-10 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div className="flex items-center gap-2">
          <FilterListIcon size={20} color="#6b7280" />
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="all">{t("dashboard.allTypes")}</option>
            <option value="AUDIO">{t("dashboard.audio")}</option>
            <option value="VIDEO">{t("dashboard.video")}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : filteredAssets.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-disabled)]">
          <AudioFileIcon size={48} color="#525252" />
          <p className="mt-2">{t("assets.noAssets")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[var(--text-tertiary)] text-sm border-b border-[var(--border-primary)]">
                <th className="pb-3 font-medium">{t("assets.fileName")}</th>
                <th className="pb-3 font-medium">{t("dashboard.type")}</th>
                <th className="pb-3 font-medium">{t("dashboard.size")}</th>
                <th className="pb-3 font-medium">{t("assets.duration")}</th>
                <th className="pb-3 font-medium">{t("common.status")}</th>
                <th className="pb-3 font-medium">{t("dashboard.release")}</th>
                <th className="pb-3 font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset) => (
                <tr
                  key={asset.id}
                  className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]"
                >
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded flex items-center justify-center ${
                          asset.type === "AUDIO"
                            ? "bg-purple-500/20"
                            : "bg-[var(--status-info-surface)]"
                        }`}
                      >
                        <AudioFileIcon
                          size={20}
                          color={asset.type === "AUDIO" ? "#a855f7" : "#3b82f6"}
                        />
                      </div>
                      <div>
                        <span className="font-medium block">
                          {asset.originalFileName || asset.fileName}
                        </span>
                        {asset.isrc && (
                          <span className="text-xs text-[var(--text-disabled)]">
                            {asset.isrc}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-4">
                    <span
                      className={`px-2 py-1 rounded text-sm ${
                        asset.type === "AUDIO"
                          ? "bg-[rgba(162,56,255,0.1)] text-[var(--color-deezer)]"
                          : "bg-[var(--status-info-surface)] text-[var(--status-info)]"
                      }`}
                    >
                      {asset.type}
                    </span>
                  </td>
                  <td className="py-4 text-[var(--text-tertiary)]">
                    {formatFileSize(asset.fileSize)}
                  </td>
                  <td className="py-4 text-[var(--text-tertiary)]">
                    {formatDuration(asset.duration)}
                  </td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm ${
                        asset.status === "READY"
                          ? "text-[var(--accent-text)] bg-[var(--status-success-surface)]"
                          : asset.status === "PROCESSING"
                            ? "text-[var(--status-warning)] bg-[var(--status-warning-surface)]"
                            : asset.status === "ERROR"
                              ? "text-[var(--status-error)] bg-[var(--status-error-surface)]"
                              : "text-[var(--text-tertiary)] bg-[var(--bg-elevated)]"
                      }`}
                    >
                      {asset.status === "READY" && (
                        <CheckCircleIcon size={14} />
                      )}
                      {asset.status === "PROCESSING" && (
                        <PendingIcon size={14} />
                      )}
                      {asset.status === "ERROR" && <CancelIcon size={14} />}
                      <span className="capitalize">
                        {asset.status?.toLowerCase() || "pending"}
                      </span>
                    </span>
                  </td>
                  <td className="py-4 text-[var(--text-tertiary)]">
                    {asset.release?.title || "-"}
                  </td>
                  <td className="py-4">
                    <div className="flex items-center gap-1">
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(asset.id)}
                          className="p-2 hover:bg-[var(--status-error-surface)] rounded-lg"
                          title={t("common.delete")}
                        >
                          <DeleteIcon size={18} color="#ef4444" />
                        </button>
                      )}
                    </div>
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
    </div>
  );
}
