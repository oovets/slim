// Offline demo backend (?demo): same exports as api.js + player.js, fake data.

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (a) => a[Math.floor(rnd() * a.length)];

const W1 = ['Midnight', 'Golden', 'Slow', 'Paper', 'Winter', 'Neon', 'Quiet', 'Broken', 'Summer', 'Velvet', 'Distant', 'Hollow', 'Electric', 'Soft', 'Last'];
const W2 = ['Hours', 'Light', 'Rain', 'Machine', 'Season', 'Harbor', 'Echo', 'Room', 'Signal', 'Garden', 'Train', 'Weather', 'Mirror', 'Tide', 'Highway'];
const ARTISTS = ['Lina Ahrén', 'The Pale Fields', 'Noor', 'Kasper & Sons', 'Mira Vale', 'Orbit Club', 'Henrik Dahl', 'Saga Lund', 'Low Tide', 'Ebba Strand', 'Atlas Bloom'];
const ALBUMS = ['Night Shift', 'Fields', 'Sunday Tapes', 'Waves', 'Second Light', 'Maps', 'Half Time', 'Events'];

const registry = new Map();
let n = 0;
function makeTrack() {
  const name = `${pick(W1)} ${pick(W2)}`;
  const t = {
    uri: `spotify:track:demo${n++}`,
    name,
    artists: rnd() > 0.8 ? `${pick(ARTISTS)}, ${pick(ARTISTS)}` : pick(ARTISTS),
    album: pick(ALBUMS),
    ms: 120_000 + Math.floor(rnd() * 180_000),
    playable: true,
  };
  registry.set(t.uri, t);
  return t;
}
const makeList = (len) => Array.from({ length: len }, makeTrack);

const PLAYLISTS = ['Morning', 'Focus', 'Roadtrip', 'Old favourites', 'Jazz in the kitchen', 'Workout', 'Evening calm', 'New & curious']
  .map((name, i) => ({
    id: `p${i}`, uri: `spotify:playlist:demo${i}`, name, owner: 'you', ownerId: 'me', collaborative: false,
    tracks: makeList(18 + Math.floor(rnd() * 40)),
  }));
// Mimics a playlist owned by someone else: Spotify's API refuses to list its tracks.
Object.assign(PLAYLISTS.at(-1), { locked: true, owner: 'Spotify', ownerId: 'spotify' });
const LIKED = makeList(173);
const saved = new Set(LIKED.slice(0, 30).map((t) => t.uri));
const TOP = { short_term: LIKED.slice(5, 55), medium_term: LIKED.slice(20, 100), long_term: LIKED.slice(0, 120) };
const RECENT = LIKED.slice(100, 125).map((t) => t.uri);

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const slice = (all, offset, size) => {
  const tracks = all.slice(offset, offset + size);
  return { tracks, total: all.length, hasMore: offset + size < all.length, next: offset + tracks.length };
};
const single = (tracks) => ({ tracks, total: tracks.length, hasMore: false, next: tracks.length });

// Playback queue shared by the data functions and the fake player.
const Q = { queue: [], idx: -1, userCount: 0 };

export const getMe = async () => ({ id: 'me', name: 'you' });
export const getPlaylists = async () => (await delay(), PLAYLISTS.map(({ tracks, ...p }) => p));
export const getLiked = async (offset = 0) => (await delay(), slice(LIKED, offset, 50));
export const getPlaylistTracks = async (id, offset = 0) => {
  await delay();
  const pl = PLAYLISTS.find((p) => p.id === id);
  if (pl.locked) throw Object.assign(new Error('Spotify API 403'), { status: 403 });
  return slice(pl.tracks, offset, 100);
};
export const search = async (q, offset = 0) => {
  await delay();
  const all = [...registry.values()].filter((t) => `${t.name} ${t.artists} ${t.album}`.toLowerCase().includes(q.toLowerCase()));
  return slice(all, offset, 10);
};
export const getQueue = async () => (await delay(), single(Q.queue.slice(Q.idx + 1, Q.idx + 21).map((u) => registry.get(u))));
export const addToQueue = async (uri) => {
  await delay(60);
  Q.queue.splice(Q.idx + 1 + Q.userCount, 0, uri);
  Q.userCount++;
};
export const getRecent = async () => (await delay(), single(RECENT.map((u) => registry.get(u))));
export const getTop = async (range, offset = 0) => (await delay(), slice(TOP[range], offset, 50));
export const addToPlaylist = async (id, uris) => {
  await delay(60);
  PLAYLISTS.find((p) => p.id === id).tracks.push(...uris.map((u) => registry.get(u)));
};
export const createPlaylist = async (name) => {
  await delay(80);
  const pl = { id: `p${PLAYLISTS.length}`, uri: `spotify:playlist:demo${PLAYLISTS.length}`, name, owner: 'you', ownerId: 'me', collaborative: false, tracks: [] };
  PLAYLISTS.push(pl);
  const { tracks, ...info } = pl;
  return info;
};
export const renamePlaylist = async (id, name) => { await delay(60); PLAYLISTS.find((p) => p.id === id).name = name; };
export const deletePlaylist = async (uri) => {
  await delay(60);
  PLAYLISTS.splice(PLAYLISTS.findIndex((p) => p.uri === uri), 1);
};
export const removeFromPlaylist = async (id, uris) => {
  await delay(60);
  const pl = PLAYLISTS.find((p) => p.id === id);
  pl.tracks = pl.tracks.filter((t) => !uris.includes(t.uri));
};
export const moveInPlaylist = async (id, from, before) => {
  await delay(60);
  const { tracks } = PLAYLISTS.find((p) => p.id === id);
  const [t] = tracks.splice(from, 1);
  tracks.splice(before > from ? before - 1 : before, 0, t);
};
export const isSaved = async (uri) => saved.has(uri);
export const save = async (uri) => void saved.add(uri);
export const unsave = async (uri) => void saved.delete(uri);

export async function createPlayer({ onState }) {
  let paused = true;
  let position = 0;
  let last = performance.now();
  let shuffle = false;
  let repeat = 0;
  let active = 'demo'; // which fake device is "playing"
  const DEVICES = [
    { id: 'demo', name: 'slim', type: 'Computer', self: true },
    { id: 'phone', name: "Stefan's iPhone", type: 'Smartphone' },
    { id: 'kitchen', name: 'Kitchen', type: 'Speaker' },
    { id: 'tv', name: 'Living room TV', type: 'TV', restricted: true },
  ];

  const cur = () => registry.get(Q.queue[Q.idx]);
  const sync = () => {
    const now = performance.now();
    if (!paused) position += now - last;
    last = now;
  };
  const emit = () => {
    const t = cur();
    onState(t && {
      paused, position, duration: t.ms, shuffle, repeat, at: performance.now(),
      remote: active !== 'demo', device: DEVICES.find((d) => d.id === active),
      track: { uri: t.uri, name: t.name, artists: t.artists },
    });
  };
  const go = (i) => {
    if (i < 0 || i >= Q.queue.length) { paused = true; position = 0; return emit(); }
    if (i === Q.idx + 1 && Q.userCount > 0) Q.userCount--;
    Q.idx = i; position = 0; paused = false; last = performance.now();
    RECENT.unshift(Q.queue[i]);
    emit();
  };
  const advance = () => {
    if (repeat === 2) return go(Q.idx);
    if (shuffle && Q.queue.length > 1) return go(Math.floor(rnd() * Q.queue.length));
    if (Q.idx + 1 >= Q.queue.length && repeat === 1) return go(0);
    go(Q.idx + 1);
  };
  setInterval(() => { sync(); if (cur() && position >= cur().ms) advance(); }, 500);

  return {
    async play({ context_uri, uris, offset_uri }) {
      Q.userCount = 0;
      if (context_uri) {
        const pl = PLAYLISTS.find((p) => p.uri === context_uri);
        Q.queue = pl.tracks.map((t) => t.uri);
        go(Math.max(0, Q.queue.indexOf(offset_uri)));
      } else {
        Q.queue = [...uris];
        go(0);
      }
    },
    async toggle() { sync(); paused = !paused; emit(); },
    async next() { advance(); },
    async prev() { sync(); position > 3000 ? go(Q.idx) : go(Q.idx - 1); },
    async seek(ms) { sync(); position = Math.max(0, ms); emit(); },
    async setVolume() {},
    deviceId: () => 'demo',
    async setShuffle(on) { shuffle = on; emit(); },
    async setRepeat(mode) { repeat = mode; emit(); },
    async devices() {
      await delay(80);
      return DEVICES.map((d) => ({ ...d, active: d.id === active && !!cur() }));
    },
    async transfer(id, play = true) {
      await delay(80);
      active = id;
      if (play && cur()) { sync(); paused = false; }
      emit();
    },
  };
}
