/**
 * Edit-distance ranking helpers for federated DSP artist search.
 *
 * Levenshtein measures the minimum number of single-character insertions,
 * deletions, or substitutions needed to convert one string into another.
 * For artist disambiguation it lets an exact-name "Taylor" indie artist
 * outrank substring-matched superstars whose popularity would otherwise win.
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const m = a.length;
  const n = b.length;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Normalize for matching: lowercase, NFKD-fold accents, collapse whitespace.
 * Keeps the algorithm robust against "Beyoncé" vs "Beyonce" and "  foo " vs "foo".
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * 0..1 similarity score (1 = identical, 0 = totally different).
 */
export function similarity(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na && !nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  if (!maxLen) return 1;
  return 1 - dist / maxLen;
}
