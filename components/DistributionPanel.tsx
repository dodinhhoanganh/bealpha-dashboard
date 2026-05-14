"use client";

import { useState, useEffect, useCallback } from "react";
import { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { useToast } from "@/components/Toast";
import Pagination from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
import Modal from "@/components/Modal";
import {
  LocalShippingIcon,
  SendIcon,
  RefreshIcon,
  SearchIcon,
  FilterListIcon,
  CheckCircleIcon,
  PendingIcon,
  CancelIcon,
  DownloadIcon,
  VisibilityIcon,
  DeleteIcon,
  AlbumIcon,
  WarningIcon,
  CloseIcon,
  ArrowBackIcon,
  KeyboardArrowDownIcon,
} from "@/components/Icon";

// ============ DISTRIBUTION / DDEX COMPONENT ============
export default function DistributionPanel({ user }: { user: UserSession }) {
  const { t } = useI18n(); // Auto-injected

  const [tab, setTab] = useState<"queue" | "deliveries">("queue");
  const [releases, setReleases] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [dsps, setDsps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [delivering, setDelivering] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedDsps, setSelectedDsps] = useState<Record<string, string[]>>(
    {},
  );
  const [xmlPreview, setXmlPreview] = useState<{
    releaseTitle: string;
    xml: string;
  } | null>(null);
  const [deliveryDetail, setDeliveryDetail] = useState<any>(null);
  const { showToast } = useToast();

  // Fetch DSP list
  useEffect(() => {
    fetch("/api/ddex/deliver")
      .then((r) => r.json())
      .then((d) => setDsps(d.dsps || []))
      .catch(() => {});
  }, []);

  // Fetch releases ready for distribution
  const fetchReleases = useCallback(async () => {
    if (tab !== "queue") return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "APPROVED");
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (search) params.set("search", search);
      const res = await fetch(`/api/releases?${params}`);
      if (res.ok) {
        const json = await res.json();
        setReleases(json.data || []);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, tab]);

  // Fetch delivery history
  const fetchDeliveries = useCallback(async () => {
    if (tab !== "deliveries") return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/ddex/deliveries?${params}`);
      if (res.ok) {
        const json = await res.json();
        setDeliveries(json.data || []);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, search, tab]);

  useEffect(() => {
    if (tab === "queue") fetchReleases();
    else fetchDeliveries();
  }, [tab, fetchReleases, fetchDeliveries]);

  // Reset page when switching tabs
  useEffect(() => {
    setPage(1);
    setSearch("");
    setStatusFilter("all");
  }, [tab]);

  // Toggle DSP selection for a release
  const toggleDsp = (releaseId: string, dspId: string) => {
    setSelectedDsps((prev) => {
      const current = prev[releaseId] || [];
      if (current.includes(dspId)) {
        return { ...prev, [releaseId]: current.filter((d) => d !== dspId) };
      }
      return { ...prev, [releaseId]: [...current, dspId] };
    });
  };

  // Select all DSPs for a release
  const selectAllDsps = (releaseId: string) => {
    setSelectedDsps((prev) => ({
      ...prev,
      [releaseId]: dsps.map((d) => d.id),
    }));
  };

  // Preview ERN XML
  const handlePreviewXml = async (releaseId: string, releaseTitle: string) => {
    try {
      const res = await fetch("/api/ddex/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId }),
      });
      if (res.ok) {
        const data = await res.json();
        setXmlPreview({ releaseTitle, xml: data.xml });
      } else {
        showToast(t("toast.failedToGenerateXMLPreview", "Failed to generate XML preview"), "error");
      }
    } catch {
      showToast(t("toast.failedToGenerateXMLPreview", "Failed to generate XML preview"), "error");
    }
  };

  // Deliver release to selected DSPs
  const handleDeliver = async (releaseId: string) => {
    const dspIds = selectedDsps[releaseId];
    if (!dspIds || dspIds.length === 0) {
      showToast(t("toast.selectAtLeastOneDSP", "Select at least one DSP"), "warning");
      return;
    }
    setDelivering(releaseId);
    try {
      const res = await fetch("/api/ddex/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId, dspIds, autoSend: true }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(t("toast.deliveredToDSPs", "Delivered to") + ` ${data.deliveries.length} DSP(s)`, "success");
        if (data.errors.length > 0) {
          showToast(`${t("common.warnings", "Warnings")}: ${data.errors.join(", ")}`, "warning");
        }
        setSelectedDsps((prev) => ({ ...prev, [releaseId]: [] }));
        fetchReleases();
      } else {
        showToast(translateApiError(data.error, t), "error");
      }
    } catch {
      showToast(t("toast.deliveryFailed", "Delivery failed"), "error");
    } finally {
      setDelivering(null);
    }
  };

  // Takedown
  const handleTakedown = async (releaseId: string) => {
    if (
      !confirm(
        t("toast.confirmTakedown", "Are you sure you want to send a takedown for this release to ALL DSPs?"),
      )
    )
      return;
    setDelivering(releaseId);
    try {
      const res = await fetch("/api/ddex/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseId,
          dspIds: dsps.map((d) => d.id),
          messageType: "Takedown",
          autoSend: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(t("toast.takedownSentToAllDSPs", "Takedown sent to all DSPs"), "success");
      } else {
        showToast(translateApiError(data.error, t), "error");
      }
    } catch {
      showToast(t("toast.takedownFailed", "Takedown failed"), "error");
    } finally {
      setDelivering(null);
    }
  };

  // Delivery actions (send, retry, confirm)
  const handleDeliveryAction = async (
    deliveryId: string,
    action: "send" | "retry" | "confirm",
  ) => {
    try {
      const res = await fetch(`/api/ddex/deliveries/${deliveryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        showToast(`${t("toast.delivery", "Delivery")} ${action} ${t("toast.successful", "successful")}`, "success");
        fetchDeliveries();
      } else {
        const data = await res.json();
        showToast(translateApiError(data.error, t), "error");
      }
    } catch {
      showToast(`${action} ${t("toast.failed", "failed")}`, "error");
    }
  };

  // View delivery detail (with XML)
  const handleViewDetail = async (deliveryId: string) => {
    try {
      const res = await fetch(`/api/ddex/deliveries/${deliveryId}`);
      if (res.ok) {
        const data = await res.json();
        setDeliveryDetail(data);
      }
    } catch {
      showToast(t("toast.failedToLoadDeliveryDetails", "Failed to load delivery details"), "error");
    }
  };

  // Download XML as file
  const downloadXml = (xml: string, filename: string) => {
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "confirmed":
        return "text-[var(--accent-text)] bg-[var(--status-success-surface)]";
      case "sent":
        return "text-[var(--status-info)] bg-[var(--status-info-surface)]";
      case "pending":
        return "text-[var(--status-warning)] bg-[var(--status-warning-surface)]";
      case "failed":
        return "text-[var(--status-error)] bg-[var(--status-error-surface)]";
      default:
        return "text-[var(--text-tertiary)] bg-[var(--bg-elevated)]";
    }
  };

  const statusIcon = (s: string) => {
    switch (s) {
      case "confirmed":
        return <CheckCircleIcon size={14} />;
      case "sent":
        return <SendIcon size={14} />;
      case "pending":
        return <PendingIcon size={14} />;
      case "failed":
        return <CancelIcon size={14} />;
      default:
        return null;
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("heading.distributionDDEX", "Distribution (DDEX)")}</h2>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 mb-6 rounded-lg p-1 w-fit border border-[var(--border-primary)]">
        <button
          onClick={() => setTab("queue")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === "queue" ? "bg-[var(--accent)] text-white" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
        >
          Delivery Queue
        </button>
        <button
          onClick={() => setTab("deliveries")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === "deliveries" ? "bg-[var(--accent)] text-white" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
        >
          {t("distribution.deliveryHistory")}
        </button>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]"
          />
          <input
            type="text"
            placeholder={
              tab === "queue" ? "Search releases…" : "Search deliveries…"
            }
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        {tab === "deliveries" && (
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="all">{t("dashboard.allStatus")}</option>
            <option value="pending">{t("statuses.pending")}</option>
            <option value="sent">{t("dashboard.sent")}</option>
            <option value="confirmed">{t("statuses.confirmed")}</option>
            <option value="failed">{t("statuses.failed")}</option>
          </select>
        )}
      </div>

      {/* =========== QUEUE TAB =========== */}
      {tab === "queue" &&
        (loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : releases.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-disabled)]">
            <LocalShippingIcon size={48} color="#525252" />
            <p className="mt-2">{t("dashboard.noApprovedReleases")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {releases.map((release) => {
              const selected = selectedDsps[release.id] || [];
              const isDelivering = delivering === release.id;
              return (
                <div
                  key={release.id}
                  style={{ background: "var(--bg-surface)" }}
                  className=" border border-[var(--border-primary)] rounded-xl p-5"
                >
                  <div className="flex items-start gap-4">
                    {/* Cover */}
                    {release.coverUrl ? (
                      <img
                        src={release.coverUrl}
                        alt=""
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-lg  flex items-center justify-center">
                        <AlbumIcon size={28} color="#525252" />
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-[var(--text-primary)] truncate">
                        {release.title}
                      </h3>
                      <p className="text-sm text-[var(--text-tertiary)]">
                        {release.artist?.name || "Unknown Artist"} •{" "}
                        {release.label?.name || "No Label"}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-disabled)]">
                        {release.ean && <span>EAN: {release.ean}</span>}
                        <span>
                          {release.trackCount || release.tracks?.length || 0}{" "}
                          tracks
                        </span>
                        <span>{release.format}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          handlePreviewXml(release.id, release.title)
                        }
                        className="px-3 py-1.5 text-xs  hover: rounded-lg text-[var(--text-secondary)] transition-colors"
                        title={t("ddex.previewErnXml")}
                      >
                        <VisibilityIcon size={14} /> XML
                      </button>
                      <button
                        onClick={() => handleDeliver(release.id)}
                        disabled={isDelivering || selected.length === 0}
                        className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors flex items-center gap-1 ${
                          selected.length > 0 && !isDelivering
                            ? "bg-[var(--accent)] hover:brightness-110 text-white"
                            : " text-[var(--text-disabled)] cursor-not-allowed"
                        }`}
                      >
                        {isDelivering ? (
                          <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white inline-block"></span>
                        ) : (
                          <SendIcon size={14} />
                        )}
                        Deliver ({selected.length})
                      </button>
                    </div>
                  </div>

                  {/* DSP Selection Grid */}
                  <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-[var(--text-tertiary)] font-medium">
                        Select DSPs:
                      </span>
                      <button
                        onClick={() => selectAllDsps(release.id)}
                        className="text-xs text-[var(--accent-text)] hover:text-[var(--accent-hover)]"
                      >
                        Select All
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {dsps.map((dsp) => (
                        <button
                          key={dsp.id}
                          onClick={() => toggleDsp(release.id, dsp.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                            selected.includes(dsp.id)
                              ? "bg-[var(--accent)]/20 border-green-500/50 text-[var(--accent-text)]"
                              : " border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[var(--border-primary)]"
                          }`}
                        >
                          <span className="mr-1">{dsp.icon}</span> {dsp.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {/* =========== DELIVERIES TAB =========== */}
      {tab === "deliveries" &&
        (loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : deliveries.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-disabled)]">
            <SendIcon size={48} color="#525252" />
            <p className="mt-2">{t("dashboard.noDeliveriesFound")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[var(--text-tertiary)] text-sm border-b border-[var(--border-primary)]">
                  <th className="pb-3 font-medium">{t("dashboard.release")}</th>
                  <th className="pb-3 font-medium">{t("dashboard.dsp")}</th>
                  <th className="pb-3 font-medium">{t("dashboard.type")}</th>
                  <th className="pb-3 font-medium">{t("common.status")}</th>
                  <th className="pb-3 font-medium">{t("dashboard.sent")}</th>
                  <th className="pb-3 font-medium">{t("statuses.confirmed")}</th>
                  <th className="pb-3 font-medium text-right">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]"
                  >
                    <td className="py-3">
                      <div>
                        <p className="font-medium text-[var(--text-primary)] text-sm truncate max-w-[200px]">
                          {d.release?.title || "—"}
                        </p>
                        <p className="text-xs text-[var(--text-disabled)]">
                          {d.release?.artist?.name}
                        </p>
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="text-sm capitalize">
                        {dsps.find((x) => x.id === d.dspName)?.name ||
                          d.dspName}
                      </span>
                    </td>
                    <td className="py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${d.messageType === "Takedown" ? "bg-[var(--status-error-surface)] text-[var(--status-error)]" : "bg-[var(--status-info-surface)] text-[var(--status-info)]"}`}
                      >
                        {d.messageType}
                      </span>
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${statusColor(d.status)}`}
                      >
                        {statusIcon(d.status)}
                        <span className="capitalize">{d.status}</span>
                      </span>
                    </td>
                    <td className="py-3 text-sm text-[var(--text-tertiary)]">
                      {d.sentAt ? new Date(d.sentAt).toLocaleString() : "—"}
                    </td>
                    <td className="py-3 text-sm text-[var(--text-tertiary)]">
                      {d.confirmedAt
                        ? new Date(d.confirmedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleViewDetail(d.id)}
                          className="p-1.5 hover: rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                          title={t("common.viewDetails")}
                        >
                          <VisibilityIcon size={16} />
                        </button>
                        {d.status === "pending" && (
                          <button
                            onClick={() => handleDeliveryAction(d.id, "send")}
                            className="p-1.5 hover: rounded-lg text-[var(--status-info)] hover:text-blue-300 transition-colors"
                            title={t("common.send")}
                          >
                            <SendIcon size={16} />
                          </button>
                        )}
                        {d.status === "failed" && (
                          <button
                            onClick={() => handleDeliveryAction(d.id, "retry")}
                            className="p-1.5 hover: rounded-lg text-[var(--status-warning)] hover:text-amber-300 transition-colors"
                            title={t("common.retry")}
                          >
                            <RefreshIcon size={16} />
                          </button>
                        )}
                        {d.status === "sent" && (
                          <button
                            onClick={() =>
                              handleDeliveryAction(d.id, "confirm")
                            }
                            className="p-1.5 hover: rounded-lg text-[var(--accent-text)] hover:text-[var(--accent-hover)] transition-colors"
                            title={t("common.confirm")}
                          >
                            <CheckCircleIcon size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

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

      {/* XML Preview Modal */}
      {xmlPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setXmlPreview(null)}
          ></div>
          <div className="relative rounded-xl border border-[var(--border-primary)] w-full max-w-3xl mx-4 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)] shrink-0">
              <h3 className="text-lg font-medium">
                ERN XML — {xmlPreview.releaseTitle}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    downloadXml(
                      xmlPreview.xml,
                      `ERN_${xmlPreview.releaseTitle.replace(/\s+/g, "_")}.xml`,
                    )
                  }
                  className="px-3 py-1.5 text-xs bg-[var(--accent)] hover:brightness-110 rounded-lg text-white font-medium flex items-center gap-1"
                >
                  <DownloadIcon size={14} /> {t("common.download")}
                </button>
                <button
                  onClick={() => setXmlPreview(null)}
                  className="p-1 hover: rounded-lg"
                >
                  <CloseIcon size={20} />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-auto flex-1">
              <pre className="text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-all bg-transparent rounded-lg p-4 border border-[var(--border-primary)]">
                {xmlPreview.xml}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Detail Modal */}
      {deliveryDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setDeliveryDetail(null)}
          ></div>
          <div className="relative rounded-xl border border-[var(--border-primary)] w-full max-w-3xl mx-4 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)] shrink-0">
              <div>
                <h3 className="text-lg font-medium">{t("heading.deliveryDetail", "Delivery Detail")}</h3>
                <p className="text-sm text-[var(--text-tertiary)] mt-0.5">
                  {deliveryDetail.release?.title} →{" "}
                  {dsps.find((x) => x.id === deliveryDetail.dspName)?.name ||
                    deliveryDetail.dspName}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {deliveryDetail.xmlContent && (
                  <button
                    onClick={() =>
                      downloadXml(
                        deliveryDetail.xmlContent,
                        `delivery_${deliveryDetail.id}.xml`,
                      )
                    }
                    className="px-3 py-1.5 text-xs bg-[var(--accent)] hover:brightness-110 rounded-lg text-white font-medium flex items-center gap-1"
                  >
                    <DownloadIcon size={14} /> Download XML
                  </button>
                )}
                <button
                  onClick={() => setDeliveryDetail(null)}
                  className="p-1 hover: rounded-lg"
                >
                  <CloseIcon size={20} />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-auto flex-1 space-y-4">
              {/* Status Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-[var(--text-disabled)]">{t("common.status")}</p>
                  <span
                    className={`inline-flex items-center gap-1 mt-1 px-2 py-1 rounded text-xs ${statusColor(deliveryDetail.status)}`}
                  >
                    {statusIcon(deliveryDetail.status)}
                    <span className="capitalize">{deliveryDetail.status}</span>
                  </span>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-disabled)]">{t("dashboard.type")}</p>
                  <p className="text-sm text-[var(--text-primary)] mt-1">
                    {deliveryDetail.messageType}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-disabled)]">
                    ERN Version
                  </p>
                  <p className="text-sm text-[var(--text-primary)] mt-1">
                    {deliveryDetail.ernVersion}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-disabled)]">
                    Batch ID
                  </p>
                  <p className="text-sm text-[var(--text-tertiary)] mt-1 font-mono text-xs truncate">
                    {deliveryDetail.batchId}
                  </p>
                </div>
              </div>

              {/* Timeline */}
              <div>
                <p className="text-xs text-[var(--text-disabled)] mb-2">
                  Timeline
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-[var(--accent)] text-white"></div>
                    <span className="text-[var(--text-tertiary)]">
                      Created:
                    </span>
                    <span className="text-[var(--text-primary)]">
                      {new Date(deliveryDetail.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {deliveryDetail.sentAt && (
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-[var(--status-info)] text-white"></div>
                      <span className="text-[var(--text-tertiary)]">{t("dashboard.sent")}:</span>
                      <span className="text-[var(--text-primary)]">
                        {new Date(deliveryDetail.sentAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {deliveryDetail.confirmedAt && (
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-[var(--accent)] text-white"></div>
                      <span className="text-[var(--text-tertiary)]">
                        Confirmed:
                      </span>
                      <span className="text-[var(--text-primary)]">
                        {new Date(deliveryDetail.confirmedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Error Log */}
              {deliveryDetail.errorLog && (
                <div>
                  <p className="text-xs text-[var(--status-error)] mb-1">
                    Error Log
                  </p>
                  <pre className="text-xs text-red-300 bg-[var(--status-error)]/5 border border-red-500/20 rounded-lg p-3 whitespace-pre-wrap">
                    {deliveryDetail.errorLog}
                  </pre>
                </div>
              )}

              {/* XML Content */}
              {deliveryDetail.xmlContent && (
                <div>
                  <p className="text-xs text-[var(--text-disabled)] mb-1">
                    XML Content
                  </p>
                  <pre className="text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-all bg-[var(--bg-elevated)] rounded-lg p-4 border border-[var(--border-primary)] max-h-64 overflow-auto">
                    {deliveryDetail.xmlContent}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

