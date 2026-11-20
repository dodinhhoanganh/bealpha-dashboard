export interface DspSearchConfig { spotifyClientId?: string; spotifyClientSecret?: string; }
type Artist = { id: string; name: string; popularity?: number; genres: string[]; imageUrl: string; externalUrl: string; platform: "spotify" | "apple"; matchScore: number };
const cache = new Map<string, { expiresAt: number; value: { spotify: Artist[]; apple: Artist[]; errors: { spotify: string | null; apple: string | null } } }>();
let spotifyToken: { value: string; expiresAt: number } | null = null;

function similarity(a: string, b: string) {
  const left = a.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const right = b.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]; previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length, 1);
}

function safeUrl(candidate: string | undefined, host: (name: string) => boolean, fallback = "") {
  try { const url = new URL(candidate || fallback); return url.protocol === "https:" && host(url.hostname) ? url.toString() : fallback; } catch { return fallback; }
}

async function token(config: DspSearchConfig) {
  if (spotifyToken && spotifyToken.expiresAt > Date.now()) return spotifyToken.value;
  if (!config.spotifyClientId || !config.spotifyClientSecret) return null;
  const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  spotifyToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60000 };
  return spotifyToken.value;
}

async function spotify(query: string, config: DspSearchConfig): Promise<Artist[]> {
  const accessToken = await token(config); if (!accessToken) return [];
  const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=10`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) return [];
  const data = await response.json() as { artists?: { items?: Array<any> } };
  return (data.artists?.items || []).map(item => ({ id: item.id, name: item.name, popularity: item.popularity || 0, genres: item.genres || [], imageUrl: safeUrl(item.images?.[0]?.url, host => host === "i.scdn.co" || host.endsWith(".spotifycdn.com")), externalUrl: safeUrl(item.external_urls?.spotify, host => host === "open.spotify.com", `https://open.spotify.com/artist/${encodeURIComponent(item.id)}`), platform: "spotify" as const, matchScore: similarity(item.name, query) }));
}

async function apple(query: string): Promise<Artist[]> {
  const url = new URL("https://itunes.apple.com/search");
  Object.entries({ term: query, media: "music", entity: "musicArtist", attribute: "artistTerm", limit: "10" }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) return [];
  const data = await response.json() as { results?: Array<any> }; const seen = new Set<string>();
  return (data.results || []).filter(item => { const id = String(item.artistId); if (seen.has(id)) return false; seen.add(id); return true; }).map(item => ({ id: String(item.artistId), name: item.artistName, genres: item.primaryGenreName ? [item.primaryGenreName] : [], imageUrl: safeUrl(item.artworkUrl100 || item.artworkUrl60, host => host.endsWith(".mzstatic.com")), externalUrl: safeUrl(item.artistLinkUrl, host => host === "music.apple.com", `https://music.apple.com/artist/${encodeURIComponent(item.artistId)}`), platform: "apple" as const, matchScore: similarity(item.artistName, query) }));
}

export async function searchDspArtists(query: string, config: DspSearchConfig) {
  const key = query.toLowerCase(); const hit = cache.get(key); if (hit && hit.expiresAt > Date.now()) return hit.value;
  const [spotifyResult, appleResult] = await Promise.allSettled([spotify(key, config), apple(key)]);
  const rank = (items: Artist[]) => items.sort((a, b) => b.matchScore - a.matchScore || (b.popularity || 0) - (a.popularity || 0));
  const value = { spotify: rank(spotifyResult.status === "fulfilled" ? spotifyResult.value : []), apple: rank(appleResult.status === "fulfilled" ? appleResult.value : []), errors: { spotify: spotifyResult.status === "rejected" ? "SPOTIFY_UNAVAILABLE" : null, apple: appleResult.status === "rejected" ? "APPLE_UNAVAILABLE" : null } };
  if (cache.size >= 200) cache.delete(cache.keys().next().value!); cache.set(key, { expiresAt: Date.now() + 86400000, value }); return value;
}
