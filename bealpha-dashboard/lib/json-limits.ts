const MAX_JSON_DEPTH = 8;
const MAX_JSON_KEYS = 100;
const MAX_JSON_STRING_LENGTH = 4096;

export function isSafeSmallJson(value: unknown, depth = 0): boolean {
  if (value === null) return true;
  if (depth > MAX_JSON_DEPTH) return false;

  const valueType = typeof value;
  if (valueType === "string") return (value as string).length <= MAX_JSON_STRING_LENGTH;
  if (valueType === "number") return Number.isFinite(value);
  if (valueType === "boolean") return true;
  if (valueType !== "object") return false;

  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_KEYS) return false;
    return value.every((item) => isSafeSmallJson(item, depth + 1));
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_JSON_KEYS) return false;
  return entries.every(([key, item]) => key.length <= 100 && isSafeSmallJson(item, depth + 1));
}
