"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useToast } from "@/components/Toast";
import Pagination from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
import Modal from "@/components/Modal";
import {
  HistoryIcon,
  SearchIcon,
  FilterListIcon,
  RefreshIcon,
  DownloadIcon,
  KeyboardArrowDownIcon,
  VisibilityIcon,
  PersonIcon,
  EditIcon,
  DeleteIcon,
  AddIcon,
  CheckCircleIcon,
  WarningIcon,
  SettingsIcon,
} from "@/components/Icon";

export default function AuditLogPanel() {
  const { t } = useI18n(); // Auto-injected

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [availableEntities, setAvailableEntities] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (search) params.set("search", search);
      if (actionFilter) params.set("action", actionFilter);
      if (entityFilter) params.set("entityType", entityFilter);
      const res = await fetch(`/api/audit-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        if (data.filters) {
          setAvailableActions(data.filters.actions || []);
          setAvailableEntities(data.filters.entityTypes || []);
        }
      }
    } catch (e) {
      console.error("Failed to fetch audit logs:", e);
    }
    setLoading(false);
  }, [page, limit, search, actionFilter, entityFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const actionColor = (action: string) => {
    switch (action) {
      case "CREATE":
        return "bg-green-900/40 text-[var(--accent-text)]";
      case "UPDATE":
        return "bg-blue-900/40 text-[var(--status-info)]";
      case "DELETE":
        return "bg-red-900/40 text-[var(--status-error)]";
      case "LOGIN":
        return "bg-purple-900/40 text-[var(--color-deezer)]";
      case "LOGOUT":
        return "bg-yellow-900/40 text-yellow-400";
      default:
        return " text-[var(--text-tertiary)]";
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("nav.auditLog")}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Track all system activity and changes
          </p>
        </div>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 px-4 py-2  hover: text-[var(--text-primary)] text-sm rounded-lg transition-colors"
        >
          <RefreshIcon size={18} /> {t("common.refresh")}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]"
          />
          <input
            type="text"
            placeholder={t("form.placeholder.searchEntityTypeEntityID", "Search entity type, entity ID...")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:border-green-500"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-input)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-green-500"
        >
          <option value="">{t("dashboard.allActions")}</option>
          {availableActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={entityFilter}
          onChange={(e) => {
            setEntityFilter(e.target.value);
            setPage(1);
          }}
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-input)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-green-500"
        >
          <option value="">{t("dashboard.allEntities")}</option>
          {availableEntities.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-disabled)]">
          <HistoryIcon size={48} className="mx-auto mb-3 opacity-50" />
          <p>{t("dashboard.noAuditLogEntries")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-primary)]">
          <table className="w-full text-sm">
            <thead>
              <tr
                style={{ background: "var(--bg-surface)" }}
                className="/50 text-[var(--text-tertiary)] text-xs uppercase tracking-wider"
              >
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.timestamp")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.action")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.entity")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.entityId")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.user")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.details")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-primary)]">
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="hover:bg-[var(--bg-surface-hover)] transition-colors"
                >
                  <td className="px-4 py-3 text-[var(--text-secondary)] whitespace-nowrap text-xs">
                    {formatDate(log.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}
                    >
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-primary)] font-medium">
                    {log.entityType}
                  </td>
                  <td
                    className="px-4 py-3 text-[var(--text-tertiary)] font-mono text-xs max-w-[120px] truncate"
                    title={log.entityId}
                  >
                    {log.entityId ? log.entityId.slice(0, 8) + "…" : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {log.user
                      ? log.user.name || log.user.email
                      : log.userId
                        ? "System"
                        : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {log.oldValue || log.newValue ? (
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="px-3 py-1 bg-transparent hover:bg-[var(--bg-surface-hover)] border border-[var(--border-primary)] rounded text-xs font-medium transition-colors"
                      >
                        View Details
                      </button>
                    ) : (
                      <span className="text-[var(--text-disabled)] text-xs">
                        —
                      </span>
                    )}
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

      <Modal
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title={t("dashboard.auditLogDetails")}
      >
        {selectedLog && (
          <div className="space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)]">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">
                  Timestamp
                </p>
                <p className="text-sm">{formatDate(selectedLog.createdAt)}</p>
              </div>
              <div className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)]">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">{t("dashboard.user")}</p>
                <p className="text-sm">
                  {selectedLog.user
                    ? selectedLog.user.name || selectedLog.user.email
                    : selectedLog.userId
                      ? "System"
                      : "—"}
                </p>
              </div>
              <div className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)]">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">
                  Action
                </p>
                <p className="text-sm font-medium">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs ${actionColor(selectedLog.action)}`}
                  >
                    {selectedLog.action}
                  </span>
                </p>
              </div>
              <div className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)]">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">
                  Entity
                </p>
                <p className="text-sm">
                  {selectedLog.entityType} (
                  {selectedLog.entityId
                    ? selectedLog.entityId.slice(0, 8)
                    : "—"}
                  )
                </p>
              </div>
            </div>

            {selectedLog.oldValue && (
              <div>
                <p className="text-sm font-medium mb-2 text-[var(--text-secondary)]">
                  Old Value
                </p>
                <pre className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)] text-xs text-[var(--status-error)] overflow-x-auto">
                  {JSON.stringify(selectedLog.oldValue, null, 2)}
                </pre>
              </div>
            )}

            {selectedLog.newValue && (
              <div>
                <p className="text-sm font-medium mb-2 text-[var(--text-secondary)]">
                  New Value
                </p>
                <pre className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)] text-xs text-[var(--accent-text)] overflow-x-auto">
                  {JSON.stringify(selectedLog.newValue, null, 2)}
                </pre>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface-hover)] rounded-lg text-sm font-medium transition-colors border border-[var(--border-primary)]"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
