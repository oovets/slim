// Spotify Web Playback SDK wrapper. Makes this page a Spotify Connect device, and can
// also remote-control any other Connect device (phone, speaker, ...) over the Web API.
// Interface (shared with demo.js): createPlayer({ onState, onError }) -> controls

import { getToken } from './auth.js';
import { api } from './api.js';

function loadSdk() {
  return new Promise((resolve, reject) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.onerror = () => reject(new Error('Could not load the Spotify SDK'));
    document.head.append(s);
  });
}

const names = (list) => (list ?? []).map((a) => a.name).join(', ');

function fromSdk(s) {
  if (!s?.track_window?.current_track) return null;
  const t = s.track_window.current_track;
  return {
    paused: s.paused,
    position: s.position,
    duration: s.duration,
    shuffle: s.shuffle,
    repeat: s.repeat_mode, // 0 off, 1 context, 2 track
    at: performance.now(),
    remote: false,
    track: { uri: t.uri, name: t.name, artists: names(t.artists) },
  };
}

function fromRest(s) {
  const t = s?.item;
  if (!t) return null;
  return {
    paused: !s.is_playing,
    position: s.progress_ms ?? 0,
    duration: t.duration_ms,
    shuffle: s.shuffle_state,
    repeat: ['off', 'context', 'track'].indexOf(s.repeat_state),
    at: performance.now(),
    remote: true,
    device: { id: s.device.id, name: s.device.name },
    track: { uri: t.uri, name: t.name, artists: t.type === 'episode' ? (t.show?.name ?? '') : names(t.artists) },
  };
}

export async function createPlayer({ onState, onError, volume = 0.5 }) {
  await loadSdk();
  let deviceId = null;
  let remote = null;       // { id, name } while another Connect device is the active one
  let remoteState = null;  // last state read from that device
  let pollTimer = null;

  const p = new Spotify.Player({
    name: 'slim',
    getOAuthToken: (cb) => getToken().then((t) => t && cb(t)),
    volume,
  });

  p.addListener('ready', ({ device_id }) => { deviceId = device_id; poll(); });
  p.addListener('not_ready', () => { deviceId = null; });
  p.addListener('player_state_changed', (s) => { if (!remote) onState(fromSdk(s)); });
  p.addListener('initialization_error', ({ message }) => onError(message));
  p.addListener('authentication_error', ({ message }) => onError(message));
  p.addListener('account_error', () => onError('Spotify Premium is required for playback'));
  p.addListener('playback_error', ({ message }) => onError(message));

  // The SDK only reports this page's own playback. To notice (and mirror) playback on
  // another device we ask the Web API which device is active: rarely while idle, often
  // while remote-controlling.
  async function poll() {
    clearTimeout(pollTimer);
    try {
      const s = await api('/me/player'); // null (204) when nothing is active
      if (s?.device && s.item && s.device.id !== deviceId) {
        remote = { id: s.device.id, name: s.device.name };
        remoteState = fromRest(s);
        onState(remoteState);
      } else if (remote) {
        remote = null;
        remoteState = null;
        onState(fromSdk(await p.getCurrentState()));
      }
    } catch { /* transient; try again on the next tick */ }
    pollTimer = setTimeout(poll, remote ? 2000 : 10_000);
  }
  const pollSoon = (ms = 400) => { clearTimeout(pollTimer); pollTimer = setTimeout(poll, ms); };

  if (!(await p.connect())) onError('Could not connect the player');

  const target = () => remote?.id ?? deviceId;
  const toRemote = async (path, method, query = {}) => {
    await api(path, { method, query: { ...query, device_id: remote.id } });
    pollSoon();
  };

  return {
    async play({ context_uri, uris, offset_uri }) {
      p.activateElement(); // must run inside the click handler for autoplay rules
      const id = target();
      if (!id) throw new Error('The player is still starting – try again in a second');
      const body = context_uri
        ? { context_uri, ...(offset_uri && { offset: { uri: offset_uri } }) }
        : { uris };
      const start = () => api('/me/player/play', { method: 'PUT', query: { device_id: id }, body });
      try {
        await start();
      } catch (e) {
        if (e.status !== 404 || remote) throw e;
        // This device isn't active yet: make it the active one, then retry once.
        await api('/me/player', { method: 'PUT', body: { device_ids: [id], play: false } });
        await new Promise((r) => setTimeout(r, 400));
        await start();
      }
      if (remote) pollSoon();
    },
    toggle() {
      if (!remote) { p.activateElement(); return p.togglePlay(); }
      return toRemote(remoteState?.paused ? '/me/player/play' : '/me/player/pause', 'PUT');
    },
    next: () => (remote ? toRemote('/me/player/next', 'POST') : p.nextTrack()),
    prev: () => (remote ? toRemote('/me/player/previous', 'POST') : p.previousTrack()),
    seek: (ms) => (remote
      ? toRemote('/me/player/seek', 'PUT', { position_ms: Math.max(0, Math.round(ms)) })
      : p.seek(Math.max(0, Math.round(ms)))),
    setVolume: (v) => (remote
      ? api('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(v * 100), device_id: remote.id } })
      : p.setVolume(v)),
    deviceId: target,
    // The SDK exposes shuffle/repeat read-only, so these go through the Web API.
    async setShuffle(on) {
      await api('/me/player/shuffle', { method: 'PUT', query: { state: on, device_id: target() } });
      if (remote) pollSoon();
    },
    async setRepeat(mode) {
      await api('/me/player/repeat', { method: 'PUT', query: { state: ['off', 'context', 'track'][mode], device_id: target() } });
      if (remote) pollSoon();
    },

    async devices() {
      const r = await api('/me/player/devices');
      return r.devices
        .filter((d) => d.id)
        .map((d) => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, restricted: d.is_restricted, self: d.id === deviceId }));
    },
    /** Moves playback to another device (or back to this one). */
    async transfer(id, play = true) {
      p.activateElement();
      await api('/me/player', { method: 'PUT', body: { device_ids: [id], play } });
      pollSoon(700);
    },
  };
}
