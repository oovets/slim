# slim

A minimal, text-only Spotify player for macOS. No album art, no feeds, no clutter: your playlists, your liked songs, a queue, and keyboard shortcuts.

Plain HTML/CSS/JS frontend in `slim/`, wrapped as a macOS app with Tauri 2 in `src-tauri/`. Playback uses the Spotify Web Playback SDK.

## Install

Download the latest `.dmg` from [Releases](https://github.com/oovets/slim/releases), open it and drag **slim** to Applications. Apple Silicon (M1 or newer), macOS 11+.

The app is not signed with an Apple Developer ID, so macOS blocks it the first time. Either open **System Settings → Privacy & Security** and click **Open Anyway** after trying to launch it, or run once:

```bash
xattr -dr com.apple.quarantine /Applications/slim.app
```

## Set up Spotify (once)

Spotify requires every app to use a developer Client ID, so you create your own (free, takes a minute). You also need **Spotify Premium**; the Web Playback SDK does not work on free accounts.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Add this redirect URI, exactly: `http://127.0.0.1:5173/` (`localhost` is rejected).
3. Under "APIs used", tick **Web Playback SDK** (and Web API).
4. Open slim, paste the app's **Client ID** and click **Connect**.

Spotify limits apps in development mode to 5 users and requires the app owner to have Premium, which is plenty for personal use.

## Shortcuts

Press `?` in the app for the list.

| Key | Action |
|---|---|
| space | play / pause |
| ↑ ↓ or j k | select track |
| enter | play selected |
| ← → | seek 10 s |
| n / p | next / previous |
| s / r | shuffle / repeat |
| q | add to queue |
| a | add to playlist |
| d | play on another device |
| ⌫ ⌫ | remove from playlist |
| ⌥ ↑ / ⌥ ↓ | move track in playlist |
| + / − | volume |
| / | filter (search view: search) |
| l | like |
| t | theme (auto / light / dark) |
| ⌘ + / ⌘ − / ⌘ 0 | zoom |

## What it can and cannot do

Spotify's API only lets apps read the tracks of playlists you own or collaborate on. Other playlists can still be played, but their track list can't be shown. Recommendations, audio analysis, lyrics and offline downloads are not available to third-party apps.

## Develop

```bash
pnpm install
pnpm tauri dev      # serves slim/ with python on :5173 and opens the app window
```

Web only (no app): `python3 -m http.server 5173 --bind 127.0.0.1 --directory slim`, then open http://127.0.0.1:5173/ (`?demo` = fake data, no login).

## Build

```bash
pnpm tauri build    # -> src-tauri/target/release/bundle/{macos/slim.app,dmg/*.dmg}
```

Release builds serve the embedded frontend on `127.0.0.1:5173` (see `src-tauri/src/main.rs`) so the login redirect works. Quit `pnpm tauri dev` before running the built app, since both use port 5173.

## License

[MIT](LICENSE)
