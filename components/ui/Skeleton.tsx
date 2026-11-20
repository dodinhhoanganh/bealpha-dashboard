"use client";

import React from "react";


// Base skeleton shimmer
function SkeletonBlock({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`bg-[#333] rounded animate-pulse ${className}`}
      style={style}
    />
  );
}

// Table skeleton - renders N rows with M columns
export function TableSkeleton({
  rows = 5,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex gap-4 pb-3 border-b border-[#333]">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonBlock key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 py-2">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonBlock
              key={c}
              className={`h-4 flex-1 ${c === 0 ? "max-w-[200px]" : ""}`}
              style={
                {
                  animationDelay: `${(r * cols + c) * 50}ms`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Card skeleton grid
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-[#282828] rounded-xl p-5 space-y-3">
          <SkeletonBlock className="h-3 w-1/3" />
          <SkeletonBlock className="h-8 w-2/3" />
          <SkeletonBlock className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

// Stats panel skeleton
export function StatsSkeleton() {
  return (
    <div className="space-y-6">
      <CardSkeleton count={4} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#282828] rounded-xl p-5 space-y-4">
          <SkeletonBlock className="h-4 w-1/4" />
          <SkeletonBlock className="h-[200px] w-full" />
        </div>
        <div className="bg-[#282828] rounded-xl p-5 space-y-4">
          <SkeletonBlock className="h-4 w-1/4" />
          <SkeletonBlock className="h-[200px] w-full" />
        </div>
      </div>
    </div>
  );
}

// List item skeleton (for sidebar or simple lists)
export function ListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <SkeletonBlock className="h-8 w-8 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <SkeletonBlock className="h-3 w-3/4" />
            <SkeletonBlock className="h-2 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default SkeletonBlock;
