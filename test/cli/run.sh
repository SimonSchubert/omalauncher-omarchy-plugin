#!/usr/bin/env bash

# bin/omarchy-widgets against a store served from a temp folder: the starter
# widgets (no store), install,
# a tampered download, remove, publish's checks before it reaches GitHub (a
# stub gh that fails if it is ever called), and share links.
#
#   test/cli/run.sh        (needs python3, jq, curl, sha256sum: run it on Linux
#                           or in test/desktop's container)

set -uo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
bin=$here/../../bin/omarchy-widgets
t=$(mktemp -d)
trap 'kill $server 2>/dev/null; rm -rf "$t"' EXIT

mkdir -p "$t/store/widgets/ann/clock" "$t/stub"
printf 'widget "clock" {\n  meta { description: "A clock for testing"; version: "1.0"; license: "MIT" }\n  Text { text: "12:00" }\n}\n' >"$t/store/widgets/ann/clock/widget.owl"
sha=$(sha256sum "$t/store/widgets/ann/clock/widget.owl" | cut -d' ' -f1)
jq -n --arg sha "$sha" '{format: 1, widgets: [
  {id: "ann/clock", name: "clock", author: "ann", version: "1.0", description: "A clock for testing", path: "widgets/ann/clock/widget.owl", sha256: $sha, commands: ["date"], requires: {pacman: ["coreutils"]}},
  {id: "ann/bad", name: "bad", author: "ann", version: "1.0", description: "Tampered", path: "widgets/ann/clock/widget.owl", sha256: "0000"}
]}' >"$t/store/index.json"

port=$((20000 + RANDOM % 20000))
(cd "$t/store" && exec python3 -m http.server "$port" >/dev/null 2>&1) &
server=$!
for _ in $(seq 50); do curl -fs "http://127.0.0.1:$port/index.json" >/dev/null && break; sleep 0.1; done

printf '#!/bin/sh\necho "gh must not be called" >&2; exit 99\n' >"$t/stub/gh"
chmod +x "$t/stub/gh"
export PATH=$t/stub:$PATH OMARCHY_WIDGETS_STORE=http://127.0.0.1:$port
export OWL_WIDGETS=$t/widgets XDG_STATE_HOME=$t/state XDG_CACHE_HOME=$t/cache
# No agent unless a test gives one: the scripted publish below.
export OMARCHY_WIDGETS_AGENT=$t/no-agent

failed=0
check() { # name, expected exit, expected output, command...
  local name=$1 want=$2 grep=$3; shift 3
  local out code
  out=$("$@" 2>&1); code=$?
  if [[ $code == "$want" ]] && grep -q -- "$grep" <<<"$out"; then echo "ok - $name"
  else echo "not ok - $name (exit $code)"; sed 's/^/    /' <<<"$out"; failed=1; fi
}

# A new board: the starter widgets come from the app, not the store.
check "starter copies the shipped widgets" 0 "" env OMARCHY_WIDGETS_STORE=http://127.0.0.1:1 "$bin" starter
check "all three, as their store names" 0 "" test -f "$t/widgets/market-simonschubert-today.owl" -a -f "$t/widgets/market-simonschubert-fetch.owl" -a -f "$t/widgets/market-simonschubert-koi-pond.owl"
check "byte for byte" 0 "" cmp "$here/../../starter/market-simonschubert-fetch.owl" "$t/widgets/market-simonschubert-fetch.owl"
check "recorded as store installs" 0 "market-simonschubert-fetch.owl" jq -r '."simonschubert/fetch".file' "$t/state/omarchy-widgets/installed.json"
check "with their places" 0 "koi-pond" cat "$t/state/omarchy-widgets/board.json"
rm "$t/widgets/market-simonschubert-today.owl"
check "only once" 0 "" "$bin" starter
check "a removed one stays removed" 1 "" test -e "$t/widgets/market-simonschubert-today.owl"
rm -rf "$t/widgets" "$t/state"

check "install checks and records" 0 "installed" "$bin" install --yes ann/clock
check "installed as market-<author>-<name>.owl" 0 "" test -f "$t/widgets/market-ann-clock.owl"
check "the record keeps the approved commands" 0 '"date"' jq -c '."ann/clock".commands' "$t/state/omarchy-widgets/installed.json"
check "a tampered download is refused" 1 "doesn't match" "$bin" install --yes ann/bad
check "and leaves nothing behind" 1 "" test -e "$t/widgets/market-ann-bad.owl"
check "an unknown id" 1 "no widget" "$bin" install --yes ann/none
check "a malformed id" 1 "not a store id" "$bin" install --yes "../x"
check "remove" 0 "removed" "$bin" remove ann/clock
check "removed from disk" 1 "" test -e "$t/widgets/market-ann-clock.owl"

printf 'widget "Mine" {\n  Text { text: "x" }\n}\n' >"$t/mine.owl"
cp "$t/store/widgets/ann/clock/widget.owl" "$t/market-ann-clock.owl"
check "publish refuses a store copy" 1 "came from the store" "$bin" publish --yes "$t/market-ann-clock.owl"
check "publish needs meta" 1 "needs meta" "$bin" publish --yes "$t/mine.owl"
printf 'widget "Mine" {\n  meta { description: "short"; version: "1.0"; license: "MIT" }\n}\n' >"$t/mine.owl"
check "publish checks the description" 1 "10 to 200" "$bin" publish --yes "$t/mine.owl"

# With Omarchy's agent, as on the phone: edit, check and publish start it in
# the widgets folder with a prompt about the file (a stub records them).
printf '#!/bin/sh\n{ pwd; printf "%%s\\n" "$@"; } >>"%s/agent.log"\n' "$t" >"$t/stub/agent"
chmod +x "$t/stub/agent"
mkdir -p "$t/widgets"
printf 'widget "Ours" {\n  Text { text: "x" }\n}\n' >"$t/widgets/ours.owl"
for c in edit check publish; do
  : >"$t/agent.log"
  check "$c starts the agent" 0 "Opened your agent" env OMARCHY_WIDGETS_AGENT="$t/stub/agent" "$bin" "$c" "$t/widgets/ours.owl"
  for _ in $(seq 20); do [[ -s $t/agent.log ]] && break; sleep 0.1; done
  check "$c: in the widgets folder, about the file" 0 "ours.owl" sh -c "head -1 '$t/agent.log' | grep -qx '$t/widgets' && cat '$t/agent.log'"
done
check "publish with an agent still refuses a store copy" 1 "came from the store" env OMARCHY_WIDGETS_AGENT="$t/stub/agent" "$bin" publish "$t/market-ann-clock.owl"

# Sharing: a link the launcher reads (Share.kt), and back.
printf 'widget "Hi There" {\n  Text { text: "hi" }\n}\n' >"$t/hi.owl"
link=$("$bin" share "$t/hi.owl")
check "share makes a store link" 0 "^https://simonschubert.github.io/omarchy-widgets/w#owl1\." echo "$link"
check "import adds it as shared-<name>.owl" 0 "added" "$bin" import --yes "$link"
check "and the file is the same" 0 "" cmp "$t/hi.owl" "$t/widgets/shared-hi-there.owl"
check "the launcher's own link imports" 0 "added" "$bin" import --yes "owl1.K89MSU8tUVDKyFRSqOZSUAhJrShRqFYoAVJWENFarlouAA"
check "a damaged link is refused" 1 "damaged\|not a widget" "$bin" import --yes "owl1.AAAAbroken"
head -c 4000 /dev/urandom | base64 >"$t/big.owl"
check "a widget too big for one code says so" 1 "too big for one QR code" "$bin" share "$t/big.owl"
head -c 300000 /dev/zero | tr '\0' a >"$t/huge.owl"
check "one over the launcher's 256 KB is refused" 1 "over 256 KB" "$bin" share "$t/huge.owl"
bomb=$(head -c 5000000 /dev/zero | perl -MIO::Compress::RawDeflate=rawdeflate -MMIME::Base64=encode_base64url -e 'local $/; my $in = <STDIN>; rawdeflate(\$in => \my $out); print "owl1.", encode_base64url($out)')
check "a link that unpacks huge is refused" 1 "over 256 KB" "$bin" import --yes "$bomb"
# Too big for one code: the launcher's link holds a dpaste id instead.
cp "$t/hi.owl" "$t/store/AbCd1234.txt"
export OMARCHY_WIDGETS_PASTE=http://127.0.0.1:$port
check "a dpaste link imports" 0 "added" "$bin" import --yes "https://simonschubert.github.io/omarchy-widgets/w#dpaste.AbCd1234"
check "and the file is the pasted one" 0 "" cmp "$t/hi.owl" "$t/widgets/shared-hi-there.owl"
check "an expired paste says so" 1 "expired" "$bin" import --yes "https://simonschubert.github.io/omarchy-widgets/w#dpaste.Gone1234"
head -c 300000 /dev/zero | tr '\0' a >"$t/store/Huge1234.txt"
check "a paste over 256 KB is refused" 1 "over 256 KB" "$bin" import --yes "w#dpaste.Huge1234"
if command -v qrencode >/dev/null; then
  check "share --png draws the code" 0 "" "$bin" share --png="$t/qr.png" "$t/hi.owl"
  check "a PNG" 0 "PNG" file "$t/qr.png"
fi

exit $failed
