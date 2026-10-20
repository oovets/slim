// Spotify Authorization Code flow with PKCE. No backend, no client secret.

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
  'user-top-read',
  'user-read-recently-played',
  'user-read-currently-playing',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

const K = {
  client: 'sl.clientId',
  tokens: 'sl.tokens',
  verifier: 'sl.verifier',
  state: 'sl.state',
};

export const redirectUri = () => location.origin + location.pathname;
export const getClientId = () => localStorage.getItem(K.client) || '';
export const setClientId = (id) => localStorage.setItem(K.client, id.trim());

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => CHARS[x % CHARS.length]).join('');
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const loadTokens = () => {
  try { return JSON.parse(localStorage.getItem(K.tokens)); } catch { return null; }
};
const saveTokens = (t) => localStorage.setItem(K.tokens, JSON.stringify(t));

export const isLoggedIn = () => !!loadTokens()?.refresh;
/** False when the saved login predates a scope we now ask for, so it needs a fresh login. */
export const hasCurrentScopes = () => loadTokens()?.scopes === SCOPES;
export const logout = () => localStorage.removeItem(K.tokens);

export async function login() {
  const verifier = rand(64);
  const state = rand(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(K.verifier, verifier);
  sessionStorage.setItem(K.state, state);
  location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: getClientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
}

/** Call on page load. Returns true if a login redirect was just completed. */
export async function handleCallback() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) return false;
  history.replaceState({}, '', location.pathname);
  if (p.has('error')) throw new Error(p.get('error'));
  if (p.get('state') !== sessionStorage.getItem(K.state)) throw new Error('Ogiltigt state – försök igen');
  await tokenRequest({
    grant_type: 'authorization_code',
    code: p.get('code'),
    redirect_uri: redirectUri(),
    code_verifier: sessionStorage.getItem(K.verifier),
  });
  return true;
}

async function tokenRequest(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getClientId(), ...params }),
  });
  if (!r.ok) throw new Error(`Tokenfel ${r.status}`);
  const j = await r.json();
  const prev = loadTokens();
  saveTokens({
    access: j.access_token,
    refresh: j.refresh_token ?? prev?.refresh,
    expires: Date.now() + j.expires_in * 1000 - 30_000,
    // A refresh never widens the granted scopes; only a fresh login does.
    scopes: params.grant_type === 'authorization_code' ? SCOPES : prev?.scopes,
  });
}

let refreshing = null;

/** Returns a valid access token, refreshing it if needed. null = must log in again. */
export async function getToken() {
  const t = loadTokens();
  if (!t) return null;
  if (Date.now() < t.expires) return t.access;
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh })
    .finally(() => { refreshing = null; });
  try {
    await refreshing;
  } catch {
    logout();
    return null;
  }
  return loadTokens()?.access ?? null;
}
