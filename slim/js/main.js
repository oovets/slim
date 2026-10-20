import * as auth from './auth.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const data = await import(DEMO ? './demo.js' : './api.js');
const { createPlayer } = await import(DEMO ? './demo.js' : './player.js');

const $ = (id) => document.getElementById(id);
const el = { app: $('app'), setup: $('setup'), list: $('list'), q: $('q'), title: $('title'), count: $('count'), playlists: $('playlists') };

const store = {
  get: (k, d) => { try { return localStorage.getItem('sl.' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('sl.' + k, v); } catch {} },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const VIEW_TITLES = { liked: 'Gillade låtar', search: 'Sök', queue: 'Kö', recent: 'Senast spelat', top: 'Mest spelat' };
const EMPTY_TEXT = { search: 'Inga träffar.', queue: 'Kön är tom.', recent: 'Inget spelat än.' };
const RANGES = ['short_term', 'medium_term', 'long_term'];
const savedRange = () => (RANGES.includes(store.get('range', '')) ? store.get('range', '') : 'medium_term');

const S = {
  me: null,
  playlists: [],
  view: null,        // { type: 'liked' | 'playlist' | 'search' | 'queue' | 'recent' | 'top', ... }
  shown: [],         // tracks currently rendered (after filter)
  raw: [],           // every track fetched for the view, unfiltered
  total: 0,
  next: 0,
  hasMore: false,
  loading: false,
  gen: 0,            // bumped on view change to drop stale responses
  filter: '',
  sel: -1,
  now: null,         // player state
  liked: false,
  shuffle: false,
  repeat: 0,         // 0 off, 1 context, 2 track
  player: null,
};

/* toast ------------------------------------------------------------ */
let toastTimer;
function toast(msg, ms = 4000) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

/** Which DRM (EME) key system does this webview offer? Spotify's SDK needs one. */
async function probeDrm() {
  const cfg = [{
    initDataTypes: ['cenc', 'sinf', 'skd'],
    audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"' }],
  }];
  for (const ks of ['com.widevine.alpha', 'com.apple.fps', 'com.apple.fps.1_0']) {
    try { await navigator.requestMediaKeySystemAccess(ks, cfg); return ks; } catch {}
  }
  return null;
}
const fail = (e) => {
  console.error(e);
  toast(e?.status === 403 ? 'Spotify nekade åtkomst (403) – prova att logga ut och in igen' : (e?.message ?? String(e)));
};

/* theme ------------------------------------------------------------ */
const THEMES = ['auto', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('theme').textContent = `tema: ${t === 'auto' ? 'auto' : t === 'light' ? 'ljust' : 'mörkt'}`;
  store.set('theme', t === 'auto' ? '' : t);
}
const cycleTheme = () => applyTheme(THEMES[(THEMES.indexOf(store.get('theme', '') || 'auto') + 1) % 3]);

/* zoom (desktop app only; browsers already zoom natively) ----------- */
const TAURI = window.__TAURI_INTERNALS__;
let zoom = Number(store.get('zoom', 1)) || 1;

async function setZoom(z) {
  zoom = Math.round(Math.min(2, Math.max(0.7, z)) * 10) / 10;
  store.set('zoom', zoom);
  try {
    await TAURI.invoke('plugin:webview|set_webview_zoom', { label: TAURI.metadata.currentWebview.label, value: zoom });
    toast(`Zoom ${Math.round(zoom * 100)}%`, 900);
  } catch (e) { fail(e); }
}

/* setup / auth ----------------------------------------------------- */
function showSetup(err) {
  el.app.hidden = true;
  el.setup.hidden = false;
  $('clientId').value = auth.getClientId();
  $('redirect').value = auth.redirectUri();
  $('setupErr').hidden = !err;
  $('setupErr').textContent = err ?? '';
}

$('connect').onclick = async () => {
  const id = $('clientId').value.trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) {
    $('setupErr').textContent = 'Client ID ska vara 32 tecken (hex).';
    $('setupErr').hidden = false;
    return;
  }
  auth.setClientId(id);
  await auth.login();
};
$('redirect').onclick = (e) => { e.target.select(); navigator.clipboard?.writeText(e.target.value); };
$('logout').onclick = () => { auth.logout(); location.href = location.pathname; };

/* views ------------------------------------------------------------ */
function renderNav() {
  const v = S.view;
  document.querySelectorAll('.nav[data-view]').forEach((b) => b.classList.toggle('active', v.type === b.dataset.view));
  el.playlists.innerHTML = S.playlists
    .map((p) => `<button class="nav${v.type === 'playlist' && v.id === p.id ? ' active' : ''}" data-id="${esc(p.id)}" title="${esc(p.name)}">${esc(p.name)}</button>`)
    .join('');
}

async function openView(view) {
  S.view = view;
  S.gen++;
  S.shown = [];
  S.raw = [];
  S.total = S.next = 0;
  S.hasMore = true;
  S.loading = false;
  S.sel = -1;
  S.filter = '';
  el.q.value = '';
  el.q.placeholder = view.type === 'search' ? 'Sök låtar, tryck enter  /' : 'Filtrera  /';
  el.title.textContent = view.type === 'playlist' ? view.name : VIEW_TITLES[view.type];
  el.count.textContent = '';
  $('range').hidden = view.type !== 'top';
  document.querySelectorAll('#range button').forEach((b) => b.classList.toggle('active', b.dataset.r === view.range));
  el.app.classList.remove('menu-open');
  el.list.scrollTop = 0;
  renderNav();
  resetList();

  if (view.type === 'search') {
    S.hasMore = false;
    el.list.insertAdjacentHTML('beforeend', '<div class="empty" id="hint">Skriv och tryck enter.</div>');
    el.q.focus();
    return;
  }
  await loadMore();
}

function resetList() {
  el.list.innerHTML = `<div class="colhead"><span></span><span>Titel</span><span>Artist</span><span class="al">Album</span><span class="d">Tid</span></div>`;
}

function fetchPage() {
  const v = S.view;
  switch (v.type) {
    case 'liked': return data.getLiked(S.next);
    case 'playlist': return data.getPlaylistTracks(v.id, S.next);
    case 'queue': return data.getQueue();
    case 'recent': return data.getRecent();
    case 'top': return data.getTop(v.range, S.next);
    default: return data.search(v.q, S.next);
  }
}

async function loadMore() {
  if (S.loading || !S.hasMore) return;
  S.loading = true;
  const gen = S.gen;
  try {
    const r = await fetchPage();
    if (gen !== S.gen) return;
    S.raw.push(...r.tracks);
    S.total = r.total;
    S.next = r.next;
    S.hasMore = r.hasMore && r.tracks.length > 0;
    appendRows(r.tracks.filter(matches));
    updateCount();
  } catch (e) {
    if (gen !== S.gen) return;
    S.hasMore = false;
    if (S.view.type === 'playlist' && (e.status === 403 || e.status === 404)) {
      el.list.insertAdjacentHTML('beforeend',
        '<div class="empty">Spotify låter bara appar läsa låtarna i dina egna spellistor, så listan kan inte visas.' +
        '<br><button id="playCtx" class="primary">Spela spellistan</button></div>');
    } else fail(e);
  } finally {
    if (gen === S.gen) { S.loading = false; maybeLoadMore(); }
  }
}

function maybeLoadMore() {
  if (!S.hasMore || S.loading) return;
  const nearEnd = el.list.scrollTop + el.list.clientHeight > el.list.scrollHeight - 600;
  if (nearEnd || (S.filter && S.view.type !== 'search')) loadMore();
}
el.list.addEventListener('scroll', maybeLoadMore, { passive: true });

function updateCount() {
  const t = S.total;
  const shown = S.filter ? `${S.shown.length} av ${t}` : `${t}`;
  el.count.textContent = t ? `${shown} låtar` : '';
}

/* rows ------------------------------------------------------------- */
function matches(t) {
  if (!S.filter || S.view.type === 'search') return true;
  const hay = `${t.name} ${t.artists} ${t.album}`.toLowerCase();
  return S.filter.split(/\s+/).every((w) => hay.includes(w));
}

function appendRows(tracks) {
  if (!tracks.length && !S.shown.length && !S.hasMore) {
    const msg = S.filter ? 'Inget matchar filtret.' : (EMPTY_TEXT[S.view.type] ?? 'Tom lista.');
    el.list.insertAdjacentHTML('beforeend', `<div class="empty">${msg}</div>`);
    return;
  }
  const start = S.shown.length;
  S.shown.push(...tracks);
  el.list.querySelector('.empty')?.remove();
  el.list.insertAdjacentHTML('beforeend', tracks.map((t, k) =>
    `<div class="row${t.playable ? '' : ' off'}" data-i="${start + k}" data-uri="${esc(t.uri)}">` +
    `<span class="n" data-n="${start + k + 1}"></span><span class="t" title="${esc(t.name)}">${esc(t.name)}</span>` +
    `<span class="a">${esc(t.artists)}</span><span class="al">${esc(t.album)}</span><span class="d">${fmt(t.ms)}</span></div>`
  ).join(''));
  markPlaying();
}

/** Re-apply the filter to everything fetched so far, without refetching. */
function refilter() {
  S.shown = [];
  S.sel = -1;
  resetList();
  appendRows(S.raw.filter(matches));
  updateCount();
  maybeLoadMore();
}

function setSel(i, scroll = true) {
  el.list.querySelector('.row.sel')?.classList.remove('sel');
  S.sel = Math.min(Math.max(i, -1), S.shown.length - 1);
  const row = el.list.querySelector(`.row[data-i="${S.sel}"]`);
  if (!row) return;
  row.classList.add('sel');
  if (scroll) row.scrollIntoView({ block: 'nearest' });
}

function markPlaying() {
  const uri = S.now?.track?.uri;
  el.list.querySelectorAll('.row.playing').forEach((r) => r.classList.remove('playing'));
  if (uri) el.list.querySelectorAll(`.row[data-uri="${CSS.escape(uri)}"]`).forEach((r) => r.classList.add('playing'));
}

/* playback --------------------------------------------------------- */
async function playIndex(i) {
  const t = S.shown[i];
  if (!t?.playable || !S.player) return;
  const v = S.view;
  try {
    if (v.type === 'playlist' && !S.filter) await S.player.play({ context_uri: v.uri, offset_uri: t.uri });
    else await S.player.play({ uris: S.shown.slice(i, i + 100).filter((x) => x.playable).map((x) => x.uri) });
  } catch (e) { fail(e); }
}

const PLAY = '<svg viewBox="0 0 16 16"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16"><path d="M5 3v10M11 3v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function onPlayerState(st) {
  const prev = S.now?.track?.uri;
  S.now = st;
  $('pp').innerHTML = st && !st.paused ? PAUSE : PLAY;
  $('npTitle').textContent = st?.track.name ?? 'Ingenting spelas';
  $('npArtist').textContent = st?.track.artists ?? '';
  $('tdur').textContent = fmt(st?.duration ?? 0);
  document.title = st && !st.paused ? `${st.track.name} · ${st.track.artists}` : 'slim';
  if (st) { S.shuffle = !!st.shuffle; S.repeat = st.repeat ?? 0; setModesUi(); }
  markPlaying();
  tick();
  updateMediaSession(prev);
  if (st?.track.uri !== prev) {
    refreshLiked();
    if (S.view?.type === 'queue') setTimeout(refreshQueue, 500); // the queue endpoint lags a moment behind
  }
}

function tick() {
  const st = S.now;
  const pos = st ? Math.min(st.duration, st.position + (st.paused ? 0 : performance.now() - st.at)) : 0;
  $('tcur').textContent = fmt(pos);
  $('fill').style.width = st?.duration ? `${(pos / st.duration) * 100}%` : '0';
}
setInterval(tick, 250);

async function refreshLiked() {
  const uri = S.now?.track.uri;
  S.liked = false;
  setLikeUi();
  if (!uri) return;
  try {
    const v = await data.isSaved(uri);
    if (S.now?.track.uri === uri) { S.liked = v; setLikeUi(); }
  } catch {}
}
function setLikeUi() { $('like').classList.toggle('on', S.liked); }

async function toggleLike() {
  const uri = S.now?.track.uri;
  if (!uri) return;
  const want = !S.liked;
  S.liked = want;
  setLikeUi();
  try { await (want ? data.save(uri) : data.unsave(uri)); } catch (e) { S.liked = !want; setLikeUi(); fail(e); }
}

const seekTo = (ms) => S.now && S.player?.seek(Math.min(ms, S.now.duration - 1));
const curPos = () => (S.now ? S.now.position + (S.now.paused ? 0 : performance.now() - S.now.at) : 0);

/* shuffle / repeat ------------------------------------------------- */
function setModesUi() {
  $('shuffle').classList.toggle('on', S.shuffle);
  $('repeat').classList.toggle('on', S.repeat > 0);
  $('repeat').dataset.mode = S.repeat === 2 ? 'track' : '';
}

async function toggleShuffle() {
  if (!S.player) return;
  const was = S.shuffle;
  S.shuffle = !was;
  setModesUi();
  try { await S.player.setShuffle(S.shuffle); } catch (e) { S.shuffle = was; setModesUi(); fail(e); }
}

async function cycleRepeat() {
  if (!S.player) return;
  const was = S.repeat;
  S.repeat = (was + 1) % 3;
  setModesUi();
  try { await S.player.setRepeat(S.repeat); } catch (e) { S.repeat = was; setModesUi(); fail(e); }
}

/* queue ------------------------------------------------------------ */
const refreshQueue = () => { if (S.view?.type === 'queue') openView({ type: 'queue' }); };

async function queueSelected() {
  const t = S.shown[S.sel];
  if (!t?.playable) return toast('Välj en låt först', 1500);
  try {
    await data.addToQueue(t.uri, S.player?.deviceId());
    toast(`Lade i kön: ${t.name}`, 1500);
    if (S.view.type === 'queue') setTimeout(refreshQueue, 600);
  } catch (e) {
    if (e.status === 404) toast('Starta en låt först, så finns det en kö att lägga i', 3000);
    else fail(e);
  }
}

/* add to playlist -------------------------------------------------- */
const P = { track: null, items: [], sel: 0 };
const editablePlaylists = () => S.playlists.filter((p) => !S.me || p.ownerId === S.me.id || p.collaborative);

function openPicker() {
  const t = S.shown[S.sel] ?? S.now?.track;
  if (!t) return toast('Välj en låt först', 1500);
  P.track = t;
  P.sel = 0;
  $('pkTitle').textContent = `Lägg till ”${t.name}” i`;
  $('pkq').value = '';
  $('picker').hidden = false;
  renderPicker();
  $('pkq').focus();
}

function renderPicker() {
  const q = $('pkq').value.trim().toLowerCase();
  P.items = editablePlaylists().filter((p) => p.name.toLowerCase().includes(q));
  P.sel = Math.min(P.sel, Math.max(0, P.items.length - 1));
  $('pkList').innerHTML = P.items.length
    ? P.items.map((p, i) => `<div class="pk-item${i === P.sel ? ' sel' : ''}" data-i="${i}">${esc(p.name)}</div>`).join('')
    : '<div class="pk-empty">Inga spellistor.</div>';
  $('pkList').querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

const closePicker = () => { $('picker').hidden = true; $('pkq').blur(); };

async function chooseList(i) {
  const p = P.items[i];
  if (!p) return;
  closePicker();
  try {
    await data.addToPlaylist(p.id, [P.track.uri]);
    toast(`Lade till i ${p.name}`, 1800);
    if (S.view.type === 'playlist' && S.view.id === p.id) openView(S.view);
  } catch (e) { fail(e); }
}

/* media keys / macOS "Now Playing" --------------------------------- */
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const on = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch {} };
  on('play', () => S.player?.toggle());
  on('pause', () => S.player?.toggle());
  on('nexttrack', () => S.player?.next());
  on('previoustrack', () => S.player?.prev());
  on('seekto', (d) => seekTo(d.seekTime * 1000));
}

function updateMediaSession(prevUri) {
  if (!('mediaSession' in navigator)) return;
  const st = S.now;
  const ms = navigator.mediaSession;
  if (st?.track.uri !== prevUri) {
    ms.metadata = st ? new MediaMetadata({ title: st.track.name, artist: st.track.artists }) : null;
  }
  ms.playbackState = !st ? 'none' : st.paused ? 'paused' : 'playing';
  try {
    if (st) ms.setPositionState({ duration: st.duration / 1000, position: Math.min(st.position, st.duration) / 1000, playbackRate: 1 });
  } catch {}
}

/* events ----------------------------------------------------------- */
function bind() {
  $('theme').onclick = cycleTheme;
  $('help').onclick = () => ($('helpbox').hidden = !$('helpbox').hidden);
  $('menu').onclick = () => el.app.classList.toggle('menu-open');

  $('nav').onclick = (e) => {
    const b = e.target.closest('button.nav');
    if (!b) return;
    const v = b.dataset.view;
    if (v === 'search') openView({ type: 'search', q: '' });
    else if (v === 'top') openView({ type: 'top', range: savedRange() });
    else if (v) openView({ type: v });
    else if (b.dataset.id) {
      const p = S.playlists.find((x) => x.id === b.dataset.id);
      openView({ type: 'playlist', id: p.id, uri: p.uri, name: p.name });
    }
  };

  $('range').onclick = (e) => {
    const b = e.target.closest('button[data-r]');
    if (!b) return;
    store.set('range', b.dataset.r);
    openView({ type: 'top', range: b.dataset.r });
  };

  el.list.addEventListener('click', (e) => {
    if (e.target.closest('#playCtx')) {
      S.player?.play({ context_uri: S.view.uri }).catch(fail);
      return;
    }
    const r = e.target.closest('.row');
    if (r) setSel(+r.dataset.i, false);
  });
  el.list.addEventListener('dblclick', (e) => {
    const r = e.target.closest('.row');
    if (r) playIndex(+r.dataset.i);
  });

  $('pp').onclick = () => S.player?.toggle();
  $('next').onclick = () => S.player?.next();
  $('prev').onclick = () => S.player?.prev();
  $('shuffle').onclick = toggleShuffle;
  $('repeat').onclick = cycleRepeat;
  $('like').onclick = toggleLike;
  $('prog').onclick = (e) => {
    if (!S.now) return;
    const r = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * S.now.duration);
  };

  const vol = $('vol');
  const setVol = (v) => {
    vol.value = v;
    vol.style.setProperty('--v', `${v}%`);
    S.player?.setVolume(v / 100);
    store.set('vol', v);
  };
  vol.value = store.get('vol', 50);
  vol.style.setProperty('--v', `${vol.value}%`);
  vol.oninput = () => setVol(+vol.value);

  el.q.addEventListener('input', () => {
    if (S.view.type === 'search') return;
    S.filter = el.q.value.trim().toLowerCase();
    refilter();
  });
  el.q.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { el.q.value = ''; el.q.dispatchEvent(new Event('input')); el.q.blur(); }
    if (e.key !== 'Enter') return;
    if (S.view.type === 'search') {
      const q = el.q.value.trim();
      if (!q) return;
      const keep = el.q.value;
      await openView({ type: 'search', q });
      el.q.value = keep;
      S.hasMore = true;
      await loadMore();
      el.q.blur();
    } else {
      el.q.blur();
      setSel(0);
    }
  });

  // playlist picker
  $('pkq').addEventListener('input', () => { P.sel = 0; renderPicker(); });
  $('pkq').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
    else if (e.key === 'Enter') { e.preventDefault(); chooseList(P.sel); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      P.sel = Math.min(Math.max(P.sel + (e.key === 'ArrowDown' ? 1 : -1), 0), P.items.length - 1);
      renderPicker();
    }
  });
  $('pkList').addEventListener('click', (e) => {
    const it = e.target.closest('.pk-item');
    if (it) chooseList(+it.dataset.i);
  });
  $('picker').addEventListener('click', (e) => { if (e.target === $('picker')) closePicker(); });

  document.addEventListener('keydown', (e) => {
    if (TAURI && e.metaKey && !e.ctrlKey && !e.altKey) {
      const step = { '=': 0.1, '+': 0.1, '-': -0.1, _: -0.1 }[e.key];
      if (step) { e.preventDefault(); setZoom(zoom + step); }
      else if (e.key === '0') { e.preventDefault(); setZoom(1); }
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$('picker').hidden) return;
    if (e.target === el.q || e.target.id === 'clientId') return;
    const k = e.key;
    const handled = {
      ' ': () => S.player?.toggle(),
      ArrowDown: () => setSel(S.sel + 1), j: () => setSel(S.sel + 1),
      ArrowUp: () => setSel(S.sel - 1), k: () => setSel(S.sel - 1),
      Enter: () => S.sel >= 0 && playIndex(S.sel),
      ArrowRight: () => seekTo(curPos() + 10_000),
      ArrowLeft: () => seekTo(curPos() - 10_000),
      n: () => S.player?.next(), p: () => S.player?.prev(),
      s: toggleShuffle, r: cycleRepeat,
      q: queueSelected, a: openPicker,
      '+': () => setVol(Math.min(100, +vol.value + 5)), '=': () => setVol(Math.min(100, +vol.value + 5)),
      '-': () => setVol(Math.max(0, +vol.value - 5)),
      l: toggleLike, t: cycleTheme,
      '?': () => ($('helpbox').hidden = !$('helpbox').hidden),
      '/': () => el.q.focus(),
      Escape: () => { $('helpbox').hidden = true; },
    }[k];
    if (!handled) return;
    e.preventDefault();
    handled();
  });
}

/* boot ------------------------------------------------------------- */
async function start() {
  el.setup.hidden = true;
  el.app.hidden = false;
  try { S.me = await data.getMe(); } catch (e) { console.warn('getMe failed', e); }
  try { S.playlists = await data.getPlaylists(); } catch (e) { fail(e); }
  openView({ type: 'liked' });
  if (!DEMO) {
    const drm = await probeDrm();
    console.info('DRM key system:', drm);
    if (!drm) toast('Den här webbvyn saknar DRM-stöd (EME) – Spotify-uppspelning fungerar troligen inte här.', 12000);
  }
  try {
    S.player = await createPlayer({ onState: onPlayerState, onError: toast, volume: +store.get('vol', 50) / 100 });
    onPlayerState(null);
    setupMediaSession();
  } catch (e) { fail(e); }
}

(async () => {
  if (TAURI) {
    document.documentElement.classList.add('tauri');
    if (zoom !== 1) TAURI.invoke('plugin:webview|set_webview_zoom', { label: TAURI.metadata.currentWebview.label, value: zoom }).catch(() => {});
  }
  applyTheme(store.get('theme', '') || 'auto');
  bind();
  $('pp').innerHTML = PLAY;

  if (DEMO) return start();

  // Spotify rejects "localhost" redirect URIs; use the loopback IP literal instead.
  if (location.protocol === 'http:' && location.hostname === 'localhost') {
    location.replace(location.href.replace('//localhost', '//127.0.0.1'));
    return;
  }
  try { await auth.handleCallback(); } catch (e) { return showSetup(e.message); }
  if (!auth.isLoggedIn()) return showSetup();
  if (!auth.hasCurrentScopes()) {
    auth.logout();
    return showSetup('Nya funktioner kräver ny inloggning – klicka Anslut.');
  }
  start();
})();
