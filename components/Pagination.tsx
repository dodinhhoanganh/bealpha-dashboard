"use client";

import React from "react";

import { ArrowBackIcon } from "./Icon";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
}

export default function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  onLimitChange,
}: PaginationProps) {
  if (totalPages <= 1 && total <= limit) return null;

  const startItem = (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  // Generate page numbers with ellipsis
  const getPageNumbers = (): (number | "...")[] => {
    const pages: (number | "...")[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");

      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);

      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }

    return pages;
  };

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mt-4 px-1">
      {/* Info */}
      <div className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        Showing{" "}
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
          {startItem}
        </span>
        –
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
          {endItem}
        </span>{" "}
        of{" "}
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
          {total}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Per page selector */}
        {onLimitChange && (
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="text-sm rounded px-2 py-1.5 focus:outline-none"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-primary)",
            }}
          >
            {[10, 20, 50, 100].map((v) => (
              <option key={v} value={v}>
                {v} / page
              </option>
            ))}
          </select>
        )}

        {/* Page buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-2.5 py-1.5 text-sm rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-primary)",
            }}
          >
            <ArrowBackIcon size={14} />
          </button>

          {getPageNumbers().map((p, i) =>
            p === "..." ? (
              <span
                key={`ellipsis-${i}`}
                className="px-2 text-sm"
                style={{ color: "var(--text-tertiary)" }}
              >
                ...
              </span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className="px-2.5 py-1.5 text-sm rounded transition-colors min-w-[32px]"
                style={{
                  background:
                    p === page ? "var(--accent)" : "var(--bg-elevated)",
                  color:
                    p === page ? "var(--bg-primary)" : "var(--text-secondary)",
                  border:
                    p === page
                      ? "1px solid var(--accent)"
                      : "1px solid var(--border-primary)",
                  fontWeight: p === page ? 500 : 400,
                }}
              >
                {p}
              </button>
            ),
          )}

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-2.5 py-1.5 text-sm rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-primary)",
            }}
          >
            <ArrowBackIcon size={14} className="rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}
