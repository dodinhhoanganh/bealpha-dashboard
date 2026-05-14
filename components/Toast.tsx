"use client";

import React, {
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
} from "react";
import {
  CheckIcon,
  XMarkIcon,
  WarningIcon,
  InfoIcon,
  CloseIcon,
} from "@/components/Icon";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
});

export const useToast = () => useContext(ToastContext);

const toastIconComponents: Record<
  ToastType,
  React.ComponentType<{ className?: string; size?: number }>
> = {
  success: CheckIcon,
  error: XMarkIcon,
  warning: WarningIcon,
  info: InfoIcon,
};

const toastStyles: Record<
  ToastType,
  { bg: string; border: string; color: string }
> = {
  success: {
    bg: "var(--status-success-surface)",
    border: "var(--status-success)",
    color: "var(--status-success)",
  },
  error: {
    bg: "var(--status-error-surface)",
    border: "var(--status-error)",
    color: "var(--status-error)",
  },
  warning: {
    bg: "var(--status-warning-surface)",
    border: "var(--status-warning)",
    color: "var(--status-warning)",
  },
  info: {
    bg: "var(--status-info-surface)",
    border: "var(--status-info)",
    color: "var(--status-info)",
  },
};

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: string) => void;
}) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onRemove(toast.id), 300);
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast, onRemove]);

  const styles = toastStyles[toast.type];
  const IconComponent = toastIconComponents[toast.type];

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg backdrop-blur-sm
        transition-all duration-300 ease-in-out min-w-[300px] max-w-[450px]
        ${isExiting ? "opacity-0 translate-x-8" : "opacity-100 translate-x-0"}`}
      style={{
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        boxShadow: "var(--shadow-md)",
      }}
    >
      <span
        className="text-lg font-bold flex-shrink-0"
        style={{ color: styles.color }}
      >
        <IconComponent size={18} />
      </span>
      <p className="text-sm flex-1" style={{ color: "var(--text-primary)" }}>
        {toast.message}
      </p>
      <button
        onClick={() => {
          setIsExiting(true);
          setTimeout(() => onRemove(toast.id), 300);
        }}
        className="text-sm flex-shrink-0 ml-2"
        style={{ color: "var(--text-tertiary)" }}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback(
    (message: string, type: ToastType = "success", duration = 4000) => {
      const id = Date.now().toString() + Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, message, type, duration }]);
    },
    [],
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container - fixed position top-right */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
