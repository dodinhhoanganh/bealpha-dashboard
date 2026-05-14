"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  CheckCircleIcon,
  CancelIcon,
  LocalShippingIcon,
  AttachMoneyIcon,
  AlbumIcon,
  CampaignIcon,
  ScheduleIcon,
  CelebrationIcon,
  CloseIcon,
  DoneAllIcon,
  DeleteOutlineIcon,
} from "@/components/Icon";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";
import { faBell as faBellRegular } from "@fortawesome/free-regular-svg-icons";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  link?: string | null;
  createdAt: string;
}

interface NotificationBellProps {
  onNavigate?: (panel: string) => void;
}

export default function NotificationBell({
  onNavigate,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch unread count on mount + poll every 30s
  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=1&unread=true");
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  // Fetch full list when dropdown opens
  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.data || []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      /* silent */
    }
    setLoading(false);
  };

  const handleOpen = () => {
    setOpen(!open);
    if (!open) fetchNotifications();
  };

  // Mark all as read
  const markAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      /* silent */
    }
  };

  // Mark single as read + navigate
  const handleClick = async (notification: Notification) => {
    if (!notification.read) {
      try {
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [notification.id] }),
        });
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, read: true } : n,
          ),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        /* silent */
      }
    }

    if (notification.link && onNavigate) {
      onNavigate(notification.link);
      setOpen(false);
    }
  };

  // Clear all
  const clearAll = async () => {
    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications([]);
      setUnreadCount(0);
    } catch {
      /* silent */
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("time.justNow", "Just now");
    if (mins < 60) return `${mins}${t("time.minutesShort", "m")}`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}${t("time.hoursShort", "h")}`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}${t("time.daysShort", "d")}`;
    return new Date(dateStr).toLocaleDateString();
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case "release_approved":
        return (
          <CheckCircleIcon size={18} className="text-[var(--accent-text)]" />
        );
      case "release_denied":
        return <CancelIcon size={18} className="text-[var(--status-error)]" />;
      case "release_scheduled":
        return <ScheduleIcon size={18} className="text-[var(--status-info)]" />;
      case "release_released":
        return (
          <CelebrationIcon size={18} className="text-[var(--color-deezer)]" />
        );
      case "new_royalty":
        return (
          <AttachMoneyIcon size={18} className="text-[var(--status-warning)]" />
        );
      case "delivery_confirmed":
        return (
          <LocalShippingIcon size={18} className="text-[var(--accent-text)]" />
        );
      case "delivery_failed":
        return (
          <LocalShippingIcon size={18} className="text-[var(--status-error)]" />
        );
      case "welcome":
        return (
          <CelebrationIcon size={18} className="text-[var(--accent-text)]" />
        );
      default:
        return (
          <CampaignIcon size={18} className="text-[var(--text-tertiary)]" />
        );
    }
  };

  return (
    <div ref={dropdownRef} className="relative">
      {/* Bell Button */}
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg transition-colors"
        style={{ color: "var(--text-tertiary)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.background = "var(--bg-elevated)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-tertiary)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        {unreadCount > 0 ? (
          <FontAwesomeIcon icon={faBell} style={{ width: 16, height: 16 }} />
        ) : (
          <FontAwesomeIcon
            icon={faBellRegular}
            style={{ width: 16, height: 16 }}
          />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-[var(--status-error)] rounded-full text-[10px] font-bold text-[var(--text-primary)] flex items-center justify-center px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl z-50 max-h-[70vh] flex flex-col"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-primary)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid var(--border-primary)" }}
          >
            <h3
              className="text-sm font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {t("notifications.title", "Notifications")}
            </h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="p-1.5 text-xs rounded-lg transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  title={t("notifications.markAllRead", "Mark all read")}
                >
                  <DoneAllIcon size={16} />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="p-1.5 text-xs rounded-lg transition-colors"
                  style={{ color: "var(--text-tertiary)" }}
                  title={t("notifications.clearAll", "Clear all")}
                >
                  <DeleteOutlineIcon size={16} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: "var(--text-tertiary)" }}
              >
                <CloseIcon size={16} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div
                  className="animate-spin rounded-full h-5 w-5"
                  style={{ borderBottom: "2px solid var(--text-tertiary)" }}
                ></div>
              </div>
            ) : notifications.length === 0 ? (
              <div
                className="py-10 text-center text-sm"
                style={{ color: "var(--text-tertiary)" }}
              >
                <FontAwesomeIcon
                  icon={faBellRegular}
                  style={{
                    width: 28,
                    height: 28,
                    color: "var(--text-disabled)",
                  }}
                />
                <p className="mt-2">{t("notifications.noNotifications", "No notifications")}</p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors last:border-0"
                  style={{
                    borderBottom: "1px solid var(--border-subtle)",
                    background: !n.read
                      ? "var(--accent-surface)"
                      : "transparent",
                  }}
                >
                  <div className="mt-0.5 shrink-0">{typeIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className="text-sm truncate"
                        style={{
                          fontWeight: !n.read ? 500 : 400,
                          color: !n.read
                            ? "var(--text-primary)"
                            : "var(--text-secondary)",
                        }}
                      >
                        {n.title}
                      </p>
                      <span
                        className="text-[10px] shrink-0"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>
                    <p
                      className="text-xs mt-0.5 line-clamp-2"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {n.message}
                    </p>
                  </div>
                  {!n.read && (
                    <div
                      className="w-2 h-2 rounded-full mt-2 shrink-0"
                      style={{ background: "var(--accent)" }}
                    ></div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
