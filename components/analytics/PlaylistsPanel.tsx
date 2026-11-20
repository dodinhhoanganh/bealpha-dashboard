"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { RefreshIcon, QueueMusicIcon } from "@/components/ui/Icon";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { apiRequest } from "@/lib/api-client";
import type { UserSession } from "@/lib/types";

export interface PlaylistSummary {
  id: string;
  name: string;
  platform: string;
  cover?: string | null;
  color?: string | null;
  followers?: number | null;
  trackCount?: number | null;
}

interface PlaylistsPanelProps {
  user: UserSession;
}

export default function PlaylistsPanel({ user }: PlaylistsPanelProps) {
  const { t } = useI18n();
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlaylists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiRequest<PlaylistSummary[]>("/api/v1/catalog/playlists");
      setPlaylists(rows);
    } catch (e) {
      console.error("Failed to load playlists", e);
      setPlaylists([]);
      setError(e instanceof Error ? e.message : t("common.errorOccurred", "Something went wrong."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (user.entityType !== "SUPER_ADMIN") {
      setLoading(false);
      setError(t("errors.forbidden.description", "You do not have access to this area."));
      return;
    }
    void fetchPlaylists();
  }, [fetchPlaylists, t, user.entityType]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("nav.playlists", "Playlists")}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {t("playlists.manageDescription", "Manage global DSP playlists and pitching")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void fetchPlaylists()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] rounded-lg transition-colors text-sm font-medium"
          >
            <RefreshIcon size={18} /> {t("common.refresh", "Refresh")}
          </button>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={4} />
      ) : error ? (
        <div role="alert" className="border-y border-[var(--border-primary)] py-10 text-center text-sm text-[var(--status-error)]">
          <p>{error}</p>
          {user.entityType === "SUPER_ADMIN" && (
            <button type="button" onClick={() => void fetchPlaylists()} className="mt-3 underline underline-offset-2">
              {t("common.retry", "Retry")}
            </button>
          )}
        </div>
      ) : playlists.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-disabled)]">
          <QueueMusicIcon size={48} className="mx-auto mb-3 opacity-50" />
          <p>{t("playlists.noPlaylists", "No playlists found.")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {playlists.map((playlist) => (
            <div key={playlist.id} className="p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] flex gap-4 items-center">
              <div 
                className="w-16 h-16 rounded-lg bg-cover bg-center shrink-0 border border-[var(--border-input)]"
                style={{ backgroundImage: playlist.cover ? `url(${playlist.cover})` : 'none', backgroundColor: playlist.color || '#333' }}
              />
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-[var(--text-primary)] truncate" title={playlist.name}>{playlist.name}</h3>
                <p className="text-xs text-[var(--text-secondary)] mt-1">{playlist.platform}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-tertiary)]">
                  <span>{playlist.followers?.toLocaleString() || 0} {t("ui.playlistsPanel.followers", "followers")}</span>
                  <span>{playlist.trackCount || 0} {t("nav.tracks", "tracks")}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
