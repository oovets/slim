#!/bin/bash
# Renders docs/screenshot-light.png and docs/screenshot-dark.png from the app's built-in demo data
# (fake playlists, no login, none of your real data). Needs Google Chrome; set CHROME to use another.
set -euo pipefail
cd "$(dirname "$0")/../.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set CHROME=...)" >&2; exit 1; }

tmp=$(mktemp -d)
srv=""
trap '[ -n "$srv" ] && kill "$srv" 2>/dev/null; rm -rf "$tmp"' EXIT
cp -R slim "$tmp/app"
cp scripts/screenshots/shot.html "$tmp/"
port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$tmp" >/dev/null 2>&1 &
srv=$!
disown "$srv" # keeps bash from printing "Terminated" when the trap kills it
sleep 1

mkdir -p docs
for theme in light dark; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=1100,740 --default-background-color=00000000 --virtual-time-budget=8000 \
    --screenshot="docs/screenshot-$theme.png" "http://127.0.0.1:$port/shot.html?theme=$theme" >/dev/null 2>&1
  echo "wrote docs/screenshot-$theme.png"
done
