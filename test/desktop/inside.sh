#!/bin/bash
# Inside the container (see run.sh): headless sway, the app, screenshots.
export XDG_RUNTIME_DIR=/tmp/xdg; mkdir -p -m 700 $XDG_RUNTIME_DIR
export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 QT_QPA_PLATFORM=wayland
mkdir -p ~/.local/state/omarchy/current/theme
cp /work/theme/colors.toml ~/.local/state/omarchy/current/theme/
echo "${THEME:-tokyo-night}" > ~/.local/state/omarchy/current/theme.name
# One window, filling the output, as a tiled app would.
printf 'xwayland disable\noutput HEADLESS-1 resolution %s\ndefault_border none\n' "${RES:-1920x1080}" > /tmp/sway.conf
sway -c /tmp/sway.conf >/tmp/sway.log 2>&1 &
for i in $(seq 50); do ls $XDG_RUNTIME_DIR/wayland-* >/dev/null 2>&1 && break; sleep 0.2; done
export WAYLAND_DISPLAY=$(basename $(ls $XDG_RUNTIME_DIR/wayland-* | grep -v lock | head -1))

cp -r /app /tmp/app
export OWL_WIDGETS=$HOME/.config/omarchy-widgets
mkdir -p $OWL_WIDGETS && cp /work/widgets/*.owl $OWL_WIDGETS/ 2>/dev/null
# The store install, as the app runs it, before the app starts.
[ -n "$INSTALL" ] && /tmp/app/bin/omarchy-widgets install --yes $INSTALL > /out/install.log 2>&1
ipc() { qs -p /tmp/app/shell.qml ipc call "$@"; }

quickshell -p /tmp/app/shell.qml >/tmp/qs.log 2>&1 &
sleep ${WAIT:-14}
grim /out/board.png
if [ -n "$ARRANGE" ]; then ipc widgets arrange "$ARRANGE"; sleep 2; grim /out/arrange.png
  for k in $KEYS; do wtype -k $k; sleep 0.5; done; sleep 1; wtype -k Escape; sleep 1; fi
if [ -n "$SCREEN" ]; then ipc widgets screen "$SCREEN"; sleep 3; grim /out/screen.png; wtype -k Escape; sleep 1; fi
ipc widgets list > /out/list.json
if [ -n "$STORE" ]; then ipc app tab store; sleep ${WAIT_STORE:-15}; grim /out/store.png; fi
cp ~/.local/state/omarchy-widgets/*.json /out/ 2>/dev/null
cp /tmp/qs.log /out/qs.log
if [ -n "$PAGE" ]; then ipc app store "$PAGE"; sleep ${WAIT_STORE:-15}; grim /out/page.png; fi
if [ -n "$SHARE" ]; then ipc app tab board; sleep 1; ipc widgets share "$SHARE"; sleep 4; grim /out/share.png; fi
