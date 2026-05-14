"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { SearchIcon, AddIcon, RefreshIcon, EditIcon, QueueMusicIcon } from "./Icon";
import Pagination from "./Pagination";
import { TableSkeleton } from "./Skeleton";

interface PlaylistsPanelProps {
  user: any;
}

export default function PlaylistsPanel({ user }: PlaylistsPanelProps) {
  const { t } = useI18n();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlaylists = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/playlists`);
      const data = await res.json();
      if (res.ok) {
        setPlaylists(data || []);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPlaylists();
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("nav.playlists", "Playlists")}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Manage global DSP playlists and pitching
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchPlaylists}
            className="flex items-center gap-2 px-4 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] rounded-lg transition-colors text-sm font-medium"
          >
            <RefreshIcon size={18} /> {t("common.refresh", "Refresh")}
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors text-sm font-medium">
            <AddIcon size={18} /> Create Playlist
          </button>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={4} />
      ) : playlists.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-disabled)]">
          <QueueMusicIcon size={48} className="mx-auto mb-3 opacity-50" />
          <p>No playlists found.</p>
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
                  <span>{playlist.followers?.toLocaleString() || 0} followers</span>
                  <span>{playlist.trackCount || 0} tracks</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
