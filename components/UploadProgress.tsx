"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import {
  CloudUploadIcon,
  CheckCircleIcon,
  CancelIcon,
  CloseIcon,
  KeyboardArrowDownIcon,
} from "@/components/Icon";

export type UploadStatus = "uploading" | "success" | "error";

export interface UploadTask {
  id: string;
  name: string;
  progress: number;
  status: UploadStatus;
}

export interface UploadProgressContextType {
  tasks: UploadTask[];
  startUpload: (id: string, name: string) => void;
  updateProgress: (id: string, progress: number) => void;
  finishUpload: (id: string, status: UploadStatus) => void;
  removeTask: (id: string) => void;
  uploadFile: (
    url: string,
    file: File,
    name: string,
    extraData?: Record<string, string>,
    onProgress?: (pct: number) => void,
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

  const startUpload = useCallback((id: string, name: string) => {
    setTasks((prev) => {
      const existing = prev.find((t) => t.id === id);
      if (existing) {
        return prev.map((t) =>
          t.id === id ? { ...t, progress: 0, status: "uploading", name } : t,
        );
      }
      return [...prev, { id, name, progress: 0, status: "uploading" }];
    });
    setIsMinimized(false);
  }, []);

  const updateProgress = useCallback((id: string, progress: number) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, progress } : t)));
  }, []);

  const finishUpload = useCallback((id: string, status: UploadStatus) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, status, progress: status === "success" ? 100 : t.progress }
          : t,
      ),
    );
    // Auto remove success after 5 seconds
    if (status === "success") {
      setTimeout(() => {
        setTasks((current) =>
          current.filter((t) => t.id !== id || t.status !== "success"),
        );
      }, 5000);
    }
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Upload token cache (tokens valid 10min, refresh at 8min) ──
  const tokenRef = React.useRef<{ token: string; fetchedAt: number } | null>(
    null,
  );

  const getUploadToken = useCallback(async (): Promise<string> => {
    const now = Date.now();
    // Reuse cached token if < 8 minutes old
    if (tokenRef.current && now - tokenRef.current.fetchedAt < 8 * 60 * 1000) {
      return tokenRef.current.token;
    }
    const res = await fetch("/api/upload/token", { method: "POST" });
    if (!res.ok) throw new Error("Failed to get upload token");
    const data = await res.json();
    tokenRef.current = { token: data.token, fetchedAt: now };
    return data.token;
  }, []);

  // XHR wrapper for tracking upload progress
  const uploadFile = useCallback(
    async (
      url: string,
      file: File,
      name: string,
      extraData: Record<string, string> = {},
      onProgress?: (pct: number) => void,
    ) => {
      // Fetch signed upload token before uploading
      let uploadToken: string | null = null;
      try {
        uploadToken = await getUploadToken();
      } catch (e) {
        console.error("Failed to get upload token:", e);
        // Fall back to no token (will work in dev, fail in prod)
      }

      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substring(7);
        startUpload(id, name);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);

        // Attach signed upload token
        if (uploadToken) {
          xhr.setRequestHeader("x-upload-token", uploadToken);
        }

        const formData = new FormData();
        for (const [key, value] of Object.entries(extraData)) {
          if (value) formData.append(key, value);
        }
        formData.append("file", file);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round(
              (event.loaded / event.total) * 100,
            );
            updateProgress(id, percentComplete);
            if (onProgress) onProgress(percentComplete);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            finishUpload(id, "success");
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              resolve(xhr.responseText);
            }
          } else {
            finishUpload(id, "error");
            try {
              const errData = JSON.parse(xhr.responseText);
              reject(new Error(errData.error || errData.message || "Upload failed"));
            } catch (e) {
              reject(new Error("Upload failed"));
            }
          }
        };

        xhr.onerror = () => {
          finishUpload(id, "error");
          reject(new Error("Network error"));
        };

        xhr.send(formData);
      });
    },
    [startUpload, updateProgress, finishUpload, getUploadToken],
  );

  // XHR wrapper for tracking download progress
  const downloadFile = useCallback(
    (url: string, fileName: string) => {
      return new Promise<void>((resolve, reject) => {
        const id = Math.random().toString(36).substring(7);
        startUpload(id, `Downloading ${fileName}`);

        const xhr = new XMLHttpRequest();
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
          if (xhr.status >= 200 && xhr.status < 300) {
            finishUpload(id, "success");

            // Trigger download
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
            finishUpload(id, "error");
            reject(new Error(`Download failed: ${xhr.status}`));
          }
        };

        xhr.onerror = () => {
          finishUpload(id, "error");
          reject(new Error("Network error"));
        };

        xhr.send();
      });
    },
    [startUpload, updateProgress, finishUpload],
  );

  return (
    <UploadProgressContext.Provider
      value={{
        tasks,
        startUpload,
        updateProgress,
        finishUpload,
        removeTask,
        uploadFile,
        downloadFile,
      }}
    >
      {children}

      {/* Floating UI */}
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
              {tasks.filter((t) => t.status === "uploading").length} Active
              Transfers
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
                  setTasks([]);
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

                  {task.status === "error" && (
                    <p className="text-xs text-red-500">{t("settings.uploadFailed")}</p>
                  )}

                  {task.status !== "uploading" && (
                    <button
                      onClick={() => removeTask(task.id)}
                      className="absolute top-1/2 -translate-y-1/2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
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
