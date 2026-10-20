// Spotify Authorization Code flow with PKCE. No backend, no client secret.
//
// Two identities ("profiles") can be signed in:
//  - MAIN: the Client ID you create yourself. Used for everything.
//  - FALLBACK: an optional second app registration that is still allowed to read other
//    people's playlists (see README, "Fallback sign-in"). Opt-in, desktop app only.

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-library-modify',
  'user-follow-modify', // needed to remove (unfollow) a playlist via DELETE /me/library
  'user-top-read',
  'user-read-recently-played',
  'user-read-currently-playing',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

// ncspot's Spotify app registration (the same one spotify-player defaults to). Spotify only
// allows loopback redirects, and this app's registered redirect is fixed to port 8989; the
// desktop app listens there and forwards the callback to the main page (see main.rs).
const FALLBACK = {
  clientId: 'd420a117a32841c2b3474932e49fb54b',
  redirectUri: 'http://127.0.0.1:8989/login',
  scopes: 'playlist-read-private playlist-read-collaborative',
};

const K = {
  client: 'sl.clientId',
  tokens: 'sl.tokens',
  verifier: 'sl.verifier',
  state: 'sl.state',
  fbTokens: 'sl.fbTokens',
  fbVerifier: 'sl.fbVerifier',
  fbState: 'sl.fbState',
};

export const redirectUri = () => location.origin + location.pathname;
export const getClientId = () => localStorage.getItem(K.client) || '';
export const setClientId = (id) => localStorage.setItem(K.client, id.trim());

const MAIN = {
  tokens: K.tokens, verifier: K.verifier, state: K.state,
  scopes: SCOPES, clientId: getClientId, redirectUri,
};
const FB = {
  tokens: K.fbTokens, verifier: K.fbVerifier, state: K.fbState,
  scopes: FALLBACK.scopes, clientId: () => FALLBACK.clientId, redirectUri: () => FALLBACK.redirectUri,
};

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => CHARS[x % CHARS.length]).join('');
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const load = (profile) => {
  try { return JSON.parse(localStorage.getItem(profile.tokens)); } catch { return null; }
};
const save = (profile, t) => localStorage.setItem(profile.tokens, JSON.stringify(t));
const clear = (profile) => localStorage.removeItem(profile.tokens);

export const isLoggedIn = () => !!load(MAIN)?.refresh;
/** False when the saved login predates a scope we now ask for, so it needs a fresh login. */
export const hasCurrentScopes = () => load(MAIN)?.scopes === SCOPES;
export const logout = () => clear(MAIN);

async function startLogin(profile) {
  const verifier = rand(64);
  const state = rand(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(profile.verifier, verifier);
  sessionStorage.setItem(profile.state, state);
  location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: profile.clientId(),
    response_type: 'code',
    redirect_uri: profile.redirectUri(),
    scope: profile.scopes,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
}

export const login = () => startLogin(MAIN);

/**
 * Call on page load. Returns null when this isn't a login redirect, otherwise
 * { fallback: boolean, error?: string }. Errors from the main login are thrown; a failed
 * fallback login is reported in the result so it can't take the whole app down.
 */
export async function handleCallback() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) return null;
  const profile = p.get('fb') === '1' ? FB : MAIN;
  history.replaceState({}, '', location.pathname);

  const finish = async () => {
    if (p.has('error')) throw new Error(p.get('error'));
    if (p.get('state') !== sessionStorage.getItem(profile.state)) throw new Error('Invalid state – try again');
    await tokenRequest(profile, {
      grant_type: 'authorization_code',
      code: p.get('code'),
      redirect_uri: profile.redirectUri(),
      code_verifier: sessionStorage.getItem(profile.verifier),
    });
  };

  if (profile === MAIN) { await finish(); return { fallback: false }; }
  try { await finish(); return { fallback: true }; } catch (e) { return { fallback: true, error: e.message }; }
}

async function tokenRequest(profile, params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: profile.clientId(), ...params }),
  });
  if (!r.ok) throw new Error(`Token error ${r.status}`);
  const j = await r.json();
  const prev = load(profile);
  save(profile, {
    access: j.access_token,
    refresh: j.refresh_token ?? prev?.refresh,
    expires: Date.now() + j.expires_in * 1000 - 30_000,
    // A refresh never widens the granted scopes; only a fresh login does.
    scopes: params.grant_type === 'authorization_code' ? profile.scopes : prev?.scopes,
  });
}

const refreshing = new Map();

/** Returns a valid access token for the profile, refreshing it if needed. null = sign in again. */
async function tokenFor(profile) {
  const t = load(profile);
  if (!t) return null;
  if (Date.now() < t.expires) return t.access;
  if (!refreshing.has(profile)) {
    refreshing.set(profile, tokenRequest(profile, { grant_type: 'refresh_token', refresh_token: t.refresh })
      .finally(() => refreshing.delete(profile)));
  }
  try {
    await refreshing.get(profile);
  } catch {
    clear(profile);
    return null;
  }
  return load(profile)?.access ?? null;
}

export const getToken = () => tokenFor(MAIN);

/* fallback sign-in ------------------------------------------------- */
/** The :8989 callback listener only exists in the desktop app (Tauri or Electron). */
export const fallbackSupported = () => !!window.__TAURI_INTERNALS__ || !!window.slimDesktop;
export const hasFallback = () => !!load(FB)?.refresh;
export const loginFallback = () => startLogin(FB);
export const clearFallback = () => clear(FB);
export const getFallbackToken = () => tokenFor(FB);
