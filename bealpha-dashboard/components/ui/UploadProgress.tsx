"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { uploadMediaDirect, type MediaAssetType } from "@/lib/media-upload-client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import {
  CloudUploadIcon,
  CheckCircleIcon,
  CancelIcon,
  CloseIcon,
  KeyboardArrowDownIcon,
} from "@/components/ui/Icon";

export type UploadStatus = "uploading" | "processing" | "success" | "error";

export interface UploadTask {
  id: string;
  name: string;
  progress: number;
  status: UploadStatus;
  errorMessage?: string;
}

export interface UploadProgressContextType {
  tasks: UploadTask[];
  startUpload: (id: string, name: string) => void;
  updateProgress: (id: string, progress: number) => void;
  finishUpload: (id: string, status: UploadStatus, errorMessage?: string) => void;
  removeTask: (id: string) => void;
  uploadMedia: (
    assetType: MediaAssetType,
    file: File,
    name: string,
    extraData?: Record<string, string>,
    onProgress?: (pct: number) => void,
  // Preserve the loose response shape while forms migrate to typed assets.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;
  downloadFile: (url: string, fileName: string) => Promise<void>;
}

const UploadProgressContext = createContext<UploadProgressContextType | null>(
  null,
);

export function UploadProgressProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);

  // UX-2: track in-flight XHR per task so we can abort on remove/clear.
  const xhrRefs = useRef<Map<string, XMLHttpRequest>>(new Map());

  const startUpload = useCallback((id: string, name: string) => {
    setTasks((prev) => {
      const existing = prev.find((task) => task.id === id);
      if (existing) {
        return prev.map((task) =>
          task.id === id ? { ...task, progress: 0, status: "uploading", name } : task,
        );
      }
      return [...prev, { id, name, progress: 0, status: "uploading" }];
    });
    setIsMinimized(false);
  }, []);

  const updateProgress = useCallback((id: string, progress: number) => {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== id) return task;
        // UX-1: when bytes reach 100% but server hasn't responded, transition
        // to a `processing` indeterminate state instead of leaving the bar at 100%.
        if (progress >= 100 && task.status === "uploading") {
          return { ...task, progress: 100, status: "processing" };
        }
        return { ...task, progress };
      }),
    );
  }, []);

  const finishUpload = useCallback(
    (id: string, status: UploadStatus, errorMessage?: string) => {
      setTasks((prev) =>
        prev.map((task) =>
          task.id === id
            ? {
                ...task,
                status,
                progress: status === "success" ? 100 : task.progress,
                errorMessage,
              }
            : task,
        ),
      );
      xhrRefs.current.delete(id);
      // Auto-remove on completion. UX-6: errors also auto-remove (15s) to bound the list.
      const delay = status === "success" ? 5000 : status === "error" ? 15000 : 0;
      if (delay > 0) {
        setTimeout(() => {
          setTasks((current) =>
            current.filter((task) => task.id !== id || task.status === "uploading" || task.status === "processing"),
          );
        }, delay);
      }
    },
    [],
  );

  const removeTask = useCallback((id: string) => {
    const xhr = xhrRefs.current.get(id);
    if (xhr) {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
      xhrRefs.current.delete(id);
    }
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }, []);

  const clearAllTasks = useCallback(() => {
    // UX-2: abort every in-flight XHR before dropping state.
    for (const xhr of xhrRefs.current.values()) {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
    }
    xhrRefs.current.clear();
    setTasks([]);
  }, []);

  const uploadMedia = useCallback(
    async (
      assetType: MediaAssetType,
      file: File,
      name: string,
      extraData: Record<string, string> = {},
      onProgress?: (pct: number) => void,
    ) => {
      const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      startUpload(id, name);
      return uploadMediaDirect(
        assetType,
        file,
        extraData,
        (percent) => {
          updateProgress(id, percent);
          onProgress?.(percent);
        },
        (xhr) => xhrRefs.current.set(id, xhr),
      ).then((result) => {
        xhrRefs.current.delete(id);
        finishUpload(id, "success");
        return result;
      }).catch((error) => {
        xhrRefs.current.delete(id);
        finishUpload(id, "error", error instanceof Error ? error.message : "Upload failed");
        throw error;
      });
    },
    [startUpload, updateProgress, finishUpload],
  );

  const downloadFile = useCallback(
    (url: string, fileName: string) => {
      return new Promise<void>((resolve, reject) => {
        const id =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        startUpload(id, `${t("common.downloading", "Downloading")} ${fileName}`);

        const xhr = new XMLHttpRequest();
        xhrRefs.current.set(id, xhr);
        xhr.open("GET", url, true);
        xhr.responseType = "blob";

        xhr.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round(
              (event.loaded / event.total) * 100,
            );
            updateProgress(id, percentComplete);
          }
        };

        xhr.onload = () => {
          xhrRefs.current.delete(id);
          if (xhr.status >= 200 && xhr.status < 300) {
            finishUpload(id, "success");

            const blob = xhr.response;
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = downloadUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);

            resolve();
          } else {
            finishUpload(id, "error", `Download failed: ${xhr.status}`);
            reject(new Error(`Download failed: ${xhr.status}`));
          }
        };

        xhr.onerror = () => {
          xhrRefs.current.delete(id);
          finishUpload(id, "error", t("upload.errors.network", "Network error"));
          reject(new Error("Network error"));
        };

        xhr.onabort = () => {
          xhrRefs.current.delete(id);
        };

        xhr.send();
      });
    },
    [startUpload, updateProgress, finishUpload, t],
  );

  return (
    <UploadProgressContext.Provider
      value={{
        tasks,
        startUpload,
        updateProgress,
        finishUpload,
        removeTask,
        uploadMedia,
        downloadFile,
      }}
    >
      {children}

      {tasks.length > 0 && (
        <div
          className={`fixed bottom-6 right-6 w-80 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg shadow-2xl overflow-hidden z-50 transition-all duration-300 ${isMinimized ? "h-12" : "max-h-[60vh] flex flex-col"}`}
        >
          <div
            className="flex items-center justify-between px-4 py-3 bg-[var(--bg-elevated)] cursor-pointer select-none"
            onClick={() => setIsMinimized(!isMinimized)}
          >
            <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2 text-sm">
              <CloudUploadIcon size={16} className="text-[#1DB954]" />
              {tasks.filter((task) => task.status === "uploading" || task.status === "processing").length}{" "}
              {t("common.activeTransfers", "Active Transfers")}
            </h4>
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              <button
                className="hover:text-[var(--text-primary)] transition-colors p-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMinimized(!isMinimized);
                }}
              >
                <KeyboardArrowDownIcon
                  size={16}
                  className={`transform transition-transform ${isMinimized ? "rotate-180" : ""}`}
                />
              </button>
              <button
                className="hover:text-[var(--text-primary)] transition-colors p-1"
                onClick={(e) => {
                  e.stopPropagation();
                  clearAllTasks();
                }}
              >
                <CloseIcon size={16} />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <div className="overflow-y-auto max-h-[calc(60vh-48px)] p-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="relative p-3 border-b border-[var(--border-primary)] last:border-0 hover:bg-[var(--bg-elevated)] transition-colors rounded-md group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-sm text-[var(--text-primary)] font-medium truncate pr-6"
                      title={task.name}
                    >
                      {task.name}
                    </span>
                    {task.status === "uploading" && (
                      <span className="text-xs text-[var(--text-secondary)] w-8 text-right shrink-0">
                        {task.progress}%
                      </span>
                    )}
                    {task.status === "processing" && (
                      <span className="text-xs text-[var(--text-secondary)] shrink-0">
                        {t("upload.processing", "Processing…")}
                      </span>
                    )}
                    {task.status === "success" && (
                      <CheckCircleIcon
                        size={16}
                        className="text-[#1DB954] shrink-0"
                      />
                    )}
                    {task.status === "error" && (
                      <CancelIcon size={16} className="text-red-500 shrink-0" />
                    )}
                  </div>

                  {task.status === "uploading" && (
                    <div className="w-full h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#1DB954] transition-all duration-300 rounded-full"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  )}

                  {task.status === "processing" && (
                    <div className="w-full h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                      <div className="h-full bg-[#1DB954] rounded-full animate-pulse w-full" />
                    </div>
                  )}

                  {task.status === "error" && (
                    <p className="text-xs text-red-500 break-words">
                      {task.errorMessage || t("settings.uploadFailed")}
                    </p>
                  )}

                  {task.status !== "uploading" && task.status !== "processing" && (
                    <button
                      onClick={() => removeTask(task.id)}
                      className="absolute top-1/2 -translate-y-1/2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    >
                      <CloseIcon size={14} />
                    </button>
                  )}

                  {(task.status === "uploading" || task.status === "processing") && (
                    <button
                      onClick={() => removeTask(task.id)}
                      title={t("common.cancel", "Cancel")}
                      className="absolute top-1/2 -translate-y-1/2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-tertiary)] hover:text-red-500"
                    >
                      <CloseIcon size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </UploadProgressContext.Provider>
  );
}

export function useUploadProgress() {
  const context = useContext(UploadProgressContext);
  if (!context) {
    throw new Error(
      "useUploadProgress must be used within an UploadProgressProvider",
    );
  }
  return context;
}
