#!/usr/bin/env bash

# Screenshots of the app in a real Quickshell, under headless sway in an Arch
# container.
#
#   test/desktop/run.sh <omarchy checkout> <widgets folder> [out dir]
#
# Env: THEME=tokyo-night, RES=1920x1080, INSTALL=<author/name> (installed from
# the live store first), ARRANGE=<file> (arrange.png) with KEYS="Down Left"
# typed while arranging, SCREEN=<file> (screen.png), STORE=1 (store.png),
# PAGE=<author/name> (page.png, that widget's store page), SHARE=<file>
# (share.png, its QR code).

set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
app=$(cd -- "$here/../.." && pwd)
omarchy=${1:?omarchy checkout, for its themes}
widgets=${2:?widgets folder}
out=${3:-$here/out}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/theme" "$out"
cp "$omarchy/themes/${THEME:-tokyo-night}/colors.toml" "$work/theme/"
cp -r "$widgets" "$work/widgets"

docker build --platform linux/amd64 -q -t omarchy-widgets-test "$here" >/dev/null
docker run --rm --platform linux/amd64 --cap-add=SYS_NICE \
  -e THEME -e RES -e INSTALL -e ARRANGE -e KEYS -e SCREEN -e STORE -e PAGE -e SHARE -e WAIT -e WAIT_STORE \
  -v "$work:/work:ro" -v "$app:/app:ro" -v "$out:/out" \
  omarchy-widgets-test /app/test/desktop/inside.sh
echo "screenshots in $out"
