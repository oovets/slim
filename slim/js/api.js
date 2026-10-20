// Thin Spotify Web API client, written against the February 2026 dev-mode API
// (playlist `/items`, `/me/library`, search limit <= 10).

import { getToken, getFallbackToken } from './auth.js';

const BASE = 'https://api.spotify.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(status, body) {
    super(`Spotify API ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** `fallback: true` sends the request under the optional fallback sign-in instead of the main one. */
export async function api(path, { method = 'GET', query, body, fallback = false } = {}, canRetry = true) {
  const token = await (fallback ? getFallbackToken() : getToken());
  if (!token) throw new ApiError(401, 'not logged in');

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (r.status === 429 && canRetry) {
    await sleep((Number(r.headers.get('Retry-After')) || 1) * 1000);
    return api(path, { method, query, body, fallback }, false);
  }
  if (!r.ok) throw new ApiError(r.status, await r.text());
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/** Normalise track/episode objects into the flat shape the UI uses. */
function norm(t) {
  if (!t?.uri) return null;
  const ep = t.type === 'episode';
  return {
    uri: t.uri,
    name: t.name,
    artists: ep ? (t.show?.name ?? '') : (t.artists ?? []).map((a) => a.name).join(', '),
    album: ep ? '' : (t.album?.name ?? ''),
    ms: t.duration_ms ?? 0,
    playable: t.is_playable !== false && !t.is_local,
  };
}

const page = (items, r, offset) => ({
  tracks: items.map(norm).filter(Boolean),
  total: r.total ?? 0,
  hasMore: !!r.next,
  next: offset + items.length,
});

export async function getMe() {
  const r = await api('/me');
  return { id: r.id, name: r.display_name };
}

const playlistInfo = (p) => ({
  id: p.id, uri: p.uri, name: p.name,
  owner: p.owner?.display_name ?? '', ownerId: p.owner?.id, collaborative: !!p.collaborative,
});

export async function getPlaylists() {
  const out = [];
  for (let offset = 0; ; offset += 50) {
    const r = await api('/me/playlists', { query: { limit: 50, offset } });
    out.push(...r.items.filter(Boolean).map(playlistInfo));
    if (!r.next) return out;
  }
}

export async function createPlaylist(name) {
  return playlistInfo(await api('/me/playlists', { method: 'POST', body: { name, public: false } }));
}
export const renamePlaylist = (id, name) => api(`/playlists/${id}`, { method: 'PUT', body: { name } });
/** "Deleting" a playlist is unfollowing it; Spotify keeps it recoverable for a while. */
export const deletePlaylist = (uri) => api('/me/library', { method: 'DELETE', query: { uris: uri } });
/** Removes every occurrence of each URI (the API addresses items by URI, not position). */
export const removeFromPlaylist = (id, uris) =>
  api(`/playlists/${id}/items`, { method: 'DELETE', body: { items: uris.map((uri) => ({ uri })) } });
/** Moves the item at `from` so it ends up before the item currently at `before`. */
export const moveInPlaylist = (id, from, before) =>
  api(`/playlists/${id}/items`, { method: 'PUT', body: { range_start: from, insert_before: before, range_length: 1 } });

const single = (tracks) => ({ tracks, total: tracks.length, hasMore: false, next: tracks.length });

export async function getQueue() {
  const r = await api('/me/player/queue');
  return single((r?.queue ?? []).map(norm).filter(Boolean));
}

export const addToQueue = (uri, deviceId) =>
  api('/me/player/queue', { method: 'POST', query: { uri, ...(deviceId && { device_id: deviceId }) } });

export async function getRecent() {
  const r = await api('/me/player/recently-played', { query: { limit: 50 } });
  return single(r.items.map((i) => norm(i.track)).filter(Boolean));
}

/** range: short_term (4 weeks) | medium_term (6 months) | long_term (all time) */
export async function getTop(range, offset = 0) {
  const r = await api('/me/top/tracks', { query: { time_range: range, limit: 50, offset } });
  return page(r.items, r, offset);
}

export const addToPlaylist = (id, uris) => api(`/playlists/${id}/items`, { method: 'POST', body: { uris } });

export async function getLiked(offset = 0) {
  const r = await api('/me/tracks', { query: { limit: 50, offset } });
  return page(r.items.map((i) => i.track), r, offset);
}

export async function getPlaylistTracks(id, offset = 0, fallback = false) {
  const r = await api(`/playlists/${id}/items`, { fallback, query: { limit: 100, offset, additional_types: 'track,episode' } });
  // Response field was renamed track -> item; accept both.
  return page(r.items.map((i) => i.item ?? i.track), r, offset);
}

export async function search(q, offset = 0) {
  const r = await api('/search', { query: { q, type: 'track', limit: 10, offset } });
  return page(r.tracks.items, r.tracks, offset);
}

export async function isSaved(uri) {
  const r = await api('/me/library/contains', { query: { uris: uri } });
  return !!r?.[0];
}
export const save = (uri) => api('/me/library', { method: 'PUT', query: { uris: uri } });
export const unsave = (uri) => api('/me/library', { method: 'DELETE', query: { uris: uri } });
