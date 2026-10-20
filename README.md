# slim

Minimal Spotify player. Plain HTML/CSS/JS frontend in `slim/`, wrapped as a macOS app with Tauri 2 in `src-tauri/`. Playback uses the Spotify Web Playback SDK, so Premium is required.

## Spotify dashboard

Redirect URI: `http://127.0.0.1:5173/` (exactly; `localhost` is rejected). Enable "Web Playback SDK". The Client ID is pasted into the app on first start.

## Develop

```bash
pnpm install
pnpm tauri dev      # serves slim/ with python on :5173 and opens the app window
```

Web only (no app): `python3 -m http.server 5173 --bind 127.0.0.1 --directory slim`, then open http://127.0.0.1:5173/ (`?demo` = fake data, no login).

## Build the app

```bash
pnpm tauri build    # -> src-tauri/target/release/bundle/macos/slim.app
```

Release builds serve the embedded frontend on `127.0.0.1:5173` (see `src-tauri/src/main.rs`) so the login redirect works. Quit `pnpm tauri dev` before running the built app, since both use port 5173.

The app is ad-hoc signed, which is fine for running on the machine that built it.

## Shortcuts

space play/pause, j/k or arrows select, enter play, left/right seek 10s, n/p next/prev, +/- volume, / filter or search, l like, t theme, cmd +/-/0 zoom, ? help.
