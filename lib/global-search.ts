import { apiRequest } from "@/lib/api-client";

export interface GlobalSearchResult {
  id: string;
  type: "ARTIST" | "RELEASE" | "ASSET" | "LABEL";
  title: string;
  subtitle: string;
  image?: string;
}

interface SearchRow {
  id?: string;
  name?: string;
  title?: string;
  ean?: string;
  displayArtist?: string;
  coverUrl?: string;
  imageUrl?: string;
  logoUrl?: string;
  fileName?: string;
  type?: string;
}

async function rows(path: string, signal: AbortSignal): Promise<SearchRow[]> {
  try {
    return await apiRequest<SearchRow[]>(path, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    return [];
  }
}

export async function searchAcrossServices(query: string, scope: string, signal: AbortSignal): Promise<GlobalSearchResult[]> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return [];
  const limit = scope === "ALL" ? 4 : 10;
  const wants = (type: string) => scope === "ALL" || scope === type;
  const [artists, releases, assets, labels] = await Promise.all([
    wants("ARTIST") ? rows("/api/v1/catalog/artists", signal) : [],
    wants("RELEASE") ? rows("/api/v1/catalog/releases", signal) : [],
    wants("ASSET") ? rows("/api/v1/media/assets", signal) : [],
    wants("LABEL") ? rows("/api/v1/catalog/labels", signal) : [],
  ]);
  const matches = (value: unknown) => typeof value === "string" && value.toLowerCase().includes(normalized);
  const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
  const results: GlobalSearchResult[] = [];
  artists.filter((item) => matches(item.name)).slice(0, limit).forEach((item) => results.push({ id: text(item.id), type: "ARTIST", title: text(item.name), subtitle: "Artist", ...(item.imageUrl ? { image: item.imageUrl } : {}) }));
  releases.filter((item) => matches(item.title) || matches(item.ean)).slice(0, limit).forEach((item) => results.push({ id: text(item.id), type: "RELEASE", title: text(item.title), subtitle: item.displayArtist || (item.ean ? `UPC: ${item.ean}` : "Release"), ...(item.coverUrl ? { image: item.coverUrl } : {}) }));
  assets.filter((item) => matches(item.fileName)).slice(0, limit).forEach((item) => results.push({ id: text(item.id), type: "ASSET", title: text(item.fileName), subtitle: item.type || "Asset" }));
  labels.filter((item) => matches(item.name)).slice(0, limit).forEach((item) => results.push({ id: text(item.id), type: "LABEL", title: text(item.name), subtitle: "Label", ...(item.logoUrl ? { image: item.logoUrl } : {}) }));
  return results.slice(0, 10);
}
