// Spotify Web Playback SDK wrapper. Makes this page a Spotify Connect device.
// Interface (shared with demo.js): createPlayer({ onState, onError }) -> controls

import { getToken } from './auth.js';
import { api } from './api.js';

function loadSdk() {
  return new Promise((resolve, reject) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.onerror = () => reject(new Error('Kunde inte ladda Spotify SDK'));
    document.head.append(s);
  });
}

function toState(s) {
  if (!s?.track_window?.current_track) return null;
  const t = s.track_window.current_track;
  return {
    paused: s.paused,
    position: s.position,
    duration: s.duration,
    shuffle: s.shuffle,
    repeat: s.repeat_mode, // 0 off, 1 context, 2 track
    at: performance.now(),
    track: { uri: t.uri, name: t.name, artists: t.artists.map((a) => a.name).join(', ') },
  };
}

export async function createPlayer({ onState, onError, volume = 0.5 }) {
  await loadSdk();
  let deviceId = null;

  const p = new Spotify.Player({
    name: 'slim',
    getOAuthToken: (cb) => getToken().then((t) => t && cb(t)),
    volume,
  });

  p.addListener('ready', async ({ device_id }) => {
    deviceId = device_id;
    try { await api('/me/player', { method: 'PUT', body: { device_ids: [device_id], play: false } }); } catch {}
  });
  p.addListener('not_ready', () => { deviceId = null; });
  p.addListener('player_state_changed', (s) => onState(toState(s)));
  p.addListener('initialization_error', ({ message }) => onError(message));
  p.addListener('authentication_error', ({ message }) => onError(message));
  p.addListener('account_error', () => onError('Spotify Premium krävs för uppspelning'));
  p.addListener('playback_error', ({ message }) => onError(message));

  if (!(await p.connect())) onError('Kunde inte ansluta spelaren');

  return {
    async play({ context_uri, uris, offset_uri }) {
      p.activateElement(); // must run inside the click handler for autoplay rules
      if (!deviceId) throw new Error('Spelaren startar fortfarande – försök igen om en sekund');
      const body = context_uri
        ? { context_uri, ...(offset_uri && { offset: { uri: offset_uri } }) }
        : { uris };
      await api('/me/player/play', { method: 'PUT', query: { device_id: deviceId }, body });
    },
    toggle: () => { p.activateElement(); return p.togglePlay(); },
    next: () => p.nextTrack(),
    prev: () => p.previousTrack(),
    seek: (ms) => p.seek(Math.max(0, Math.round(ms))),
    setVolume: (v) => p.setVolume(v),
    deviceId: () => deviceId,
    // The SDK exposes shuffle/repeat read-only, so these go through the Web API.
    setShuffle: (on) => api('/me/player/shuffle', { method: 'PUT', query: { state: on, device_id: deviceId } }),
    setRepeat: (mode) => api('/me/player/repeat', { method: 'PUT', query: { state: ['off', 'context', 'track'][mode], device_id: deviceId } }),
  };
}
