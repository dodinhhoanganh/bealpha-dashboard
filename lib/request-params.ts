export type SortOrder = "asc" | "desc";
const MAX_SEARCH_CHARS = 100;
const MAX_PAGE = 1000;

export function parseSortOrder(value: string | null, fallback: SortOrder): SortOrder {
  const normalized = value?.toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return fallback;
}

export function parseLimitParam(
  value: string | null,
  fallback: number,
  max: number,
): number {
  const parsed = Number.parseInt(value || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function parsePageParam(value: string | null, fallback = 1): number {
  const parsed = Number.parseInt(value || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_PAGE);
}

export function parseSearchParam(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= MAX_SEARCH_CHARS ? trimmed : null;
}
