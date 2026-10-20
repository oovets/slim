# slim

A minimal, text-only Spotify player for macOS. No album art, no feeds, no clutter: your playlists, your liked songs, a queue, and keyboard shortcuts.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
    <img alt="slim showing a playlist, with a track playing" src="docs/screenshot-light.png" width="860">
  </picture>
</p>

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

Spotify's API only lets apps created recently read the tracks of playlists you own or collaborate on. Other playlists can still be played, but by default their track list can't be shown (see the optional fallback below). Recommendations, audio analysis, lyrics and offline downloads are not available to third-party apps.

## Fallback sign-in (optional, desktop app)

Spotify's limit applies per *app registration* (Client ID), not per account. Some older registrations, such as the one used by the open-source [ncspot](https://github.com/hrkfdn/ncspot) client, predate the restriction and can still read other people's playlists. [spotify-player](https://github.com/aome510/spotify-player) uses it by default.

slim can do the same, but only if you say yes. Open a playlist you don't own, click **Show tracks…** and confirm (or use `fallback` in the sidebar). slim then asks you to sign in a second time, read-only, under that registration, and uses it for other people's playlists only. Everything else keeps using your own Client ID. Click `fallback: on` again to turn it off.

What you should know before enabling it:

- It uses another project's shared API quota. If that quota runs out you will see `429` errors, and heavy use by many people could get the registration restricted, which would also hurt ncspot and spotify-player users.
- Spotify's developer terms expect every app to use its own credentials (section VI.1), so this goes beyond them. It's your call; slim never does it without your confirmation.
- It needs the desktop app: the sign-in callback comes back on `http://127.0.0.1:8989/login`, which the app listens on and forwards. If another program already uses port 8989 the option won't work.

## Develop

```bash
pnpm install
pnpm tauri dev      # serves slim/ with python on :5173 and opens the app window
```

Web only (no app): `python3 -m http.server 5173 --bind 127.0.0.1 --directory slim`, then open http://127.0.0.1:5173/ (`?demo` = fake data, no login).

The screenshots above are rendered from the demo data (no login, nothing from a real account). Regenerate them after UI changes with `./scripts/screenshots/make.sh` (needs Google Chrome).

## Build

```bash
pnpm tauri build    # -> src-tauri/target/release/bundle/{macos/slim.app,dmg/*.dmg}
```

Release builds serve the embedded frontend on `127.0.0.1:5173` (see `src-tauri/src/main.rs`) so the login redirect works. Quit `pnpm tauri dev` before running the built app, since both use port 5173.

## License

[MIT](LICENSE)
