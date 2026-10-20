# slim

Minimal Spotify player (web). No build step, no dependencies.

## Run

```bash
python3 -m http.server 5173 --bind 127.0.0.1
```

Open http://127.0.0.1:5173/ (not `localhost` – Spotify rejects it as a redirect URI).

## Spotify dashboard setup

1. developer.spotify.com/dashboard → your app → Settings
2. Add redirect URI: `http://127.0.0.1:5173/`
3. Enable "Web Playback SDK" (and Web API) under "APIs used"
4. Paste the Client ID in the app on first start

`?demo` runs the UI with fake data and no login.

## Files

- `js/auth.js` – PKCE login + token refresh
- `js/api.js` – Web API (Feb 2026 endpoints: `/playlists/{id}/items`, `/me/library`)
- `js/player.js` – Web Playback SDK
- `js/demo.js` – offline fake backend
- `js/main.js` – UI
